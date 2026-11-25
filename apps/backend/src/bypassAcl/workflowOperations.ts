import { logger } from '@/utils/logger';
import { readAgentDispatch } from '@/workflowsV2/agents/claw-provider';
import { persistence, workflowRuntime } from '@/workflowsV2/runtime';
import { asService } from './base';

/**
 * Bypass-ACL operations that DRIVE the workflow runtime.
 *
 * Split from `workflowServices.ts`, which holds the queries the runtime is
 * BUILT from — `persistence.ts` and `authorizer.ts` import those, and the
 * runtime is constructed out of them. One file holding both halves sat below
 * and above the runtime at once, so anything reaching the query half dragged
 * the runtime in behind it. Through `database/repositories` that reached the
 * connector's own steps, and the cycle surfaced as
 * `Cannot access 'XyneSpacesConnector' before initialization`.
 *
 * Everything here runs after the runtime exists — a worker claiming a job, a
 * callback resuming a gate — so it imports it plainly, and the layering is the
 * file boundary rather than a comment asking you to remember it.
 */

/** Inert marker for the tenant context — only `workspaceId` is read by the stamper. */
const CLAW_CALLBACK_SERVICE_ACTOR = 'workflows-claw-callback';
/** Inert marker for the tenant context — only `workspaceId` is read by the stamper. */
const WORKFLOWS_WORKER_SERVICE_ACTOR = 'workflows-worker';
/** The step statuses that represent an open gate, matching the SDK's own check. */
const PARKED = new Set(['EXTERNAL_WAIT', 'REVIEW_WAIT']);
export type ClawCallbackOutcome =
  | { kind: 'ignored'; reason: string }
  | { kind: 'resumed' };

/**
 * Relocated from workflowsV2/agents/callback.ts's handleWorkflowClawCallback. The gate is
 * addressed by node path; the attempt number says whether it is still current — a repair
 * re-dispatch re-parks the same step at the same node path, so the path alone cannot
 * distinguish a live callback from a superseded one. The runtime authorizes the resume, so it
 * needs an actor: the execution's creator, falling back to '' for a cron- or webhook-triggered
 * run that has no creator (the interim authorizer does not read userId).
 */
export function resumeWorkflowClawCallback(
  execution: { workspaceId: string; createdBy: string | null },
  executionId: string,
  nodePath: string,
  attempt: number,
  turn: number | undefined,
  payload: Record<string, unknown>,
): Promise<ClawCallbackOutcome> {
  return asService(
    ['WorkflowExecution'],
    'claw callback resumes a parked step; workspace resolved from the execution before this scope opened',
    CLAW_CALLBACK_SERVICE_ACTOR,
    execution.workspaceId,
    async () => {
      // One indexed read on (executionId, stepName) — the node path addresses the gate directly.
      const gate = await persistence.getStep(executionId, nodePath);

      // Not parked means the run already reported and moved on: claw's recovery
      // worker re-delivering, or a duplicate POST.
      if (!gate || !PARKED.has(gate.status)) {
        logger.info(
          `[workflows] claw-callback: no open gate at ${nodePath} on execution ${executionId} `
          + '— already resumed or completed, ignoring',
        );
        return { kind: 'ignored', reason: 'gate not open' };
      }

      // The gate is open, but is it still on *this* run? A repair re-dispatch
      // re-parks the same step at the same node path, so a late callback from
      // the attempt we already rejected would otherwise be accepted here and
      // the workflow would proceed on a response that failed validation.
      const parked = readAgentDispatch(gate.data);
      if (!parked) {
        logger.info(
          `[workflows] claw-callback: ${nodePath} on execution ${executionId} is not waiting on an agent run — ignoring`,
        );
        return { kind: 'ignored', reason: 'not waiting on an agent run' };
      }
      // Same for a step that waits for replies: each turn re-parks the same
      // node, so an answer to an earlier turn must not land on a later one.
      if (parked.conversation && turn !== undefined && parked.conversation.turn !== turn) {
        logger.info(
          `[workflows] claw-callback: ${nodePath} on execution ${executionId} is on turn `
          + `${String(parked.conversation.turn)}, callback is for turn ${String(turn)} — superseded, ignoring`,
        );
        return { kind: 'ignored', reason: 'superseded turn' };
      }
      if (parked.attempt !== attempt) {
        logger.info(
          `[workflows] claw-callback: ${nodePath} on execution ${executionId} is on attempt `
          + `${String(parked.attempt)}, callback is for ${String(attempt)} — superseded, ignoring`,
        );
        return { kind: 'ignored', reason: 'superseded attempt' };
      }

      // TODO(phase-10): a system resume path, so this does not depend on a
      // creator that may legitimately be absent.
      await workflowRuntime.resume(
        { userId: execution.createdBy ?? '', workspaceId: execution.workspaceId },
        executionId,
        { data: { action: 'approve', data: payload }, nodePath },
      );

      logger.info(
        `[workflows] claw-callback resumed execution=${executionId} node=${nodePath} attempt=${String(attempt)}`,
      );
      return { kind: 'resumed' };
    },
  );
}

/**
 * Relocated from workers/workflowsWorker.ts's runExecution. The executor's step writes,
 * credential resolution and attachment storage all go through `db` or the adapters, and every
 * one of them reads the ambient workspace — service rather than user, since there is no caller
 * at execution time, which is exactly why the SDK carries the tenant on the resource.
 */
export function runExecutionUnderServiceActor(executionId: string, workspaceId: string) {
  return asService(
    ['WorkflowExecution'],
    'executor writes (steps, credentials, attachments) all read the ambient workspace; no caller exists at execution time',
    WORKFLOWS_WORKER_SERVICE_ACTOR,
    workspaceId,
    () => workflowRuntime.processJob(executionId),
  );
}

/**
 * Relocated from workers/workflowsWorker.ts's runCronTick. Creating the execution happens
 * inside processCronTick, so this needs the same tenant context as a run — the row it writes is
 * a workflow execution like any other.
 */
export function runCronTickUnderServiceActor(workflowId: string, workspaceId: string) {
  return asService(
    ['WorkflowExecution'],
    'cron tick writes a workflow execution row like any other run',
    WORKFLOWS_WORKER_SERVICE_ACTOR,
    workspaceId,
    () => workflowRuntime.processCronTick(workflowId),
  );
}
