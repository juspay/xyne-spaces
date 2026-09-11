import { randomUUID } from 'crypto';
import {
  PRStatus, PRStatusEvent, TicketStatusV2,
  SDLC_AGENT_SLUG,
} from '@xyne/shared';
import { config } from '@/config/env';
import { DatabaseClient } from '@/database/client';
import { PRMetricsRepository } from '@/database/repositories/pullRequestsRepository';
import { sdlcAdmission } from '@/queues/sdlcAdmission';
import {
  cancelS2SClawRun,
  getS2SClawRunStatus,
  runS2SClawAgent,
} from '@/services/clawAgentService';
import { prTicketStatusSyncService } from '@/services/prTicketStatusSyncService';
import { logger } from '@/utils/logger';
import { sdlcAgentContext } from './SdlcAgentContextService';
import {
  newSdlcClawDeadline,
  SDLC_CLAW_TIMEOUT_ERROR_CODE,
  sdlcCapacityWaitExpired,
  sdlcClawDeadlineExpired,
  sdlcClawTimeoutMessage,
} from './sdlcClawDeadline';
import { requireSdlcChannelId } from './sdlcChannelMembership';
import { shouldHandleSdlcCallback } from './sdlcCallbackPolicy';
import { isSafeSdlcGitRef, requireSdlcBaseBranch } from './sdlcRepositoryContext';
import {
  buildSdlcTicketLifecycleInstruction,
  buildSdlcWorkDeliveryInstruction,
} from './sdlcTicketLifecyclePrompt';
import { sdlcVcs } from './vcs';


interface ClawCallbackPayload {
  sessionId?: string;
  status?: string;
  result?: unknown;
  error?: string;
}

interface ExecutionContext {
  repoId: string;
  /** The hub this run started from. Re-resolving later would pick the oldest. */
  channelId?: string;
  phase: string;
  agentSlug?: typeof SDLC_AGENT_SLUG;
  conversationId?: string;
  sessionId?: string;
  credentialSessionId?: string;
  parentWikiExecutionId?: string;
  generationCommit?: string;
  ticketId?: string;
  sourceType?: 'CANVAS' | 'TICKET';
  sourceId?: string;
  branchName?: string;
  error?: string;
  admissionPermitId?: string;
  clawRunStartedAt?: string | null;
  clawRunDeadlineAt?: string | null;
  errorCode?: string;
}

export class SdlcClawExecutionService {
  constructor(private readonly prisma = DatabaseClient.getInstance()) {}

  private async runChannelId(context: ExecutionContext, repoId: string): Promise<string> {
    return context.channelId ?? requireSdlcChannelId(this.prisma, repoId);
  }

  async dispatchWork(executionId: string, admissionPermitId: string): Promise<boolean> {
    const execution = await this.prisma.workflowExecution.findUnique({
      where: { id: executionId },
      include: { workflow: { include: { ticket: true } } },
    });
    const ticket = execution?.workflow.ticket;
    if (!execution?.createdBy || !ticket)
      throw new Error(`Invalid SDLC work execution ${executionId}`);
    const current = this.readContext(execution.context);
    const [repo, user] = await Promise.all([
      this.prisma.repo.findUnique({ where: { id: current.repoId } }),
      this.requireUser(execution.createdBy),
    ]);
    if (!repo) throw new Error('SDLC repository unavailable');
    const channelId = await this.runChannelId(current, repo.id);
    const repository = sdlcVcs.parseRepository('GITHUB', repo.canonicalUrl || repo.url);
    const conversationId = current.conversationId || `chat-sdlc-work-${execution.id}`;
    const sessionId = randomUUID();
    if (
      !(await this.setRunning(execution.id, execution.workflowId, {
        ...current,
        phase: 'IMPLEMENTING',
        conversationId,
        sessionId,
        credentialSessionId: sessionId,
        admissionPermitId,
        ...newSdlcClawDeadline(),
      }))
    )
      return false;
    const actor = {
      userId: execution.createdBy,
      workspaceId: this.requiredWorkspaceId(repo.workspaceId),
    };
    const agentContext = await sdlcAgentContext.build(actor, repo.id, {
      operation: 'work',
      channelId,
      workflowExecutionId: execution.id,
      sessionId,
      conversationId,
      ticketId: ticket.id,
      sourceType: current.sourceType,
      sourceId: current.sourceId,
    });
    const response = await runS2SClawAgent({
      sessionId,
      agentSlug: SDLC_AGENT_SLUG,
      task: this.workPrompt({
        repoId: repo.id,
        repoName: repo.name,
        repoUrl: repository.cloneUrl,
        baseBranch: requireSdlcBaseBranch(repo.baseBranch),
        ticketId: ticket.xyneId,
        title: ticket.title,
        description: ticket.description || '',
        executionId: execution.id,
        sessionId,
      }),
      userId: user.id,
      userName: user.name || user.email,
      userEmail: user.email,
      callbackUrl: this.callbackUrl(execution.id, 'work'),
      callbackSecret: config.xyneClaw.s2sKey,
      conversationId,
      channelId,
      workspaceId: this.requiredWorkspaceId(repo.workspaceId),
      executionProfile: 'sdlc',
      sdlcOperation: 'work',
      sdlcContext: agentContext as unknown as Record<string, unknown>,
      allowWriteInReadOnlyJob: true,
    });
    if (response.sessionId && response.sessionId !== sessionId) {
      await this.patchContext(execution.id, { sessionId: response.sessionId });
    }
    return true;
  }

  async handleCallback(
    executionId: string,
    _step: string,
    payload: ClawCallbackPayload
  ): Promise<void> {
    const execution = await this.prisma.workflowExecution.findUnique({
      where: { id: executionId },
      include: { workflow: true, sdlcRepo: true },
    });
    if (!execution) throw new Error(`SDLC execution ${executionId} not found`);
    const context = this.readContext(execution.context);
    if (
      !shouldHandleSdlcCallback({
        executionStatus: execution.status,
        expectedSessionId: context.sessionId,
        callbackSessionId: payload.sessionId,
      })
    ) {
      if (!['RUNNING', 'PENDING'].includes(execution.status)) return;
      logger.warn('[SDLC-CLAW] ignored stale or unidentified callback', {
        executionId,
        executionStatus: execution.status,
        expectedSessionId: context.sessionId,
        callbackSessionId: payload.sessionId,
      });
      return;
    }
    if (execution.status === 'PENDING') {
      // Older generic recovery workers reset external SDLC waits to PENDING
      // because these executions intentionally have no workflow lock. Restore
      // the exact matching execution before processing its terminal callback.
      const restored = await this.prisma.workflowExecution.updateMany({
        where: {
          id: execution.id,
          status: 'PENDING',
          context: execution.context,
        },
        data: { status: 'RUNNING' },
      });
      if (restored.count === 0) return;
    }
    try {
      if (payload.status !== 'completed') {
        const failure =
          payload.error || `Claw run ended with status ${payload.status || 'unknown'}`;
        await sdlcVcs.markRuntimeFailure(
          context.repoId,
          execution.workflowType === 'SDLC_WORK' ? 'PUSH' : 'CLONE',
          failure
        );
        await this.failExecution(execution.id, execution.workflowId, failure);
        return;
      }
      try {
        if (execution.workflowType === 'SDLC_WORK') {
          await this.completeWork(execution.id, execution.workflowId, payload.result);
          return;
        }
        throw new Error(`Unsupported SDLC workflow type ${execution.workflowType}`);
      } catch (error) {
        await this.failExecution(
          execution.id,
          execution.workflowId,
          error instanceof Error ? error.message : String(error)
        );
      }
    } finally {
      await sdlcAdmission.release(context.admissionPermitId);
    }
  }

  async reconcileExecutions(): Promise<void> {
    const staleBefore = new Date(Date.now() - 2 * 60 * 1000);
    const terminalFailureBefore = new Date(Date.now() - 10 * 60 * 1000);
    const executions = await this.prisma.workflowExecution.findMany({
      where: {
        workflowType: 'SDLC_WORK',
        status: { in: ['PENDING', 'RUNNING'] },
        updatedAt: { lt: staleBefore },
        createdBy: { not: null },
      },
      select: {
        id: true,
        workflowType: true,
        createdBy: true,
        context: true,
        status: true,
        workflowId: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: 'asc' },
      take: 50,
    });
    const results = await Promise.allSettled(
      executions.map(async (execution) => {
        if (!execution.createdBy) return;
        if (execution.status === 'PENDING') {
          if (sdlcCapacityWaitExpired(execution.updatedAt)) {
            await this.failExecution(
              execution.id,
              execution.workflowId,
              'Execution did not start before the configured capacity wait limit. Retry the run.'
            );
          }
          return;
        }
        const context = this.readContext(execution.context);
        if (sdlcClawDeadlineExpired(context, execution.updatedAt)) {
          if (context.sessionId) {
            await cancelS2SClawRun(context.sessionId, execution.createdBy).catch(() => undefined);
          }
          await this.failExecution(
            execution.id,
            execution.workflowId,
            sdlcClawTimeoutMessage(),
            {
              expectedContext: execution.context,
              errorCode: SDLC_CLAW_TIMEOUT_ERROR_CODE,
              context,
            }
          );
          return;
        }
        await sdlcAdmission.renew(context.admissionPermitId);
        if (!context.sessionId) {
          await this.failExecution(
            execution.id,
            execution.workflowId,
            'Claw session identity was not persisted. Retry the run.'
          );
          return;
        }
        const run = await getS2SClawRunStatus(context.sessionId, execution.createdBy);
        if (!run) {
          await this.failExecution(
            execution.id,
            execution.workflowId,
            'Claw run could not be found. Retry the run.'
          );
          return;
        }
        if (run.status === 'running') return;
        const step = execution.workflowType === 'SDLC_WORK' ? 'work' : 'artifact';
        await this.handleCallback(execution.id, step, {
          sessionId: run.sessionId,
          status: run.status,
          result: run.result,
          error: run.error || undefined,
        });
      })
    );
    for (const [index, result] of results.entries()) {
      if (result.status !== 'rejected') continue;
      const execution = executions[index];
      const error = result.reason instanceof Error ? result.reason.message : String(result.reason);
      logger.error('[SDLC-CLAW] execution reconciliation failed', {
        executionId: execution?.id,
        error,
      });
      if (execution && execution.updatedAt < terminalFailureBefore) {
        await this.failExecution(
          execution.id,
          execution.workflowId,
          `Could not reconcile Claw run status: ${error}`
        );
      }
    }
    await this.reconcilePullRequests();
  }

  async restoreAdmissionPermits(): Promise<void> {
    const executions = await this.prisma.workflowExecution.findMany({
      where: {
        workflowType: 'SDLC_WORK',
        status: 'RUNNING',
      },
      select: { id: true, context: true },
    });
    await Promise.all(
      executions.map(async (execution) => {
        const context = this.readContext(execution.context);
        await sdlcAdmission.restore({
          permitId: context.admissionPermitId,
          repoId: context.repoId,
          jobId: execution.id,
        });
      })
    );
  }

  private async reconcilePullRequests(): Promise<void> {
    const pullRequests = await this.prisma.pullRequests.findMany({
      where: {
        status: { in: ['OPEN', 'UPDATED'] },
        ticketId: { not: null },
        workflowExecutionId: { not: null },
      },
      select: {
        id: true,
        prId: true,
        prUrl: true,
        repositoryUrl: true,
        ticketId: true,
        // The execution that opened the PR names its repository; the TICKET ->
        // PULL_REQUEST link describes the ticket, not the repo.
        workflowExecution: { select: { context: true } },
      },
      orderBy: { updatedAt: 'asc' },
      take: 25,
    });
    if (pullRequests.length === 0) return;
    const repository = new PRMetricsRepository();
    const results = await Promise.allSettled(
      pullRequests.map(async (pullRequest) => {
        const repoId = this.readContext(pullRequest.workflowExecution?.context).repoId;
        if (!repoId || !pullRequest.ticketId) return;
        const inspection = await sdlcVcs.inspectPullRequest(repoId, pullRequest.prId);
        if (inspection.state === 'MERGED') {
          const result = await repository.markMergedPr({
            prId: pullRequest.prId,
            repoUrl: pullRequest.repositoryUrl,
            prUrl: pullRequest.prUrl,
            numberOfComments: inspection.numberOfComments,
          });
          if (result?.statusChanged) {
            const remainingOpenPRs = await repository.countPRsForTicket(
              pullRequest.ticketId,
              pullRequest.prId,
              pullRequest.prUrl,
              [PRStatus.OPEN, PRStatus.UPDATED]
            );
            await prTicketStatusSyncService.syncTicketStatusOnPRChange({
              prId: pullRequest.prId,
              prUrl: pullRequest.prUrl,
              newStatus: PRStatus.MERGED,
              prEvent: PRStatusEvent.MERGED,
              remainingOpenPRs,
            });
          }
        } else if (inspection.state === 'CLOSED') {
          await repository.markDeclinedPr({
            prId: pullRequest.prId,
            repoUrl: pullRequest.repositoryUrl,
            prUrl: pullRequest.prUrl,
            numberOfComments: inspection.numberOfComments,
          });
        }
      })
    );
    for (const [index, result] of results.entries()) {
      if (result.status !== 'rejected') continue;
      const pullRequest = pullRequests[index];
      logger.warn('[SDLC-VCS] pull request reconciliation failed', {
        pullRequestId: pullRequest?.id,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
    }
  }

  async failDispatch(executionId: string, error: unknown): Promise<void> {
    const execution = await this.prisma.workflowExecution.findUnique({
      where: { id: executionId },
      select: { workflowId: true },
    });
    if (!execution) return;
    await this.failExecution(
      executionId,
      execution.workflowId,
      error instanceof Error ? error.message : String(error)
    );
  }

  private async completeWork(executionId: string, workflowId: string, rawResult: unknown) {
    const context = await this.executionContext(executionId);
    const result = this.parseResult(rawResult);
    const [repo, execution] = await Promise.all([
      this.prisma.repo.findUnique({ where: { id: context.repoId } }),
      this.prisma.workflowExecution.findUnique({
        where: { id: executionId },
        select: { createdBy: true },
      }),
    ]);
    if (!repo || !context.ticketId || !execution?.createdBy) {
      throw new Error('SDLC work context is incomplete');
    }
    const channelId = await this.runChannelId(context, repo.id);
    const branchName = this.requiredString(result.branchName, 'branchName');
    const commitHash = this.requiredString(result.commitHash, 'commitHash');
    const pullRequestUrl = this.requiredString(result.pullRequestUrl, 'pullRequestUrl');
    const baseBranch = requireSdlcBaseBranch(repo.baseBranch);
    if (!isSafeSdlcGitRef(branchName) || branchName === baseBranch) {
      throw new Error('Claw returned an invalid work branch');
    }
    if (!/^[0-9a-f]{40}$/i.test(commitHash))
      throw new Error('Claw returned an invalid remote commit hash');
    const parsedRepository = sdlcVcs.parseRepository('GITHUB', repo.canonicalUrl || repo.url);
    if (!sdlcVcs.adapterFor('GITHUB').validatePullRequestUrl(parsedRepository, pullRequestUrl)) {
      throw new Error('Claw pull request does not belong to the attached repository');
    }
    const prId = Number(new URL(pullRequestUrl).pathname.split('/').filter(Boolean)[3]);
    if (!Number.isSafeInteger(prId)) throw new Error('Could not parse Claw pull request ID');
    const pullRequest = await new PRMetricsRepository().insertPRIfNotPresent({
      prId,
      prUrl: pullRequestUrl,
      childExecutionId: executionId,
      repoName: parsedRepository.name,
      sourceBranchName: branchName,
      destinationBranchName: baseBranch,
      repoUrl: repo.url,
      ticketId: context.ticketId,
    });
    await this.prisma.$transaction([
      this.prisma.ticket.update({
        where: { id: context.ticketId },
        data: {
          stageName: 'In Review',
          statusV2: TicketStatusV2.STARTED,
          statusUpdatedAt: new Date(),
          updatedBy: execution.createdBy,
        },
      }),
      this.prisma.sdlcEntityLink.upsert({
        where: {
          channelId_sourceType_sourceId_targetType_targetId_relationType: {
            channelId,
            sourceType: 'TICKET',
            sourceId: context.ticketId,
            targetType: 'PULL_REQUEST',
            targetId: pullRequest.id,
            relationType: 'PULL_REQUEST',
          },
        },
        create: {
          workspaceId: this.requiredWorkspaceId(repo.workspaceId),
          channelId,
          sourceType: 'TICKET',
          sourceId: context.ticketId,
          targetType: 'PULL_REQUEST',
          targetId: pullRequest.id,
          relationType: 'PULL_REQUEST',
          createdBy: execution.createdBy,
        },
        update: {},
      }),
      this.prisma.workflowExecution.update({
        where: { id: executionId },
        data: {
          status: 'SUCCESS',
          context: JSON.stringify({
            ...context,
            phase: 'IN_REVIEW',
            branchName,
            commitHash,
            pullRequestUrl,
          }),
          output: JSON.stringify(result),
        },
      }),
      this.prisma.workflow.update({ where: { id: workflowId }, data: { status: 'SUCCESS' } }),
    ]);
  }

  private workPrompt(input: {
    repoId: string;
    repoName: string;
    repoUrl: string;
    baseBranch: string;
    ticketId: string;
    title: string;
    description: string;
    executionId: string;
    sessionId: string;
  }): string {
    return `Implement SDLC Ticket ${input.ticketId}: ${input.title}

${input.description}

Repository ${input.repoName} is pinned to this run. Call sandbox-repo-setup with repoName ${input.repoName},
URL ${input.repoUrl}, base branch ${input.baseBranch}.
Read approved Code & Lint Standards first. Derive a safe work branch name from its documented Git branch
conventions. If no branch convention is documented, choose a short descriptive branch name tied to Ticket
${input.ticketId}; never invent or reuse the legacy Repo.prefix value. Call sandbox-repo-setup with write=true
and that branchName. Read the repository and SDLC channel context before editing. Follow all approved baseline
documents. Do not add unit tests in this V1 flow. Run existing lint/type/build checks when practical. Never merge,
force-push, expose secrets, or modify unrelated files.

${buildSdlcWorkDeliveryInstruction()}

${buildSdlcTicketLifecycleInstruction(input.ticketId)}

Commit changes locally, then push only the chosen work branch directly to origin. Never push
${input.baseBranch}, never force-push, and never merge. Use only sandbox Git credentials installed for this run.
After remote push succeeds, call spaces-sdlc-create-pull-request exactly once with executionId
${input.executionId}, sessionId ${input.sessionId}, repoId ${input.repoId},
head set to the chosen work branch, base ${input.baseBranch}, exact remote commitHash, title, and body. This backend-owned tool
must create the DRAFT pull request; do not use generic GitHub MCP credentials or tools.
Verify the remote branch and pull request exist. Submit summary, exact branchName, the REMOTE commitHash, and
pullRequestUrl using the required structured result. A compare URL is not a pull request and must be treated
as failure.`;
  }

  private callbackUrl(executionId: string, step: string): string {
    return `${config.xyneClaw.callbackUrl.replace(/\/$/, '')}/api/internal/sdlc/claw-callback/${encodeURIComponent(executionId)}/${encodeURIComponent(step)}`;
  }

  private async requireUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true },
    });
    if (!user?.email) throw new Error(`User ${userId} unavailable for Claw execution`);
    return user;
  }


  private async setRunning(
    executionId: string,
    workflowId: string,
    context: ExecutionContext
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.workflowExecution.updateMany({
        where: {
          id: executionId,
          status: { in: ['NEW', 'PENDING', 'SCHEDULED'] },
        },
        data: {
          status: 'RUNNING',
          context: JSON.stringify({ ...context, agentSlug: SDLC_AGENT_SLUG }),
        },
      });
      if (updated.count === 0) return false;
      await tx.workflow.update({ where: { id: workflowId }, data: { status: 'RUNNING' } });
      return true;
    });
  }


  private async failExecution(
    executionId: string,
    workflowId: string,
    error: string,
    options?: {
      expectedContext?: string | null;
      errorCode?: string;
      context?: ExecutionContext;
    }
  ) {
    const context = options?.context ?? (await this.executionContext(executionId));
    logger.error('[SDLC-CLAW] execution failed', { executionId, error });
    try {
      await this.prisma.$transaction(async (tx) => {
        const updated = await tx.workflowExecution.updateMany({
          where: {
            id: executionId,
            status: { in: ['NEW', 'PENDING', 'SCHEDULED', 'RUNNING'] },
            ...(options?.expectedContext !== undefined ? { context: options.expectedContext } : {}),
          },
          data: {
            status: 'FAILURE',
            context: JSON.stringify({
              ...context,
              phase: 'PARTIALLY_FAILED',
              error,
              ...(options?.errorCode ? { errorCode: options.errorCode } : {}),
            }),
            output: JSON.stringify({ error }),
          },
        });
        if (updated.count === 0) return;
        await tx.workflow.update({ where: { id: workflowId }, data: { status: 'FAILURE' } });
      });
    } finally {
      await sdlcAdmission.release(context.admissionPermitId);
    }
  }

  private async patchContext(
    executionId: string,
    patch: Record<string, unknown>
  ): Promise<boolean> {
    const context = await this.executionContext(executionId);
    const next = { ...context, ...patch };
    for (const [key, value] of Object.entries(next)) if (value === undefined) delete next[key];
    const result = await this.prisma.workflowExecution.updateMany({
      where: { id: executionId, status: 'RUNNING' },
      data: { context: JSON.stringify(next) },
    });
    return result.count > 0;
  }

  private async executionContext(
    executionId: string
  ): Promise<Record<string, unknown> & ExecutionContext> {
    const execution = await this.prisma.workflowExecution.findUnique({
      where: { id: executionId },
      select: { context: true },
    });
    return this.readContext(execution?.context) as Record<string, unknown> & ExecutionContext;
  }


  private readContext(value: string | null | undefined, fallbackRepoId = ''): ExecutionContext {
    try {
      const parsed = JSON.parse(value || '{}') as ExecutionContext;
      return {
        ...parsed,
        repoId: parsed.repoId || fallbackRepoId,
        phase: parsed.phase || 'QUEUED',
      };
    } catch {
      return { repoId: fallbackRepoId, phase: 'QUEUED' };
    }
  }

  private parseResult(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value))
      return value as Record<string, unknown>;
    if (typeof value !== 'string') throw new Error('Claw work result is not JSON');
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
        return parsed as Record<string, unknown>;
    } catch {
      // handled below
    }
    throw new Error('Claw work result is not valid JSON');
  }

  private requiredString(value: unknown, field: string): string {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`Claw result missing ${field}`);
    return value.trim();
  }

  private requiredWorkspaceId(value: string | null): string {
    if (!value) throw new Error('SDLC repository is missing its workspace');
    return value;
  }
}

export const sdlcClawExecutionService = new SdlcClawExecutionService();
