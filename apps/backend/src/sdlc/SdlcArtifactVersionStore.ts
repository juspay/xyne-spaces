import { createHash } from 'crypto';
import {
  isBaselineCanvasType,
  parseSdlcSourcePaths,
  parseSdlcSourceReferences,
  sdlcRepoIds,
  SDLC_MEMBERSHIP_RELATION,
} from '@xyne/shared';
import { Prisma, type PrismaClient } from '@prisma/client';
import { DatabaseClient } from '@/database/client';
import { AppError } from '@/middleware/errorHandler';
import { convertBlockNoteToMarkdown } from '@/services/canvasService';
import type { BlockNoteBlock } from '@/types/blockNoteTypes';
import { isWikiArchiveFolder, normalizeWikiRelativePath } from './wiki/wikiPaths';
import {
  parseWikiExecutionContext,
  parseWikiExecutionOutput,
  type WikiRevisionEvidence,
} from './wiki/wikiRunState';
import { canvasIdsForRepos } from './sdlcChannelMembership';

export type SdlcArtifactVersionSelector =
  | { type: 'WIKI_PAGE'; path: string; includeArchived?: boolean }
  | { type: 'SDLC_CANVAS'; canvasId: string };

type RevisionStatus = 'FINALIZED' | 'PENDING' | 'CURRENT_METADATA';

interface RevisionRecord {
  revision: WikiRevisionEvidence;
  status: RevisionStatus;
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
  path: string | null;
  artifactKind: 'WIKI' | 'BASELINE' | 'ARTIFACT';
  archived: boolean;
  content: Prisma.JsonValue | null;
  repoId: string | null;
}

function metadataRecord(value: Prisma.JsonValue | null): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function wikiActionFromVersionName(name: string): WikiRevisionEvidence['action'] | null {
  if (name.startsWith('Wiki audit @')) return 'refined';
  const match = name.match(/: (create|created|update|updated|archive|archived|restore|restored|moved)$/);
  if (!match) return null;
  const raw = match[1];
  if (raw === 'create' || raw === 'created') return 'created';
  if (raw === 'archive' || raw === 'archived') return 'archived';
  if (raw === 'restore' || raw === 'restored') return 'restored';
  if (raw === 'moved') return 'moved';
  return 'updated';
}

function artifactKindForCanvasType(
  artifactType: string | null | undefined
): ResolvedArtifact['artifactKind'] | null {
  if (!artifactType) return null;
  if (artifactType === 'WIKI') return 'WIKI';
  return isBaselineCanvasType(artifactType) ? 'BASELINE' : 'ARTIFACT';
}

function shortCommitRef(commitSha: string): string {
  return commitSha === 'ROOT_BOOTSTRAP' ? commitSha : commitSha.slice(0, 12);
}

function agentRevision(record: RevisionRecord | undefined) {
  if (!record) return null;
  return {
    ...record.revision,
    commitSha: shortCommitRef(record.revision.commitSha),
    sourceReferences: record.revision.sourceReferences?.map(reference => ({
      ...reference,
      commitSha: shortCommitRef(reference.commitSha),
    })),
    status: record.status,
  };
}

function versionSummary(
  version: {
    id: string;
    name: string;
    contentHash: string;
    createdBy: string | null;
    createdAt: Date;
  },
  record: RevisionRecord | undefined
) {
  const revision = record?.revision;
  const historicalIdentity = revision?.path || revision?.title
    ? { path: revision.path ?? null, title: revision.title ?? null }
    : null;
  const archived = revision?.archived ?? (
    revision?.action === 'archived' ? true : revision?.action === 'restored' ? false : null
  );
  return {
    versionId: version.id,
    name: version.name,
    createdAt: version.createdAt.toISOString(),
    createdBy: version.createdBy,
    contentHash: version.contentHash,
    origin: revision ? 'WIKI_PIPELINE' as const : 'CANVAS' as const,
    checkpointRef: revision ? shortCommitRef(revision.commitSha) : null,
    action: revision?.action ?? null,
    archived,
    historicalIdentity,
    metadataStatus:
      record?.status === 'CURRENT_METADATA'
        ? 'inferred' as const
        : historicalIdentity?.path && historicalIdentity.title
          ? 'exact' as const
          : 'unavailable' as const,
    sourceEvidence: revision
      ? {
          sourcePathCount: revision.sourcePaths.length,
          sourceReferenceCount: revision.sourceReferences?.length ?? 0,
          status: record?.status ?? null,
        }
      : null,
  };
}

export class SdlcArtifactVersionStore {
  constructor(private readonly prisma: PrismaClient = DatabaseClient.getInstance()) {}

  async listArtifacts(
    input: SdlcArtifactScopeInput & {
      kinds?: Array<'WIKI' | 'BASELINE' | 'ARTIFACT'>;
      includeArchived?: boolean;
    }
  ) {
    const scope = await this.requireScope(input);
    const canvases = await this.prisma.canvas.findMany({
      where: {
        channelId: scope.channelId,
        workspaceId: input.workspaceId,
        projectId: scope.projectId,
        // A hub can cover several repositories, so the artifact's repository is part of
        ...(await this.canvasFilter(scope)),
        sdlcArtifact: { is: { artifactStatus: { not: 'REFRESH_CANDIDATE' } } },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        title: true,
        sdlcArtifact: { select: { artifactType: true, repoId: true } },
        metadata: true,
        updatedAt: true,
        folder: { select: { name: true } },
      },
    });
    const wanted = new Set(input.kinds ?? []);
    return canvases.flatMap(canvas => {
      const metadata = metadataRecord(canvas.metadata);
      const artifactKind = artifactKindForCanvasType(canvas.sdlcArtifact?.artifactType);
      if (!artifactKind) return [];
      if (wanted.size > 0 && !wanted.has(artifactKind)) return [];
      const archived = artifactKind === 'WIKI' && isWikiArchiveFolder(canvas.folder?.name);
      if (archived && !input.includeArchived) return [];
      return [{
        canvasId: canvas.id,
        title: canvas.title,
        artifactKind,
        repoId: canvas.sdlcArtifact?.repoId ?? null,
        path: artifactKind === 'WIKI' ? String(metadata.wikiRelativePath ?? '') : null,
        archived,
        updatedAt: canvas.updatedAt.toISOString(),
      }];
    });
  }

  async readArtifact(
    input: SdlcArtifactScopeInput & {
    selector: SdlcArtifactVersionSelector;
    }
  ) {
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
      artifact: this.publicArtifact(artifact),
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
    const evidence = artifact.artifactKind === 'WIKI'
      ? await this.loadWikiEvidence(artifact.repoId, artifact)
      : new Map<string, RevisionRecord>();
    return {
      artifact: this.publicArtifact(artifact),
      versions: page.map(version => versionSummary(version, evidence.get(version.id))),
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
    const evidence = artifact.artifactKind === 'WIKI'
      ? await this.loadWikiEvidence(artifact.repoId, artifact)
      : new Map<string, RevisionRecord>();
    const record = evidence.get(version.id);
    const blocks = Array.isArray(version.content)
      ? version.content as unknown as BlockNoteBlock[]
      : [];
    const markdown = await convertBlockNoteToMarkdown(blocks);
    return {
      artifact: this.publicArtifact(artifact),
      version: {
        ...versionSummary(version, record),
        markdown,
        markdownHash: createHash('sha256').update(markdown).digest('hex'),
        revisionEvidence: agentRevision(record),
      },
    };
  }

  private publicArtifact(artifact: ResolvedArtifact) {
    return {
      canvasId: artifact.canvasId,
      title: artifact.title,
      path: artifact.path,
      artifactKind: artifact.artifactKind,
      archived: artifact.archived,
    };
  }

  private async resolveArtifact(
    input: SdlcArtifactScopeInput & { selector: SdlcArtifactVersionSelector }
  ): Promise<ResolvedArtifact> {
    const scope = await this.requireScope(input);

    let wikiPath: string | null = null;
    if (input.selector.type === 'WIKI_PAGE') {
      try {
        wikiPath = normalizeWikiRelativePath(input.selector.path);
      } catch (error) {
        throw new AppError(
          error instanceof Error ? error.message : 'Invalid Wiki path',
          400
        );
      }
    }
    const selectedCanvasId = input.selector.type === 'SDLC_CANVAS'
      ? input.selector.canvasId
      : null;
    const pages = wikiPath
      ? await this.prisma.canvas.findMany({
          where: {
            channelId: scope.channelId,
            workspaceId: input.workspaceId,
            projectId: scope.projectId,
            ...(await this.canvasFilter(scope)),
            sdlcArtifact: { is: { artifactType: 'WIKI' } },
          },
          select: {
            id: true,
            title: true,
            sdlcArtifact: { select: { artifactType: true, repoId: true } },
            metadata: true,
            content: true,
            folder: { select: { name: true } },
          },
        })
      : [];
    let wikiMatches: typeof pages = [];
    if (wikiPath) {
      wikiMatches = pages.filter(page => {
        const metadata = metadataRecord(page.metadata);
        return metadata.wikiRelativePath === wikiPath;
      });
      if (wikiMatches.length > 1) {
        const owners = wikiMatches
          .map(page => page.sdlcArtifact?.repoId)
          .filter((id): id is string => Boolean(id));
        throw new AppError(
          `Several repositories in this hub have a Wiki page at "${wikiPath}". Name one in repoIds: ${owners.join(', ')}`,
          409
        );
      }
    }
    const canvas = wikiPath
      ? wikiMatches[0] ?? null
      : await this.prisma.canvas.findFirst({
          where: {
            id: selectedCanvasId!,
            channelId: scope.channelId,
            workspaceId: input.workspaceId,
            projectId: scope.projectId,
            ...(await this.canvasFilter(scope)),
            sdlcArtifact: { is: { artifactType: { not: 'DEFAULT' } } },
          },
          select: {
            id: true,
            title: true,
            sdlcArtifact: { select: { artifactType: true, repoId: true } },
            metadata: true,
            content: true,
            folder: { select: { name: true } },
          },
        });
    if (!canvas) throw new AppError('SDLC artifact not found', 404);
    const metadata = metadataRecord(canvas.metadata);

    if (input.selector.type === 'WIKI_PAGE') {
      if (canvas.sdlcArtifact?.artifactType !== 'WIKI') {
        throw new AppError('SDLC artifact not found', 404);
      }
      const archived = isWikiArchiveFolder(canvas.folder?.name);
      if (archived && !input.selector.includeArchived) {
        throw new AppError('SDLC artifact not found', 404);
      }
      return {
        canvasId: canvas.id,
        title: canvas.title,
        path: String(metadata.wikiRelativePath),
        artifactKind: 'WIKI',
        archived,
        content: canvas.content,
        repoId: canvas.sdlcArtifact?.repoId ?? null,
      };
    }

    const artifactKind = artifactKindForCanvasType(canvas.sdlcArtifact?.artifactType);
    if (!artifactKind || artifactKind === 'WIKI') {
      throw new AppError('SDLC artifact not found', 404);
    }
    return {
      canvasId: canvas.id,
      title: canvas.title,
      path: null,
      artifactKind,
      archived: false,
      content: canvas.content,
      repoId: canvas.sdlcArtifact?.repoId ?? null,
    };
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

    const [repos, memberships] = await Promise.all([
      this.prisma.repo.findMany({
        where: { id: { in: named }, workspaceId: input.workspaceId, projectId: { not: null } },
        select: { id: true, projectId: true },
      }),
      this.prisma.sdlcEntityLink.findMany({
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
      }),
    ]);
    const reachable = new Set(memberships.map((m) => m.targetId));
    const projectId = repos.find((repo) => repo.projectId)?.projectId;
    const channelId = input.channelId ?? memberships[0]?.channelId;
    if (!projectId || !channelId || named.some((id: string) => !reachable.has(id))) {
      throw new AppError('SDLC artifact not found', 404);
    }
    if (!input.channelId && new Set(memberships.map((m) => m.channelId)).size > 1) {
      throw new AppError(
        'These repositories are reachable through more than one SDLC hub. Name the hub with channelId.',
        409
      );
    }
    return { repoIds: named, channelId, projectId };
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

  private async loadWikiEvidence(
    repoId: string | null,
    artifact: ResolvedArtifact
  ): Promise<Map<string, RevisionRecord>> {
    if (!repoId) return new Map();
    const links = await this.prisma.sdlcEntityLink.findMany({
      where: {
        sourceType: 'REPOSITORY',
        sourceId: repoId,
        targetType: 'WORKFLOW_EXECUTION',
        relationType: 'WIKI_RUN',
      },
      select: { targetId: true },
    });
    const executions = links.length === 0 ? [] : await this.prisma.workflowExecution.findMany({
      where: { id: { in: links.map(link => link.targetId) }, workflowType: 'SDLC_WIKI' },
      select: { context: true, output: true },
    });
    const evidence = new Map<string, RevisionRecord>();
    for (const execution of executions) {
      try {
        const output = parseWikiExecutionOutput(execution.output);
        for (const outcome of output.outcomes) {
          for (const revision of outcome.revisions) {
            if (revision.canvasId === artifact.canvasId) {
              evidence.set(revision.canvasVersionId, { revision, status: 'FINALIZED' });
            }
          }
        }
      } catch {
        // Legacy or partially written output is ignored; pending/current
        // evidence below can still make the durable snapshot readable.
      }
      try {
        if (!execution.context) continue;
        const context = parseWikiExecutionContext(execution.context);
        for (const pending of context.pendingCommit?.pages ?? []) {
          if (pending.revision.canvasId === artifact.canvasId && !evidence.has(pending.revision.canvasVersionId)) {
            evidence.set(pending.revision.canvasVersionId, {
              revision: pending.revision,
              status: 'PENDING',
            });
          }
        }
      } catch {
        // See output handling above.
      }
    }

    // Current-revision fallback for pruned/legacy executions: rebuild it from
    // the provenance row (sdlc_artifacts) plus the latest version row.
    const [entity, latestVersion] = await Promise.all([
      this.prisma.sdlcArtifact.findUnique({
        where: { artifactId: artifact.canvasId },
        select: { generationCommit: true, sourcePaths: true, sourceReferences: true },
      }),
      this.prisma.canvasVersion.findFirst({
        where: { canvasId: artifact.canvasId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true, name: true },
      }),
    ]);
    const action = latestVersion ? wikiActionFromVersionName(latestVersion.name) : null;
    if (
      latestVersion && !evidence.has(latestVersion.id) &&
      action && entity?.generationCommit
    ) {
      const blocks = Array.isArray(artifact.content)
        ? (artifact.content as unknown as BlockNoteBlock[])
        : [];
      const markdown = await convertBlockNoteToMarkdown(blocks);
      evidence.set(latestVersion.id, {
        status: 'CURRENT_METADATA',
        revision: {
          action,
          commitSha: entity.generationCommit,
          canvasId: artifact.canvasId,
          canvasVersionId: latestVersion.id,
          contentHash: createHash('sha256').update(markdown).digest('hex'),
          sourcePaths: parseSdlcSourcePaths(entity.sourcePaths),
          path: artifact.path ?? undefined,
          title: artifact.title,
          archived: artifact.archived,
          sourceReferences: parseSdlcSourceReferences(entity.sourceReferences),
        },
      });
    }
    return evidence;
  }
}
