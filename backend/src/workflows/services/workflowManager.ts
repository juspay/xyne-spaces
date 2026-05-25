// Core WorkflowManager service for orchestrating workflow execution

import { repositories } from '@/database/repositories'
import {
  WorkflowType,
  WorkflowExecutionStatus,
  WorkflowExecutionResult,
  WorkflowExecutionProgress,
  WorkflowTriggerRequest,
  isTerminalStatus,
  isActiveStatus
} from '../types/workflow-enums'
import { workflowStatusSyncService } from './workflowStatusSyncService'
import {logger} from '@/utils/logger';

export class WorkflowManager {
  private static instance: WorkflowManager

  private constructor() {}

  static getInstance(): WorkflowManager {
    if (!WorkflowManager.instance) {
      WorkflowManager.instance = new WorkflowManager()
    }
    return WorkflowManager.instance
  }

  // Start a new workflow execution
  async startWorkflow(request: WorkflowTriggerRequest): Promise<{
    executionId: string
    workflowId: string
    status: WorkflowExecutionStatus
  }> {
    try {
      const ticket = await repositories.tickets.getTicketById(request.ticketId)
      if (!ticket) {
        throw new Error(`Ticket ${request.ticketId} not found`)
      }

      // 1. Create Workflow record
      const workflow = await repositories.workflows.create({
        ticketId: request.ticketId,
        workspaceId: ticket.workspaceId,
        workflowType: request.workflowType,
        status: WorkflowExecutionStatus.NEW,
        context: request.context ? JSON.stringify(request.context) : null,
        metadata: JSON.stringify({
          priority: request.priority,
          ...request.metadata
        }),
        scheduledAt: request.scheduledAt
      })

      // 2. Create WorkflowExecution record
      const execution = await repositories.workflowExecutions.create({
        workflow: { connect: { id: workflow.id } },
        context: request.context ? JSON.stringify(request.context) : null,
        workflowType: request.workflowType,
        status: WorkflowExecutionStatus.PENDING,
        createdBy: request.createdBy,
      })

      await repositories.workflows.update(workflow.id, {
        status: WorkflowExecutionStatus.PENDING
      })

      return {
        executionId: execution.id,
        workflowId: workflow.id,
        status: WorkflowExecutionStatus.PENDING
      }
    } catch (error) {
      logger.error('Failed to start workflow:', error)
      throw new Error(`Failed to start workflow: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }


  async resumeWorkflow(executionId: string): Promise<void> {
    try {
      const execution = await repositories.workflowExecutions.findById(executionId)
      if (!execution) {
        throw new Error(`Workflow execution ${executionId} not found`)
      }

      if (execution.status !== WorkflowExecutionStatus.PAUSED) {
        throw new Error(`Workflow execution ${executionId} is not paused (current status: ${execution.status})`)
      }

      // Update status to RUNNING
      await workflowStatusSyncService.updateWorkflowExecution(executionId, {
        status: WorkflowExecutionStatus.PENDING,
        ignoreDuration: {
          increment: Date.now() - execution.updatedAt.getTime()
        }
      })

      // Get workflow metadata to extract workflow type and context
      const workflow = await repositories.workflows.findById(execution.workflowId)
      if (!workflow) {
        throw new Error(`Workflow ${execution.workflowId} not found`)
      }

      if (!workflow.workflowType) {
        throw new Error(`Workflow type not found in metadata for execution ${executionId}`)
      }

      logger.info(`Resumed workflow execution: ${executionId}`)
    } catch (error) {
      logger.error(`Failed to resume workflow ${executionId}:`, error)
      throw error
    }
  }

  // Pause a running workflow
  async pauseWorkflow(executionId: string): Promise<void> {
    try {
      const execution = await repositories.workflowExecutions.findById(executionId)
      if (!execution) {
        throw new Error(`Workflow execution ${executionId} not found`)
      }

      if (!isActiveStatus(execution.status as WorkflowExecutionStatus)) {
        throw new Error(`Workflow execution ${executionId} is not active (current status: ${execution.status})`)
      }

      // Update status to PAUSED
      await workflowStatusSyncService.updateWorkflowExecution(executionId, {
        status: WorkflowExecutionStatus.PAUSED
      })


      logger.info(`Paused workflow execution: ${executionId}`)
    } catch (error) {
      logger.error(`Failed to pause workflow ${executionId}:`, error)
      throw error
    }
  }

  // Cancel a workflow execution
  async cancelWorkflow(executionId: string): Promise<void> {
    try {
      const execution = await repositories.workflowExecutions.findById(executionId)
      if (!execution) {
        throw new Error(`Workflow execution ${executionId} not found`)
      }

      if (isTerminalStatus(execution.status as WorkflowExecutionStatus)) {
        throw new Error(`Workflow execution ${executionId} is already in terminal status: ${execution.status}`)
      }

      // Update status to CANCELLED
      await workflowStatusSyncService.updateWorkflowExecution(executionId, {
        status: WorkflowExecutionStatus.CANCELLED
      })


      logger.info(`Cancelled workflow execution: ${executionId}`)
    } catch (error) {
      logger.error(`Failed to cancel workflow ${executionId}:`, error)
      throw error
    }
  }

  // Get workflow execution status and progress
  async getExecutionStatus(executionId: string): Promise<WorkflowExecutionProgress> {
    try {
      const execution = await repositories.workflowExecutions.findById(executionId)
      if (!execution) {
        throw new Error(`Workflow execution ${executionId} not found`)
      }

      // Get workflow type from execution (child) or workflow (parent)
      const workflow = await repositories.workflows.findById(execution.workflowId)
      const workflowType = (execution.workflowType || workflow?.workflowType) as WorkflowType

      // Get all workflow steps for this execution
      const steps = await repositories.workflowSteps.findByWorkflowExecutionId(executionId)

      // Analyze step completion
      const completedSteps = steps.filter(step => step.data !== null).map(step => step.stepName || step.id)
      const pendingSteps = steps.filter(step => step.data === null).map(step => step.stepName || step.id)
      const failedSteps: string[] = [] // TODO: Implement step failure tracking

      // Calculate progress
      const totalSteps = steps.length
      const completedCount = completedSteps.length
      const progress = totalSteps > 0 ? Math.round((completedCount / totalSteps) * 100) : 0

      // Get current step (first pending step)
      const currentStep = pendingSteps[0] || undefined

      return {
        executionId,
        workflowType: workflowType || WorkflowType.USER_ONBOARDING,
        status: execution.status as WorkflowExecutionStatus,
        progress,
        currentStep,
        completedSteps,
        pendingSteps,
        failedSteps,
        lastUpdated: execution.updatedAt
      }
    } catch (error) {
      logger.error(`Failed to get execution status for ${executionId}:`, error)
      throw error
    }
  }

  async provideExternalData<R>(executionId: string, stepId: string, data: R): Promise<void> {
    try {
      const execution = await repositories.workflowExecutions.findById(executionId)
      if (!execution) {
        throw new Error(`Workflow execution ${executionId} not found`)
      }

      const { DBWorkflowStorage } = await import('../storage/db-storage')
      const storage = new DBWorkflowStorage()

      await storage.saveExternalStepData(executionId, stepId, data)

      if (execution.status === WorkflowExecutionStatus.WAIT_FOR_EVENT) {
        await this.resumeWorkflow(executionId)
      }

      logger.info(`Provided external data for execution ${executionId}, step ${stepId}`)
    } catch (error) {
      logger.error(`Failed to provide external data for ${executionId}:${stepId}:`, error)
      throw error
    }
  }

  // Get execution result
  async getExecutionResult(executionId: string): Promise<WorkflowExecutionResult> {
    try {
      const execution = await repositories.workflowExecutions.findById(executionId)
      if (!execution) {
        throw new Error(`Workflow execution ${executionId} not found`)
      }

      // Get workflow type from execution (child) or workflow (parent)
      const workflow = await repositories.workflows.findById(execution.workflowId)
      const workflowType = (execution.workflowType || workflow?.workflowType) as WorkflowType

      const steps = await repositories.workflowSteps.findByWorkflowExecutionId(executionId)
      const completedSteps = steps.filter(step => step.data !== null)
      const failedSteps = [] // TODO: Implement failure tracking

      const duration = execution.updatedAt.getTime() - execution.createdAt.getTime()

      return {
        executionId,
        workflowType: workflowType || WorkflowType.USER_ONBOARDING,
        status: execution.status as WorkflowExecutionStatus,
        startedAt: execution.createdAt,
        completedAt: isTerminalStatus(execution.status as WorkflowExecutionStatus) ? execution.updatedAt : undefined,
        duration: isTerminalStatus(execution.status as WorkflowExecutionStatus) ? duration : undefined,
        stepCount: steps.length,
        completedSteps: completedSteps.length,
        failedSteps: failedSteps.length,
        result: execution.output ? JSON.parse(execution.output) : undefined
      }
    } catch (error) {
      logger.error(`Failed to get execution result for ${executionId}:`, error)
      throw error
    }
  }

}

// Export singleton instance
export const workflowManager = WorkflowManager.getInstance()
