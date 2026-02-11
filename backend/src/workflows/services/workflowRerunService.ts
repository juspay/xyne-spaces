import { DatabaseClient } from '@/database/client';
import { WorkflowRepository } from '@/database/repositories/workflowRepository';
import { WorkflowExecutionStatus } from '@/workflows/types/workflow-enums';
import { createExecutionState, getExecutionState } from '@/database/repositories/workflowExecutionStateUtils';

interface RerunResult {
  rerunExecutionId: string;
  sourceExecutionId: string;
  workflowId: string;
  usedRootExecution?: boolean;
  originalRequestedExecutionId?: string;
  message: string;
}
import {logger} from '@/utils/logger';

/**
 * Service for handling workflow rerun operations
 */
export class WorkflowRerunService {
  private workflowRepository: WorkflowRepository;
  private db: ReturnType<typeof DatabaseClient.getInstance>;

  constructor() {
    this.workflowRepository = new WorkflowRepository();
    this.db = DatabaseClient.getInstance();
  }

  /**
   * Create a rerun execution from start for a specific ticket with updated context
   * Used by ticket-bot when updating and rerunning a ticket
   * 
   * @param params.ticketId - Ticket ID to rerun workflow for
   * @param params.updatedContext - Updated workflow context
   * @returns Rerun execution details
   */
  async rerunFromStart(params: {
    ticketId: string;
    updatedContext: any;
  }): Promise<RerunResult> {
    const { ticketId, updatedContext } = params;

    // Find the workflow for this ticket
    const workflow = await this.db.workflow.findFirst({
      where: { ticketId },
      orderBy: { createdAt: 'desc' }
    });

    if (!workflow) {
      throw new Error(`No workflow found for ticket ${ticketId}`);
    }

    // Find root execution
    const rootExecution = await this.db.workflowExecution.findFirst({
      where: {
        workflowId: workflow.id,
        parentWorkflowExecutionId: null
      },
      orderBy: { createdAt: 'desc' }
    });

    if (!rootExecution) {
      throw new Error(`No root execution found for workflow ${workflow.id}`);
    }

    // Create rerun from start with updated context
    const contextString = typeof updatedContext === 'string' 
      ? updatedContext 
      : JSON.stringify(updatedContext);
    
    const rerunExecution = await this.db.workflowExecution.create({
      data: {
        workflow: { connect: { id: workflow.id } },
        workflowType: rootExecution.workflowType,
        status: WorkflowExecutionStatus.PENDING,
        tag: 'rerun',
        parentWorkflowExecution: { connect: { id: rootExecution.id } },
        sourceStepsId: null // NULL = rerun from start
      }
    });

    // Create state with context
    await createExecutionState(rerunExecution.id, contextString, null);

    return {
      rerunExecutionId: rerunExecution.id,
      sourceExecutionId: rootExecution.id,
      workflowId: workflow.id,
      message: `Workflow rerun from start created successfully for ticket ${ticketId}`
    };
  }

  /**
   * Create a rerun execution from start for a specific execution ID
   * Used by workflow controller API endpoint
   * Always reruns from the root execution (traverses parent chain if needed)
   * 
   * @param executionId - Source execution ID to rerun from
   * @returns Rerun execution details
   */
  async rerunFromExecution(executionId: string): Promise<RerunResult> {
    // Get source execution
    const sourceExecution = await this.workflowRepository.getWorkflowExecutionByIdSimple(executionId);

    if (!sourceExecution) {
      throw new Error('Source execution not found');
    }

    // IMPORTANT: Always rerun from the root execution (tag='root', no parent)
    // Traverse parent chain until we find the root execution
    let rootExecution = sourceExecution;
    while (rootExecution.parentWorkflowExecutionId && 
           (rootExecution.tag === 'rerun' || rootExecution.tag === 'child')) {
      const parentExecution = await this.workflowRepository.getWorkflowExecutionByIdSimple(
        rootExecution.parentWorkflowExecutionId
      );
      if (!parentExecution) {
        break; // Stop if parent not found
      }
      rootExecution = parentExecution;
    }

    // Use root execution for context and as parent
    const executionToUse = rootExecution;

    // Get the context from the state table
    const executionState = await getExecutionState(executionToUse.id);

    // Create rerun execution with tag='rerun', sourceStepsId=null (indicates rerun from start)
    const rerunExecution = await this.db.workflowExecution.create({
      data: {
        workflow: { connect: { id: executionToUse.workflowId } },
        workflowType: executionToUse.workflowType,
        status: WorkflowExecutionStatus.PENDING,
        tag: 'rerun',
        parentWorkflowExecution: { connect: { id: executionToUse.id } },
        sourceStepsId: null // NULL indicates rerun from start (no specific restore point)
      }
    });

    // Create state with context from source execution
    await createExecutionState(rerunExecution.id, executionState.context, null);

    const usedRootExecution = executionToUse.id !== sourceExecution.id;

    await this.updateMessageMetadataForRerun(executionToUse.workflowId);

    return {
      rerunExecutionId: rerunExecution.id,
      sourceExecutionId: executionToUse.id,
      workflowId: executionToUse.workflowId,
      usedRootExecution,
      originalRequestedExecutionId: usedRootExecution ? sourceExecution.id : undefined,
      message: usedRootExecution
        ? `Rerun created from root execution (traversed from ${sourceExecution.id} to ${executionToUse.id})`
        : 'Workflow rerun from start initiated successfully'
    };
  }

  /**
   * Update message metadata when workflow is rerun to show it's running again
   */
  private async updateMessageMetadataForRerun(workflowId: string): Promise<void> {
    try {
      // Get workflow to find ticket and conversation
      const workflow = await this.db.workflow.findUnique({
        where: { id: workflowId }
      });

      if (!workflow?.ticketId) {
        logger.info(`[RerunService] No ticketId found for workflow ${workflowId}`);
        return;
      }

      // Get ticket to find conversation
      const ticket = await this.db.ticket.findUnique({
        where: { id: workflow.ticketId }
      });

      if (!ticket?.conversationId) {
        logger.info(`[RerunService] No conversation found for ticket ${workflow.ticketId}`);
        return;
      }

      const conversationId = ticket.conversationId;

      // Find existing SYSTEM message for this workflow
      const existingMessage = await this.db.message.findFirst({
        where: {
          conversationId,
          msgType: 'SYSTEM',
        },
        orderBy: { createdAt: 'desc' }
      });

      if (!existingMessage) {
        logger.info(`[RerunService] No SYSTEM message found for workflow ${workflowId}`);
        return;
      }

      // Check if this message belongs to our workflow by checking metadata
      const metadata = existingMessage.metadata as any;
      if (metadata?.workflowId !== workflowId) {
        logger.info(`[RerunService] Message ${existingMessage.messageId} does not belong to workflow ${workflowId}`);
        return;
      }

      // Update message metadata to show RUNNING status and clear completed/pending steps
      const updatedMetadata = {
        ...metadata,
        workflowStatus: 'RUNNING',
        completedSteps: [],
        pendingSteps: [],
        rerunStartTime: new Date().toISOString(),
        lastUpdated: new Date().toISOString()
      };

      await this.db.message.update({
        where: { messageId: existingMessage.messageId },
        data: {
          metadata: updatedMetadata
        }
      });

      logger.info(`[RerunService] Updated message ${existingMessage.messageId} metadata to RUNNING status for workflow ${workflowId}`);

    } catch (error) {
      logger.error(`[RerunService] Error updating message metadata for workflow ${workflowId}:`, error);
    }
  }
}

// Export singleton instance
export const workflowRerunService = new WorkflowRerunService();
