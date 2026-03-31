// Recovery worker for detecting and recovering stale workflow executions
// This should run in a separate pod to handle recovery independently

import { repositories } from '@/database/repositories'
import { LockService } from '@/services/lockService'
import { logger } from '@/utils/logger'

const RECOVERY_INTERVAL_MS = 60 * 1000 // 1 minute

export class RecoveryWorker {
  private isRunning = false
  private lockService: LockService
  private recoveryTimer?: NodeJS.Timeout

  constructor() {
    this.lockService = new LockService()
    logger.info('Recovery worker initialized')
  }

  async start(): Promise<void> {
    if (this.isRunning) return
    this.isRunning = true
    logger.info('🔄 Recovery worker started')
    this.scheduleRecovery()
  }

  async stop(): Promise<void> {
    logger.info('Recovery worker stop() called - initiating graceful shutdown')
    this.isRunning = false

    if (this.recoveryTimer) {
      clearTimeout(this.recoveryTimer)
      this.recoveryTimer = undefined
    }

    logger.info('⏹️ Recovery worker stopped')
  }

  private scheduleRecovery(): void {
    if (!this.isRunning) return

    this.recoveryTimer = setTimeout(async () => {
      try {
        await this.recoverStaleExecutions()
      } catch (error) {
        logger.warn('[RECOVERY] Error during stale execution recovery:', error)
      } finally {
        this.scheduleRecovery()
      }
    }, RECOVERY_INTERVAL_MS)
  }

  private async recoverStaleExecutions(): Promise<void> {
    const runningIds = await repositories.workflowExecutions.findRunningExecutionIds()
    if (runningIds.length === 0) {
      logger.debug('[RECOVERY] No running executions found')
      return
    }

    logger.debug(`[RECOVERY] Checking ${runningIds.length} running execution(s) for stale locks`)

    const expiredIds = await this.lockService.getExpiredExecutionIds(runningIds)
    if (expiredIds.length === 0) {
      logger.debug('[RECOVERY] No stale executions found')
      return
    }

    await repositories.workflowExecutions.resetExecutionsToPending(expiredIds)
    logger.info(
      `[RECOVERY] Reset ${expiredIds.length} stale RUNNING execution(s) to PENDING: [${expiredIds.join(', ')}]`
    )
  }
}
