import { SDLC_AGENT_SLUG } from '@xyne/shared';
import { randomUUID } from 'crypto';
import type { PrismaClient } from '@prisma/client';
import { config } from '@/config/env';
import { DatabaseClient } from '@/database/client';
import { sdlcAdmission } from '@/queues/sdlcAdmission';
import { sdlcQueue } from '@/queues/sdlcQueue';
import {
  cancelS2SClawRun,
  getS2SClawRunStatus,
  runS2SClawAgent,
} from '@/services/clawAgentService';
import { logger } from '@/utils/logger';
import { resolveSdlcChannelId } from '../sdlcChannelMembership';
import { SdlcBaselineReconciliationService } from '../SdlcBaselineReconciliationService';
import { sdlcAgentContext, type SdlcWikiAgentRole } from '../SdlcAgentContextService';
import {
  newSdlcClawDeadline,
  SDLC_CLAW_TIMEOUT_ERROR_CODE,
  sdlcClawDeadlineExpired,
  sdlcClawTimeoutMessage,
} from '../sdlcClawDeadline';
import { sdlcVcs } from '../vcs';
import { buildSdlcWikiPrompt } from './prompts';
import {
  nextWikiChunk,
  nextWikiWindow,
  planInitialWikiRange,
  planRefreshWikiRange,
} from './wikiRangePolicy';
import {
  parseWikiExecutionContext,
  parseWikiExecutionOutput,
  recoverWikiFailureContext,
  requiresWikiBootstrap,
  serializeWikiRunState,
  wikiAssignmentDurablyCompleted,
  type WikiExecutionContext,
} from './wikiRunState';
import { shortestUniqueWikiCommitRef, wikiCommitRefUniverse } from './wikiCommitRefs';
import { normalizeWikiRelativePath } from './wikiPaths';

// Claw-auth can briefly mark the transport session failed/missing when its SSE
// bridge drops even though the Claw runtime continues headless. Wiki commits
// are independently checkpointed, so give that runtime/recovery path time to
// finish instead of killing the WorkflowExecution from one observation.
export const WIKI_TERMINAL_RECONCILIATION_GRACE_MS = 35 * 60_000;
export const WIKI_MAX_NO_PROGRESS_RECOVERIES = 3;

interface WikiCallbackPayload {
  sessionId?: string;
  status?: string;
  result?: unknown;
  error?: string;
}

interface WikiExecutionQueue {
  enqueueWiki(executionId: string, repoId: string): Promise<void>;
}

export class SdlcWikiExecutionService {
  constructor(
    private readonly prisma: PrismaClient = DatabaseClient.getInstance(),
    private readonly queue: WikiExecutionQueue = sdlcQueue,
    private readonly runContentAudit: (input: {
      repoId: string;
      workspaceId: string;
      userId: string;
      targetHeadSha: string;
    }) => Promise<Array<{ code: string; path: string; detail: string }>> = async (input) => {
      const { SdlcWikiPageStore } = await import('./SdlcWikiPageStore');
      return SdlcWikiPageStore.withSourceVerifier(
        (repoId, commitSha, paths) => sdlcVcs.verifySourcePaths(repoId, commitSha, paths),
        (repoId, commitSha, references) =>
          sdlcVcs.verifySourceRanges(repoId, commitSha, references),
        this.prisma
      ).contentAudit(input);
    },
    private readonly queueBaselineReconciliation: (
      repoId: string,
      wikiExecutionId: string
    ) => Promise<string | null> = (repoId, wikiExecutionId) =>
      new SdlcBaselineReconciliationService(this.prisma).queueAfterWiki(repoId, wikiExecutionId)
  ) {}

  async dispatch(executionId: string, admissionPermitId: string): Promise<boolean> {
    const execution = await this.prisma.workflowExecution.findUnique({
      where: { id: executionId },
      include: { workflow: true },
    });
    if (!execution?.createdBy || !execution.context) throw new Error('Invalid Wiki execution');
    let context = parseWikiExecutionContext(execution.context);
    const [repo, user] = await Promise.all([
      this.prisma.repo.findUnique({ where: { id: context.repoId } }),
      this.prisma.user.findUnique({
        where: { id: execution.createdBy },
        select: { id: true, name: true, email: true },
      }),
    ]);
    // The run names its hub; the repository's oldest is the wrong one when it is
    // in several.
    const channelId =
      context.channelId ?? (repo && (await resolveSdlcChannelId(this.prisma, repo.id)));
    if (!repo || !channelId || !repo.workspaceId || !user?.email) {
      throw new Error('Wiki repository or owner is unavailable');
    }

    let contextSnapshot = execution.context;
    let preparationClaimed = false;
    if (!context.targetHeadSha) {
      const preparingContext: WikiExecutionContext = {
        ...context,
        phase: 'PREPARING',
        admissionPermitId,
        sessionId: null,
        credentialSessionId: null,
        assignedChunk: null,
      };
      const claimed = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.workflowExecution.updateMany({
          where: {
            id: execution.id,
            status: { in: ['NEW', 'PENDING', 'SCHEDULED'] },
            context: execution.context,
          },
          data: { status: 'RUNNING', context: serializeWikiRunState(preparingContext) },
        });
        if (updated.count === 0) return false;
        await tx.workflow.update({
          where: { id: execution.workflowId },
          data: { status: 'RUNNING' },
        });
        return true;
      });
      if (!claimed) return false;
      preparationClaimed = true;
      contextSnapshot = serializeWikiRunState(preparingContext);

      const history = await sdlcVcs.listBaseBranchFirstParentHistory(context.repoId);
      const range =
        context.runMode === 'INITIAL'
          ? planInitialWikiRange({
              commits: history.commits,
              targetHeadSha: history.targetHeadSha,
              historyRange: context.historyRange!,
            })
          : planRefreshWikiRange({
              commits: history.commits,
              targetHeadSha: history.targetHeadSha,
              cursorSha: context.cursorSha!,
            });
      if (!range) {
        await this.finish(execution.id, execution.workflowId, {
          ...preparingContext,
          targetHeadSha: history.targetHeadSha,
        });
        await sdlcAdmission.release(admissionPermitId);
        return true;
      }
      context = {
        ...preparingContext,
        phase:
          context.runMode === 'INITIAL' && range.bootstrapRef !== 'ROOT_BOOTSTRAP'
            ? 'BOOTSTRAPPING'
            : 'PROCESSING',
        targetHeadSha: range.targetHeadSha,
        bootstrapRef: range.bootstrapRef,
        selectedStartSha: range.selectedStartSha,
        selectedCommitShas: range.selectedCommitShas,
        cursorSha: context.runMode === 'REFRESH' ? context.cursorSha : null,
        counts: {
          total: range.selectedCommitShas.length,
          processed: 0,
          updated: 0,
          noop: 0,
          failed: 0,
          aggregated: context.version === 2 ? 0 : undefined,
          ...(context.version === 2
            ? {
                windows: {
                  total: Math.ceil(range.selectedCommitShas.length / context.chunkSize),
                  completed: 0,
                  updated: 0,
                  noop: 0,
                  failed: 0,
                  intermediate: 0,
                },
              }
            : {}),
        },
      };
      const prepared = await this.prisma.workflowExecution.updateMany({
        where: { id: execution.id, status: 'RUNNING', context: contextSnapshot },
        data: { context: serializeWikiRunState(context) },
      });
      if (prepared.count !== 1) {
        throw new Error('Wiki execution changed during deterministic preparation');
      }
      contextSnapshot = serializeWikiRunState(context);
    }

    const output = parseWikiExecutionOutput(execution.output);
    const role = this.nextRole(context, output.outcomes);
    if (!role) {
      await this.finish(execution.id, execution.workflowId, context);
      return false;
    }
    const sessionId = randomUUID();
    const conversationId = `chat-sdlc-wiki-${execution.id}-${role.toLowerCase()}-${sessionId}`;
    const resumedWindowAssignment =
      context.version === 2 &&
      role === 'GENERATOR' &&
      context.assignedChunk?.kind === 'COMMITS' &&
      context.assignedChunk.window
        ? context.assignedChunk
        : null;
    const historyWindow =
      context.version === 2 && role === 'GENERATOR'
        ? resumedWindowAssignment
          ? {
              beforeSha: resumedWindowAssignment.window!.beforeSha,
              afterSha: resumedWindowAssignment.window!.afterSha,
              includedCommitShas: resumedWindowAssignment.commitShas.filter(
                (sha): sha is string => sha !== 'ROOT_BOOTSTRAP'
              ),
            }
          : nextWikiWindow({
              selectedCommitShas: context.selectedCommitShas,
              cursorSha: context.cursorSha,
              bootstrapRef: context.bootstrapRef!,
              windowSize: context.chunkSize,
            })
        : null;
    const commitShas = historyWindow?.includedCommitShas ?? this.assignmentFor(role, context);
    const commitRefUniverse = wikiCommitRefUniverse(context);
    const agentCommitRefs = commitShas.map((sha) =>
      shortestUniqueWikiCommitRef(sha, commitRefUniverse)
    );
    const nextContext: WikiExecutionContext = {
      ...context,
      phase: ['BOOTSTRAP', 'BOOTSTRAP_SURVEY', 'BOOTSTRAP_PAGE', 'BOOTSTRAP_EDITOR'].includes(role)
        ? 'BOOTSTRAPPING'
        : role === 'ARCHITECTURE_VALIDATOR'
          ? 'VALIDATING'
          : role === 'CORRECTOR'
            ? 'CORRECTING'
            : 'PROCESSING',
      agentSlug: SDLC_AGENT_SLUG,
      conversationId,
      sessionId,
      credentialSessionId: sessionId,
      admissionPermitId,
      ...newSdlcClawDeadline(),
      assignedChunk: {
        kind:
          role === 'BOOTSTRAP'
            ? 'BOOTSTRAP'
            : role === 'BOOTSTRAP_SURVEY'
              ? 'BOOTSTRAP_SURVEY'
              : role === 'BOOTSTRAP_PAGE'
                ? 'BOOTSTRAP_PAGE'
                : role === 'BOOTSTRAP_EDITOR'
                  ? 'BOOTSTRAP_EDITOR'
                  : role === 'ARCHITECTURE_VALIDATOR'
                    ? 'VALIDATION'
                    : role === 'CORRECTOR'
                      ? 'CORRECTION'
                      : 'COMMITS',
        conversationId,
        sessionId,
        commitShas,
        nextIndex: resumedWindowAssignment?.nextIndex ?? 0,
        ...(historyWindow
          ? {
              window: resumedWindowAssignment?.window ?? {
                beforeSha: historyWindow.beforeSha,
                afterSha: historyWindow.afterSha,
                activeCheckpointSha: null,
                completedCheckpointShas: [],
              },
            }
          : {}),
      },
    };
    const claimed = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.workflowExecution.updateMany({
        where: preparationClaimed
          ? { id: execution.id, status: 'RUNNING', context: contextSnapshot }
          : {
              id: execution.id,
              status: { in: ['NEW', 'PENDING', 'SCHEDULED'] },
              context: execution.context,
            },
        data: { status: 'RUNNING', context: serializeWikiRunState(nextContext) },
      });
      if (updated.count === 0) return false;
      if (!preparationClaimed) {
        await tx.workflow.update({
          where: { id: execution.workflowId },
          data: { status: 'RUNNING' },
        });
      }
      return true;
    });
    if (!claimed) return false;

    const agentContext = await sdlcAgentContext.build(
      { userId: execution.createdBy, workspaceId: repo.workspaceId },
      repo.id,
      {
        operation: 'wiki',
        channelId,
        workflowExecutionId: execution.id,
        sessionId,
        conversationId,
        wikiRole: role,
        wikiAssignedCommitShas: [
          ...commitShas.filter((sha) => sha !== 'ROOT_BOOTSTRAP'),
          ...(historyWindow?.beforeSha && historyWindow.beforeSha !== 'ROOT_BOOTSTRAP'
            ? [historyWindow.beforeSha]
            : []),
        ],
        wikiBootstrapRef: context.bootstrapRef,
        wikiTargetHeadSha: context.targetHeadSha,
      }
    );
    const task = [
      buildSdlcWikiPrompt({
        role,
        context: {
          executionId: execution.id,
          repoId: repo.id,
          baseBranch: context.baseBranch,
          targetHeadSha: shortestUniqueWikiCommitRef(context.targetHeadSha!, commitRefUniverse),
          sessionId,
          assignedCommitShas: agentCommitRefs,
          ...(role === 'GENERATOR' && nextContext.assignedChunk?.window
            ? {
                historyWindow: {
                  beforeRef:
                    nextContext.assignedChunk.window.beforeSha === 'ROOT_BOOTSTRAP'
                      ? 'ROOT_BOOTSTRAP'
                      : shortestUniqueWikiCommitRef(
                          nextContext.assignedChunk.window.beforeSha,
                          commitRefUniverse
                        ),
                  afterRef: shortestUniqueWikiCommitRef(
                    nextContext.assignedChunk.window.afterSha,
                    commitRefUniverse
                  ),
                  includedRefs: agentCommitRefs,
                },
              }
            : {}),
        },
        existingPageSummaries: 'Use spaces-sdlc-list-artifacts when this role permits Wiki reads.',
        ...(role === 'CORRECTOR'
          ? { validatorFeedback: JSON.stringify(context.validatorReports) }
          : {}),
        ...(['BOOTSTRAP', 'BOOTSTRAP_PAGE', 'BOOTSTRAP_EDITOR'].includes(role) &&
        context.bootstrapPlan
          ? {
              bootstrapPlan: JSON.stringify({
                repositorySummary: context.bootstrapPlan.repositorySummary,
                page: context.bootstrapPlan.correction?.path
                  ? context.bootstrapPlan.pages.find(
                      (page) => page.path === context.bootstrapPlan!.correction!.path
                    )
                  : context.bootstrapPlan.pages[context.bootstrapPlan.nextPageIndex],
                correction: context.bootstrapPlan.correction,
              }),
            }
          : {}),
      }),
      `Reuse the existing repository sandbox and never destroy it. If the Wiki Git tool reports that the sandbox session is missing, call sandbox-repo-setup for ${repo.name} on ${context.baseBranch}, then retry. Trusted tool binding: executionId=${execution.id}, sessionId=${sessionId}, repoId=${repo.id}. Pass these exact values to every Hubs Wiki tool.`,
    ].join('\n\n');
    await runS2SClawAgent({
      sessionId,
      agentSlug: SDLC_AGENT_SLUG,
      task,
      userId: user.id,
      userName: user.name || user.email,
      userEmail: user.email,
      callbackUrl: this.callbackUrl(execution.id, role),
      callbackSecret: config.xyneClaw.s2sKey,
      conversationId,
      channelId,
      workspaceId: repo.workspaceId,
      executionProfile: 'sdlc',
      sdlcOperation: 'wiki',
      sdlcWikiRole: role,
      sdlcContext: agentContext as unknown as Record<string, unknown>,
      allowWriteInReadOnlyJob: true,
    });
    return true;
  }

  async handleCallback(
    executionId: string,
    role: string,
    payload: WikiCallbackPayload
  ): Promise<void> {
    const execution = await this.prisma.workflowExecution.findUnique({
      where: { id: executionId },
      include: { workflow: true },
    });
    if (!execution?.context) throw new Error('Wiki execution not found');
    const context = parseWikiExecutionContext(execution.context);
    if (payload.sessionId !== context.sessionId) return;
    if (role !== this.roleForContext(context)) return;
    if (execution.status === 'PENDING') {
      const restored = await this.prisma.workflowExecution.updateMany({
        where: { id: execution.id, status: 'PENDING', context: execution.context },
        data: { status: 'RUNNING' },
      });
      if (restored.count === 0) return;
    } else if (execution.status !== 'RUNNING') {
      return;
    }
    try {
      if (payload.status !== 'completed') {
        const latest = await this.prisma.workflowExecution.findUnique({
          where: { id: execution.id },
          select: { context: true },
        });
        const durableContext = recoverWikiFailureContext(latest?.context, context);
        if (!wikiAssignmentDurablyCompleted(context, durableContext)) {
          const cause =
            payload.error || `Wiki agent transport ended as ${payload.status ?? 'unknown'}`;
          if (
            role === 'GENERATOR' &&
            durableContext.version === 2 &&
            durableContext.assignedChunk?.kind === 'COMMITS' &&
            this.retryableInfrastructureFailure(cause)
          ) {
            const noProgressAttempts = (durableContext.recovery?.noProgressAttempts ?? 0) + 1;
            const recovery = {
              attempts: (durableContext.recovery?.attempts ?? 0) + 1,
              noProgressAttempts,
              lastCause: cause.slice(0, 2_000),
              lastCauseAt: new Date().toISOString(),
            };
            if (noProgressAttempts < WIKI_MAX_NO_PROGRESS_RECOVERIES) {
              await this.requeue(execution.id, execution.workflowId, {
                ...durableContext,
                phase: 'PROCESSING',
                conversationId: null,
                sessionId: null,
                credentialSessionId: null,
                admissionPermitId: null,
                recovery,
                error: null,
                errorCode: null,
              });
              return;
            }
          }
          await this.fail(
            execution.id,
            execution.workflowId,
            durableContext,
            payload.error || 'Wiki agent failed'
          );
          return;
        }
        logger.warn('[SDLC-WIKI] Advancing from durable checkpoint after terminal transport', {
          executionId: execution.id,
          sessionId: context.sessionId,
          clawStatus: payload.status,
        });
      }
      if (role === 'BOOTSTRAP_SURVEY') {
        const plan = this.bootstrapPlan(payload.result);
        const next: WikiExecutionContext = {
          ...context,
          phase: 'BOOTSTRAPPING',
          bootstrapPlan: plan,
          bootstrapStage: 'PAGE',
          assignedChunk: null,
          conversationId: null,
          sessionId: null,
          credentialSessionId: null,
          admissionPermitId: null,
        };
        await this.requeue(execution.id, execution.workflowId, next);
        return;
      }
      if (role === 'BOOTSTRAP_PAGE') {
        const latest = await this.prisma.workflowExecution.findUnique({
          where: { id: execution.id },
          select: { context: true },
        });
        if (!latest?.context) throw new Error('Wiki execution disappeared');
        const durable = parseWikiExecutionContext(latest.context);
        const plan = durable.bootstrapPlan!;
        const page = plan.correction
          ? plan.pages.find((candidate) => candidate.path === plan.correction!.path)
          : plan.pages[plan.nextPageIndex];
        if (!page) throw new Error('Wiki bootstrap page plan is exhausted');
        if (
          durable.pendingCommit?.commitSha !== durable.bootstrapRef ||
          !durable.pendingCommit.pages.some(
            (written) =>
              written.path === page.path &&
              // Older in-flight executions may not contain writerSessionId.
              // Accept that legacy evidence only when it is the sole pending
              // page; multi-page bootstrap evidence must match this run.
              (written.writerSessionId === context.sessionId ||
                (!written.writerSessionId && durable.pendingCommit!.pages.length === 1))
          )
        ) {
          throw new Error(
            `Wiki bootstrap page completed without durable page evidence: ${page.path}`
          );
        }
        const requireEditorial = context.quality !== 'QUICK';
        const nextPlan = {
          ...plan,
          correction: null,
          pendingEditorialPath: requireEditorial ? page.path : null,
          nextPageIndex: plan.correction ? plan.nextPageIndex : plan.nextPageIndex + 1,
        };
        const next: WikiExecutionContext = {
          ...durable,
          phase: 'BOOTSTRAPPING',
          bootstrapPlan: nextPlan,
          bootstrapStage: requireEditorial
            ? 'EDITOR'
            : nextPlan.nextPageIndex < nextPlan.pages.length
              ? 'PAGE'
              : 'FINALIZE',
          assignedChunk: null,
          conversationId: null,
          sessionId: null,
          credentialSessionId: null,
          admissionPermitId: null,
        };
        await this.requeue(execution.id, execution.workflowId, next);
        return;
      }
      if (role === 'BOOTSTRAP_EDITOR') {
        const report = this.validatorReport(payload.result);
        const plan = context.bootstrapPlan!;
        const path = plan.pendingEditorialPath;
        if (!path) throw new Error('Wiki bootstrap editorial page is missing');
        const actionable =
          !report.complete || report.missingTopics.length > 0 || report.issues.length > 0;
        const correctionAlreadyAttempted = plan.editorialReports.some(
          (previous) =>
            previous.path === path &&
            (!previous.report.complete ||
              previous.report.missingTopics.length > 0 ||
              previous.report.issues.length > 0)
        );
        // Editorial feedback is deliberately bounded. One corrective page run
        // gets a second review; repeated findings are retained for the final
        // run-level validators instead of creating an unattended loop.
        const requestCorrection = actionable && !correctionAlreadyAttempted;
        const nextPlan = {
          ...plan,
          pendingEditorialPath: null,
          correction: requestCorrection ? { path, report } : null,
          editorialReports: [...plan.editorialReports, { path, report }],
        };
        const next: WikiExecutionContext = {
          ...context,
          phase: 'BOOTSTRAPPING',
          bootstrapPlan: nextPlan,
          bootstrapStage: requestCorrection
            ? 'PAGE'
            : nextPlan.nextPageIndex < nextPlan.pages.length
              ? 'PAGE'
              : 'FINALIZE',
          assignedChunk: null,
          conversationId: null,
          sessionId: null,
          credentialSessionId: null,
          admissionPermitId: null,
        };
        await this.requeue(execution.id, execution.workflowId, next);
        return;
      }
      if (role === 'ARCHITECTURE_VALIDATOR') {
        const reports = [...context.validatorReports, this.validatorReport(payload.result)];
        const findings = await this.runContentAudit({
          repoId: context.repoId,
          workspaceId: execution.workspaceId,
          userId: execution.createdBy!,
          targetHeadSha: context.targetHeadSha!,
        });
        reports.push({
          complete: findings.length === 0,
          missingTopics: [],
          issues: findings.map((finding) => `[${finding.code}] ${finding.path}: ${finding.detail}`),
          suggestions: [],
        });
        const next: WikiExecutionContext = {
          ...context,
          phase: 'VALIDATING',
          validatorReports: reports,
          assignedChunk: null,
          sessionId: null,
          credentialSessionId: null,
          admissionPermitId: null,
        };
        const output = parseWikiExecutionOutput(execution.output);
        if (this.nextRole(next, output.outcomes)) {
          await this.requeue(execution.id, execution.workflowId, next);
        } else {
          await this.finish(execution.id, execution.workflowId, next);
        }
        return;
      }

      const latest = await this.prisma.workflowExecution.findUnique({
        where: { id: execution.id },
        select: { context: true },
      });
      if (!latest?.context) throw new Error('Wiki execution disappeared');
      const checkpointed = parseWikiExecutionContext(latest.context);
      const processedAny = checkpointed.cursorSha !== context.cursorSha;
      const finalizedActiveAssignment =
        checkpointed.assignedChunk === null &&
        checkpointed.sessionId !== null &&
        checkpointed.sessionId === context.sessionId;
      const correctionDone = role === 'CORRECTOR' && finalizedActiveAssignment;
      const incompleteHistoryWindow =
        context.version === 2 && role === 'GENERATOR' && !finalizedActiveAssignment;
      if (incompleteHistoryWindow && checkpointed.assignedChunk?.kind === 'COMMITS') {
        const previousIndex = context.assignedChunk?.nextIndex ?? 0;
        const currentIndex = checkpointed.assignedChunk.nextIndex;
        const madeProgress =
          processedAny ||
          currentIndex > previousIndex ||
          checkpointed.assignedChunk.window?.completedCheckpointShas.length !==
            context.assignedChunk?.window?.completedCheckpointShas.length;
        const noProgressAttempts = madeProgress
          ? 0
          : (checkpointed.recovery?.noProgressAttempts ?? 0) + 1;
        const recovery = {
          attempts: (checkpointed.recovery?.attempts ?? 0) + 1,
          noProgressAttempts,
          lastCause:
            'Wiki agent completed without the mandatory history-window endpoint checkpoint',
          lastCauseAt: new Date().toISOString(),
        };
        if (noProgressAttempts < WIKI_MAX_NO_PROGRESS_RECOVERIES) {
          logger.warn('[SDLC-WIKI] Resuming incomplete history-window suffix', {
            executionId: execution.id,
            sessionId: context.sessionId,
            nextIndex: currentIndex,
            endpointSha: checkpointed.assignedChunk.window?.afterSha,
            recoveryAttempt: recovery.attempts,
            noProgressAttempts,
          });
          await this.requeue(execution.id, execution.workflowId, {
            ...checkpointed,
            phase: 'PROCESSING',
            conversationId: null,
            sessionId: null,
            credentialSessionId: null,
            admissionPermitId: null,
            recovery,
            error: null,
            errorCode: null,
          });
          return;
        }
        await this.fail(
          execution.id,
          execution.workflowId,
          { ...checkpointed, recovery },
          `${recovery.lastCause} after ${noProgressAttempts} no-progress recoveries`
        );
        return;
      }
      if (!processedAny && !finalizedActiveAssignment) {
        await this.fail(
          execution.id,
          execution.workflowId,
          checkpointed,
          'Wiki agent completed without a durable commit checkpoint'
        );
        return;
      }
      const next: WikiExecutionContext = {
        ...checkpointed,
        phase: 'PROCESSING',
        assignedChunk: null,
        sessionId: null,
        credentialSessionId: null,
        admissionPermitId: null,
        recovery: undefined,
      };
      if (
        correctionDone ||
        (next.counts.processed >= next.counts.total && next.quality === 'QUICK')
      ) {
        await this.finish(execution.id, execution.workflowId, next);
      } else {
        await this.requeue(execution.id, execution.workflowId, next);
      }
    } catch (error) {
      const latest = await this.prisma.workflowExecution.findUnique({
        where: { id: execution.id },
        select: { context: true },
      });
      const durableContext = latest?.context ? parseWikiExecutionContext(latest.context) : context;
      await this.fail(
        execution.id,
        execution.workflowId,
        durableContext,
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      await sdlcAdmission.release(context.admissionPermitId ?? undefined);
    }
  }

  async failDispatch(executionId: string, error: unknown): Promise<void> {
    const execution = await this.prisma.workflowExecution.findUnique({
      where: { id: executionId },
      select: { workflowId: true, context: true },
    });
    if (!execution?.context) return;
    await this.fail(
      executionId,
      execution.workflowId,
      parseWikiExecutionContext(execution.context),
      error instanceof Error ? error.message : String(error)
    );
  }

  async restoreAdmissionPermits(): Promise<void> {
    const executions = await this.prisma.workflowExecution.findMany({
      where: { workflowType: 'SDLC_WIKI', status: 'RUNNING' },
      select: { id: true, context: true },
    });
    await Promise.all(
      executions.map(async (execution) => {
        if (!execution.context) return;
        const context = parseWikiExecutionContext(execution.context);
        await sdlcAdmission.restore({
          permitId: context.admissionPermitId,
          repoId: context.repoId,
          jobId: execution.id,
        });
      })
    );
  }

  async reconcileExecutions(): Promise<void> {
    const staleBefore = new Date(Date.now() - 2 * 60_000);
    const executions = await this.prisma.workflowExecution.findMany({
      where: {
        workflowType: 'SDLC_WIKI',
        status: { in: ['PENDING', 'RUNNING'] },
        updatedAt: { lt: staleBefore },
        createdBy: { not: null },
      },
      select: {
        id: true,
        workflowId: true,
        createdBy: true,
        context: true,
        updatedAt: true,
      },
      take: 50,
    });
    for (const execution of executions) {
      if (!execution.createdBy || !execution.context) continue;
      const context = parseWikiExecutionContext(execution.context);
      if (!context.sessionId) {
        if (context.phase === 'PREPARING') {
          await this.requeue(execution.id, execution.workflowId, {
            ...context,
            phase: 'QUEUED',
            admissionPermitId: null,
          });
          await sdlcAdmission.release(context.admissionPermitId ?? undefined);
        }
        continue;
      }
      let run: Awaited<ReturnType<typeof getS2SClawRunStatus>>;
      try {
        if (sdlcClawDeadlineExpired(context, execution.updatedAt)) {
          await cancelS2SClawRun(context.sessionId, execution.createdBy).catch(() => undefined);
          try {
            await this.fail(
              execution.id,
              execution.workflowId,
              context,
              sdlcClawTimeoutMessage('Wiki Claw run'),
              {
                expectedContext: execution.context,
                errorCode: SDLC_CLAW_TIMEOUT_ERROR_CODE,
              }
            );
          } finally {
            await sdlcAdmission.release(context.admissionPermitId);
          }
          continue;
        }
        await sdlcAdmission.renew(context.admissionPermitId);
        run = await getS2SClawRunStatus(context.sessionId, execution.createdBy);
      } catch (error) {
        // Claw restarts and short network outages are transient. Preserve the
        // bound execution/session and retry on the next reconciliation tick;
        // failing here turned a healthy resumable run into PARTIALLY_FAILED.
        logger.warn('[SDLC-WIKI] Could not fetch Claw run status; will retry', {
          executionId: execution.id,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      try {
        if (run?.status === 'running') continue;
        if (
          (!run || run.status === 'failed' || run.status === 'cancelled') &&
          Date.now() - execution.updatedAt.getTime() < WIKI_TERMINAL_RECONCILIATION_GRACE_MS
        ) {
          logger.warn('[SDLC-WIKI] Deferring terminal Claw status during recovery grace', {
            executionId: execution.id,
            sessionId: context.sessionId,
            clawStatus: run?.status ?? 'missing',
          });
          continue;
        }
        if (!run) {
          await this.fail(
            execution.id,
            execution.workflowId,
            context,
            'Wiki Claw run could not be found. Retry the run.'
          );
          await sdlcAdmission.release(context.admissionPermitId);
          continue;
        }
        await this.handleCallback(execution.id, this.roleForContext(context), {
          sessionId: run.sessionId,
          status: run.status,
          result: run.result,
          error: run.error ?? undefined,
        });
      } catch (error) {
        await this.fail(
          execution.id,
          execution.workflowId,
          context,
          `Could not reconcile Wiki Claw run: ${error instanceof Error ? error.message : String(error)}`
        );
        await sdlcAdmission.release(context.admissionPermitId);
      }
    }
  }

  private roleForContext(context: WikiExecutionContext): SdlcWikiAgentRole {
    if (!context.targetHeadSha) throw new Error('Wiki history preparation is incomplete');
    switch (context.assignedChunk?.kind) {
      case 'BOOTSTRAP_SURVEY':
        return 'BOOTSTRAP_SURVEY';
      case 'BOOTSTRAP_PAGE':
        return 'BOOTSTRAP_PAGE';
      case 'BOOTSTRAP_EDITOR':
        return 'BOOTSTRAP_EDITOR';
      case 'BOOTSTRAP':
        return 'BOOTSTRAP';
      case 'COMMITS':
        return 'GENERATOR';
      case 'CORRECTION':
        return 'CORRECTOR';
      case 'VALIDATION':
        return 'ARCHITECTURE_VALIDATOR';
    }

    // A successful finalization clears assignedChunk immediately so its
    // checkpoint is authoritative even if the Claw callback is lost. The run
    // phase remains bound to the active session until callback reconciliation,
    // making it the durable fallback for recovering that terminal result.
    switch (context.phase) {
      case 'BOOTSTRAPPING':
        // Survey runs always retain their explicit assignment until their
        // callback persists the plan. A cleared BOOTSTRAPPING assignment is a
        // durably finalized page-writing bootstrap, including pre-plan runs.
        if (context.bootstrapStage === 'PAGE') return 'BOOTSTRAP_PAGE';
        if (context.bootstrapStage === 'EDITOR') return 'BOOTSTRAP_EDITOR';
        return 'BOOTSTRAP';
      case 'PROCESSING':
        return 'GENERATOR';
      case 'CORRECTING':
        return 'CORRECTOR';
      case 'VALIDATING':
        return 'ARCHITECTURE_VALIDATOR';
      default:
        throw new Error('Wiki execution has no recoverable assigned role');
    }
  }

  private nextRole(
    context: WikiExecutionContext,
    outcomes: ReturnType<typeof parseWikiExecutionOutput>['outcomes']
  ): SdlcWikiAgentRole | null {
    if (!context.targetHeadSha) throw new Error('Wiki history preparation is incomplete');
    if (
      requiresWikiBootstrap({
        runMode: context.runMode,
        bootstrapRef: context.bootstrapRef,
        completedCommitRefs: outcomes.map((outcome) => outcome.commitSha),
      })
    ) {
      if (!context.bootstrapPlan) return 'BOOTSTRAP_SURVEY';
      if (context.bootstrapStage === 'EDITOR') return 'BOOTSTRAP_EDITOR';
      if (context.bootstrapStage === 'FINALIZE') return 'BOOTSTRAP';
      return 'BOOTSTRAP_PAGE';
    }
    if (context.counts.processed < context.counts.total) return 'GENERATOR';
    if (context.quality === 'QUICK') return null;
    if (context.validatorReports.length === 0) return 'ARCHITECTURE_VALIDATOR';
    const actionable = context.validatorReports.some(
      (report) => !report.complete || report.missingTopics.length > 0 || report.issues.length > 0
    );
    const targetOutcomes = outcomes.filter(
      (outcome) => outcome.commitSha === context.targetHeadSha
    );
    if (actionable && targetOutcomes.length < 2) return 'CORRECTOR';
    return null;
  }

  private assignmentFor(role: SdlcWikiAgentRole, context: WikiExecutionContext): string[] {
    if (
      role === 'BOOTSTRAP' ||
      role === 'BOOTSTRAP_SURVEY' ||
      role === 'BOOTSTRAP_PAGE' ||
      role === 'BOOTSTRAP_EDITOR'
    )
      return [context.bootstrapRef!];
    if (role === 'ARCHITECTURE_VALIDATOR' || role === 'CORRECTOR') {
      return [context.targetHeadSha!];
    }
    return nextWikiChunk({
      selectedCommitShas: context.selectedCommitShas,
      cursorSha: context.cursorSha,
      chunkSize: context.chunkSize,
    });
  }

  private async requeue(executionId: string, workflowId: string, context: WikiExecutionContext) {
    const claimed = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.workflowExecution.updateMany({
        where: { id: executionId, status: 'RUNNING' },
        data: { status: 'PENDING', context: serializeWikiRunState(context) },
      });
      if (updated.count !== 1) return false;
      await tx.workflow.update({ where: { id: workflowId }, data: { status: 'PENDING' } });
      return true;
    });
    if (claimed) await this.queue.enqueueWiki(executionId, context.repoId);
  }

  private async finish(executionId: string, workflowId: string, context: WikiExecutionContext) {
    const next = {
      ...context,
      phase: 'COMPLETED' as const,
      assignedChunk: null,
      sessionId: null,
      credentialSessionId: null,
      admissionPermitId: null,
    };
    const completed = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.workflowExecution.updateMany({
        where: { id: executionId, status: 'RUNNING' },
        data: { status: 'SUCCESS', context: serializeWikiRunState(next) },
      });
      if (updated.count !== 1) return false;
      await tx.workflow.update({ where: { id: workflowId }, data: { status: 'SUCCESS' } });
      return true;
    });
    if (!completed) return;
    try {
      await this.queueBaselineReconciliation(context.repoId, executionId);
    } catch (error) {
      logger.error('[SDLC-WIKI] knowledge reconciliation dispatch failed', {
        repoId: context.repoId,
        wikiExecutionId: executionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async fail(
    executionId: string,
    workflowId: string,
    context: WikiExecutionContext,
    error: string,
    options?: { expectedContext?: string; errorCode?: string }
  ) {
    const next: WikiExecutionContext = {
      ...context,
      phase: 'PARTIALLY_FAILED',
      assignedChunk:
        context.version === 2 && context.assignedChunk?.kind === 'COMMITS'
          ? context.assignedChunk
          : null,
      error,
      errorCode: options?.errorCode ?? 'AGENT_RUN_FAILED',
    };
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.workflowExecution.updateMany({
        where: {
          id: executionId,
          status: { in: ['PENDING', 'SCHEDULED', 'RUNNING'] },
          ...(options?.expectedContext ? { context: options.expectedContext } : {}),
        },
        data: { status: 'FAILURE', context: serializeWikiRunState(next) },
      });
      if (updated.count !== 1) return;
      await tx.workflow.update({ where: { id: workflowId }, data: { status: 'FAILURE' } });
    });
  }

  private objectResult(raw: unknown): Record<string, unknown> {
    if (raw && typeof raw === 'object' && !Array.isArray(raw))
      return raw as Record<string, unknown>;
    if (typeof raw === 'string') {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
        return parsed as Record<string, unknown>;
    }
    throw new Error('Wiki agent returned invalid structured output');
  }

  private validatorReport(raw: unknown): WikiExecutionContext['validatorReports'][number] {
    const value = this.objectResult(raw);
    const strings = (field: string): string[] =>
      Array.isArray(value[field])
        ? (value[field] as unknown[]).filter((item): item is string => typeof item === 'string')
        : [];
    if (typeof value.complete !== 'boolean') {
      throw new Error('Wiki validator result is missing complete');
    }
    return {
      complete: value.complete,
      missingTopics: strings('missingTopics'),
      issues: strings('issues'),
      suggestions: strings('suggestions'),
    };
  }

  private bootstrapPlan(raw: unknown): NonNullable<WikiExecutionContext['bootstrapPlan']> {
    const value = this.objectResult(raw);
    const pages = Array.isArray(value.pages) ? value.pages : [];
    const seenPaths = new Set<string>();
    const plan = {
      repositorySummary:
        typeof value.repositorySummary === 'string' ? value.repositorySummary.slice(0, 4_000) : '',
      nextPageIndex: 0,
      pendingEditorialPath: null,
      correction: null,
      editorialReports: [],
      pages: pages.slice(0, 50).flatMap((page) => {
        if (!page || typeof page !== 'object' || Array.isArray(page)) return [];
        const candidate = page as Record<string, unknown>;
        const strings = (field: string, limit: number): string[] =>
          Array.isArray(candidate[field])
            ? (candidate[field] as unknown[])
                .filter(
                  (item): item is string => typeof item === 'string' && item.trim().length > 0
                )
                .slice(0, limit)
            : [];
        const archetypes = new Set([
          'overview',
          'subsystem',
          'flow',
          'data-model',
          'interface',
          'operations',
          'decision',
        ]);
        const priorities = new Set(['HIGH', 'MEDIUM', 'LOW']);
        if (
          typeof candidate.path !== 'string' ||
          typeof candidate.purpose !== 'string' ||
          !archetypes.has(String(candidate.archetype)) ||
          !priorities.has(String(candidate.priority))
        )
          return [];
        let path: string;
        try {
          const proposed = candidate.path.trim().slice(0, 512);
          path = normalizeWikiRelativePath(/\.md$/i.test(proposed) ? proposed : `${proposed}.md`);
        } catch {
          return [];
        }
        if (seenPaths.has(path)) return [];
        seenPaths.add(path);
        return [
          {
            path,
            purpose: candidate.purpose.slice(0, 1_000),
            concepts: strings('concepts', 20),
            priority: candidate.priority as 'HIGH' | 'MEDIUM' | 'LOW',
            archetype: candidate.archetype as
              | 'overview'
              | 'subsystem'
              | 'flow'
              | 'data-model'
              | 'interface'
              | 'operations'
              | 'decision',
            sourceAreas: strings('sourceAreas', 20),
            relatedPages: strings('relatedPages', 20),
            tableCandidates: strings('tableCandidates', 10),
            diagramCandidates: strings('diagramCandidates', 10),
          },
        ];
      }),
    };
    if (!plan.repositorySummary || plan.pages.length === 0) {
      throw new Error('Wiki bootstrap survey returned an empty page plan');
    }
    return plan;
  }

  private retryableInfrastructureFailure(error: string): boolean {
    return /(?:fetch failed|network|timeout|timed out|sandbox.*(?:missing|died|unavailable)|proxy|disconnect|429|5\d\d)/i.test(
      error
    );
  }

  private callbackUrl(executionId: string, role: SdlcWikiAgentRole): string {
    return `${config.xyneClaw.callbackUrl.replace(/\/$/, '')}/api/internal/sdlc/claw-callback/${encodeURIComponent(executionId)}/wiki-${role}`;
  }
}

export const sdlcWikiExecutionService = new SdlcWikiExecutionService();
