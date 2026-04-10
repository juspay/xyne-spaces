// Workflow poller for background execution

import os from 'os'
import { repositories, WorkflowExecutionWithState } from '@/database/repositories'
import { workflowRegistry } from '@/workflows/registry/workflowRegistry'
import { createWorkflowEngineWithDB } from '../factory'
import { WorkflowExecutionStatus, WorkflowType } from '../types/workflow-enums'
import { PollingConfig, WORKFLOW_POLLER_CONFIG } from './config'
import { LockService } from '@/services/lockService'
import { logger } from '@/utils/logger'
import { eventService } from '@/services/eventService'
import {
  WorkflowLockLostException,
  WorkflowPausedException,
  WorkflowCancelledException,
  WorkflowExternalWaitException,
} from '../exceptions/workflow-exceptions'
import { workflowStatusSyncService } from '../services/workflowStatusSyncService'
import { notificationHooks } from '@/hooks/notificationHooks'
import { cleanupRepository } from '@framework'
import { generateConsolidatedKnowledgeLearnings } from '../utils/knowledge-generator'
import type { WorkflowStorage } from '../workflow-storage'


interface PollingLoop {
  index: number
  timer?: NodeJS.Timeout
  currentExecutionId?: string
}

export class WorkflowPoller {
  private isRunning = false
  private currentInterval = WORKFLOW_POLLER_CONFIG.minInterval
  private config: PollingConfig
  private workerId: string
  private lockService: LockService
  private loops: PollingLoop[] = []
  private recoveryTimer?: NodeJS.Timeout

  constructor(config: PollingConfig = WORKFLOW_POLLER_CONFIG) {
    this.config = config
    this.workerId = `worker-${os.hostname()}-${process.pid}-${Date.now()}`
    this.lockService = new LockService()
    logger.info(`Worker initialized with ID: ${this.workerId}`)
  }

  async start(): Promise<void> {
    if (this.isRunning) return
    this.isRunning = true
    logger.info('🚀 Workflow poller started')
    this.startWorkers()
  }

  private startWorkers(): void {
    this.loops = Array.from({ length: this.config.batchSize }, (_, i) => ({ index: i }))
    const staggerTime = Math.floor(this.config.minInterval / this.config.batchSize)

    this.loops.forEach((loop, i) => {
      this.scheduleNextPoll(loop, i * staggerTime)
    })


  }

  async stop(): Promise<void> {
    logger.info('Workflow poller stop() called - initiating graceful shutdown')

    const activeExecutions = this.loops
      .filter(loop => loop.currentExecutionId)
      .map(loop => loop.currentExecutionId!)

    logger.info(`Active executions being processed: ${activeExecutions.length}`)

    this.isRunning = false
    this.loops.forEach((loop) => {
      if (loop.timer) clearTimeout(loop.timer)
    })

    if (this.recoveryTimer) {
      clearTimeout(this.recoveryTimer)
      this.recoveryTimer = undefined
    }

    if (activeExecutions.length > 0) {
      logger.info(`Marking ${activeExecutions.length} active workflow executions as PENDING for recovery`)
      const resetPromises = activeExecutions.map(async (executionId) => {
        try {
          await workflowStatusSyncService.updateWorkflowExecution(executionId, {
            status: WorkflowExecutionStatus.PENDING
          })
          await this.lockService.releaseLock(executionId)
          logger.info(`Reset workflow execution ${executionId} to PENDING`)
        } catch (error) {
          logger.error(`Failed to reset workflow execution ${executionId} to PENDING:`, error)
        }
      })
      await Promise.all(resetPromises)
    }

    this.loops = []
    logger.info('⏹️ Workflow poller stopped')
  }


  private scheduleNextPoll(loop: PollingLoop, delay: number = this.currentInterval): void {
    if (!this.isRunning) return

    loop.timer = setTimeout(async () => {
      try {
        const processed = await this.pollAndExecute(loop)
        this.scheduleNextPoll(loop, processed ? 0 : this.currentInterval)
      } catch (error) {
        logger.error(`Polling error in lane ${loop.index}:`, error)
        this.scheduleNextPoll(loop)
      }
    }, delay)
  }

  private async pollAndExecute(loop: PollingLoop): Promise<boolean> {
    if (!this.isRunning) return false

    const allowedWorkflowType = process.env.WORKFLOW_TYPE
    const execution = await repositories.workflowExecutions.claimNextPendingExecution(
      allowedWorkflowType,
      ['root', 'rerun']
    )

    if (!execution) {
      this.currentInterval = this.config.maxInterval
      return false
    }

    this.currentInterval = this.config.minInterval
    await this.processExecution(loop, execution)
    return true
  }

  private async processExecution(loop: PollingLoop, execution: WorkflowExecutionWithState): Promise<void> {
    await this.lockService.setLock(execution.id, this.workerId)
    loop.currentExecutionId = execution.id

    try {
      await this.executeWorkflow(execution)
    } catch (error) {
      await this.handleWorkflowError(execution, error as Error)
    } finally {
      loop.currentExecutionId = undefined
      await this.lockService.releaseLock(execution.id)
    }
  }

  private serializeError(err: Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
  }

  private async handleWorkflowError(execution: WorkflowExecutionWithState, error: Error): Promise<void> {
    try {
      if (error instanceof WorkflowLockLostException) {
        return
      }

      if (error instanceof WorkflowPausedException) {
        await workflowStatusSyncService.updateWorkflowExecution(execution.id, { status: WorkflowExecutionStatus.PAUSED })
        // Don't cleanup on pause - workflow will resume later
        return
      }

      if (error instanceof WorkflowCancelledException) {
        await workflowStatusSyncService.updateWorkflowExecution(execution.id, { status: WorkflowExecutionStatus.CANCELLED })
        // Cleanup workspace on cancellation for parent workflows
        if (!execution.parentWorkflowExecutionId) {
          const workspacePath = `/tmp/${execution.id}`
          logger.info(`🧹 Cleaning up workspace for cancelled parent workflow: ${workspacePath}`)
          await cleanupRepository(workspacePath).catch((err: Error) => {
            logger.warn(`Failed to cleanup workspace ${workspacePath}:`, err)
          })
        }
        await this.triggerParentResumeIfChild(execution.parentWorkflowExecutionId, execution.id)
        return
      }

      if (error instanceof WorkflowExternalWaitException) {
        await workflowStatusSyncService.updateWorkflowExecution(execution.id, { status: WorkflowExecutionStatus.WAIT_FOR_EVENT })
        // Don't cleanup on wait - workflow will resume later
        return
      }

      await workflowStatusSyncService.updateWorkflowExecution(execution.id, {
        status: WorkflowExecutionStatus.FAILURE,
        output: JSON.stringify(this.serializeError(error)),
      })

      // Cleanup workspace on failure for parent workflows
      if (!execution.parentWorkflowExecutionId) {
        const workspacePath = `/tmp/${execution.id}`
        logger.info(`🧹 Cleaning up workspace for failed parent workflow: ${workspacePath}`)
        await cleanupRepository(workspacePath).catch((err: Error) => {
          logger.warn(`Failed to cleanup workspace ${workspacePath}:`, err)
        })
      }

      // Send workflow failure notification
      // await notificationHooks.onWorkflowCompletion(execution.workflowId, 'FAILURE')

      await this.triggerParentResumeIfChild(execution.parentWorkflowExecutionId, execution.id)
    } catch (updateError) {
      logger.error(`Failed to update execution ${execution.id} status:`, updateError)
    }
  }

  private async executeWorkflow(execution: WorkflowExecutionWithState): Promise<void> {
    // Update status to RUNNING
    await workflowStatusSyncService.updateWorkflowExecution(execution.id, {
      status: WorkflowExecutionStatus.RUNNING
    })

    const workflow = await repositories.workflows.findById(execution.workflowId)
    if (!workflow) {
      throw new Error(`Workflow ${execution.workflowId} not found`)
    }

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
    this.generateConsolidatedKnowledge(execution.id, storage).catch((err: Error) => {
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
      await this.triggerParentResume(execution.parentWorkflowExecutionId, execution.id)
    }
  }

  private async triggerParentResumeIfChild(parentExecutionId: string | null, childExecutionId: string): Promise<void> {
    try {
      if (parentExecutionId) {
        await this.triggerParentResume(parentExecutionId, childExecutionId)
      }
    } catch (error) {
      logger.error(`Failed to trigger parent resume for ${childExecutionId}:`, error)
    }
  }

  private async triggerParentResume(parentExecutionId: string, completedChildId: string): Promise<void> {
    try {
      const childExecution = await repositories.workflowExecutions.findById(completedChildId)

      if (!childExecution) {
        logger.warn(`Child execution ${completedChildId} not found`)
        return
      }

      // Store event using EventService
      // The EventPoller will pick this up and promote parent to PENDING
      await eventService.storeEvent(
        completedChildId,
        childExecution.sourceStepsId || '',
        childExecution.output
      )

      logger.info(`✅ Stored child completion event for parent ${parentExecutionId} (child ${completedChildId})`)
    } catch (error) {
      logger.error(`Failed to store child completion event for ${parentExecutionId}:`, error)
    }
  }

  /**
   * Generate consolidated knowledge learnings from all agentic checkpoints after workflow success
   * Creates a single canvas with unified learnings across all phases
   */
  private async generateConsolidatedKnowledge(
    workflowExecutionId: string,
    storage: WorkflowStorage
  ): Promise<void> {
    try {
      // Get all pending agentic results accumulated during workflow execution
      const pendingResults = storage.getPendingAgenticResults(workflowExecutionId)

      if (pendingResults.length === 0) {
        logger.info(`ℹ️ No agentic results to consolidate for ${workflowExecutionId}`)
        return
      }

      logger.info(`💡 Generating consolidated knowledge from ${pendingResults.length} agentic checkpoints for ${workflowExecutionId}`)

      // Generate consolidated learnings from all checkpoint data
      const consolidatedLearnings = await generateConsolidatedKnowledgeLearnings(
        pendingResults.map(r => ({
          checkpointId: r.checkpointId,
          conversationResult: r.result,
          gitInfo: r.gitInfo
        }))
      )

      if (consolidatedLearnings.length === 0) {
        logger.info(`ℹ️ No learnings generated for ${workflowExecutionId}`)
        storage.clearPendingAgenticResults(workflowExecutionId)
        return
      }

      // Save consolidated learnings to database (checkpointId = 'consolidated')
      await storage.saveWorkflowKnowledge(
        workflowExecutionId,
        'consolidated',
        consolidatedLearnings
      )

      // Trigger single consolidated canvas creation
      await storage.triggerConsolidatedKnowledgeCanvas(
        workflowExecutionId,
        consolidatedLearnings
      )

      // Clear pending results after processing
      storage.clearPendingAgenticResults(workflowExecutionId)

      logger.info(`✅ Generated and saved ${consolidatedLearnings.length} consolidated learnings for ${workflowExecutionId}`)
    } catch (error) {
      logger.error(`Failed to generate consolidated knowledge for ${workflowExecutionId}:`, error)
      // Clear pending results even on error to avoid memory leak
      storage.clearPendingAgenticResults(workflowExecutionId)
    }
  }
}
