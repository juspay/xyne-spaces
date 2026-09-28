import type { PrismaClient } from '@prisma/client';
import type { WorkflowRecord, FolderRecord, ExecutionRecord } from '@xyne/workflow-sdk';
import { db } from '@/database/client';
import { WORKFLOWS_SCOPE, WORKFLOWS_TYPE } from '@/workflowsV2/constants';
import { toWorkflowRecord, toFolderRecord, toExecutionRecord } from '@/workflowsV2/utils';
import { logger } from '@/utils/logger';
import { persistence, workflowRuntime } from '@/workflowsV2/runtime';
import { readAgentDispatch } from '@/workflowsV2/agents/claw-provider';
import { asSystem, asService, rawQuery } from './base';

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
 * Relocated from workflowsV2/authorizer.ts's executionWorkspaces. Execution records carry no
 * attributes, and runs are read across workspaces (the worker needs any of them), so this is
 * the check that keeps a run inside its own workspace.
 */
export function executionWorkspacesQuery(ids: readonly string[]): Promise<Array<{ id: string; workspaceId: string }>> {
  return asSystem(
    ['WorkflowExecution'],
    'authorizer reads runs across workspaces to check each one against its own tenant key',
    () =>
      db.workflowExecution.findMany({
        where: { id: { in: [...new Set(ids)] }, ...WORKFLOWS_SCOPE },
        select: { id: true, workspaceId: true },
      }),
  );
}

/**
 * Relocated from workflowsV2/agents/callback.ts. Resolve which tenant to become BEFORE opening
 * a scope — a callback arrives with nothing but an id, same ordering constraint as the worker.
 */
export function findWorkflowExecutionForCallback(executionId: string) {
  return asSystem(
    ['WorkflowExecution'],
    'callback arrives with only an execution id — workspace must be resolved before a scope can open',
    () =>
      db.workflowExecution.findFirst({
        where: { id: executionId, workflowType: WORKFLOWS_TYPE },
        select: { workspaceId: true, createdBy: true },
      }),
  );
}

/**
 * Relocated from workflowsV2/adapters/persistence.ts's findActiveWorkflows. SYSTEM event
 * routing, not user authorization. A dispatched event has no caller, so this must not be
 * reduced to anyone's workspace by the ambient scope. The event's origin workspace arrives in
 * `eventScope` and is applied explicitly.
 */
export async function findActiveWorkflowsQuery(
  eventType: string,
  eventScope: Record<string, unknown>,
): Promise<WorkflowRecord[]> {
  const workspaceId =
    typeof eventScope['workspaceId'] === 'string' ? eventScope['workspaceId'] : undefined;

  return asSystem(
    ['Workflow'],
    'dispatched event has no caller — the origin workspace arrives in eventScope and is applied explicitly',
    async () => {
      const rows = await db.workflow.findMany({
        where: {
          ...WORKFLOWS_SCOPE,
          eventType,
          status: 'ACTIVE',
          ...(workspaceId ? { workspaceId } : {}),
        },
      });
      return rows.map(toWorkflowRecord);
    },
  );
}

/**
 * Relocated from persistence.ts's listAllActiveWorkflows. Not part of the SDK interface — the
 * worker's cold-start cron recovery needs it to re-register schedules after a restart, which is
 * inherently cross-tenant.
 */
export function listAllActiveWorkflowsQuery(): Promise<WorkflowRecord[]> {
  return asSystem(
    ['Workflow'],
    'cold-start cron recovery re-registers schedules across every workspace after a restart',
    async () => {
      const rows = await db.workflow.findMany({ where: { ...WORKFLOWS_SCOPE, status: 'ACTIVE' } });
      return rows.map(toWorkflowRecord);
    },
  );
}

/**
 * Relocated from persistence.ts's listAllFolders. SYSTEM integrity read — the reparent cycle
 * check must see folders the caller cannot, or a hidden descendant lets a cycle through. These
 * rows must never be returned to a caller.
 */
export function listAllFoldersQuery(): Promise<FolderRecord[]> {
  return asSystem(
    ['WorkflowFolder'],
    'reparent cycle check must see every folder, including ones the caller cannot — never returned to a caller',
    async () => {
      const rows = await db.workflowFolder.findMany();
      return rows.map(toFolderRecord);
    },
  );
}

/**
 * Relocated from persistence.ts's countWorkflowsInFolder. SYSTEM integrity read — deletion is
 * blocked while a folder holds ANY workflow, including ones the caller cannot see. Counting only
 * visible rows would let a caller delete a folder out from under someone else's workflows.
 */
export function countWorkflowsInFolderQuery(folderId: string): Promise<number> {
  return asSystem(
    ['Workflow'],
    'folder deletion must be blocked by every workflow inside it, including ones the caller cannot see',
    () => db.workflow.count({ where: { folderId, ...WORKFLOWS_SCOPE } }),
  );
}

/**
 * Relocated from persistence.ts's getExecution. SYSTEM read — the worker calls this to discover
 * which workspace an execution belongs to, i.e. BEFORE it can open a tenant context, so it must
 * not itself be scoped by one.
 */
/**
 * Relocated from workers/workflowsWorker.ts. Resolve which workspace a job acts as, BEFORE any
 * tenant context is open — a job arrives with nothing but an id, and the process cannot know
 * which tenant to become until it has read a row, which it cannot do while scoped.
 */
export function workspaceForExecution(executionId: string): Promise<string | null> {
  return asSystem(
    ['WorkflowExecution'],
    'worker job carries only an execution id — workspace must be resolved before any scope opens',
    async () => {
      const row = await db.workflowExecution.findFirst({
        where: { id: executionId, workflowType: WORKFLOWS_TYPE },
        select: { workspaceId: true },
      });
      return row?.workspaceId ?? null;
    },
  );
}

/** Same as workspaceForExecution, for the cron queue's workflowId instead of an executionId. */
export function workspaceForWorkflow(workflowId: string): Promise<string | null> {
  return asSystem(
    ['Workflow'],
    'worker job carries only a workflow id — workspace must be resolved before any scope opens',
    async () => {
      const row = await db.workflow.findFirst({
        where: { id: workflowId, workflowType: WORKFLOWS_TYPE },
        select: { workspaceId: true },
      });
      return row?.workspaceId ?? null;
    },
  );
}

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

export function getExecutionQuery(executionId: string): Promise<ExecutionRecord | null> {
  return asSystem(
    ['WorkflowExecution'],
    'worker must discover the execution\'s workspace before it can open a tenant context',
    async () => {
      const row = await db.workflowExecution.findFirst({
        where: { id: executionId, ...WORKFLOWS_SCOPE },
        include: {
          workflow: { select: { metadata: true } },
          workflowExecutionState: { select: { fireAt: true, origin: true, endReason: true } },
        },
      });
      if (!row) return null;
      return toExecutionRecord(row, row.workflow?.metadata ?? null, row.workflowExecutionState);
    },
  );
}

/**
 * Relocated from database/repositories/workflows' claimNextPendingExecution. The claim uses
 * `FOR UPDATE SKIP LOCKED` so that competing worker pods cannot claim the same execution;
 * the statement text is built by buildClaimQuery and passed through unchanged.
 */
export async function claimNextPendingExecutionRow(client: PrismaClient, query: string): Promise<Array<{ id: string }>> {
  return rawQuery(
    ['WorkflowExecution'],
    'workflow scheduler: FOR UPDATE SKIP LOCKED claim query, built by buildClaimQuery',
    () => client.$queryRawUnsafe<Array<{ id: string }>>(
      query
    ),
  );
}
