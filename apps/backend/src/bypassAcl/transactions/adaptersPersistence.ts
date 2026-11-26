import { transaction } from '../base';
import { db } from '@/database/client';
import { WORKFLOWS_TYPE, WORKFLOW_VERSION_TYPE } from '@/workflowsV2/constants';
import { versionRowId, versionRowsOf } from '@/workflowsV2/utils';
import type { ExecutionOrigin, ResourceAttributes } from '@xyne/workflow-sdk';


export function createExecutionTx(workspaceId: string, data: { workflowId: string; status: string; context: string; sourceExecutionId?: string; fireAt?: Date; origin?: ExecutionOrigin; workflowVersion?: number | null; attributes: ResourceAttributes<"workflow">; }) {
  return transaction(['WorkflowExecution', 'WorkflowExecutionState'], 'createExecution: workflow execution row and its initial execution state must commit atomically; tx is not ACL-wrapped', db, async (tx) => {
    const created = await tx.workflowExecution.create({
      data: {
        workspaceId,
        workflowId: data.workflowId,
        workflowType: WORKFLOWS_TYPE,
        status: data.status,
        ...(data.workflowVersion != null ? { workflowVersion: data.workflowVersion } : {}),
        ...(data.sourceExecutionId
          ? { parentWorkflowExecutionId: data.sourceExecutionId, tag: 'rerun' }
          : { tag: 'root' }),
      },
      select: { id: true },
    });

    await tx.workflowExecutionState.create({
      data: {
        workflowExecutionId: created.id,
        workspaceId,
        context: data.context,
        currentStepIndex: 0,
        ...(data.fireAt !== undefined ? { fireAt: data.fireAt } : {}),
        ...(data.origin !== undefined ? { origin: JSON.stringify(data.origin) } : {}),
      },
    });

    return created;
  });
}

/**
 * Allocates the next version number for a workflow and inserts its snapshot row. The parent row is
 * locked `FOR UPDATE` so two concurrent saves serialise instead of both reading the same max; the
 * snapshot's primary key (`<workflowId>:v<n>`) is the backstop. With `onlyIfNone`, an existing history is
 * left alone and its newest number returned. The tx is not ACL-wrapped, so the workspace is stamped here.
 */
export function createWorkflowVersionTx(
  workflowId: string,
  data: { config: string; metadata: string | null; summary: string | null; eventType: string; onlyIfNone?: boolean },
) {
  return transaction(['Workflow'], 'createWorkflowVersion: next number is allocated under a lock on the parent workflow row; tx is not ACL-wrapped', db, async (tx) => {
    const parent = await tx.$queryRaw<{ workspaceId: string }[]>`
      SELECT "workspaceId" FROM "public"."workflows"
      WHERE "id" = ${workflowId} AND "workflowType" = ${WORKFLOWS_TYPE}
      FOR UPDATE`;
    const workspaceId = parent[0]?.workspaceId;
    if (!workspaceId) throw new Error(`createWorkflowVersion: workflow ${workflowId} not found`);

    const max = (
      await tx.workflow.aggregate({ where: versionRowsOf(workflowId), _max: { version: true } })
    )._max.version;
    if (data.onlyIfNone && max != null) return max;

    const version = (max ?? 0) + 1;
    await tx.workflow.create({
      data: {
        id: versionRowId(workflowId, version),
        workspaceId,
        workflowType: WORKFLOW_VERSION_TYPE,
        status: 'VERSION',
        eventType: 'NO_OP',
        context: data.config,
        metadata: data.metadata,
        summary: data.summary,
        configuration: data.eventType,
        version,
      },
    });
    return version;
  });
}
