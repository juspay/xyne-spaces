import { transaction } from '../base';
import { db } from '@/database/client';
import { WORKFLOWS_TYPE } from '@/workflowsV2/constants';
import type { ExecutionOrigin, ResourceAttributes } from '@xyne/workflow-sdk';


export function createExecutionTx(workspaceId: string, data: { workflowId: string; status: string; context: string; sourceExecutionId?: string; fireAt?: Date; origin?: ExecutionOrigin; attributes: ResourceAttributes<"workflow">; }) {
  return transaction(['WorkflowExecution', 'WorkflowExecutionState'], 'createExecution: workflow execution row and its initial execution state must commit atomically; tx is not ACL-wrapped', db, async (tx) => {
    const created = await tx.workflowExecution.create({
      data: {
        workspaceId,
        workflowId: data.workflowId,
        workflowType: WORKFLOWS_TYPE,
        status: data.status,
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
