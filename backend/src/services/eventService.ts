import { repositories } from '@/database/repositories'
import { logger } from '@/utils/logger'

/**
 * EventService - Stores workflow events to ExternalStepResponse table
 * Used by both webhooks and child workflow completions
 * Does NOT update workflow status - that's handled by EventPoller
 */
export class EventService {
  /**
   * Store an event for a workflow step
   * @param workflowExecutionId - The workflow execution waiting for the event
   * @param stepId - The workflow step ID (INPUT step for external/parallel steps)
   * @param eventData - The event payload (webhook data or child execution result)
   */
  async storeEvent(
    workflowExecutionId: string,
    stepId: string,
    eventData: any
  ): Promise<void> {
    try {
      // Convert eventData to JSON string if it's an object
      const rawResponse = typeof eventData === 'string'
        ? eventData
        : JSON.stringify(eventData)

      // Upsert to ExternalStepResponse table
      await repositories.externalStepResponses.upsertByExecutionAndStepId(
        workflowExecutionId,
        stepId,
        rawResponse
      )

      logger.info(`Event stored for workflow ${workflowExecutionId}, step ${stepId}`)
    } catch (error) {
      logger.error(`Failed to store event for workflow ${workflowExecutionId}, step ${stepId}:`, error)
      throw error
    }
  }
}

export const eventService = new EventService()
