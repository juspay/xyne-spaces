import { repositories } from '@/database/repositories'
import { WorkflowStep } from '@/types/database'
import {logger} from '@/utils/logger';

export interface StepData {
  id: string
  stepName: string | null
  stepExecutorType: string
  type: string | null
  sourceExecutionId: string
  data: unknown
  isOverridden?: boolean
  createdAt: Date
}

export interface PrecedingStepsResult {
  workflowExecutionId: string
  targetStepId: string
  steps: StepData[]
}

export class WorkflowDataService {
  /**
   * Get all step data (input/output) that occurred before the specified input step,
   * including data from parent executions if this is a rerun.
   *
   * @param inputStepDbId - The database ID of the target input step
   * @returns All preceding steps with input/output data
   */
  async getPrecedingSteps(
    inputStepDbId: string
  ): Promise<PrecedingStepsResult> {
    // 1. Validate the input step exists
    const inputStep = await repositories.workflowSteps.findById(inputStepDbId)
    if (!inputStep) {
      throw new Error(`Step ${inputStepDbId} not found`)
    }

    const workflowExecutionId = inputStep.workflowExecutionId
    const inputStepCreatedAt = inputStep.createdAt
    const executionChain: string[] = []
    let allSteps: WorkflowStep[] = []

    // 2. Fetch steps from current execution up to the input step
    const currentExecutionSteps = await repositories.workflowSteps.findMany({
      where: {
        workflowExecutionId: workflowExecutionId,
        createdAt: {
          lte: inputStepCreatedAt
        }
      },
      orderBy: {
        createdAt: 'asc'
      }
    })

    allSteps = [...currentExecutionSteps]
    executionChain.unshift(workflowExecutionId)

    // 3. Walk the parent chain if this is a rerun
    let currentExecution = await repositories.workflowExecutions.findById(workflowExecutionId)

    while (currentExecution && currentExecution.tag === 'rerun' && currentExecution.parentWorkflowExecutionId) {
      const parentExecutionId = currentExecution.parentWorkflowExecutionId
      const sourceStepsId = currentExecution.sourceStepsId

      if (!sourceStepsId) {
        logger.warn(`Rerun execution ${currentExecution.id} missing sourceStepsId`)
        break
      }

      // Get the source step in parent execution (this is where we restored from)
      const sourceStep = await repositories.workflowSteps.findById(sourceStepsId)
      if (!sourceStep) {
        logger.warn(`Source step ${sourceStepsId} not found in parent execution`)
        break
      }

      // Fetch all steps from parent up to the source step
      const parentSteps = await repositories.workflowSteps.findMany({
        where: {
          workflowExecutionId: parentExecutionId,
          createdAt: {
            lte: sourceStep.createdAt
          }
        },
        orderBy: {
          createdAt: 'asc'
        }
      })

      // Prepend parent steps (they come before current execution steps chronologically)
      allSteps = [...parentSteps, ...allSteps]
      executionChain.unshift(parentExecutionId)

      // Move to parent's parent
      currentExecution = await repositories.workflowExecutions.findById(parentExecutionId)
    }

    // 4. Get the current execution to check for step input override
    const currentExecutionData = await repositories.workflowExecutions.findById(workflowExecutionId)

    // 5. Format the step data
    const formattedSteps: StepData[] = allSteps.map(step => {
      const stepData: StepData = {
        id: step.id,
        stepName: step.stepName,
        stepExecutorType: step.stepExecutorType,
        type: step.type,
        sourceExecutionId: step.workflowExecutionId,
        data: step.data ? JSON.parse(step.data) : null,
        createdAt: step.createdAt
      }

      // Check if this step has an override (for rerun executions)
      if (currentExecutionData?.tag === 'rerun' && 
          currentExecutionData.sourceStepsId === step.id && 
          currentExecutionData.stepInputOverrideData) {
        stepData.isOverridden = true
        // Use override data instead of original
        stepData.data = JSON.parse(currentExecutionData.stepInputOverrideData)
      }

      return stepData
    })

    return {
      workflowExecutionId,
      targetStepId: inputStep.id,
      steps: formattedSteps,
    }
  }
}

export const workflowDataService = new WorkflowDataService()
