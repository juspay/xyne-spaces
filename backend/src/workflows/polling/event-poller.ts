import os from 'os'
import { repositories } from '@/database/repositories'
import { WorkflowExecutionStatus } from '../types/workflow-enums'
import { PollingConfig, EVENT_POLLER_CONFIG } from './config'
import { LockService } from '@/services/lockService'
import { logger } from '@/utils/logger'

/**
 * EventPoller - Monitors WAIT_FOR_EVENT executions and promotes them to PENDING
 */
export class EventPoller {
  private isRunning = false
  private currentInterval = EVENT_POLLER_CONFIG.minInterval
  private timeoutId?: NodeJS.Timeout
  private config: PollingConfig
  private workerId: string
  private lockService: LockService

  constructor(config: PollingConfig = EVENT_POLLER_CONFIG) {
    this.config = config
    this.workerId = `event-poller-${os.hostname()}-${process.pid}-${Date.now()}`
    this.lockService = new LockService()
    logger.info(`EventPoller initialized with ID: ${this.workerId}`)
  }

  async start(): Promise<void> {
    if (this.isRunning) return
    this.isRunning = true
    logger.info('🎯 EventPoller started')
    this.scheduleNextPoll()
  }

  async stop(): Promise<void> {
    this.isRunning = false
    if (this.timeoutId) {
      clearTimeout(this.timeoutId)
    }
    logger.info('⏹️ EventPoller stopped')
  }

  private scheduleNextPoll(): void {
    if (!this.isRunning) return

    this.timeoutId = setTimeout(async () => {
      try {
        await this.pollAndPromote()
        this.scheduleNextPoll()
      } catch (error) {
        logger.error('EventPoller error:', error)
        this.scheduleNextPoll()
      }
    }, this.currentInterval)
  }

  private async pollAndPromote(): Promise<void> {
    const allowedWorkflowType = process.env.WORKFLOW_TYPE
    const waitingExecutions = await repositories.workflowExecutions.findByStatus(
      WorkflowExecutionStatus.WAIT_FOR_EVENT,
      allowedWorkflowType,
    )

    if (waitingExecutions.length === 0) {
      this.currentInterval = this.config.maxInterval
      return
    }

    this.currentInterval = this.config.minInterval

    const executionPromises = waitingExecutions.map(execution =>this.tryPromote(execution))
    await Promise.allSettled(executionPromises)
  }

  private async tryPromote(execution: any): Promise<void> {
    // Try to acquire lock
    const lockAcquired = await this.lockService.tryAcquireLock(execution.id, this.workerId)

    if (!lockAcquired) {
      return
    }

    try {
      const externalResponses = await repositories.externalStepResponses.findByWorkflowExecutionId(execution.id)
      
      if (externalResponses.length === 0) {
        logger.debug(`⏳ Execution ${execution.id} still waiting for external response, skipping promotion`)
        return
      }

      await repositories.workflowExecutions.update(execution.id, {
        status: WorkflowExecutionStatus.PENDING
      })
      logger.info(`✅ Promoted execution ${execution.id} from WAIT_FOR_EVENT to PENDING (response received)`)
    } catch (error) {
      logger.error(`Failed to promote execution ${execution.id}:`, error)
    } finally {
      await this.lockService.releaseLock(execution.id, this.workerId)
    }
  }
}
