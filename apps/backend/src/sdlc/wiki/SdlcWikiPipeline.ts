import type { Prisma, PrismaClient } from '@prisma/client';
import {
  SDLC_BASELINE_COUNT,
  type SdlcBaselineKind,
  type SdlcSetupStatus,
  type RefreshSdlcWikiRunInput,
  type SdlcWikiRunProgress,
  type StartSdlcWikiRunInput,
} from '@xyne/shared';
import { DatabaseClient } from '@/database/client';
import { AppError } from '@/middleware/errorHandler';
import { sdlcAdmission } from '@/queues/sdlcAdmission';
import { cancelS2SClawRun } from '@/services/clawAgentService';
import { SDLC_MEMBERSHIP_RELATION } from '@xyne/shared';
import { requireSdlcBaseBranch } from '../sdlcRepositoryContext';
import { sdlcVcs } from '../vcs';
import {
  parseWikiExecutionContext,
  serializeWikiRunState,
  type WikiExecutionContext,
} from './wikiRunState';
import { shortestUniqueWikiCommitRef, wikiCommitRefUniverse } from './wikiCommitRefs';
import { effectiveWikiRunPhase } from './wikiExecutionPhase';

const ACTIVE_EXECUTION_STATUSES = ['NEW', 'PENDING', 'SCHEDULED', 'RUNNING'] as const;

export interface SdlcWikiPipelineActor {
  userId: string;
  workspaceId: string;
}

export interface SdlcWikiRunStatus extends SdlcWikiRunProgress {
  executionId: string;
  runMode: 'INITIAL' | 'REFRESH';
  chunkSize: 1 | 10 | 25 | 50 | 100;
  quality: 'QUICK' | 'STANDARD';
  baseBranch: string;
  currentCommitSha: string | null;
  currentChunkPosition: number | null;
  currentChunkSize: number | null;
  conversationId: string | null;
  sessionId: string | null;
  createdAt: string;
  updatedAt: string;
  knowledge: {
    executionId: string;
    phase: SdlcSetupStatus | string;
    completedCount: number;
    totalCount: number;
    error: string | null;
  } | null;
}

export interface SdlcWikiPipeline {
  start(
    actor: SdlcWikiPipelineActor,
    repoId: string,
    input: StartSdlcWikiRunInput
  ): Promise<SdlcWikiRunStatus>;
  refresh(
    actor: SdlcWikiPipelineActor,
    repoId: string,
    input: RefreshSdlcWikiRunInput
  ): Promise<SdlcWikiRunStatus>;
  retry(
    actor: SdlcWikiPipelineActor,
    repoId: string,
    executionId: string
  ): Promise<SdlcWikiRunStatus>;
  cancel(
    actor: SdlcWikiPipelineActor,
    repoId: string,
    executionId: string
  ): Promise<SdlcWikiRunStatus>;
  getStatus(actor: SdlcWikiPipelineActor, repoId: string): Promise<SdlcWikiRunStatus | null>;
}

interface WikiPipelineQueue {
  enqueueWiki(executionId: string, repoId: string): Promise<void>;
}

interface WikiRepositoryRecord {
  id: string;
  name: string;
  workspaceId: string;
  projectId: string;
  channelId: string;
  createdBy: string;
  baseBranch: unknown;
  accessCapabilities: unknown;
}

export class SdlcWikiPipelineService implements SdlcWikiPipeline {
  constructor(
    private readonly prisma: PrismaClient = DatabaseClient.getInstance(),
    private readonly queue?: WikiPipelineQueue
  ) {}

  async start(
    actor: SdlcWikiPipelineActor,
    repoId: string,
    input: StartSdlcWikiRunInput
  ): Promise<SdlcWikiRunStatus> {
    const repo = await this.requireRepository(actor, repoId, true);
    const context = this.queuedContext(repo, 'INITIAL', input);
    const execution = await this.createRun(actor, repo, context);
    await this.enqueueOrFail(execution.id, repo.id);
    return this.statusFromExecution(
      execution.id,
      execution.createdAt,
      execution.updatedAt,
      context
    );
  }

  async refresh(
    actor: SdlcWikiPipelineActor,
    repoId: string,
    input: RefreshSdlcWikiRunInput
  ): Promise<SdlcWikiRunStatus> {
    const repo = await this.requireRepository(actor, repoId, true);
    const latest = await this.latestRun(repo.id);
    if (!latest || latest.context.phase !== 'COMPLETED' || !latest.context.cursorSha) {
      throw new AppError('Generate the Wiki before refreshing it', 409);
    }
    const context = this.queuedContext(repo, 'REFRESH', {
      historyRange: null,
      chunkSize: input.chunkSize,
      quality: input.quality,
      cursorSha: latest.context.cursorSha,
    });
    const execution = await this.createRun(actor, repo, context);
    await this.enqueueOrFail(execution.id, repo.id);
    return this.statusFromExecution(
      execution.id,
      execution.createdAt,
      execution.updatedAt,
      context
    );
  }

  async retry(
    actor: SdlcWikiPipelineActor,
    repoId: string,
    executionId: string
  ): Promise<SdlcWikiRunStatus> {
    await this.requireRepository(actor, repoId, true);
    const resumed = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "public"."repos" WHERE "id" = ${repoId} FOR UPDATE`;
      const run = await this.linkedRun(tx, repoId, executionId);
      if (run.context.phase !== 'PARTIALLY_FAILED' && run.context.phase !== 'CANCELLED') {
        throw new AppError('Wiki run is not retryable', 409);
      }
      await this.requireNoOtherActiveRun(tx, repoId, executionId);
      const orphanedPendingCommit =
        run.context.phase === 'CANCELLED' &&
        run.context.assignedChunk === null &&
        run.context.pendingCommit;
      const context: WikiExecutionContext = {
        ...run.context,
        phase: 'QUEUED',
        assignedChunk:
          run.context.version === 2 && run.context.assignedChunk?.kind === 'COMMITS'
            ? run.context.assignedChunk
            : null,
        pendingCommit: orphanedPendingCommit ? null : run.context.pendingCommit,
        conversationId: null,
        sessionId: null,
        credentialSessionId: null,
        admissionPermitId: null,
        error: null,
        errorCode: null,
      };
      const terminalStatus = run.context.phase === 'CANCELLED' ? 'CANCELLED' : 'FAILURE';
      const claimed = await tx.workflowExecution.updateMany({
        where: { id: executionId, status: terminalStatus, context: run.execution.context },
        data: { status: 'PENDING', context: serializeWikiRunState(context) },
      });
      if (claimed.count !== 1) throw new AppError('Wiki run changed before retry', 409);
      await tx.workflow.update({
        where: { id: run.execution.workflowId },
        data: { status: 'PENDING' },
      });
      return { run, context };
    });
    if (resumed.run.context.sessionId && resumed.run.execution.createdBy) {
      await cancelS2SClawRun(resumed.run.context.sessionId, resumed.run.execution.createdBy).catch(
        () => undefined
      );
    }
    await this.enqueueOrFail(executionId, repoId);
    const updated = await this.prisma.workflowExecution.findUniqueOrThrow({
      where: { id: executionId },
      select: { id: true, createdAt: true, updatedAt: true },
    });
    return this.statusFromExecution(
      updated.id,
      updated.createdAt,
      updated.updatedAt,
      resumed.context
    );
  }

  async cancel(
    actor: SdlcWikiPipelineActor,
    repoId: string,
    executionId: string
  ): Promise<SdlcWikiRunStatus> {
    await this.requireRepository(actor, repoId, true);
    const cancelled = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "public"."repos" WHERE "id" = ${repoId} FOR UPDATE`;
      const run = await this.linkedRun(tx, repoId, executionId);
      if (!ACTIVE_EXECUTION_STATUSES.includes(run.execution.status as never)) {
        throw new AppError('Wiki run is not active', 409);
      }
      const context: WikiExecutionContext = {
        ...run.context,
        phase: 'CANCELLED',
        error: null,
        errorCode: null,
      };
      const claimed = await tx.workflowExecution.updateMany({
        where: {
          id: executionId,
          status: { in: [...ACTIVE_EXECUTION_STATUSES] },
          context: run.execution.context,
        },
        data: { status: 'CANCELLED', context: serializeWikiRunState(context) },
      });
      if (claimed.count !== 1) throw new AppError('Wiki run changed before cancellation', 409);
      await tx.workflow.update({
        where: { id: run.execution.workflowId },
        data: { status: 'CANCELLED' },
      });
      return { run, context };
    });
    if (cancelled.run.context.sessionId && cancelled.run.execution.createdBy) {
      await cancelS2SClawRun(
        cancelled.run.context.sessionId,
        cancelled.run.execution.createdBy
      ).catch(() => undefined);
    }
    await sdlcAdmission.release(cancelled.run.context.admissionPermitId);
    const updated = await this.prisma.workflowExecution.findUniqueOrThrow({
      where: { id: executionId },
      select: { id: true, createdAt: true, updatedAt: true },
    });
    return this.statusFromExecution(
      updated.id,
      updated.createdAt,
      updated.updatedAt,
      cancelled.context
    );
  }

  async getStatus(actor: SdlcWikiPipelineActor, repoId: string): Promise<SdlcWikiRunStatus | null> {
    await this.requireRepository(actor, repoId, false);
    const latest = await this.latestRun(repoId);
    if (!latest) return null;
    const status = this.statusFromExecution(
      latest.execution.id,
      latest.execution.createdAt,
      latest.execution.updatedAt,
      latest.context,
      latest.execution.status
    );
    const repo = await this.prisma.repo.findUnique({
      where: { id: repoId },
      select: { sdlcSetupExecutionId: true },
    });
    if (!repo?.sdlcSetupExecutionId) return status;
    const knowledgeExecution = await this.prisma.workflowExecution.findUnique({
      where: { id: repo.sdlcSetupExecutionId },
      select: { id: true, context: true },
    });
    if (!knowledgeExecution?.context) return status;
    try {
      const context = JSON.parse(knowledgeExecution.context) as Record<string, unknown>;
      if (context.parentWikiExecutionId !== latest.execution.id) return status;
      const completed = Array.isArray(context.completedBaselineKinds)
        ? context.completedBaselineKinds.filter(
            (value): value is SdlcBaselineKind => typeof value === 'string'
          )
        : [];
      return {
        ...status,
        knowledge: {
          executionId: knowledgeExecution.id,
          phase: typeof context.phase === 'string' ? context.phase : 'QUEUED',
          completedCount: new Set(completed).size,
          totalCount: SDLC_BASELINE_COUNT,
          error: typeof context.error === 'string' ? context.error : null,
        },
      };
    } catch {
      return status;
    }
  }

  private async requireRepository(
    actor: SdlcWikiPipelineActor,
    repoId: string,
    requireAdmin: boolean
  ): Promise<WikiRepositoryRecord> {
    const repo = await this.prisma.repo.findFirst({
      where: { id: repoId, workspaceId: actor.workspaceId },
      select: {
        id: true,
        name: true,
        workspaceId: true,
        projectId: true,
        createdBy: true,
        baseBranch: true,
        accessCapabilities: true,
      },
    });
    const membership = await this.prisma.sdlcEntityLink.findFirst({
      where: {
        workspaceId: actor.workspaceId,
        targetType: 'REPOSITORY',
        targetId: repoId,
        relationType: SDLC_MEMBERSHIP_RELATION,
        channel: { participants: { some: { userId: actor.userId } } },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        channelId: true,
        channel: {
          select: {
            participants: { where: { userId: actor.userId }, select: { role: true }, take: 1 },
          },
        },
      },
    });
    const participant = membership?.channel?.participants[0];
    if (!repo?.projectId || !membership?.channelId || !participant) {
      throw new AppError('SDLC repository not found', 404);
    }
    if (requireAdmin && participant.role !== 'ADMIN') {
      throw new AppError('Repository admin access is required', 403);
    }
    if (requireAdmin) await sdlcVcs.requireCapabilities(actor, repo.id, ['READ_REPOSITORY']);
    return { ...repo, channelId: membership.channelId } as WikiRepositoryRecord;
  }

  private queuedContext(
    repo: WikiRepositoryRecord,
    runMode: 'INITIAL' | 'REFRESH',
    input: {
      historyRange: StartSdlcWikiRunInput['historyRange'] | null;
      chunkSize: StartSdlcWikiRunInput['chunkSize'];
      quality: StartSdlcWikiRunInput['quality'];
      cursorSha?: string | null;
    }
  ): WikiExecutionContext {
    return {
      version: 2,
      executionModel: 'HISTORY_WINDOW',
      repoId: repo.id,
      channelId: repo.channelId,
      agentSlug: null,
      conversationId: null,
      sessionId: null,
      credentialSessionId: null,
      admissionPermitId: null,
      phase: 'QUEUED',
      runMode,
      historyRange: input.historyRange,
      chunkSize: input.chunkSize,
      quality: input.quality,
      baseBranch: requireSdlcBaseBranch(repo.baseBranch),
      targetHeadSha: null,
      bootstrapRef: null,
      selectedStartSha: null,
      selectedCommitShas: [],
      cursorSha: input.cursorSha ?? null,
      assignedChunk: null,
      counts: {
        total: 0,
        processed: 0,
        updated: 0,
        noop: 0,
        failed: 0,
        aggregated: 0,
        windows: { total: 0, completed: 0, updated: 0, noop: 0, failed: 0, intermediate: 0 },
      },
      validatorReports: [],
      error: null,
      errorCode: null,
    };
  }

  private async createRun(
    actor: SdlcWikiPipelineActor,
    repo: WikiRepositoryRecord,
    context: WikiExecutionContext
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "public"."repos" WHERE "id" = ${repo.id} FOR UPDATE`;
      const activeLinks = await tx.sdlcEntityLink.findMany({
        where: {
          sourceType: 'REPOSITORY',
          sourceId: repo.id,
          targetType: 'WORKFLOW_EXECUTION',
          relationType: 'WIKI_RUN',
        },
        select: { targetId: true },
      });
      const active = activeLinks.length
        ? await tx.workflowExecution.findFirst({
            where: {
              id: { in: activeLinks.map((link) => link.targetId) },
              status: { in: [...ACTIVE_EXECUTION_STATUSES] },
            },
            select: { id: true },
          })
        : null;
      if (active) throw new AppError('A Wiki run is already active', 409);

      const serialized = serializeWikiRunState(context);
      const workflow = await tx.workflow.create({
        data: {
          workspaceId: actor.workspaceId,
          workflowName: `SDLC Wiki: ${repo.name}`,
          workflowType: 'SDLC_WIKI',
          status: 'PENDING',
          context: serialized,
          metadata: JSON.stringify({ repoId: repo.id, projectId: repo.projectId }),
        },
      });
      const execution = await tx.workflowExecution.create({
        data: {
          workspaceId: actor.workspaceId,
          workflowId: workflow.id,
          workflowType: 'SDLC_WIKI',
          status: 'PENDING',
          context: serialized,
          output: JSON.stringify({ version: context.version, outcomes: [] }),
          createdBy: actor.userId,
        },
        select: { id: true, createdAt: true, updatedAt: true },
      });
      await tx.sdlcEntityLink.create({
        data: {
          workspaceId: actor.workspaceId,
          channelId: repo.channelId,
          sourceType: 'REPOSITORY',
          sourceId: repo.id,
          targetType: 'WORKFLOW_EXECUTION',
          targetId: execution.id,
          relationType: 'WIKI_RUN',
          createdBy: actor.userId,
        },
      });
      return execution;
    });
  }

  private async linkedRun(tx: Prisma.TransactionClient, repoId: string, executionId: string) {
    const link = await tx.sdlcEntityLink.findFirst({
      where: {
        sourceType: 'REPOSITORY',
        sourceId: repoId,
        targetType: 'WORKFLOW_EXECUTION',
        targetId: executionId,
        relationType: 'WIKI_RUN',
      },
      select: { targetId: true },
    });
    if (!link) throw new AppError('Wiki run not found', 404);
    const execution = await tx.workflowExecution.findUnique({
      where: { id: executionId },
      select: {
        id: true,
        workflowId: true,
        status: true,
        context: true,
        createdBy: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!execution?.context) throw new AppError('Wiki run not found', 404);
    return { execution, context: parseWikiExecutionContext(execution.context) };
  }

  private async requireNoOtherActiveRun(
    tx: Prisma.TransactionClient,
    repoId: string,
    executionId: string
  ): Promise<void> {
    const links = await tx.sdlcEntityLink.findMany({
      where: {
        sourceType: 'REPOSITORY',
        sourceId: repoId,
        targetType: 'WORKFLOW_EXECUTION',
        targetId: { not: executionId },
        relationType: 'WIKI_RUN',
      },
      select: { targetId: true },
    });
    if (links.length === 0) return;
    const active = await tx.workflowExecution.findFirst({
      where: {
        id: { in: links.map((link) => link.targetId) },
        status: { in: [...ACTIVE_EXECUTION_STATUSES] },
      },
      select: { id: true },
    });
    if (active) throw new AppError('A different Wiki run is already active', 409);
  }

  private async latestRun(repoId: string) {
    const link = await this.prisma.sdlcEntityLink.findFirst({
      where: {
        sourceType: 'REPOSITORY',
        sourceId: repoId,
        targetType: 'WORKFLOW_EXECUTION',
        relationType: 'WIKI_RUN',
      },
      orderBy: { createdAt: 'desc' },
      select: { targetId: true },
    });
    if (!link) return null;
    const execution = await this.prisma.workflowExecution.findUnique({
      where: { id: link.targetId },
      select: {
        id: true,
        workflowId: true,
        status: true,
        context: true,
        createdBy: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!execution?.context) return null;
    return { execution, context: parseWikiExecutionContext(execution.context) };
  }

  private async enqueueOrFail(executionId: string, repoId: string): Promise<void> {
    if (!this.queue) return;
    try {
      await this.queue.enqueueWiki(executionId, repoId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const execution = await this.prisma.workflowExecution.findUnique({
        where: { id: executionId },
        select: { context: true, workflowId: true },
      });
      if (execution?.context) {
        const context: WikiExecutionContext = {
          ...parseWikiExecutionContext(execution.context),
          phase: 'PARTIALLY_FAILED',
          error: `Failed to queue Wiki run: ${message}`,
          errorCode: 'QUEUE_FAILED',
        };
        await this.prisma.$transaction(async (tx) => {
          const updated = await tx.workflowExecution.updateMany({
            where: {
              id: executionId,
              status: { in: [...ACTIVE_EXECUTION_STATUSES] },
              context: execution.context,
            },
            data: { status: 'FAILURE', context: serializeWikiRunState(context) },
          });
          if (updated.count !== 1) return;
          await tx.workflow.update({
            where: { id: execution.workflowId },
            data: { status: 'FAILURE' },
          });
        });
      }
      throw new AppError('Failed to queue Wiki run', 503);
    }
  }

  private statusFromExecution(
    executionId: string,
    createdAt: Date,
    updatedAt: Date,
    context: WikiExecutionContext,
    executionStatus?: string
  ): SdlcWikiRunStatus {
    const commitRefs = wikiCommitRefUniverse(context);
    const displayRef = (ref: string | null): string | null =>
      ref ? shortestUniqueWikiCommitRef(ref, commitRefs) : null;
    return {
      executionId,
      runMode: context.runMode,
      phase: executionStatus
        ? effectiveWikiRunPhase(executionStatus, context.phase)
        : context.phase,
      total: context.counts.total,
      processed: context.counts.processed,
      updated: context.counts.updated,
      noop: context.counts.noop,
      failed: context.counts.failed,
      aggregated: context.counts.aggregated,
      cursorSha: displayRef(context.cursorSha),
      targetHeadSha: displayRef(context.targetHeadSha),
      error: context.error,
      ...(context.recovery ? { recovery: context.recovery } : {}),
      ...(context.counts.windows ? { windows: context.counts.windows } : {}),
      currentWindowBeforeSha: displayRef(context.assignedChunk?.window?.beforeSha ?? null),
      currentWindowAfterSha: displayRef(context.assignedChunk?.window?.afterSha ?? null),
      activeCheckpointSha: displayRef(context.assignedChunk?.window?.activeCheckpointSha ?? null),
      chunkSize: context.chunkSize,
      quality: context.quality,
      baseBranch: context.baseBranch,
      currentCommitSha: displayRef(
        context.assignedChunk?.window?.activeCheckpointSha ??
          (context.assignedChunk
            ? (context.assignedChunk.commitShas[context.assignedChunk.nextIndex] ?? null)
            : null)
      ),
      currentChunkPosition: context.assignedChunk ? context.assignedChunk.nextIndex + 1 : null,
      currentChunkSize: context.assignedChunk?.commitShas.length ?? null,
      conversationId: context.conversationId,
      sessionId: context.sessionId,
      createdAt: createdAt.toISOString(),
      updatedAt: updatedAt.toISOString(),
      knowledge: null,
    };
  }
}
