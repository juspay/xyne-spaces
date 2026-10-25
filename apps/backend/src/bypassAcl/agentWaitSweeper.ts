import { SDLC_WIKI_WORKFLOW_RELATION } from '@xyne/shared';
import { leafStepId } from '@xyne/workflow-sdk';
import { db } from '@/database/client';
import { getS2SClawRunStatus } from '@/services/clawAgentService';
import { logger } from '@/utils/logger';
import { readAgentDispatch } from '@/workflowsV2/agents/claw-provider';
import { cancelClawRun, clawRunOwner, type ParkedAgentStep } from '@/workflowsV2/agents/clawSessions';
import { sdlcAuthorOf } from '@/workflowsV2/agents/sdlc-dispatch';
import { SDLC_STARTED_BY_KEY, TERMINAL_EXECUTION_STATUSES, WORKFLOWS_SCOPE } from '@/workflowsV2/constants';
import { workflowRuntime } from '@/workflowsV2/runtime';
import { PLAN_STEP_ID, WINDOW_DONE_STEP_ID, WINDOW_GENERATE_STEP_ID } from '@/sdlc/wiki/wikiPlanStep';
import { asService, asSystem } from './base';
import { resumeWorkflowClawCallback } from './workflowOperations';

const SWEEPER_ACTOR = 'agent-wait-sweeper';
// Claw abandons a run at 3h (xyne-claw run-deadline.ts), then claw-auth retries its result for 30 minutes.
const MAX_WAIT_MS = 3.5 * 60 * 60_000;
const RESULT_RETRY_MS = 30 * 60_000;
// A dispatch that timed out parks anyway; claw creates its run record within seconds if it got the request.
const UNKNOWN_SESSION_MS = 15 * 60_000;

/** Fails agent steps whose claw run is over but whose result never arrived, so the run ends instead of hanging. */
export async function sweepParkedAgentSteps(now = Date.now()): Promise<void> {
  const rows = await asSystem(
    ['WorkflowStep'],
    'sweeper finds parked agent steps across workspaces',
    () =>
      db.workflowStep.findMany({
        where: {
          status: 'EXTERNAL_WAIT',
          data: { contains: '"externalRef"' },
          workflowExecution: { ...WORKFLOWS_SCOPE, status: { notIn: [...TERMINAL_EXECUTION_STATUSES] } },
        },
        select: {
          stepName: true,
          data: true,
          // The step row is written when it parks (and re-parks on a repair), so this is its dispatch time.
          updatedAt: true,
          workflowExecutionId: true,
          workflowExecution: {
            select: { workspaceId: true, createdBy: true, workflow: { select: { metadata: true } } },
          },
        },
      }),
  );
  for (const row of rows) {
    const dispatch = readAgentDispatch(row.data);
    if (!dispatch || !row.stepName) continue;
    // A chat step waiting on a person keeps its old agent record, but nothing is owed by claw.
    if ((JSON.parse(row.data ?? '{}') as { conversation?: { waiting?: string } }).conversation?.waiting === 'person') continue;
    const execution = row.workflowExecution;
    const step: ParkedAgentStep = {
      executionId: row.workflowExecutionId,
      stepName: row.stepName,
      data: row.data,
      workspaceId: execution.workspaceId,
      createdBy: execution.createdBy,
      workflowMetadata: execution.workflow.metadata,
    };
    try {
      await asService(['WorkflowStep'], 'sweeper fails a parked step whose claw run is over', SWEEPER_ACTOR, step.workspaceId, async () => {
        let reason: string | null = null;
        if (now - row.updatedAt.getTime() > MAX_WAIT_MS) {
          reason = `no result from claw run ${dispatch.externalRef} within ${MAX_WAIT_MS / 3_600_000}h`;
        } else {
          const owner = await clawRunOwner(step);
          const run = owner ? await getS2SClawRunStatus(dispatch.externalRef, owner, true) : undefined;
          const ended = run?.status !== 'running' && run?.completedAt ? Date.parse(run.completedAt) : null;
          if (run && ended !== null && now - ended > RESULT_RETRY_MS) {
            reason = `claw run ${dispatch.externalRef} ended ${run.status} at ${run.completedAt}, its result never arrived`;
          } else if (run === null && now - row.updatedAt.getTime() > UNKNOWN_SESSION_MS) {
            reason = `claw has no run ${dispatch.externalRef} ${UNKNOWN_SESSION_MS / 60_000} minutes after dispatch`;
          }
        }
        if (!reason) return;
        logger.warn(`[workflows] sweeper failing ${step.stepName} on ${step.executionId}: ${reason}`);
        await cancelClawRun(step);
        await resumeWorkflowClawCallback(
          { workspaceId: step.workspaceId, createdBy: step.createdBy },
          step.executionId,
          step.stepName,
          dispatch.attempt,
          dispatch.conversation?.turn,
          { status: 'failed', error: reason },
        );
      });
    } catch (error) {
      logger.error(`[workflows] sweeper could not check ${row.stepName} on ${row.workflowExecutionId}`, error);
    }
  }
}

interface PlanOutputLike {
  skipped?: boolean;
  input?: { repoIds: string[]; commitsPerRun: number; [SDLC_STARTED_BY_KEY]?: string };
  repositories?: Array<{ remainingWindows: number; error: string | null }>;
}

/**
 * Restarts a Wiki run that failed in a commit window, or that stopped at the window ceiling, with the
 * same input. Never a cancelled run, never while one is active; Plan blocks a window that keeps failing.
 */
export async function restartWikiRuns(): Promise<void> {
  const links = await asSystem(['SdlcEntityLink'], 'sweeper lists every hub Wiki workflow', () =>
    db.sdlcEntityLink.findMany({
      where: { targetType: 'WORKFLOW', relationType: SDLC_WIKI_WORKFLOW_RELATION },
      select: { targetId: true },
    }),
  );
  for (const { targetId: workflowId } of links) {
    try {
      const latest = await asSystem(['WorkflowExecution'], 'sweeper reads the latest Wiki run of a hub', async () => {
        const active = await db.workflowExecution.findFirst({
          where: { workflowId, status: { notIn: [...TERMINAL_EXECUTION_STATUSES] } },
          select: { id: true },
        });
        if (active) return null;
        return db.workflowExecution.findFirst({
          where: { workflowId },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            status: true,
            workspaceId: true,
            workflow: { select: { metadata: true } },
            workflowSteps: {
              where: { OR: [{ stepName: PLAN_STEP_ID }, { status: 'FAILED' }] },
              select: { stepName: true, status: true, data: true },
            },
          },
        });
      });
      if (!latest || (latest.status !== 'FAILED' && latest.status !== 'COMPLETED')) continue;
      const planRow = latest.workflowSteps.find((step) => step.stepName === PLAN_STEP_ID && step.status === 'COMPLETED');
      const plan = planRow ? ((JSON.parse(planRow.data ?? '{}') as { output?: PlanOutputLike }).output ?? null) : null;
      if (!plan?.input || plan.skipped) continue;
      const restart = latest.status === 'FAILED'
        ? latest.workflowSteps.some((step) => {
            const leaf = step.stepName ? leafStepId(step.stepName) : '';
            return step.status === 'FAILED' && (leaf === WINDOW_GENERATE_STEP_ID || leaf === WINDOW_DONE_STEP_ID);
          })
        : (plan.repositories ?? []).some((repository) => repository.remainingWindows > 0 && !repository.error);
      // The restart acts as the run it replaces: whoever started that one, else the workflow author.
      const actor = plan.input[SDLC_STARTED_BY_KEY] ?? sdlcAuthorOf(latest.workflow.metadata);
      if (!restart || !actor) continue;
      const executionId = await asService(['WorkflowExecution'], 'sweeper restarts a Wiki run as its starter', SWEEPER_ACTOR, latest.workspaceId, () =>
        workflowRuntime.triggerManual({ userId: actor, workspaceId: latest.workspaceId }, workflowId, {
          ...plan.input,
          automatic: true,
        }),
      );
      logger.info(`[SDLC] sweeper restarted Wiki workflow ${workflowId} after ${latest.id} as ${executionId}`);
    } catch (error) {
      logger.error(`[SDLC] sweeper could not restart Wiki workflow ${workflowId}`, error);
    }
  }
}
