// Ticket Status Synchronization Service
// Implements "any success wins" logic for workflows within a ticket

import { AI_STAGES } from '../types/workflow-enums';
import { repositories } from '@/database/repositories'
import { ticketService } from '@/services/ticketService';
import { logger } from '@/utils/logger'
import { TicketStatusV2 } from '@prisma/client'
import { DatabaseClient } from '@/database/client'

const prisma = DatabaseClient.getInstance();

// Status classifications for workflow statuses
const SUCCESSFUL_WORKFLOW_STATUSES = ['SUCCESS'] as const
const FAILED_WORKFLOW_STATUSES = ['FAILURE', 'CANCELLED'] as const
const ACTIVE_WORKFLOW_STATUSES = [
  'NEW',
  'PENDING',
  'SCHEDULED',
  'RUNNING',
  'PAUSED',
  'WAIT_FOR_EVENT',
  // Legacy statuses (to be removed in Phase 2):
  'EXTERNAL_WAIT',
  'WAITING_FOR_CHILD_EXECUTIONS'
] as const

type SuccessfulWorkflowStatus = typeof SUCCESSFUL_WORKFLOW_STATUSES[number]
type FailedWorkflowStatus = typeof FAILED_WORKFLOW_STATUSES[number]
type ActiveWorkflowStatus = typeof ACTIVE_WORKFLOW_STATUSES[number]

export class TicketStatusSyncService {

  /**
   * Synchronizes ticket status based on all workflow statuses for that ticket
   * Implements user's business logic:
   * - Any workflow SUCCESS → ticket RESOLVED
   * - All workflows FAILURE/CANCELLED → ticket DROPPED
   * - Has active workflows → keep current ticket status
   *
   * @param workflowId - The workflow that just had its status updated
   */
  async syncTicketStatus(workflowId: string): Promise<void> {
    try {
      logger.info(`[DEBUG] Starting ticket status sync for workflow: ${workflowId}`)

      // 1. Get the workflow to find the ticketId
      const workflow = await repositories.workflows.findById(workflowId)
      if (!workflow) {
        logger.warn(`Workflow not found: ${workflowId}`)
        return
      }

      const ticketId = workflow.ticketId
      
      // Skip workflows without ticketId (e.g., Ask AI workflows)
      if (!ticketId) {
        logger.debug(`Workflow ${workflowId} has no ticketId, skipping ticket status sync`)
        return
      }
      
      logger.info(`[DEBUG] Found workflow for ticket: ${ticketId}, workflow status: ${workflow.status}`)

      // 2. Get ALL workflows for this ticket (future-proof for 1:N relationship)
      const allTicketWorkflows = await repositories.workflows.findByTicketId(ticketId)

      if (allTicketWorkflows.length === 0) {
        logger.warn(`No workflows found for ticket: ${ticketId}`)
        return
      }

      logger.info(`[DEBUG] Found ${allTicketWorkflows.length} workflows for ticket ${ticketId}:`,
        allTicketWorkflows.map(wf => ({ id: wf.id, status: wf.status })))

      // 3. Analyze workflow statuses to determine ticket status
      const hasSuccessfulWorkflow = allTicketWorkflows.some(wf =>
        this.isSuccessfulStatus(wf.status)
      )

      const hasActiveWorkflow = allTicketWorkflows.some(wf =>
        this.isActiveStatus(wf.status)
      )

      const allWorkflowsAreFailed = allTicketWorkflows.every(wf =>
        this.isFailedStatus(wf.status)
      )

      logger.info(`[DEBUG] Workflow analysis: hasSuccessful=${hasSuccessfulWorkflow}, hasActive=${hasActiveWorkflow}, allFailed=${allWorkflowsAreFailed}`)

      // 4. Apply user's business logic
      let newTicketStatus: TicketStatusV2 | null = null
      let newStage: AI_STAGES | undefined = undefined

      if (hasSuccessfulWorkflow && !hasActiveWorkflow) {
        // Any workflow successful AND no active workflows → ticket COMPLETED
        newTicketStatus = TicketStatusV2.COMPLETED
        newStage = AI_STAGES.HUMAN_INTERVENTION
        logger.info(`[DEBUG] Setting ticket status to COMPLETED (has successful workflow, no active workflows)`)
      } else if (hasActiveWorkflow) {
        // Has active workflows → ticket STARTED (regardless of past successful workflows)
        newTicketStatus = TicketStatusV2.STARTED
        newStage = AI_STAGES.AI_PICKED_UP
        logger.info(`[DEBUG] Setting ticket status to STARTED (has active workflows)`)
      } else if (allWorkflowsAreFailed && !hasActiveWorkflow) {
        // All workflows failed/cancelled and none active → ticket CANCELLED
        newTicketStatus = TicketStatusV2.CANCELLED
        newStage = AI_STAGES.HUMAN_INTERVENTION
        logger.info(`[DEBUG] Setting ticket status to CANCELLED (all workflows failed)`)
      } else {
        logger.info(`[DEBUG] No ticket status change needed (mixed states)`)
      }

      if (newStage) {
        await ticketService.updateTicketStageForWorkflow(ticketId, 'BOT', newStage)
      }
      // 5. Update ticket status if needed
      if (newTicketStatus) {
        logger.info(`[DEBUG] Updating ticket ${ticketId} status to ${newTicketStatus}`)
        const result = await prisma.ticket.update({
          where: { id: ticketId },
          data: {
            statusV2: newTicketStatus,
            updatedAt: new Date()
          }
        })
        logger.info(`[DEBUG] Ticket update completed successfully:`, result)

        logger.info(`Ticket ${ticketId} status updated to ${newTicketStatus}`, {
          triggerWorkflowId: workflowId,
          triggerWorkflowStatus: workflow.status,
          totalWorkflows: allTicketWorkflows.length,
          successfulWorkflows: allTicketWorkflows.filter(wf =>
            this.isSuccessfulStatus(wf.status)
          ).length,
          failedWorkflows: allTicketWorkflows.filter(wf =>
            this.isFailedStatus(wf.status)
          ).length,
          activeWorkflows: allTicketWorkflows.filter(wf =>
            this.isActiveStatus(wf.status)
          ).length,
          workflowStatuses: allTicketWorkflows.map(wf => ({
            id: wf.id,
            type: wf.workflowType,
            status: wf.status
          }))
        })
      } else {
        logger.debug(`Ticket ${ticketId} status unchanged - has active workflows`, {
          triggerWorkflowId: workflowId,
          activeWorkflows: allTicketWorkflows.filter(wf =>
            this.isActiveStatus(wf.status)
          ).length
        })
      }

    } catch (error) {
      // Non-fatal error handling as per established pattern
      logger.error(`Failed to sync ticket status for workflow ${workflowId}:`, error, {
        workflowId,
        errorMessage: error instanceof Error ? error.message : 'Unknown error'
      })
      // Don't throw - ticket status sync shouldn't break workflow execution
    }
  }

  /**
   * Batch sync multiple tickets for performance (optional enhancement)
   */
  async batchSyncTicketStatuses(workflowIds: string[]): Promise<void> {
    if (workflowIds.length === 0) {
      return
    }

    // Group by ticketId to avoid duplicate processing
    const ticketGroups = new Map<string, string[]>()

    for (const workflowId of workflowIds) {
      try {
        const workflow = await repositories.workflows.findById(workflowId)
        if (workflow && workflow.ticketId) {
          const ticketId = workflow.ticketId
          if (!ticketGroups.has(ticketId)) {
            ticketGroups.set(ticketId, [])
          }
          ticketGroups.get(ticketId)!.push(workflowId)
        }
      } catch (error) {
        logger.warn(`Failed to group workflow ${workflowId} for batch processing:`, error)
      }
    }

    // Process one workflow per ticket (they'll all sync the same ticket anyway)
    const results = await Promise.allSettled(
      Array.from(ticketGroups.values()).map(workflowIdsForTicket =>
        this.syncTicketStatus(workflowIdsForTicket[0]) // Just use first workflow to trigger sync
      )
    )

    const failures = results.filter(result => result.status === 'rejected')
    if (failures.length > 0) {
      logger.warn(`Batch ticket status sync had ${failures.length} failures out of ${ticketGroups.size} tickets`)
    }
  }

  // Helper methods for status classification
  private isSuccessfulStatus(status: string): status is SuccessfulWorkflowStatus {
    return SUCCESSFUL_WORKFLOW_STATUSES.includes(status as SuccessfulWorkflowStatus)
  }

  private isFailedStatus(status: string): status is FailedWorkflowStatus {
    return FAILED_WORKFLOW_STATUSES.includes(status as FailedWorkflowStatus)
  }

  private isActiveStatus(status: string): status is ActiveWorkflowStatus {
    return ACTIVE_WORKFLOW_STATUSES.includes(status as ActiveWorkflowStatus)
  }

  /**
   * Get current ticket status summary for debugging
   */
  async getTicketStatusSummary(ticketId: string): Promise<{
    ticketStatus: string
    workflows: Array<{
      id: string
      type: string
      status: string
      createdAt: Date
    }>
    hasActiveWorkflows: boolean
    hasSuccessfulWorkflows: boolean
    hasFailedWorkflows: boolean
    recommendedTicketStatus: TicketStatusV2 | null
  }> {
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId }
    })
    const workflows = await repositories.workflows.findByTicketId(ticketId)

    const hasActiveWorkflows = workflows.some(wf => this.isActiveStatus(wf.status))
    const hasSuccessfulWorkflows = workflows.some(wf => this.isSuccessfulStatus(wf.status))
    const hasFailedWorkflows = workflows.some(wf => this.isFailedStatus(wf.status))
    const allWorkflowsAreFailed = workflows.every(wf => this.isFailedStatus(wf.status))

    // Apply same business logic to determine recommended status
    let recommendedTicketStatus: TicketStatusV2 | null = null
    if (hasSuccessfulWorkflows && !hasActiveWorkflows) {
      recommendedTicketStatus = TicketStatusV2.COMPLETED
    } else if (hasActiveWorkflows) {
      recommendedTicketStatus = TicketStatusV2.STARTED
    } else if (allWorkflowsAreFailed && !hasActiveWorkflows) {
      recommendedTicketStatus = TicketStatusV2.CANCELLED
    }

    return {
      ticketStatus: ticket?.statusV2 || 'UNKNOWN',
      workflows: workflows.map(wf => ({
        id: wf.id,
        type: wf.workflowType || 'UNKNOWN',
        status: wf.status,
        createdAt: wf.createdAt
      })),
      hasActiveWorkflows,
      hasSuccessfulWorkflows,
      hasFailedWorkflows,
      recommendedTicketStatus
    }
  }
}

// Singleton instance for use across the application
export const ticketStatusSyncService = new TicketStatusSyncService()
