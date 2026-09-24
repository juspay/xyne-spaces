import type { PrismaClient } from '@prisma/client';
import type { WorkflowRecord, FolderRecord, ExecutionRecord } from '@xyne/workflow-sdk';
import { db } from '@/database/client';
import { WORKFLOWS_SCOPE, WORKFLOWS_TYPE } from '@/workflowsV2/constants';
import { toWorkflowRecord, toFolderRecord, toExecutionRecord } from '@/workflowsV2/utils';
import { asSystem, rawQuery } from './base';

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
