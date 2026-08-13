import { createHash, randomUUID } from 'crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import type {
  BeginSdlcWikiCheckpointInput,
  FinalizeSdlcWikiCommitInput,
  MoveSdlcWikiPageInput,
  SdlcWikiPageAction,
  WriteSdlcWikiPageInput,
} from '@xyne/shared';
import { DatabaseClient } from '@/database/client';
import { AppError } from '@/middleware/errorHandler';
import { vespaQueue } from '@/queues/vespaQueue';
import { convertBlockNoteToMarkdown, convertMarkdownToBlockNote } from '@/services/canvasService';
import type { BlockNoteBlock } from '@/types/blockNoteTypes';
import { readFromYSweet, syncToYSweet } from '@/utils/ysweetUtils';
import { fileSchema, SubApp } from '@/vespa/src/types';
import { sdlcChannelCanvasParticipant } from '../sdlcCanvasAccess';
import {
  assertWikiCommitAssignment,
  beginWikiCheckpoint,
  checkpointWikiCommit,
  parseWikiExecutionContext,
  parseWikiExecutionOutput,
  serializeWikiRunState,
  WikiCheckpointError,
  type WikiExecutionContext,
  type WikiRevisionEvidence,
} from './wikiRunState';
import { normalizeWikiRelativePath, WIKI_FOLDER_PREFIX, wikiFolderName } from './wikiPaths';
import { resolveWikiRevisionSources, wikiVersionIdentityHash } from './wikiRevisionPolicy';
import { shortestUniqueWikiCommitRef, wikiCommitRefUniverse } from './wikiCommitRefs';
import { mutateWikiMarkdownSection } from './wikiSectionMutation';
import { deriveWikiMapEntry, type WikiMapEntry } from './wikiMap';
import {
  githubWikiSourceUrl,
  resolveWikiSourceReferenceTokens,
  type WikiSourceReference,
} from './wikiSourceReferences';
import { auditWikiContent, type WikiAuditFinding } from './wikiContentAudit';
import { validateWikiMermaid } from './wikiMermaidValidation';

interface WikiPageStoreDependencies {
  readCanvas(canvasId: string): Promise<BlockNoteBlock[]>;
  syncCanvas(canvasId: string, content: BlockNoteBlock[]): Promise<boolean>;
  indexCanvas(input: { canvasId: string; userId: string; workspaceId: string }): Promise<void>;
  verifySourcePaths(repoId: string, commitSha: string, sourcePaths: string[]): Promise<void>;
  verifySourceRanges(
    repoId: string,
    commitSha: string,
    references: Array<{ path: string; startLine?: number; endLine?: number }>
  ): Promise<void>;
}

interface WikiPageRecord {
  id: string;
  title: string;
  content: Prisma.JsonValue;
  folderId: string | null;
  metadata: Prisma.JsonValue;
}

type WholeWikiPageAction = Extract<
  SdlcWikiPageAction,
  { action: 'create' | 'update' | 'restore' | 'archive' }
>;

function metadataRecord(value: Prisma.JsonValue | null): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function markdownHash(markdown: string): string {
  return createHash('sha256').update(markdown).digest('hex');
}

function metadataSourceReferences(value: unknown): WikiSourceReference[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(reference => {
    if (!reference || typeof reference !== 'object' || Array.isArray(reference)) return [];
    const candidate = reference as Record<string, unknown>;
    if (typeof candidate.path !== 'string' || typeof candidate.commitSha !== 'string') return [];
    return [{
      path: candidate.path,
      commitSha: candidate.commitSha,
      ...(typeof candidate.symbol === 'string' ? { symbol: candidate.symbol } : {}),
      ...(typeof candidate.startLine === 'number' ? { startLine: candidate.startLine } : {}),
      ...(typeof candidate.endLine === 'number' ? { endLine: candidate.endLine } : {}),
    }];
  });
}

function sourceReferenceKey(reference: WikiSourceReference): string {
  return JSON.stringify([
    reference.path,
    reference.commitSha,
    reference.symbol ?? null,
    reference.startLine ?? null,
    reference.endLine ?? null,
  ]);
}

const defaultDependencies: WikiPageStoreDependencies = {
  readCanvas: readFromYSweet,
  syncCanvas: syncToYSweet,
  async indexCanvas({ canvasId, userId, workspaceId }) {
    await vespaQueue.addJob({
      schema: fileSchema,
      docId: canvasId,
      jobType: 'feed',
      userId,
      workspaceId,
      app: SubApp.CANVAS,
    });
  },
  async verifySourcePaths() {
    throw new Error('Wiki source-path verifier is not configured');
  },
  async verifySourceRanges() {
    throw new Error('Wiki source-range verifier is not configured');
  },
};

export class SdlcWikiPageStore {
  constructor(
    private readonly prisma: PrismaClient = DatabaseClient.getInstance(),
    private readonly dependencies: WikiPageStoreDependencies = defaultDependencies
  ) {}

  static withSourceVerifier(
    verifySourcePaths: WikiPageStoreDependencies['verifySourcePaths'],
    verifySourceRanges: WikiPageStoreDependencies['verifySourceRanges'] = async () => undefined,
    prisma: PrismaClient = DatabaseClient.getInstance()
  ): SdlcWikiPageStore {
    return new SdlcWikiPageStore(prisma, {
      ...defaultDependencies,
      verifySourcePaths,
      verifySourceRanges,
    });
  }

  async listPages(input: {
    repoId: string;
    workspaceId: string;
    userId: string;
    includeArchived?: boolean;
    sourcePaths?: string[];
  }): Promise<
    Array<{
      path: string;
      title: string;
      canvasId: string;
      contentHash: string;
      sourcePaths: string[];
      lastCommitSha: string | null;
      archived: boolean;
    }>
  > {
    const repo = await this.requireReadableRepository(input);
    const pages = await this.prisma.canvas.findMany({
      where: { channelId: repo.channelId },
      select: { id: true, title: true, content: true, folderId: true, metadata: true },
    });
    const sourceFilter = new Set(input.sourcePaths ?? []);
    const summaries = await Promise.all(
      pages.flatMap((page) => {
        const metadata = metadataRecord(page.metadata);
        if (
          metadata.surface !== 'SDLC' ||
          metadata.documentKind !== 'WIKI' ||
          metadata.repoId !== input.repoId ||
          typeof metadata.wikiRelativePath !== 'string'
        ) {
          return [];
        }
        const archived = typeof metadata.wikiArchivedAt === 'string';
        if (archived && !input.includeArchived) return [];
        const sourcePaths = Array.isArray(metadata.wikiSourcePaths)
          ? metadata.wikiSourcePaths.filter((value): value is string => typeof value === 'string')
          : [];
        if (
          sourceFilter.size > 0 &&
          !sourcePaths.some((sourcePath) => sourceFilter.has(sourcePath))
        ) {
          return [];
        }
        return [
          (async () => {
            const markdown = await this.readLiveMarkdown(page);
            return {
              path: metadata.wikiRelativePath as string,
              title: page.title,
              canvasId: page.id,
              contentHash: markdownHash(markdown),
              sourcePaths,
              lastCommitSha:
                typeof metadata.wikiLastCommitSha === 'string' ? metadata.wikiLastCommitSha : null,
              archived,
            };
          })(),
        ];
      })
    );
    return summaries.sort((left, right) => left.path.localeCompare(right.path));
  }

  async wikiMap(input: {
    repoId: string;
    workspaceId: string;
    userId: string;
    includeArchived?: boolean;
  }): Promise<WikiMapEntry[]> {
    const pages = await this.listPages(input);
    return Promise.all(
      pages.map(async page => {
        const full = await this.readPage({ ...input, path: page.path });
        return deriveWikiMapEntry(full);
      })
    );
  }

  async contentAudit(input: {
    repoId: string;
    workspaceId: string;
    userId: string;
    targetHeadSha?: string;
    changedSourcePaths?: string[];
  }): Promise<WikiAuditFinding[]> {
    const pages = await this.listPages(input);
    const fullPages = await Promise.all(
      pages.map(page => this.readPage({ ...input, path: page.path }))
    );
    const staleSourcesByPath = new Map<string, string[]>();
    if (input.targetHeadSha) {
      await Promise.all(fullPages.map(async page => {
        const stale: string[] = [];
        for (const sourcePath of page.sourcePaths) {
          try {
            await this.dependencies.verifySourcePaths(input.repoId, input.targetHeadSha!, [sourcePath]);
          } catch {
            stale.push(sourcePath);
          }
        }
        if (stale.length > 0) staleSourcesByPath.set(page.path, stale);
      }));
    }
    return auditWikiContent({
      map: fullPages.map(deriveWikiMapEntry),
      markdownByPath: new Map(fullPages.map(page => [page.path, page.markdown])),
      staleSourcesByPath,
      previousContentLengthByPath: new Map(
        fullPages.flatMap(page => page.previousContentLength === null ? [] : [[page.path, page.previousContentLength]])
      ),
      mutationModeByPath: new Map(
        fullPages.flatMap(page => page.mutationMode === null ? [] : [[page.path, page.mutationMode]])
      ),
      changedSourcePaths: input.changedSourcePaths,
      runTargetSha: input.targetHeadSha,
    });
  }

  async readPage(input: {
    repoId: string;
    workspaceId: string;
    userId: string;
    path: string;
    includeArchived?: boolean;
  }): Promise<{
    path: string;
    title: string;
    canvasId: string;
    markdown: string;
    contentHash: string;
    sourcePaths: string[];
    sourceReferences: WikiSourceReference[];
    lastCommitSha: string | null;
    archived: boolean;
    previousContentLength: number | null;
    mutationMode: string | null;
  }> {
    const repo = await this.requireReadableRepository(input);
    const path = normalizeWikiRelativePath(input.path);
    const page = await this.findPage(repo.channelId, repo.id, path);
    if (!page) throw new AppError('Wiki page not found', 404);
    const metadata = metadataRecord(page.metadata);
    const archived = typeof metadata.wikiArchivedAt === 'string';
    if (archived && !input.includeArchived) throw new AppError('Wiki page not found', 404);
    const markdown = await this.readLiveMarkdown(page);
    return {
      path,
      title: page.title,
      canvasId: page.id,
      markdown,
      contentHash: markdownHash(markdown),
      sourcePaths: Array.isArray(metadata.wikiSourcePaths)
        ? metadata.wikiSourcePaths.filter((value): value is string => typeof value === 'string')
        : [],
      sourceReferences: metadataSourceReferences(
        archived ? metadata.wikiArchivedSourceReferences : metadata.wikiSourceReferences
      ),
      lastCommitSha:
        typeof metadata.wikiLastCommitSha === 'string' ? metadata.wikiLastCommitSha : null,
      archived,
      previousContentLength:
        typeof metadata.wikiPreviousContentLength === 'number'
          ? metadata.wikiPreviousContentLength
          : null,
      mutationMode:
        typeof metadata.wikiMutationMode === 'string' ? metadata.wikiMutationMode : null,
    };
  }

  async writePage(input: {
    sessionId: string;
    request: WriteSdlcWikiPageInput;
  }): Promise<{ revision: WikiRevisionEvidence; writtenPages: number }> {
    const execution = await this.prisma.workflowExecution.findUnique({
      where: { id: input.request.executionId },
      select: { id: true, context: true, output: true, createdBy: true },
    });
    if (!execution?.context || !execution.createdBy) {
      throw new AppError('Wiki execution not found', 404);
    }
    const context = parseWikiExecutionContext(execution.context);
    const output = parseWikiExecutionOutput(execution.output);
    try {
      assertWikiCommitAssignment({
        context,
        output,
        sessionId: input.sessionId,
        commitSha: input.request.commitSha,
      });
    } catch (error) {
      this.throwCheckpointError(error);
    }
    this.validatePageAction(input.request.page);

    const path = normalizeWikiRelativePath(input.request.page.path);
    const requestHash = createHash('sha256')
      .update(JSON.stringify(input.request.page))
      .digest('hex');
    const pending = context.pendingCommit ?? null;
    if (pending && pending.commitSha !== input.request.commitSha) {
      throw new AppError('[COMMIT_OUT_OF_ORDER] Another commit has pending Wiki pages', 409);
    }
    const recorded = pending?.pages.find((page) => page.path === path);
    if (
      context.assignedChunk?.kind === 'BOOTSTRAP_PAGE' &&
      context.bootstrapPlan
    ) {
      const plannedPath = normalizeWikiRelativePath(
        context.bootstrapPlan.correction?.path ??
          context.bootstrapPlan.pages[context.bootstrapPlan.nextPageIndex]?.path ??
          ''
      );
      if (path !== plannedPath) {
        throw new AppError(
          `[PAGE_NOT_ASSIGNED] This bootstrap run may write only ${plannedPath}; received ${path}`,
          409
        );
      }
      const writtenByThisRun = pending?.pages.find(
        page => page.writerSessionId === input.sessionId
      );
      if (writtenByThisRun?.path === path && writtenByThisRun.requestHash === requestHash) {
        return { revision: writtenByThisRun.revision, writtenPages: pending!.pages.length };
      }
      if (writtenByThisRun) {
        throw new AppError(
          `[PAGE_ALREADY_WRITTEN] Bootstrap page already written by this run: ${writtenByThisRun.path}. Submit the run result; corrections use a separately scheduled correction run.`,
          409
        );
      }
    }
    if (recorded) {
      if (recorded.requestHash !== requestHash) {
        // The same bound session may correct a page before finalization. The
        // latest mutation replaces its pending evidence atomically below.
        if (context.assignedChunk?.sessionId !== input.sessionId) {
          throw new AppError(`[CONTENT_CONFLICT] Wiki page already written for this commit: ${path}`, 409);
        }
      } else {
        return { revision: recorded.revision, writtenPages: pending!.pages.length };
      }
    }

    const repo = await this.prisma.repo.findUnique({
      where: { id: context.repoId },
      select: { id: true, workspaceId: true, projectId: true, channelId: true, url: true },
    });
    if (!repo?.workspaceId || !repo.projectId || !repo.channelId) {
      throw new AppError('Wiki repository is unavailable', 404);
    }
    const requestedReferences = (
      input.request.page as SdlcWikiPageAction & {
        sourceReferences?: Array<{
          path: string;
          symbol?: string;
          startLine?: number;
          endLine?: number;
        }>;
      }
    ).sourceReferences;
    await this.dependencies.verifySourcePaths(
      repo.id,
      input.request.commitSha,
      [...new Set([
        ...input.request.page.sourcePaths,
        ...(requestedReferences ?? []).map(reference => reference.path),
      ])]
    );
    await this.dependencies.verifySourceRanges(
      repo.id,
      input.request.commitSha,
      requestedReferences ?? []
    );
    const canonicalReferences: WikiSourceReference[] = (requestedReferences ?? []).map(reference => ({
      ...reference,
      commitSha: input.request.commitSha,
    }));
    const pageAction =
      input.request.page.action === 'archive' || !requestedReferences?.length
        ? input.request.page
        : {
            ...input.request.page,
            markdown: resolveWikiSourceReferenceTokens({
              markdown: input.request.page.markdown ?? '',
              repositoryUrl: repo.url,
              commitSha: input.request.commitSha,
              references: requestedReferences,
            }),
          };
    const action = await this.resolveSectionAction({
      repo: { channelId: repo.channelId, id: repo.id },
      action: pageAction,
    });
    if (action.action !== 'archive') validateWikiMermaid(action.markdown);
    const revision = await this.applyPageAction({
      repo: repo as {
        id: string;
        workspaceId: string;
        projectId: string;
        channelId: string;
        url: string;
      },
      actorId: execution.createdBy,
      sessionId: input.sessionId,
      commitSha: input.request.commitSha,
      displayCommitRef: shortestUniqueWikiCommitRef(
        input.request.commitSha,
        wikiCommitRefUniverse(context)
      ),
      action,
      sourceReferences: canonicalReferences,
      mutationMode: input.request.page.action,
      refinement: context.assignedChunk?.kind === 'CORRECTION',
    });
    const pages = [
      ...(pending?.pages ?? []).filter(page => page.path !== path),
      { path, requestHash, writerSessionId: input.sessionId, revision },
    ];
    const nextContext = parseWikiExecutionContext(
      serializeWikiRunState({
        ...context,
        pendingCommit: { commitSha: input.request.commitSha, pages },
      })
    );
    const recordedPage = await this.prisma.workflowExecution.updateMany({
      where: { id: execution.id, context: execution.context },
      data: { context: serializeWikiRunState(nextContext) },
    });
    if (recordedPage.count !== 1) {
      throw new AppError(
        '[CONTENT_CONFLICT] Wiki page evidence changed concurrently; retry this page',
        409
      );
    }
    return { revision, writtenPages: pages.length };
  }

  async beginCheckpoint(input: {
    sessionId: string;
    request: BeginSdlcWikiCheckpointInput;
  }): Promise<{ checkpointSha: string; endpointSha: string }> {
    const execution = await this.prisma.workflowExecution.findUnique({
      where: { id: input.request.executionId },
      select: { id: true, context: true },
    });
    if (!execution?.context) throw new AppError('Wiki execution not found', 404);
    const context = parseWikiExecutionContext(execution.context);
    let next: WikiExecutionContext;
    try {
      next = beginWikiCheckpoint({
        context,
        sessionId: input.sessionId,
        commitSha: input.request.commitSha,
      });
    } catch (error) {
      this.throwCheckpointError(error);
    }
    const endpointSha = next.assignedChunk?.window?.afterSha;
    if (!endpointSha) throw new AppError('Wiki history window is unavailable', 409);
    if (next !== context) {
      const begun = await this.prisma.workflowExecution.updateMany({
        where: { id: execution.id, context: execution.context },
        data: { context: serializeWikiRunState(next) },
      });
      if (begun.count !== 1) {
        throw new AppError(
          '[CONTENT_CONFLICT] Wiki checkpoint changed concurrently; retry begin',
          409
        );
      }
    }
    return { checkpointSha: input.request.commitSha, endpointSha };
  }

  async movePage(input: {
    sessionId: string;
    request: MoveSdlcWikiPageInput;
  }): Promise<{ revision: WikiRevisionEvidence; writtenPages: number }> {
    const execution = await this.prisma.workflowExecution.findUnique({
      where: { id: input.request.executionId },
      select: { id: true, context: true, output: true, createdBy: true },
    });
    if (!execution?.context || !execution.createdBy) throw new AppError('Wiki execution not found', 404);
    const context = parseWikiExecutionContext(execution.context);
    const output = parseWikiExecutionOutput(execution.output);
    try {
      assertWikiCommitAssignment({
        context,
        output,
        sessionId: input.sessionId,
        commitSha: input.request.commitSha,
      });
    } catch (error) {
      this.throwCheckpointError(error);
    }
    const sourcePath = normalizeWikiRelativePath(input.request.sourcePath);
    const destinationPath = normalizeWikiRelativePath(input.request.destinationPath);
    if (sourcePath === destinationPath) throw new AppError('Wiki move requires a different destination', 400);
    const requestHash = createHash('sha256').update(JSON.stringify(input.request)).digest('hex');
    const pending = context.pendingCommit ?? null;
    if (pending && pending.commitSha !== input.request.commitSha) {
      throw new AppError('[COMMIT_OUT_OF_ORDER] Another commit has pending Wiki pages', 409);
    }
    const recorded = pending?.pages.find((page) => page.path === destinationPath);
    if (recorded) {
      if (recorded.requestHash !== requestHash) {
        throw new AppError(`[CONTENT_CONFLICT] Wiki page already written for this commit: ${destinationPath}`, 409);
      }
      return { revision: recorded.revision, writtenPages: pending!.pages.length };
    }
    const repo = await this.prisma.repo.findUnique({
      where: { id: context.repoId },
      select: { id: true, workspaceId: true, projectId: true, channelId: true },
    });
    if (!repo?.workspaceId || !repo.projectId || !repo.channelId) throw new AppError('Wiki repository is unavailable', 404);
    const wikiRepo = {
      id: repo.id,
      workspaceId: repo.workspaceId,
      projectId: repo.projectId,
      channelId: repo.channelId,
    };
    const source = await this.findPage(wikiRepo.channelId, wikiRepo.id, sourcePath);
    const destination = await this.findPage(wikiRepo.channelId, wikiRepo.id, destinationPath);
    const recoveredMoveMetadata = metadataRecord(destination?.metadata ?? null);
    const recoveringDurableMove =
      !source &&
      destination &&
      recoveredMoveMetadata.wikiLastCommitSha === input.request.commitSha &&
      recoveredMoveMetadata.wikiRevisionKind === 'moved' &&
      recoveredMoveMetadata.wikiMovedFromPath === sourcePath &&
      typeof recoveredMoveMetadata.wikiCanvasVersionId === 'string';
    if (!source && !recoveringDurableMove) throw new AppError(`Wiki page does not exist: ${sourcePath}`, 409);
    if (source && destination) throw new AppError(`Wiki page already exists: ${destinationPath}`, 409);
    const page = source ?? destination!;
    const markdown = await this.readLiveMarkdown(page);
    const contentHash = markdownHash(markdown);
    if (contentHash !== input.request.expectedContentHash) {
      throw new AppError(`[CONTENT_CONFLICT] Wiki page changed concurrently: ${sourcePath}`, 409);
    }
    const metadata = metadataRecord(page.metadata);
    const sourcePaths = Array.isArray(metadata.wikiSourcePaths)
      ? metadata.wikiSourcePaths.filter((value): value is string => typeof value === 'string')
      : [];
    let moved = recoveredMoveMetadata.wikiCanvasVersionId as string | undefined;
    if (!recoveringDurableMove) {
      const folderId = await this.ensureFolder(wikiRepo, destinationPath, execution.createdBy);
      const canvasVersionId = randomUUID();
      const now = new Date();
      const displayCommitRef = shortestUniqueWikiCommitRef(
        input.request.commitSha,
        wikiCommitRefUniverse(context)
      );
      const versionIdentityHash = wikiVersionIdentityHash({
        markdown: `${sourcePath}\0${destinationPath}\0${markdown}`,
        revisionKind: 'moved',
        commitSha: input.request.commitSha,
      });
      moved = await this.prisma.$transaction(async (tx) => {
        const version = await tx.canvasVersion.upsert({
          where: { canvasId_contentHash: { canvasId: page.id, contentHash: versionIdentityHash } },
          create: {
            id: canvasVersionId,
            workspaceId: wikiRepo.workspaceId,
            canvasId: page.id,
            name: `Wiki ${displayCommitRef}: moved`,
            content: page.content as Prisma.InputJsonValue,
            contentHash: versionIdentityHash,
            createdBy: execution.createdBy!,
          },
          update: { updatedAt: now },
          select: { id: true },
        });
        await tx.canvas.update({
          where: { id: page.id },
          data: {
            folderId,
            ...(input.request.title ? { title: input.request.title } : {}),
            metadata: {
              ...metadata,
              wikiRelativePath: destinationPath,
              wikiLastCommitSha: input.request.commitSha,
              wikiRevisionSessionId: input.sessionId,
              wikiRevisionKind: 'moved',
              wikiCanvasVersionId: version.id,
              wikiMovedFromPath: sourcePath,
              wikiMovedToPath: destinationPath,
              wikiSyncedAt: now.toISOString(),
            },
            lastEditedBy: execution.createdBy!,
            lastEditedAt: now,
          },
        });
        return version.id;
      });
      if (page.folderId && page.folderId !== folderId) {
        await this.prisma.canvasFolder.deleteMany({
          where: {
            id: page.folderId,
            name: { startsWith: WIKI_FOLDER_PREFIX },
            canvases: { none: {} },
          },
        });
      }
    }
    const revision: WikiRevisionEvidence = {
      action: 'moved',
      commitSha: input.request.commitSha,
      canvasId: page.id,
      canvasVersionId: moved!,
      contentHash,
      sourcePaths,
      path: destinationPath,
      title: input.request.title ?? page.title,
      archived: typeof metadata.wikiArchivedAt === 'string',
      sourceReferences: metadataSourceReferences(
        typeof metadata.wikiArchivedAt === 'string'
          ? metadata.wikiArchivedSourceReferences
          : metadata.wikiSourceReferences
      ),
    };
    const pages = [...(pending?.pages ?? []), { path: destinationPath, requestHash, revision }];
    const nextContext = parseWikiExecutionContext(
      serializeWikiRunState({ ...context, pendingCommit: { commitSha: input.request.commitSha, pages } })
    );
    const recordedPage = await this.prisma.workflowExecution.updateMany({
      where: { id: execution.id, context: execution.context },
      data: { context: serializeWikiRunState(nextContext) },
    });
    if (recordedPage.count !== 1) {
      throw new AppError('[CONTENT_CONFLICT] Wiki page evidence changed concurrently; retry this page', 409);
    }
    await this.dependencies.indexCanvas({
      canvasId: page.id,
      userId: execution.createdBy,
      workspaceId: wikiRepo.workspaceId,
    });
    return { revision, writtenPages: pages.length };
  }

  async finalizeCommit(input: {
    sessionId: string;
    request: FinalizeSdlcWikiCommitInput;
  }): Promise<{ cursorSha: string | null; revisions: WikiRevisionEvidence[] }> {
    const execution = await this.prisma.workflowExecution.findUnique({
      where: { id: input.request.executionId },
      select: { id: true, context: true, output: true, createdBy: true },
    });
    if (!execution?.context || !execution.createdBy) {
      throw new AppError('Wiki execution not found', 404);
    }
    const context = parseWikiExecutionContext(execution.context);
    const output = parseWikiExecutionOutput(execution.output);
    try {
      assertWikiCommitAssignment({
        context,
        output,
        sessionId: input.sessionId,
        commitSha: input.request.commitSha,
      });
    } catch (error) {
      this.throwCheckpointError(error);
    }
    const pending = context.pendingCommit ?? null;
    if (pending && pending.commitSha !== input.request.commitSha) {
      throw new AppError('[COMMIT_OUT_OF_ORDER] Pending pages belong to another commit', 409);
    }
    const revisions = pending?.pages.map((page) => page.revision) ?? [];
    if (input.request.outcome === 'changes' && revisions.length === 0) {
      throw new AppError('Changed commits require at least one completed page write', 400);
    }
    if (input.request.outcome === 'noop' && revisions.length > 0) {
      throw new AppError('A commit with written pages cannot be finalized as no-op', 400);
    }

    let next: ReturnType<typeof checkpointWikiCommit>;
    try {
      next = checkpointWikiCommit({
        context,
        output,
        sessionId: input.sessionId,
        commitSha: input.request.commitSha,
        status: input.request.outcome === 'noop' ? 'noop' : 'updated',
        revisions,
        completedAt: new Date().toISOString(),
      });
    } catch (error) {
      this.throwCheckpointError(error);
    }
    const advanced = await this.prisma.workflowExecution.updateMany({
      where: { id: execution.id, context: execution.context, output: execution.output },
      data: {
        context: serializeWikiRunState(next.context),
        output: serializeWikiRunState(next.output),
      },
    });
    if (advanced.count !== 1) {
      throw new AppError(
        '[CONTENT_CONFLICT] Wiki checkpoint changed concurrently; retry finalization',
        409
      );
    }
    return { cursorSha: next.context.cursorSha, revisions };
  }

  private validatePageAction(action: SdlcWikiPageAction): void {
    normalizeWikiRelativePath(action.path);
    if (action.action !== 'archive' && action.sourcePaths.length === 0) {
      throw new AppError('Active Wiki pages require source paths', 400);
    }
    for (const sourcePath of action.sourcePaths) {
      if (
        !sourcePath ||
        sourcePath.startsWith('/') ||
        sourcePath.includes('\\') ||
        sourcePath.split('/').includes('..')
      ) {
        throw new AppError(`Invalid Wiki source path: ${sourcePath}`, 400);
      }
    }
  }

  private async resolveSectionAction(input: {
    repo: { channelId: string; id: string };
    action: SdlcWikiPageAction;
  }): Promise<WholeWikiPageAction> {
    if (!['replace_section', 'insert_section', 'remove_section'].includes(input.action.action)) {
      return input.action as WholeWikiPageAction;
    }
    const sectionAction = input.action as unknown as {
      action: 'replace_section' | 'insert_section' | 'remove_section';
      path: string;
      expectedContentHash: string;
      heading: string;
      markdown?: string;
      sourcePaths: string[];
    };
    const page = await this.findPage(input.repo.channelId, input.repo.id, sectionAction.path);
    if (!page) throw new AppError(`Wiki page does not exist: ${sectionAction.path}`, 409);
    const markdown = await this.readLiveMarkdown(page);
    if (markdownHash(markdown) !== sectionAction.expectedContentHash) {
      throw new AppError(
        `[CONTENT_CONFLICT] Wiki page changed concurrently: ${sectionAction.path}`,
        409
      );
    }
    return {
      action: 'update',
      path: sectionAction.path,
      expectedContentHash: sectionAction.expectedContentHash,
      title: page.title,
      markdown: mutateWikiMarkdownSection({
        markdown,
        action: sectionAction.action,
        heading: sectionAction.heading,
        sectionMarkdown: sectionAction.markdown,
      }),
      sourcePaths: sectionAction.sourcePaths,
    };
  }

  private async applyPageAction(input: {
    repo: {
      id: string;
      workspaceId: string;
      projectId: string;
      channelId: string;
      url: string;
    };
    actorId: string;
    sessionId: string;
    commitSha: string;
    displayCommitRef: string;
    action: WholeWikiPageAction;
    sourceReferences: WikiSourceReference[];
    mutationMode: SdlcWikiPageAction['action'];
    refinement: boolean;
  }): Promise<WikiRevisionEvidence> {
    const path = normalizeWikiRelativePath(input.action.path);
    const existing = await this.findPage(input.repo.channelId, input.repo.id, path);
    const existingMetadata = metadataRecord(existing?.metadata ?? null);
    const priorSourceReferences = metadataSourceReferences(
      input.action.action === 'restore'
        ? existingMetadata.wikiArchivedSourceReferences
        : existingMetadata.wikiSourceReferences
    );
    const evidenceAction = this.evidenceAction(input.action.action, input.refinement);
    const revisionSources = resolveWikiRevisionSources({
      action: input.action.action,
      requestedSourcePaths: input.action.sourcePaths,
      currentSourcePaths: existingMetadata.wikiSourcePaths,
      archivedSourcePaths: existingMetadata.wikiArchivedSourcePaths,
    });
    const requestedContentHash =
      input.action.action === 'archive'
        ? existingMetadata.wikiContentHash
        : markdownHash(input.action.markdown);
    if (
      existing &&
      existingMetadata.wikiLastCommitSha === input.commitSha &&
      existingMetadata.wikiRevisionKind === evidenceAction &&
      typeof existingMetadata.wikiCanvasVersionId === 'string' &&
      typeof existingMetadata.wikiContentHash === 'string' &&
      existingMetadata.wikiContentHash === requestedContentHash
    ) {
      if (input.action.action !== 'archive') {
        const repaired = await this.dependencies.syncCanvas(
          existing.id,
          existing.content as unknown as BlockNoteBlock[]
        );
        if (!repaired) throw new AppError(`Y-Sweet sync failed for Wiki page: ${path}`, 503);
      }
      await this.dependencies.indexCanvas({
        canvasId: existing.id,
        userId: input.actorId,
        workspaceId: input.repo.workspaceId,
      });
      return {
        action: evidenceAction,
        commitSha: input.commitSha,
        canvasId: existing.id,
        canvasVersionId: existingMetadata.wikiCanvasVersionId,
        contentHash: existingMetadata.wikiContentHash,
        sourcePaths: revisionSources.evidenceSourcePaths,
        path,
        title: existing.title,
        archived: typeof existingMetadata.wikiArchivedAt === 'string',
        sourceReferences: priorSourceReferences,
      };
    }
    if (input.action.action === 'create' && existing) {
      throw new AppError(`Wiki page already exists: ${path}`, 409);
    }
    if (input.action.action !== 'create' && !existing) {
      throw new AppError(`Wiki page does not exist: ${path}`, 409);
    }

    const currentContent = existing ? await this.readLiveContent(existing) : [];
    const currentMarkdown = await convertBlockNoteToMarkdown(currentContent);
    const currentHash = markdownHash(currentMarkdown);
    if (input.action.action !== 'create' && input.action.expectedContentHash !== currentHash) {
      throw new AppError(`[CONTENT_CONFLICT] Wiki page changed concurrently: ${path}`, 409);
    }

    const markdown = input.action.action === 'archive' ? currentMarkdown : input.action.markdown;
    const sourceReferences = input.action.action === 'archive'
      ? priorSourceReferences
      : [...new Map(
          [...priorSourceReferences, ...input.sourceReferences]
            .filter(reference => {
              try {
                return markdown.includes(githubWikiSourceUrl({
                  repositoryUrl: input.repo.url,
                  reference,
                }));
              } catch {
                return false;
              }
            })
            .map(reference => [sourceReferenceKey(reference), reference])
        ).values()];
    const content =
      input.action.action === 'archive'
        ? currentContent
        : await convertMarkdownToBlockNote(markdown);
    if (input.action.action !== 'archive' && content.length === 0) {
      throw new AppError(`Wiki Markdown produced no Canvas blocks: ${path}`, 400);
    }
    const contentHash = markdownHash(markdown);
    const canvasVersionId = randomUUID();
    const now = new Date();
    const archived = input.action.action === 'archive';
    const metadata: Prisma.InputJsonObject = {
      ...existingMetadata,
      source: 'sdlc-wiki-pipeline',
      surface: 'SDLC',
      documentKind: 'WIKI',
      repoId: input.repo.id,
      projectId: input.repo.projectId,
      repositoryUrl: input.repo.url,
      wikiRelativePath: path,
      wikiSourcePaths: revisionSources.activeSourcePaths,
      wikiSourceReferences: (archived ? [] : sourceReferences) as unknown as Prisma.InputJsonArray,
      wikiArchivedSourceReferences: archived
        ? sourceReferences as unknown as Prisma.InputJsonArray
        : null,
      wikiArchivedSourcePaths:
        input.action.action === 'archive' ? revisionSources.evidenceSourcePaths : null,
      wikiLastCommitSha: input.commitSha,
      wikiRevisionSessionId: input.sessionId,
      wikiRevisionKind: evidenceAction,
      wikiContentHash: contentHash,
      wikiPreviousContentLength: existing ? currentMarkdown.length : 0,
      wikiMutationMode: input.mutationMode,
      wikiCanvasVersionId: canvasVersionId,
      wikiSyncedAt: now.toISOString(),
      ...(archived
        ? { wikiArchivedAt: now.toISOString(), wikiArchivedByCommit: input.commitSha }
        : { wikiArchivedAt: null, wikiArchivedByCommit: null }),
    };
    const folderId = await this.ensureFolder(input.repo, path, input.actorId);
    const versionIdentityHash = wikiVersionIdentityHash({
      markdown,
      revisionKind: evidenceAction,
      commitSha: input.commitSha,
    });

    const canvas = existing
      ? await this.prisma.$transaction(async (tx) => {
          const version = await tx.canvasVersion.upsert({
            where: {
              canvasId_contentHash: { canvasId: existing.id, contentHash: versionIdentityHash },
            },
            create: {
              id: canvasVersionId,
              workspaceId: input.repo.workspaceId,
              canvasId: existing.id,
              name: input.refinement
                ? `Wiki audit @ ${input.displayCommitRef}`
                : `Wiki ${input.displayCommitRef}: ${input.action.action}`,
              content: content as unknown as Prisma.InputJsonValue,
              contentHash: versionIdentityHash,
              createdBy: input.actorId,
            },
            update: { updatedAt: now },
            select: { id: true },
          });
          await tx.canvas.update({
            where: { id: existing.id },
            data: {
              ...(input.action.action === 'archive'
                ? {}
                : {
                    title: input.action.title,
                    content: content as unknown as Prisma.InputJsonValue,
                  }),
              folderId,
              metadata: { ...metadata, wikiCanvasVersionId: version.id },
              lastEditedBy: input.actorId,
              lastEditedAt: now,
            },
          });
          return { id: existing.id, versionId: version.id };
        })
      : await this.prisma.$transaction(async (tx) => {
          const canvasId = randomUUID();
          const created = await tx.canvas.create({
            data: {
              id: canvasId,
              workspaceId: input.repo.workspaceId,
              title: input.action.action === 'create' ? input.action.title : path,
              content: content as unknown as Prisma.InputJsonValue,
              channelId: input.repo.channelId,
              folderId,
              projectId: input.repo.projectId,
              createdBy: input.actorId,
              lastEditedBy: input.actorId,
              lastEditedAt: now,
              viewAccessId: randomUUID(),
              visibility: 'PRIVATE',
              isCollaborative: true,
              metadata,
              participants: {
                create: sdlcChannelCanvasParticipant(input.repo.workspaceId, input.repo.channelId),
              },
            },
            select: { id: true },
          });
          await tx.canvasVersion.create({
            data: {
              id: canvasVersionId,
              workspaceId: input.repo.workspaceId,
              canvasId: created.id,
              name: `Wiki ${input.displayCommitRef}: created`,
              content: content as unknown as Prisma.InputJsonValue,
              contentHash: versionIdentityHash,
              createdBy: input.actorId,
            },
          });
          return { id: created.id, versionId: canvasVersionId };
        });

    if (input.action.action !== 'archive') {
      const synced = await this.dependencies.syncCanvas(canvas.id, content);
      if (!synced) throw new AppError(`Y-Sweet sync failed for Wiki page: ${path}`, 503);
    }
    await this.dependencies.indexCanvas({
      canvasId: canvas.id,
      userId: input.actorId,
      workspaceId: input.repo.workspaceId,
    });
    return {
      action: evidenceAction,
      commitSha: input.commitSha,
      canvasId: canvas.id,
      canvasVersionId: canvas.versionId,
      contentHash,
      sourcePaths: revisionSources.evidenceSourcePaths,
      path,
      title: input.action.action === 'archive' ? existing!.title : input.action.title,
      archived,
      sourceReferences,
    };
  }

  private evidenceAction(
    action: WholeWikiPageAction['action'],
    refinement: boolean
  ): WikiRevisionEvidence['action'] {
    if (refinement) return 'refined';
    if (action === 'create') return 'created';
    if (action === 'archive') return 'archived';
    if (action === 'restore') return 'restored';
    return 'updated';
  }

  private throwCheckpointError(error: unknown): never {
    if (error instanceof WikiCheckpointError) {
      throw new AppError(`[${error.code}] ${error.message}`, 409);
    }
    throw error;
  }

  private async readLiveMarkdown(page: WikiPageRecord): Promise<string> {
    return convertBlockNoteToMarkdown(await this.readLiveContent(page));
  }

  private async readLiveContent(page: WikiPageRecord): Promise<BlockNoteBlock[]> {
    const live = await this.dependencies.readCanvas(page.id);
    return live.length > 0 ? live : (page.content as unknown as BlockNoteBlock[]);
  }

  private async findPage(
    channelId: string,
    repoId: string,
    path: string
  ): Promise<WikiPageRecord | null> {
    const pages = await this.prisma.canvas.findMany({
      where: { channelId },
      select: { id: true, title: true, content: true, folderId: true, metadata: true },
    });
    return (
      pages.find((page) => {
        const metadata = metadataRecord(page.metadata);
        return (
          metadata.surface === 'SDLC' &&
          metadata.documentKind === 'WIKI' &&
          metadata.repoId === repoId &&
          metadata.wikiRelativePath === path
        );
      }) ?? null
    );
  }

  private async requireReadableRepository(input: {
    repoId: string;
    workspaceId: string;
    userId: string;
  }): Promise<{ id: string; channelId: string }> {
    const repo = await this.prisma.repo.findFirst({
      where: {
        id: input.repoId,
        workspaceId: input.workspaceId,
        channel: { participants: { some: { userId: input.userId } } },
      },
      select: { id: true, channelId: true },
    });
    if (!repo?.channelId) throw new AppError('SDLC repository not found', 404);
    return { id: repo.id, channelId: repo.channelId };
  }

  private async ensureFolder(
    repo: {
      workspaceId: string;
      projectId: string;
      channelId: string;
    },
    path: string,
    actorId: string
  ): Promise<string> {
    const name = wikiFolderName(path);
    const folder = await this.prisma.canvasFolder.upsert({
      where: {
        projectId_channelId_name: {
          projectId: repo.projectId,
          channelId: repo.channelId,
          name,
        },
      },
      create: {
        workspaceId: repo.workspaceId,
        projectId: repo.projectId,
        channelId: repo.channelId,
        name,
        createdBy: actorId,
      },
      update: {},
      select: { id: true },
    });
    return folder.id;
  }
}

export { WIKI_FOLDER_PREFIX };
