// Workflow Status Synchronization Service
// Implements the "any success wins" logic for primary workflow executions

import { repositories } from '@/database/repositories'
import { WorkflowExecutionStatus, WorkflowStatus } from '../types/workflow-enums'
import { logger } from '@/utils/logger'
import { notificationService } from '@/services/notificationService'
import { UpdateWorkflowExecutionInput, WorkflowExecution } from '@/types/database'
import { LockService } from '@/services/lockService'

// Note: Including legacy statuses for backwards compatibility during migration
const ACTIVE_STATUSES = [
  'NEW',
  'PENDING',
  'RUNNING',
  'PAUSED',
  'WAIT_FOR_EVENT',
  // Legacy statuses (to be removed in Phase 2):
  'EXTERNAL_WAIT',
  'WAITING_FOR_CHILD_EXECUTIONS'
] as const
const TERMINAL_STATUSES = ['SUCCESS', 'FAILURE', 'CANCELLED'] as const
const SUCCESS_STATUSES = ['SUCCESS'] as const

type ActiveStatus = typeof ACTIVE_STATUSES[number]
type TerminalStatus = typeof TERMINAL_STATUSES[number]
type SuccessStatus = typeof SUCCESS_STATUSES[number]

export class WorkflowStatusSyncService {

  /**
   * Updates a workflow execution and automatically triggers status sync for terminal statuses
   * This centralizes the update logic and prevents circular dependencies
   *
   * @param id - The workflow execution ID to update
   * @param data - The update data
   * @returns Promise<WorkflowExecution> - The updated workflow execution
   */
  async updateWorkflowExecution(
    id: string,
    data: UpdateWorkflowExecutionInput
  ): Promise<WorkflowExecution> {
    try {
      // 1. Update the execution via repository (pure data access)
      const result = await repositories.workflowExecutions.update(id, data)

      // 2. Handle status sync logic for terminal statuses
      if (data.status && typeof data.status === 'string') {
        if (this.isTerminalStatus(data.status)) {
          // Fire and forget - don't wait for sync to complete
          // Pass workflowId for performance optimization
          this.syncWorkflowStatus(
            id,
            data.status as WorkflowExecutionStatus,
            result.workflowId
          ).catch((error) => {
            // Sync failures are non-fatal - already logged in the service
            // This catch prevents unhandled promise rejection warnings
            logger.warn(`Status sync failed for execution ${id}:`, error)
          })
        }
      }
      // release lock if the status is cancelled|failure|success|WAIT_FOR_EVENT|EXTERNAL_WAIT
      if (data.status && typeof data.status === 'string') {
        if (
          this.isTerminalStatus(data.status) ||
          data.status === 'WAIT_FOR_EVENT' ||
          data.status === 'EXTERNAL_WAIT'
        ) {
          await new LockService().releaseLock(id);
        }
      }

      return result
    } catch (error) {
      logger.error(`Failed to update workflow execution ${id}:`, error)
      throw error
    }
  }

  /**
   * Synchronizes workflow status based on primary execution statuses
   * Implements user's "any success wins" logic for terminal statuses
   * Also triggers ticket status sync for active statuses like RUNNING
   *
   * @param workflowExecutionId - The execution that just had its status updated
   * @param newStatus - The new status of the execution
   * @param workflowId - Optional workflowId for performance optimization
   */
  async syncWorkflowStatus(
    workflowExecutionId: string,
    newStatus: WorkflowExecutionStatus,
    workflowId?: string
  ): Promise<void> {
    try {
      // Handle active statuses (like RUNNING) - only trigger ticket sync
      if (this.isActiveStatus(newStatus)) {
        let targetWorkflowId = workflowId
        if (!targetWorkflowId) {
          const execution = await repositories.workflowExecutions.findById(workflowExecutionId)
          if (!execution) {
            logger.warn(`WorkflowExecution not found: ${workflowExecutionId}`)
            return
          }
          targetWorkflowId = execution.workflowId
        }

        // Update workflow status to active status (e.g., RUNNING)
        await repositories.workflows.update(targetWorkflowId, {
          status: WorkflowStatus.PENDING
        })

        return
      }

      // Only process terminal status updates for full workflow status sync
      if (!this.isTerminalStatus(newStatus)) {
        return
      }

      // Get the execution details if workflowId not provided
      let targetWorkflowId = workflowId
      let execution = null

      if (!targetWorkflowId) {
        execution = await repositories.workflowExecutions.findById(workflowExecutionId)
        if (!execution) {
          logger.warn(`WorkflowExecution not found: ${workflowExecutionId}`)
          return
        }
        targetWorkflowId = execution.workflowId
      }

      // Check if this is a primary execution (not a child)
      if (!execution) {
        execution = await repositories.workflowExecutions.findById(workflowExecutionId)
        if (!execution) {
          logger.warn(`WorkflowExecution not found: ${workflowExecutionId}`)
          return
        }
      }

      // Exit if this is not a primary execution
      if (execution.parentWorkflowExecutionId !== null) {
        return // Skip child executions as per user requirements
      }

      // Get ALL primary executions for this workflow
      const primaryExecutions = await repositories.workflowExecutions.findMany({
        where: {
          workflowId: targetWorkflowId,
          parentWorkflowExecutionId: null
        },
        orderBy: {
          createdAt: 'asc'
        }
      })

      if (primaryExecutions.length === 0) {
        logger.warn(`No primary executions found for workflow: ${targetWorkflowId}`)
        return
      }

      // Check if any primary executions are still active
      const hasActiveExecution = primaryExecutions.some(exec =>
        this.isActiveStatus(exec.status as WorkflowExecutionStatus)
      )

      if (hasActiveExecution) {
        logger.debug(`Workflow ${targetWorkflowId} has active executions, waiting for completion`)
        return // Wait for all primary executions to complete
      }

      // All primary executions are terminal - apply "any success wins" logic
      const hasSuccessfulExecution = primaryExecutions.some(exec =>
        this.isSuccessStatus(exec.status as WorkflowExecutionStatus)
      )

      const workflowStatus = hasSuccessfulExecution ? 'SUCCESS' : 'FAILURE'

      // Update workflow status
      await repositories.workflows.update(targetWorkflowId, {
        status: workflowStatus
      })

      // Send completion notification
      await notificationService.sendWorkflowCompletionNotification(
        targetWorkflowId,
        workflowStatus
      )

      logger.info(`Workflow ${targetWorkflowId} status updated to ${workflowStatus}`, {
        triggerExecutionId: workflowExecutionId,
        triggerStatus: newStatus,
        totalPrimaryExecutions: primaryExecutions.length,
        successfulExecutions: primaryExecutions.filter(exec =>
          this.isSuccessStatus(exec.status as WorkflowExecutionStatus)
        ).length,
        executionStatuses: primaryExecutions.map(exec => ({
          id: exec.id,
          status: exec.status
        }))
      })

    } catch (error) {
      // Non-fatal error handling as per user requirements
      logger.error(`Failed to sync workflow status for execution ${workflowExecutionId}:`, error, {
        workflowExecutionId,
        newStatus,
        workflowId,
        errorMessage: error instanceof Error ? error.message : 'Unknown error'
      })
      // Don't throw - workflow execution should not fail due to status sync issues
    }
  }

  /**
   * Batch sync multiple executions for performance (optional enhancement)
   */
  async batchSyncWorkflowStatuses(
    updates: Array<{
      workflowExecutionId: string
      newStatus: WorkflowExecutionStatus
      workflowId?: string
    }>
  ): Promise<void> {
    const terminalUpdates = updates.filter(update =>
      this.isTerminalStatus(update.newStatus)
    )

    if (terminalUpdates.length === 0) {
      return
    }

    // Group by workflowId to avoid duplicate processing
    const workflowGroups = new Map<string, typeof terminalUpdates>()

    for (const update of terminalUpdates) {
      const workflowId = update.workflowId || 'unknown'
      if (!workflowGroups.has(workflowId)) {
        workflowGroups.set(workflowId, [])
      }
      workflowGroups.get(workflowId)!.push(update)
    }

    // Process each workflow group
    const results = await Promise.allSettled(
      Array.from(workflowGroups.values()).flat().map(update =>
        this.syncWorkflowStatus(
          update.workflowExecutionId,
          update.newStatus,
          update.workflowId
        )
      )
    )

    const failures = results.filter(result => result.status === 'rejected')
    if (failures.length > 0) {
      logger.warn(`Batch workflow status sync had ${failures.length} failures out of ${terminalUpdates.length} updates`)
    }
  }

  // Helper methods for status classification
  private isTerminalStatus(status: string): status is TerminalStatus {
    return TERMINAL_STATUSES.includes(status as TerminalStatus)
  }

  private isActiveStatus(status: string): status is ActiveStatus {
    return ACTIVE_STATUSES.includes(status as ActiveStatus)
  }

  private isSuccessStatus(status: string): status is SuccessStatus {
    return SUCCESS_STATUSES.includes(status as SuccessStatus)
  }

  /**
   * Get current workflow status summary for debugging
   */
  async getWorkflowStatusSummary(workflowId: string): Promise<{
    workflowStatus: string
    primaryExecutions: Array<{
      id: string
      status: string
      createdAt: Date
    }>
    hasActiveExecutions: boolean
    hasSuccessfulExecutions: boolean
  }> {
    const workflow = await repositories.workflows.findById(workflowId)
    const primaryExecutions = await repositories.workflowExecutions.findMany({
      where: {
        workflowId,
        parentWorkflowExecutionId: null
      },
      orderBy: {
        createdAt: 'asc'
      }
    })

    const hasActiveExecutions = primaryExecutions.some(exec =>
      this.isActiveStatus(exec.status as WorkflowExecutionStatus)
    )

    const hasSuccessfulExecutions = primaryExecutions.some(exec =>
      this.isSuccessStatus(exec.status as WorkflowExecutionStatus)
    )

    return {
      workflowStatus: workflow?.status || 'UNKNOWN',
      primaryExecutions: primaryExecutions.map(exec => ({
        id: exec.id,
        status: exec.status,
        createdAt: exec.createdAt
      })),
      hasActiveExecutions,
      hasSuccessfulExecutions
    }
  }
}

// Singleton instance for use across the application
export const workflowStatusSyncService = new WorkflowStatusSyncService()
