import { createHash } from 'crypto';
import { sdlcRepoIds, SDLC_MEMBERSHIP_RELATION } from '@xyne/shared';
import { Prisma, type PrismaClient } from '@prisma/client';
import { DatabaseClient } from '@/database/client';
import { AppError } from '@/middleware/errorHandler';
import { convertBlockNoteToMarkdown } from '@/services/canvasService';
import type { BlockNoteBlock } from '@/types/blockNoteTypes';
import { canvasIdsForRepos } from './sdlcChannelMembership';

export interface SdlcArtifactVersionSelector {
  type: 'SDLC_CANVAS';
  canvasId: string;
}

export interface SdlcArtifactScopeInput {
  workspaceId: string;
  userId: string;
  channelId?: string;
  repoId?: string;
  repoIds?: string[];
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
  async listArtifacts(input: SdlcArtifactScopeInput) {
    const scope = await this.requireScope(input);
    const canvases = await this.prisma.canvas.findMany({
      where: {
        channelId: scope.channelId,
        workspaceId: input.workspaceId,
        projectId: scope.projectId,
        ...(await this.canvasFilter(scope)),
        sdlcArtifact: { is: { artifactType: { not: 'WIKI' } } },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        title: true,
        sdlcArtifact: { select: { repoId: true } },
        updatedAt: true,
      },
    });
    return canvases.map((canvas) => ({
      canvasId: canvas.id,
      title: canvas.title,
      artifactKind: 'ARTIFACT' as const,
      repoId: canvas.sdlcArtifact?.repoId ?? null,
      updatedAt: canvas.updatedAt.toISOString(),
    }));
  }

  async readArtifact(input: SdlcArtifactScopeInput & { selector: SdlcArtifactVersionSelector }) {
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

  async listVersions(
    input: SdlcArtifactScopeInput & {
      selector: SdlcArtifactVersionSelector;
      cursor?: string;
      limit: number;
    }
  ) {
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

  async readVersion(
    input: SdlcArtifactScopeInput & {
      selector: SdlcArtifactVersionSelector;
      versionId: string;
    }
  ) {
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

  private async resolveArtifact(
    input: SdlcArtifactScopeInput & { selector: SdlcArtifactVersionSelector }
  ): Promise<ResolvedArtifact> {
    const scope = await this.requireScope(input);
    const canvas = await this.prisma.canvas.findFirst({
      where: {
        id: input.selector.canvasId,
        channelId: scope.channelId,
        workspaceId: input.workspaceId,
        projectId: scope.projectId,
        sdlcArtifact: { isNot: null },
      },
      select: { id: true, title: true, sdlcArtifact: { select: { artifactType: true } } },
    });
    if (!canvas) throw new AppError('SDLC artifact not found', 404);
    const artifactKind = canvas.sdlcArtifact?.artifactType === 'WIKI' ? 'WIKI' : 'ARTIFACT';
    // Wiki pages belong to a folder in the hub, not to a repository column.
    if (artifactKind === 'ARTIFACT' && scope.repoIds) {
      const inScope = await this.prisma.canvas.count({
        where: { id: canvas.id, ...(await this.canvasFilter(scope)) },
      });
      if (inScope === 0) throw new AppError('SDLC artifact not found', 404);
    }
    return { canvasId: canvas.id, title: canvas.title, artifactKind };
  }

  private async requireScope(input: SdlcArtifactScopeInput): Promise<{
    repoIds: string[] | null;
    channelId: string;
    projectId: string;
  }> {
    const named = sdlcRepoIds(input);
    if (named.length === 0) {
      if (!input.channelId) throw new AppError('An SDLC hub is required', 400);
      const channel = await this.prisma.channel.findFirst({
        where: {
          id: input.channelId,
          workspaceId: input.workspaceId,
          type: 'SDLC',
          participants: { some: { userId: input.userId } },
        },
        select: { id: true, projectId: true },
      });
      if (!channel?.projectId) throw new AppError('SDLC hub not found', 404);
      return { repoIds: null, channelId: channel.id, projectId: channel.projectId };
    }

    const memberships = await this.prisma.sdlcEntityLink.findMany({
      where: {
        workspaceId: input.workspaceId,
        sourceType: 'CHANNEL',
        targetType: 'REPOSITORY',
        targetId: { in: named },
        relationType: SDLC_MEMBERSHIP_RELATION,
        ...(input.channelId ? { channelId: input.channelId } : {}),
        channel: { participants: { some: { userId: input.userId } } },
      },
      orderBy: { createdAt: 'asc' },
      select: { channelId: true, targetId: true },
    });
    const reachable = new Set(memberships.map((m) => m.targetId));
    const channelId = input.channelId ?? memberships[0]?.channelId;
    if (!channelId || named.some((id: string) => !reachable.has(id))) {
      throw new AppError('SDLC artifact not found', 404);
    }
    if (!input.channelId && new Set(memberships.map((m) => m.channelId)).size > 1) {
      throw new AppError(
        'These repositories are reachable through more than one SDLC hub. Name the hub with channelId.',
        409
      );
    }
    // The hub's project, not the repository's: a hub may cover repositories from other projects.
    const channel = await this.prisma.channel.findFirst({
      where: { id: channelId, workspaceId: input.workspaceId },
      select: { projectId: true },
    });
    if (!channel?.projectId) throw new AppError('SDLC hub not found', 404);
    return { repoIds: named, channelId, projectId: channel.projectId };
  }

  private async canvasFilter(scope: {
    channelId: string;
    repoIds: string[] | null;
  }): Promise<Prisma.CanvasWhereInput> {
    if (!scope.repoIds) return {};
    const canvasIds = await canvasIdsForRepos(this.prisma, scope.channelId, scope.repoIds);
    return {
      OR: [
        ...(canvasIds.length > 0 ? [{ id: { in: canvasIds } }] : []),
        { sdlcArtifact: { is: { repoId: { in: scope.repoIds } } } },
      ],
    };
  }
}
