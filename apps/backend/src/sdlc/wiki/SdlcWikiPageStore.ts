import { createHash, randomUUID } from 'crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import type {
  BeginSdlcWikiCheckpointInput,
  FinalizeSdlcWikiCommitInput,
  MoveSdlcWikiPageInput,
  SdlcWikiPageAction,
  WriteSdlcWikiPageInput,
} from '@xyne/shared';
import { SDLC_MEMBERSHIP_RELATION } from '@xyne/shared';
import { DatabaseClient } from '@/database/client';
import { AppError } from '@/middleware/errorHandler';
import { vespaQueue } from '@/queues/vespaQueue';
import { convertBlockNoteToMarkdown, convertMarkdownToBlockNote } from '@/services/canvasService';
import type { BlockNoteBlock } from '@/types/blockNoteTypes';
import { readFromYSweet, syncToYSweet } from '@/utils/ysweetUtils';
import { fileSchema, SubApp } from '@/vespa/src/types';
import {
  parseSdlcSourcePaths,
  parseSdlcSourceReferences,
  stringifySdlcSourcePaths,
  stringifySdlcSourceReferences,
} from '@xyne/shared';
import { sdlcChannelCanvasParticipant } from '../sdlcCanvasAccess';
import { resolveSdlcChannelId } from '../sdlcChannelMembership';
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
import {
  isWikiArchiveFolder,
  normalizeWikiRelativePath,
  WIKI_FOLDER_PREFIX,
  wikiArchiveFolderName,
  wikiFolderName,
} from './wikiPaths';
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
  folder: { name: string } | null;
  metadata: Prisma.JsonValue;
}

interface WikiEntityRecord {
  workflowExecutionId: string | null;
  generationCommit: string | null;
  sourceReferences: string | null;
  sourcePaths: string | null;
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
      where: {
        channelId: repo.channelId,
        sdlcArtifact: { is: { artifactType: 'WIKI' } },
      },
      select: {
        id: true,
        title: true,
        content: true,
        folderId: true,
        folder: { select: { name: true } },
        metadata: true,
      },
    });
    const entities = await this.entityRows(pages.map((page) => page.id));
    const sourceFilter = new Set(input.sourcePaths ?? []);
    const summaries = await Promise.all(
      pages.flatMap((page) => {
        const metadata = metadataRecord(page.metadata);
        if (typeof metadata.wikiRelativePath !== 'string') {
          return [];
        }
        const archived = isWikiArchiveFolder(page.folder?.name);
        if (archived && !input.includeArchived) return [];
        const entity = entities.get(page.id);
        const sourcePaths = parseSdlcSourcePaths(entity?.sourcePaths);
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
              lastCommitSha: entity?.generationCommit ?? null,
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
  }> {
    const repo = await this.requireReadableRepository(input);
    const path = normalizeWikiRelativePath(input.path);
    const page = await this.findPage(repo.channelId, repo.id, path);
    if (!page) throw new AppError('Wiki page not found', 404);
    const archived = isWikiArchiveFolder(page.folder?.name);
    if (archived && !input.includeArchived) throw new AppError('Wiki page not found', 404);
    const entity = await this.entityRow(page.id);
    const markdown = await this.readLiveMarkdown(page);
    return {
      path,
      title: page.title,
      canvasId: page.id,
      markdown,
      contentHash: markdownHash(markdown),
      sourcePaths: parseSdlcSourcePaths(entity?.sourcePaths),
      sourceReferences: parseSdlcSourceReferences(entity?.sourceReferences),
      lastCommitSha: entity?.generationCommit ?? null,
      archived,
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
      select: { id: true, workspaceId: true, projectId: true, url: true },
    });
    const channelId =
      context.channelId ?? (repo && (await resolveSdlcChannelId(this.prisma, repo.id)));
    if (!repo?.workspaceId || !repo.projectId || !channelId) {
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
      repo: { channelId, id: repo.id },
      action: pageAction,
    });
    if (action.action !== 'archive') validateWikiMermaid(action.markdown);
    const revision = await this.applyPageAction({
      repo: { ...repo, workspaceId: repo.workspaceId, projectId: repo.projectId, channelId },
      actorId: execution.createdBy,
      executionId: execution.id,
      sessionId: input.sessionId,
      commitSha: input.request.commitSha,
      displayCommitRef: shortestUniqueWikiCommitRef(
        input.request.commitSha,
        wikiCommitRefUniverse(context)
      ),
      action,
      sourceReferences: canonicalReferences,
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
      select: { id: true, workspaceId: true, projectId: true },
    });
    const channelId =
      context.channelId ?? (repo && (await resolveSdlcChannelId(this.prisma, repo.id)));
    if (!repo?.workspaceId || !repo.projectId || !channelId) throw new AppError('Wiki repository is unavailable', 404);
    const wikiRepo = {
      id: repo.id,
      workspaceId: repo.workspaceId,
      projectId: repo.projectId,
      channelId,
    };
    const source = await this.findPage(wikiRepo.channelId, wikiRepo.id, sourcePath);
    const destination = await this.findPage(wikiRepo.channelId, wikiRepo.id, destinationPath);
    if (source && destination) throw new AppError(`Wiki page already exists: ${destinationPath}`, 409);
    if (!source && !destination) throw new AppError(`Wiki page does not exist: ${sourcePath}`, 409);
    const page = source ?? destination!;
    const markdown = await this.readLiveMarkdown(page);
    const contentHash = markdownHash(markdown);
    if (contentHash !== input.request.expectedContentHash) {
      throw new AppError(`[CONTENT_CONFLICT] Wiki page changed concurrently: ${sourcePath}`, 409);
    }
    const moveIdentityHash = wikiVersionIdentityHash({
      markdown: `${sourcePath}\0${destinationPath}\0${markdown}`,
      revisionKind: 'moved',
      commitSha: input.request.commitSha,
    });
    const entity = await this.entityRow(page.id);
    const sourcePaths = parseSdlcSourcePaths(entity?.sourcePaths);
    let moved: string | undefined;
    if (!source) {
      // The source page is gone: this is valid only as a retry of a move that
      // already durably completed. The version row's identity hash proves it.
      const durableMove = await this.prisma.canvasVersion.findUnique({
        where: {
          canvasId_contentHash: { canvasId: page.id, contentHash: moveIdentityHash },
        },
        select: { id: true },
      });
      if (!durableMove) throw new AppError(`Wiki page does not exist: ${sourcePath}`, 409);
      moved = durableMove.id;
    }
    if (!moved) {
      const folderId = await this.ensureFolder(
        wikiRepo,
        execution.createdBy,
        isWikiArchiveFolder(page.folder?.name)
      );
      const canvasVersionId = randomUUID();
      const now = new Date();
      const displayCommitRef = shortestUniqueWikiCommitRef(
        input.request.commitSha,
        wikiCommitRefUniverse(context)
      );
      moved = await this.prisma.$transaction(async (tx) => {
        const version = await tx.canvasVersion.upsert({
          where: { canvasId_contentHash: { canvasId: page.id, contentHash: moveIdentityHash } },
          create: {
            id: canvasVersionId,
            workspaceId: wikiRepo.workspaceId,
            canvasId: page.id,
            name: `Wiki ${displayCommitRef}: moved`,
            content: page.content as Prisma.InputJsonValue,
            contentHash: moveIdentityHash,
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
            metadata: { wikiRelativePath: destinationPath },
            lastEditedBy: execution.createdBy!,
            lastEditedAt: now,
          },
        });
        await tx.sdlcArtifact.upsert({
          where: { artifactId: page.id },
          create: {
            workspaceId: wikiRepo.workspaceId,
            repoId: wikiRepo.id,
            artifactId: page.id,
            artifactType: 'WIKI',
            workflowExecutionId: execution.id,
            generationCommit: input.request.commitSha,
            sourcePaths: entity?.sourcePaths ?? null,
            sourceReferences: entity?.sourceReferences ?? null,
            createdBy: execution.createdBy!,
          },
          update: {
            workflowExecutionId: execution.id,
            generationCommit: input.request.commitSha,
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
      canvasVersionId: moved,
      contentHash,
      sourcePaths,
      path: destinationPath,
      title: input.request.title ?? page.title,
      archived: isWikiArchiveFolder(page.folder?.name),
      sourceReferences: parseSdlcSourceReferences(entity?.sourceReferences),
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
    executionId: string;
    sessionId: string;
    commitSha: string;
    displayCommitRef: string;
    action: WholeWikiPageAction;
    sourceReferences: WikiSourceReference[];
    refinement: boolean;
  }): Promise<WikiRevisionEvidence> {
    const path = normalizeWikiRelativePath(input.action.path);
    const existing = await this.findPage(input.repo.channelId, input.repo.id, path);
    const existingEntity = existing ? await this.entityRow(existing.id) : null;
    const priorSourceReferences = parseSdlcSourceReferences(existingEntity?.sourceReferences);
    const evidenceAction = this.evidenceAction(input.action.action, input.refinement);
    const revisionSources = resolveWikiRevisionSources({
      action: input.action.action,
      requestedSourcePaths: input.action.sourcePaths,
      currentSourcePaths: parseSdlcSourcePaths(existingEntity?.sourcePaths),
    });

    const currentContent = existing ? await this.readLiveContent(existing) : [];
    const currentMarkdown = await convertBlockNoteToMarkdown(currentContent);
    const currentHash = markdownHash(currentMarkdown);
    const markdown = input.action.action === 'archive' ? currentMarkdown : input.action.markdown;
    const versionIdentityHash = wikiVersionIdentityHash({
      markdown,
      revisionKind: evidenceAction,
      commitSha: input.commitSha,
    });

    if (existing) {
      // Durable-revision recovery: the version row's identity hash proves this
      // exact revision (content + kind + commit) already committed. Repair the
      // side effects and return the recorded evidence instead of re-applying.
      const durable = await this.prisma.canvasVersion.findUnique({
        where: {
          canvasId_contentHash: { canvasId: existing.id, contentHash: versionIdentityHash },
        },
        select: { id: true },
      });
      if (durable && currentHash === markdownHash(markdown)) {
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
          canvasVersionId: durable.id,
          contentHash: markdownHash(markdown),
          sourcePaths: revisionSources.evidenceSourcePaths,
          path,
          title: existing.title,
          archived: isWikiArchiveFolder(existing.folder?.name),
          sourceReferences: priorSourceReferences,
        };
      }
    }
    if (input.action.action === 'create' && existing) {
      throw new AppError(`Wiki page already exists: ${path}`, 409);
    }
    if (input.action.action !== 'create' && !existing) {
      throw new AppError(`Wiki page does not exist: ${path}`, 409);
    }
    if (input.action.action !== 'create' && input.action.expectedContentHash !== currentHash) {
      throw new AppError(`[CONTENT_CONFLICT] Wiki page changed concurrently: ${path}`, 409);
    }

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
    // Identity only: archive state = folder placement; provenance = sdlc_artifacts.
    const metadata: Prisma.InputJsonObject = { wikiRelativePath: path };
    const folderId = await this.ensureFolder(input.repo, input.actorId, archived);

    const upsertEntity = async (tx: Prisma.TransactionClient, canvasId: string) => {
      const sourcePaths = archived
        ? existingEntity?.sourcePaths ?? null
        : stringifySdlcSourcePaths(revisionSources.activeSourcePaths);
      const references = archived
        ? existingEntity?.sourceReferences ?? null
        : stringifySdlcSourceReferences(sourceReferences);
      await tx.sdlcArtifact.upsert({
        where: { artifactId: canvasId },
        create: {
          workspaceId: input.repo.workspaceId,
          repoId: input.repo.id,
          artifactId: canvasId,
          artifactType: 'WIKI',
          workflowExecutionId: input.executionId,
          generationCommit: input.commitSha,
          sourcePaths,
          sourceReferences: references,
          createdBy: input.actorId,
        },
        update: {
          workflowExecutionId: input.executionId,
          generationCommit: input.commitSha,
          ...(archived ? {} : { sourcePaths, sourceReferences: references }),
        },
      });
    };

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
              metadata,
              lastEditedBy: input.actorId,
              lastEditedAt: now,
            },
          });
          await upsertEntity(tx, existing.id);
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
          await upsertEntity(tx, created.id);
          return { id: created.id, versionId: canvasVersionId };
        });

    if (existing?.folderId && existing.folderId !== folderId) {
      // Archive/restore (and directory renames) relocate the canvas; prune the
      // old folder when it is left empty.
      await this.prisma.canvasFolder.deleteMany({
        where: {
          id: existing.folderId,
          name: { startsWith: WIKI_FOLDER_PREFIX },
          canvases: { none: {} },
        },
      });
    }

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

  /** Two repositories in one hub can both have a page at the same path. */
  private async findPage(
    channelId: string,
    repoId: string,
    path: string
  ): Promise<WikiPageRecord | null> {
    const pages = await this.prisma.canvas.findMany({
      where: { channelId, sdlcArtifact: { is: { artifactType: 'WIKI', repoId } } },
      select: {
        id: true,
        title: true,
        content: true,
        folderId: true,
        folder: { select: { name: true } },
        metadata: true,
      },
    });
    return (
      pages.find((page) => {
        const metadata = metadataRecord(page.metadata);
        return metadata.wikiRelativePath === path;
      }) ?? null
    );
  }

  private async entityRow(canvasId: string): Promise<WikiEntityRecord | null> {
    return this.prisma.sdlcArtifact.findUnique({
      where: { artifactId: canvasId },
      select: {
        workflowExecutionId: true,
        generationCommit: true,
        sourceReferences: true,
        sourcePaths: true,
      },
    });
  }

  private async entityRows(canvasIds: string[]): Promise<Map<string, WikiEntityRecord>> {
    if (canvasIds.length === 0) return new Map();
    const rows = await this.prisma.sdlcArtifact.findMany({
      where: { artifactId: { in: canvasIds } },
      select: {
        artifactId: true,
        workflowExecutionId: true,
        generationCommit: true,
        sourceReferences: true,
        sourcePaths: true,
      },
    });
    return new Map(rows.map(({ artifactId, ...row }) => [artifactId, row]));
  }

  private async requireReadableRepository(input: {
    repoId: string;
    workspaceId: string;
    userId: string;
  }): Promise<{ id: string; channelId: string }> {
    // Membership is the read check: the actor must participate in a hub this
    // repository belongs to.
    const membership = await this.prisma.sdlcEntityLink.findFirst({
      where: {
        workspaceId: input.workspaceId,
        targetType: 'REPOSITORY',
        targetId: input.repoId,
        relationType: SDLC_MEMBERSHIP_RELATION,
        channel: { participants: { some: { userId: input.userId } } },
      },
      orderBy: { createdAt: 'asc' },
      select: { channelId: true },
    });
    if (!membership?.channelId) throw new AppError('SDLC repository not found', 404);
    return { id: input.repoId, channelId: membership.channelId };
  }

  private async ensureFolder(
    repo: {
      workspaceId: string;
      projectId: string;
      channelId: string;
    },
    actorId: string,
    archived = false
  ): Promise<string> {
    const name = archived ? wikiArchiveFolderName() : wikiFolderName();
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
