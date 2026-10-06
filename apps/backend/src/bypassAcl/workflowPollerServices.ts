import { workflowRegistry } from '@/workflows/registry/workflowRegistry';
import { createWorkflowEngineWithDB } from '@/workflows/factory';
import { WorkflowExecutionStatus, WorkflowType } from '@/workflows/types/workflow-enums';
import { logger } from '@/utils/logger';
import { notificationHooks } from '@/hooks/notificationHooks';
import { cleanupRepository } from '@framework';
import { workflowStatusSyncService } from '@/workflows/services/workflowStatusSyncService';
import { WorkflowPoller } from '@/workflows/polling/workflow-poller';
import type { WorkflowExecutionWithState } from '@/database/repositories';
import type { Workflow } from '@/types/database';
import { asService } from './base';

/** Inert marker for the tenant context — only `workspaceId` is read by the stamper. */
const WORKFLOW_POLLER_SERVICE_ACTOR = 'workflow-poller';

/**
 * Relocated from workflows/polling/workflow-poller.ts's executeWorkflow. Opens a per-execution
 * tenant scope so the workspaceId stamper fills workspaceId on every downstream Prisma write —
 * this job runs in the background with no request context. userId is inert; only workspaceId is
 * read by the stamp.
 */
export function executeWorkflowUnderServiceActor(
  execution: WorkflowExecutionWithState,
  workflow: Workflow,
): Promise<void> {
  return asService(
    ['WorkflowExecution'],
    'background execution has no request context; the workspaceId stamper needs an open tenant scope for every downstream write',
    WORKFLOW_POLLER_SERVICE_ACTOR,
    workflow.workspaceId,
    async () => {
      // For child executions, workflowType is in execution; for parent, in workflow
      const workflowType = (execution.workflowType || workflow.workflowType) as WorkflowType

      if (!workflowType || !workflowRegistry.has(workflowType)) {
        throw new Error(`Workflow type ${workflowType} not registered`)
      }

      // Load initial context from execution (child) or workflow (parent)
      const initialContext = execution.context
        ? JSON.parse(execution.context)
        : (workflow.context ? JSON.parse(workflow.context) : {})

      const { engine, storage } = createWorkflowEngineWithDB({
        workflowId: execution.workflowId,
        workflowExecutionId: execution.id,
        context: initialContext
      })

      // Execute workflow and get output
      const output = await workflowRegistry.execute(workflowType, engine)

      // Save output to workflow execution
      await workflowStatusSyncService.updateWorkflowExecution(execution.id, {
        status: WorkflowExecutionStatus.SUCCESS,
        output: output ? JSON.stringify(output) : null
      })

      logger.info(`✅ Completed workflow execution: ${execution.id}`)

      // Generate consolidated knowledge from all agentic checkpoints (async, non-blocking)
      WorkflowPoller.generateConsolidatedKnowledge(execution.id, storage).catch((err: Error) => {
        logger.error(`Failed to generate consolidated knowledge for ${execution.id}:`, err)
      })

      const workspacePath = `/tmp/${execution.id}`
      logger.info(`🧹 Cleaning up workspace for completed parent workflow: ${workspacePath}`)
      await cleanupRepository(workspacePath).catch((err: Error) => {
        logger.warn(`Failed to cleanup workspace ${workspacePath}:`, err)
      })

      // Send workflow completion notification
      await notificationHooks.onWorkflowCompletion(execution.workflowId, 'SUCCESS', execution.id)

      // If this is a child execution, trigger parent resume
      if (execution.parentWorkflowExecutionId) {
        await WorkflowPoller.triggerParentResume(execution.parentWorkflowExecutionId, execution.id)
      }
    },
  );
}
