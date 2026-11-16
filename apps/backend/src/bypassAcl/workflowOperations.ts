import { workflowRuntime } from '@/workflowsV2/runtime';
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
const WORKFLOWS_WORKER_SERVICE_ACTOR = 'workflows-worker';
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
