import { createHash } from 'crypto';
import {
  isBaselineCanvasType,
  parseSdlcSourcePaths,
  parseSdlcSourceReferences,
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

export type SdlcArtifactVersionSelector =
  | { type: 'WIKI_PAGE'; path: string; includeArchived?: boolean }
  | { type: 'SDLC_CANVAS'; canvasId: string };

type RevisionStatus = 'FINALIZED' | 'PENDING' | 'CURRENT_METADATA';

interface RevisionRecord {
  revision: WikiRevisionEvidence;
  status: RevisionStatus;
}

interface ResolvedArtifact {
  canvasId: string;
  title: string;
  path: string | null;
  artifactKind: 'WIKI' | 'BASELINE' | 'ARTIFACT';
  archived: boolean;
  content: Prisma.JsonValue | null;
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

  async listArtifacts(input: {
    repoId: string;
    workspaceId: string;
    userId: string;
    kinds?: Array<'WIKI' | 'BASELINE' | 'ARTIFACT'>;
    includeArchived?: boolean;
  }) {
    const repo = await this.requireRepository(input);
    const canvases = await this.prisma.canvas.findMany({
      where: {
        channelId: repo.channelId,
        workspaceId: input.workspaceId,
        projectId: repo.projectId,
        // A hub can cover several repositories, so the artifact's repository is part of
        // what identifies it, not just the channel it renders in.
        sdlcArtifact: { is: { repoId: repo.id, artifactStatus: { not: 'REFRESH_CANDIDATE' } } },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        title: true,
        sdlcArtifact: { select: { artifactType: true } },
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
        path: artifactKind === 'WIKI' ? String(metadata.wikiRelativePath ?? '') : null,
        archived,
        updatedAt: canvas.updatedAt.toISOString(),
      }];
    });
  }

  async readArtifact(input: {
    repoId: string;
    workspaceId: string;
    userId: string;
    selector: SdlcArtifactVersionSelector;
  }) {
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

  async listVersions(input: {
    repoId: string;
    workspaceId: string;
    userId: string;
    selector: SdlcArtifactVersionSelector;
    cursor?: string;
    limit: number;
  }) {
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
      ? await this.loadWikiEvidence(input.repoId, artifact)
      : new Map<string, RevisionRecord>();
    return {
      artifact: this.publicArtifact(artifact),
      versions: page.map(version => versionSummary(version, evidence.get(version.id))),
      hasMore,
      nextCursor: hasMore ? page.at(-1)?.id ?? null : null,
    };
  }

  async readVersion(input: {
    repoId: string;
    workspaceId: string;
    userId: string;
    selector: SdlcArtifactVersionSelector;
    versionId: string;
  }) {
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
      ? await this.loadWikiEvidence(input.repoId, artifact)
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

  private async resolveArtifact(input: {
    repoId: string;
    workspaceId: string;
    userId: string;
    selector: SdlcArtifactVersionSelector;
  }): Promise<ResolvedArtifact> {
    const repo = await this.requireRepository(input);

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
            channelId: repo.channelId,
            workspaceId: input.workspaceId,
            projectId: repo.projectId,
            sdlcArtifact: { is: { artifactType: 'WIKI', repoId: repo.id } },
          },
          select: {
            id: true,
            title: true,
            sdlcArtifact: { select: { artifactType: true } },
            metadata: true,
            content: true,
            folder: { select: { name: true } },
          },
        })
      : [];
    const canvas = wikiPath
      ? pages.find(page => {
          const metadata = metadataRecord(page.metadata);
          return metadata.wikiRelativePath === wikiPath;
        }) ?? null
      : await this.prisma.canvas.findFirst({
          where: {
            id: selectedCanvasId!,
            channelId: repo.channelId,
            workspaceId: input.workspaceId,
            projectId: repo.projectId,
            sdlcArtifact: { is: { repoId: repo.id, artifactType: { not: 'DEFAULT' } } },
          },
          select: {
            id: true,
            title: true,
            sdlcArtifact: { select: { artifactType: true } },
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
    };
  }

  private async requireRepository(input: {
    repoId: string;
    workspaceId: string;
    userId: string;
  }) {
    const [repo, membership] = await Promise.all([
      this.prisma.repo.findFirst({
        where: { id: input.repoId, workspaceId: input.workspaceId, projectId: { not: null } },
        select: { id: true, projectId: true },
      }),
      // Membership is the read check: the actor must participate in a hub this
      // repository belongs to.
      this.prisma.sdlcEntityLink.findFirst({
        where: {
          workspaceId: input.workspaceId,
          targetType: 'REPOSITORY',
          targetId: input.repoId,
          relationType: SDLC_MEMBERSHIP_RELATION,
          channel: { participants: { some: { userId: input.userId } } },
        },
        orderBy: { createdAt: 'asc' },
        select: { channelId: true },
      }),
    ]);
    if (!repo?.projectId || !membership?.channelId) {
      throw new AppError('SDLC artifact not found', 404);
    }
    return { id: repo.id, channelId: membership.channelId, projectId: repo.projectId };
  }

  private async loadWikiEvidence(
    repoId: string,
    artifact: ResolvedArtifact
  ): Promise<Map<string, RevisionRecord>> {
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
