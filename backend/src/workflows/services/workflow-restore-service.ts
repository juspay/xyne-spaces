import { repositories } from '@/database/repositories'
import { WorkflowExecutionStatus } from '../types/workflow-enums'
import { workflowStatusSyncService } from './workflowStatusSyncService'
import {logger} from '@/utils/logger';

export interface RestoreResult {
  rerunExecutionId: string
  actualRestoreStepId: string
  actualRestoreStepName: string
  liftedToParallel: boolean
  liftChain: string[]
  sourceRootExecutionId: string
}

export interface ModifiedStepInput {
  stepName: string
  modifiedInput: unknown
}

export interface CreateRerunOptions {
  sourceExecutionId: string
  restoreStepId: string
  modifiedInput?: unknown  // Optional modified input for the restore step
}

// Options for continuing an agentic step with user input
export interface ContinueAgenticStepOptions {
  sourceExecutionId: string      // The execution containing the agentic step
  agenticStepId: string          // The INPUT step ID of the agentic checkpoint
  continuationMessage: string    // User's message to append to conversation
}

// Webhook to workflow-step mapping
const webhookWorkflowMapper = {
  bitbucket: {
    workflows: [] as ReadonlyArray<{ workflow: string; step: string }>,
  },
} as const;

export class WorkflowRestoreService {
  /**
   * Creates a new rerun execution from a restore point.
   * Handles nested child workflows by recursively lifting to root execution's parallel step.
   * Optionally supports modifying the input for the restore step.
   *
   * @param options - The rerun options including source execution, restore step, and optional modifications
   * @returns RestoreResult containing the new execution ID and lift metadata
   */
  async createRerunExecution(
    options: string | CreateRerunOptions
  ): Promise<RestoreResult> {
    // Support backward compatibility: if called with just sourceExecutionId as string
    let sourceExecutionId: string
    let restoreStepId: string
    let modifiedInput: unknown | undefined

    if (typeof options === 'string') {
      // Legacy call: createRerunExecution(sourceExecutionId, restoreStepId)
      // This shouldn't happen since we're changing the signature, but keeping for safety
      throw new Error('createRerunExecution now requires an options object')
    } else {
      sourceExecutionId = options.sourceExecutionId
      restoreStepId = options.restoreStepId
      modifiedInput = options.modifiedInput
    }
    // Look up the restore step to validate and get metadata
    const restoreStep = await repositories.workflowSteps.findById(restoreStepId)
    if (!restoreStep) {
      throw new Error(`Step ${restoreStepId} not found`)
    }

    if (restoreStep.type !== 'input') {
      throw new Error(`Step ${restoreStepId} is not an INPUT step. Only INPUT steps can be used as restore points.`)
    }

    let sourceExecution = await repositories.workflowExecutions.findById(sourceExecutionId)
    if (!sourceExecution) {
      throw new Error(`Execution ${sourceExecutionId} not found`)
    }

    // Validate that the step belongs to the source execution
    if (restoreStep.workflowExecutionId !== sourceExecutionId) {
      throw new Error(`Step ${restoreStepId} does not belong to execution ${sourceExecutionId}`)
    }

    let actualRestoreStepId = restoreStepId
    let actualRestoreStepName = restoreStep.stepName || 'unknown'
    let liftedToParallel = false
    const liftChain: string[] = []
    let currentSourceExecutionId = sourceExecutionId

    // Recursive lift to root if source is a child workflow
    while (sourceExecution.tag === 'child') {
      if (!sourceExecution.parentWorkflowExecutionId || !sourceExecution.sourceStepsId) {
        throw new Error(`Child execution ${sourceExecution.id} missing parent reference`)
      }

      // Get the parallel step (INPUT step) that spawned this child workflow
      // sourceStepsId for child workflows is the DB ID of the parallel INPUT step
      const parallelInputStep = await repositories.workflowSteps.findById(sourceExecution.sourceStepsId)
      if (!parallelInputStep) {
        throw new Error(`Parallel step ${sourceExecution.sourceStepsId} not found`)
      }

      // Record lift chain for debugging/auditing
      liftChain.push(`${sourceExecution.id}.${actualRestoreStepName} → ${parallelInputStep.stepName}`)

      // Move to parent execution
      sourceExecution = await repositories.workflowExecutions.findById(sourceExecution.parentWorkflowExecutionId)
      if (!sourceExecution) {
        throw new Error('Parent execution not found')
      }

      currentSourceExecutionId = sourceExecution.id
      actualRestoreStepId = parallelInputStep.id // Use DB ID
      actualRestoreStepName = parallelInputStep.stepName || 'unknown'
      liftedToParallel = true
    }

    // At this point, sourceExecution is either "root" or "rerun" (not "child")
    // Validate that the restore step has a corresponding OUTPUT step (completed)
    const outputSteps = await repositories.workflowSteps.findMany({
      where: {
        workflowExecutionId: sourceExecution.id,
        stepName: actualRestoreStepName,
        type: 'output'
      }
    })
    const outputStep = outputSteps[0] || null

    if (!outputStep) {
      throw new Error(
        `Step ${actualRestoreStepName} not completed in execution ${sourceExecution.id}`
      )
    }

    // Use syncWorkflowStatus to properly update the workflow status and trigger ticket sync
    await workflowStatusSyncService.syncWorkflowStatus(
      sourceExecution.id,
      WorkflowExecutionStatus.PENDING,
      sourceExecution.workflowId
    );

    // Create the rerun execution
    const rerunExecution = await repositories.workflowExecutions.create({
      workflow: { connect: { id: sourceExecution.workflowId } },
      workspaceId: sourceExecution.workspaceId,
      workflowType: sourceExecution.workflowType,
      context: sourceExecution.context,
      status: WorkflowExecutionStatus.PENDING,
      tag: 'rerun',
      parentWorkflowExecution: { connect: { id: sourceExecution.id } },
      sourceStepsId: actualRestoreStepId, // Store the INPUT step's DB ID
      stepInputOverrideData: modifiedInput ? JSON.stringify(modifiedInput) : null,
      createdBy: sourceExecution.createdBy,
    })

    if (modifiedInput !== undefined) {
      logger.info(`✓ Created input override for step ${actualRestoreStepName} in rerun execution ${rerunExecution.id}`)
    }

    return {
      rerunExecutionId: rerunExecution.id,
      actualRestoreStepId,
      actualRestoreStepName,
      liftedToParallel,
      liftChain,
      sourceRootExecutionId: currentSourceExecutionId
    }
  }

  /**
   * Helper method to validate if a step can be restored from.
   * A step can be restored if it's an INPUT step with a corresponding OUTPUT step.
   *
   * @param stepId - The DB ID of the INPUT step
   * @returns true if the step can be restored, false otherwise
   */
  async canRestoreFromStep(stepId: string): Promise<boolean> {
    const inputStep = await repositories.workflowSteps.findById(stepId)
    if (!inputStep || inputStep.type !== 'input') {
      return false
    }

    // Check if corresponding OUTPUT step exists (step completed)
    const outputSteps = await repositories.workflowSteps.findMany({
      where: {
        workflowExecutionId: inputStep.workflowExecutionId,
        stepName: inputStep.stepName,
        type: 'output'
      }
    })
    const outputStep = outputSteps[0] || null
    return outputStep !== null
  }

  /**
   * Gets the effective restore point after lift logic is applied.
   * Useful for frontend to show what will actually be restored.
   *
   * @param sourceExecutionId - The execution ID to restore from
   * @param restoreStepId - The DB ID of the INPUT step to restore from
   * @returns Information about the effective restore point
   */
  async getEffectiveRestorePoint(
    sourceExecutionId: string,
    restoreStepId: string
  ): Promise<{
    effectiveExecutionId: string
    effectiveStepId: string
    effectiveStepName: string
    liftedToParallel: boolean
    liftChain: string[]
  }> {
    // Look up the restore step to validate
    const restoreStep = await repositories.workflowSteps.findById(restoreStepId)
    if (!restoreStep) {
      throw new Error(`Step ${restoreStepId} not found`)
    }

    if (restoreStep.type !== 'input') {
      throw new Error(`Step ${restoreStepId} is not an INPUT step`)
    }

    let sourceExecution = await repositories.workflowExecutions.findById(sourceExecutionId)
    if (!sourceExecution) {
      throw new Error(`Execution ${sourceExecutionId} not found`)
    }

    // Validate that the step belongs to the source execution
    if (restoreStep.workflowExecutionId !== sourceExecutionId) {
      throw new Error(`Step ${restoreStepId} does not belong to execution ${sourceExecutionId}`)
    }

    let effectiveStepId = restoreStepId
    let effectiveStepName = restoreStep.stepName || 'unknown'
    let liftedToParallel = false
    const liftChain: string[] = []

    // Apply same lift logic as createRerunExecution
    while (sourceExecution.tag === 'child') {
      if (!sourceExecution.parentWorkflowExecutionId || !sourceExecution.sourceStepsId) {
        throw new Error(`Child execution ${sourceExecution.id} missing parent reference`)
      }

      const parallelInputStep = await repositories.workflowSteps.findById(sourceExecution.sourceStepsId)
      if (!parallelInputStep) {
        throw new Error(`Parallel step ${sourceExecution.sourceStepsId} not found`)
      }

      liftChain.push(`${sourceExecution.id}.${effectiveStepName} → ${parallelInputStep.stepName}`)

      sourceExecution = await repositories.workflowExecutions.findById(sourceExecution.parentWorkflowExecutionId)
      if (!sourceExecution) {
        throw new Error('Parent execution not found')
      }

      effectiveStepId = parallelInputStep.id
      effectiveStepName = parallelInputStep.stepName || 'unknown'
      liftedToParallel = true
    }

    return {
      effectiveExecutionId: sourceExecution.id,
      effectiveStepId,
      effectiveStepName,
      liftedToParallel,
      liftChain
    }
  }

  /**
   * Get the step name for a webhook source and workflow type from the mapper.
   * Falls back to the first INPUT step if no mapping found.
   * 
   * @param webhookSource - The webhook source (e.g., 'bitbucket', 'github')
   * @param workflowType - The workflow type
   * @returns The step name to use for the rerun
   */
  async getStepNameForWebhook(
    webhookSource: string,
    workflowType: string
  ): Promise<string> {
    const sourceConfig = webhookWorkflowMapper[webhookSource as keyof typeof webhookWorkflowMapper];
    if (sourceConfig) {
      const workflowConfig = sourceConfig.workflows.find(w => w.workflow === workflowType);
      if (workflowConfig) {
        return workflowConfig.step;
      }
    }

    logger.warn(`⚠️  No step mapping found for workflow type ${workflowType} and source ${webhookSource}`);
    throw new Error(`No step mapping found for workflow type ${workflowType} and webhook source ${webhookSource}`);
  }

  /**
   * Creates a continuation rerun for an agentic step.
   * This allows continuing an agentic step with additional user input while preserving
   * the conversation history from the original execution.
   * 
   * The continuation works by:
   * 1. Finding the child execution that contains the agentic step's conversation
   * 2. Creating a rerun with special override containing:
   *    - continuationUserMessage: The user's new input
   *    - sourceChildExecutionId: Reference to original child execution for history
   * 3. When the agentic step runs, it reconstructs history and appends user message
   *
   * @param options - The continuation options
   * @returns RestoreResult with the new execution details
   */
  async createContinuationRerun(
    options: ContinueAgenticStepOptions
  ): Promise<RestoreResult> {
    const { sourceExecutionId, agenticStepId, continuationMessage } = options

    // 1. Validate the agentic step
    const agenticStep = await repositories.workflowSteps.findById(agenticStepId)
    if (!agenticStep) {
      throw new Error(`Agentic step ${agenticStepId} not found`)
    }

    if (agenticStep.type !== 'input') {
      throw new Error(`Step ${agenticStepId} is not an INPUT step`)
    }

    if (agenticStep.stepExecutorType !== 'agent') {
      throw new Error(`Step ${agenticStepId} is not an agentic checkpoint step`)
    }

    // 2. Find the child execution for this agentic step
    // The child execution has sourceStepsId = agenticStepId
    const childExecutions = await repositories.workflowExecutions.findMany({
      where: {
        parentWorkflowExecutionId: sourceExecutionId,
        sourceStepsId: agenticStepId
      }
    })

    if (childExecutions.length === 0) {
      throw new Error(`No child execution found for agentic step ${agenticStepId}`)
    }

    const sourceChildExecution = childExecutions[0]

    logger.info(`🔄 [RESTORE-SERVICE] Creating continuation for agentic step`)
    logger.info(`   Source execution: ${sourceExecutionId}`)
    logger.info(`   Agentic step: ${agenticStepId} (${agenticStep.stepName})`)
    logger.info(`   Source child execution: ${sourceChildExecution.id}`)

    // 3. Create the continuation override with targetStepId to ensure it only applies to this step
    const continuationOverride = {
      continuationUserMessage: continuationMessage,
      sourceChildExecutionId: sourceChildExecution.id,
      targetStepId: agenticStep.stepName
    }

    // 4. Use createRerunExecution with the continuation override as modifiedInput
    return await this.createRerunExecution({
      sourceExecutionId,
      restoreStepId: agenticStepId,
      modifiedInput: continuationOverride
    })
  }
}

export const workflowRestoreService = new WorkflowRestoreService()
