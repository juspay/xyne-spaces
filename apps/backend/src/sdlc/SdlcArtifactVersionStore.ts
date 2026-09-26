import { createHash } from 'crypto';
import {
  buildSdlcPath,
  sdlcSectionForCanvas,
  SDLC_CONTAINMENT_RELATION,
  SDLC_TRACK_FLAT_RELATION,
} from '@xyne/shared';
import { type PrismaClient } from '@prisma/client';
import { DatabaseClient } from '@/database/client';
import { AppError } from '@/middleware/errorHandler';
import { convertBlockNoteToMarkdown } from '@/services/canvasService';
import type { BlockNoteBlock } from '@/types/blockNoteTypes';
import { requireSdlcHubReader } from './sdlcChannelMembership';

export interface SdlcActorInput {
  workspaceId: string;
  userId: string;
}

export interface SdlcArtifactListInput extends SdlcActorInput {
  channelId: string;
  /** The artifact type (PRDs, Tech Docs, ...); stored as a CanvasFolder. */
  artifactTypeId?: string;
  trackId?: string;
  /** An SdlcFolder inside a track; lists what sits directly in it. */
  trackFolderId?: string;
  includeArchived?: boolean;
}

interface ResolvedArtifact {
  canvasId: string;
  title: string;
  artifactKind: 'WIKI' | 'ARTIFACT';
}

function versionSummary(version: {
  id: string;
  name: string;
  contentHash: string;
  createdBy: string | null;
  createdAt: Date;
}) {
  return {
    versionId: version.id,
    name: version.name,
    createdAt: version.createdAt.toISOString(),
    createdBy: version.createdBy,
    contentHash: version.contentHash,
  };
}

export class SdlcArtifactVersionStore {
  constructor(private readonly prisma: PrismaClient = DatabaseClient.getInstance()) {}

  /** Wiki pages are listed by the wiki tree, not here. */
  async listArtifacts(input: SdlcArtifactListInput) {
    await requireSdlcHubReader(this.prisma, input, input.channelId);
    const all = await this.prisma.canvas.findMany({
      where: {
        channelId: input.channelId,
        workspaceId: input.workspaceId,
        ...(input.artifactTypeId ? { folderId: input.artifactTypeId } : {}),
        sdlcArtifact: {
          is: {
            artifactType: { not: 'WIKI' },
            ...(input.includeArchived ? {} : { artifactStatus: 'ACTIVE' }),
          },
        },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        title: true,
        folderId: true,
        updatedAt: true,
        sdlcArtifact: { select: { artifactType: true, artifactStatus: true } },
      },
    });
    const edges = await this.prisma.sdlcEntityLink.findMany({
      where: {
        channelId: input.channelId,
        targetType: 'CANVAS',
        targetId: { in: all.map((canvas) => canvas.id) },
        OR: [
          { sourceType: 'TRACK', relationType: SDLC_TRACK_FLAT_RELATION },
          { sourceType: 'FOLDER', relationType: SDLC_CONTAINMENT_RELATION },
        ],
      },
      select: { sourceType: true, sourceId: true, targetId: true },
    });
    const trackOf = new Map(edges.filter((edge) => edge.sourceType === 'TRACK').map((edge) => [edge.targetId, edge.sourceId]));
    const trackFolderOf = new Map(edges.filter((edge) => edge.sourceType === 'FOLDER').map((edge) => [edge.targetId, edge.sourceId]));
    const canvases = all.filter(
      (canvas) =>
        (!input.trackId || trackOf.get(canvas.id) === input.trackId) &&
        (!input.trackFolderId || trackFolderOf.get(canvas.id) === input.trackFolderId)
    );
    const [types, tracks, trackFolders] = await Promise.all([
      this.prisma.canvasFolder.findMany({
        where: { id: { in: canvases.map((canvas) => canvas.folderId).filter((id): id is string => !!id) } },
        select: { id: true, name: true },
      }),
      this.prisma.sdlcTrack.findMany({ where: { id: { in: [...trackOf.values()] } }, select: { id: true, name: true } }),
      this.prisma.sdlcFolder.findMany({ where: { id: { in: [...trackFolderOf.values()] } }, select: { id: true, name: true } }),
    ]);
    const nameOf = new Map([...types, ...tracks, ...trackFolders].map((row) => [row.id, row.name]));
    const ref = (id: string | null | undefined) => (id ? { id, name: nameOf.get(id) ?? '' } : null);
    return canvases.map((canvas) => {
      const trackId = trackOf.get(canvas.id);
      const place = sdlcSectionForCanvas(canvas.sdlcArtifact?.artifactType, canvas.folderId);
      return {
        canvasId: canvas.id,
        title: canvas.title,
        url: buildSdlcPath({ channelId: input.channelId, ...place, canvasId: canvas.id, ...(trackId ? { trackId } : {}) }),
        artifactType: ref(canvas.folderId),
        track: ref(trackId),
        trackFolder: ref(trackFolderOf.get(canvas.id)),
        archived: canvas.sdlcArtifact?.artifactStatus === 'ARCHIVED',
        updatedAt: canvas.updatedAt.toISOString(),
      };
    });
  }

  async readArtifact(input: SdlcActorInput & { canvasId: string }) {
    const artifact = await this.resolveArtifact(input);
    const canvas = await this.prisma.canvas.findUnique({
      where: { id: artifact.canvasId },
      select: { content: true },
    });
    if (!canvas) throw new AppError('SDLC artifact not found', 404);
    const blocks = Array.isArray(canvas.content)
      ? canvas.content as unknown as BlockNoteBlock[]
      : [];
    const markdown = await convertBlockNoteToMarkdown(blocks);
    return {
      artifact,
      markdown,
      contentHash: createHash('sha256').update(markdown).digest('hex'),
    };
  }

  async listVersions(input: SdlcActorInput & { canvasId: string; cursor?: string; limit: number }) {
    const artifact = await this.resolveArtifact(input);
    if (input.cursor) {
      const cursor = await this.prisma.canvasVersion.findFirst({
        where: { id: input.cursor, canvasId: artifact.canvasId },
        select: { id: true },
      });
      if (!cursor) throw new AppError('Invalid artifact version cursor', 400);
    }
    const rows = await this.prisma.canvasVersion.findMany({
      where: { canvasId: artifact.canvasId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: input.limit + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        name: true,
        contentHash: true,
        createdBy: true,
        createdAt: true,
      },
    });
    const hasMore = rows.length > input.limit;
    const page = hasMore ? rows.slice(0, input.limit) : rows;
    return {
      artifact,
      versions: page.map(versionSummary),
      hasMore,
      nextCursor: hasMore ? page.at(-1)?.id ?? null : null,
    };
  }

  async readVersion(input: SdlcActorInput & { canvasId: string; versionId: string }) {
    const artifact = await this.resolveArtifact(input);
    const version = await this.prisma.canvasVersion.findFirst({
      where: { id: input.versionId, canvasId: artifact.canvasId },
      select: {
        id: true,
        name: true,
        content: true,
        contentHash: true,
        createdBy: true,
        createdAt: true,
      },
    });
    if (!version) throw new AppError('SDLC artifact version not found', 404);
    const blocks = Array.isArray(version.content)
      ? version.content as unknown as BlockNoteBlock[]
      : [];
    const markdown = await convertBlockNoteToMarkdown(blocks);
    return {
      artifact,
      version: {
        ...versionSummary(version),
        markdown,
        markdownHash: createHash('sha256').update(markdown).digest('hex'),
      },
    };
  }

  /** The hub comes from the canvas, so reads need only the canvas id. */
  private async resolveArtifact(input: SdlcActorInput & { canvasId: string }): Promise<ResolvedArtifact> {
    const canvas = await this.prisma.canvas.findFirst({
      where: { id: input.canvasId, workspaceId: input.workspaceId, sdlcArtifact: { isNot: null } },
      select: { id: true, title: true, channelId: true, sdlcArtifact: { select: { artifactType: true } } },
    });
    if (!canvas?.channelId) throw new AppError('SDLC artifact not found', 404);
    await requireSdlcHubReader(this.prisma, input, canvas.channelId);
    const artifactKind = canvas.sdlcArtifact?.artifactType === 'WIKI' ? 'WIKI' : 'ARTIFACT';
    return { canvasId: canvas.id, title: canvas.title, artifactKind };
  }

  // Every canvas in a hub is readable by the hub today; per-canvas privacy would need a canvas check here.
}
