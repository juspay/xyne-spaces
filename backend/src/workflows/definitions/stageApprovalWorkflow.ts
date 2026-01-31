// @ts-nocheck
// TODO: Update to use ExternalStepRequestResult pattern
import { WorkflowEngine, BaseWorkflowContext } from '../workflow-types'
import { WorkflowDefinition } from '../registry/workflowRegistry'
import { WorkflowType } from '../types/workflow-enums'
import { z } from 'zod'
import {logger} from '@/utils/logger';


export interface StageApprovalContext extends BaseWorkflowContext {
  taskId: string
  taskTitle: string
  taskDescription: string
  assignedTo?: string
}

export interface StageApprovalOutput {
  completedStages: string[]
  totalDuration: number
  completedAt: string
  allStagesApproved: boolean
}

// Step IDs for stage approval workflow (matching the stages from the image)
export enum StageApprovalSteps {
  DEBUGGING = 'debugging',
  DESIGN_IN_PROGRESS = 'design_in_progress',
  DEV_IN_PROGRESS = 'dev_in_progress',
  PR_REVIEW = 'pr_review',
  WAITING_FOR_MERGE = 'waiting_for_merge',
  SANDBOX_TESTING = 'sandbox_testing',
  PROD_DEPLOYMENT = 'prod_deployment',
  VERIFICATION = 'verification'
}

export const StageApprovalInputSchema = z.object({
  taskId: z.string(),
  taskTitle: z.string(),
  taskDescription: z.string(),
  assignedTo: z.string().optional()
})

export const stageApprovalContextMapper = (payload: z.infer<typeof StageApprovalInputSchema> & { ticketId : string } ): StageApprovalContext => ({
  ticketId: payload.ticketId,
  taskId: payload.taskId,
  taskTitle: payload.taskTitle,
  taskDescription: payload.taskDescription,
  assignedTo: payload.assignedTo
})



/**
 * Empty request handler for user_approval type external steps
 * No action needed - just logs that the step is waiting for user approval
 */
const emptyUserApprovalHandler = async (
  workflowExecutionId: string,
  workflowStepId: string,
  stageName: string
): Promise<void> => {
  logger.info(`📋 [STAGE_APPROVAL] Stage "${stageName}" is waiting for user approval`)
  logger.info(`   - Workflow Execution ID: ${workflowExecutionId}`)
  logger.info(`   - Workflow Step ID: ${workflowStepId}`)
  logger.info(`   - User needs to click "Approve" button in the UI to proceed`)
}

/**
 * Simple response processor for user_approval steps
 * Expects rawResponse to be either "approved" or JSON with approval status
 */
const processApprovalResponse = async (rawResponse: string): Promise<{
  approved: boolean
  approvedAt: string
  approvedBy?: string
  comments?: string
}> => {
  logger.info(`✅ [STAGE_APPROVAL] Processing approval response: ${rawResponse}`)

  try {
    // Try to parse as JSON first
    const parsed = JSON.parse(rawResponse)
    return {
      approved: parsed.approved === true || parsed.status === 'approved',
      approvedAt: parsed.approvedAt || new Date().toISOString(),
      approvedBy: parsed.approvedBy,
      comments: parsed.comments
    }
  } catch {
    // If not JSON, treat as simple string
    return {
      approved: rawResponse.toLowerCase().includes('approved'),
      approvedAt: new Date().toISOString()
    }
  }
}

export const stageApprovalWorkflow: WorkflowDefinition<
  StageApprovalContext,
  StageApprovalOutput,
  typeof StageApprovalSteps
> = {
  type: WorkflowType.STAGE_APPROVAL_WORKFLOW,
  name: 'Stage Approval Workflow',
  description: 'Multi-stage approval workflow where each stage requires user approval to proceed',
  category: 'Approval',
  icon: 'check-circle',
  requiresRepo: false,
  priority: 'medium',
  fields: ['taskId', 'taskTitle', 'taskDescription'],
  inputSchema: StageApprovalInputSchema,
  contextMapper: stageApprovalContextMapper,


  async execute(engine: WorkflowEngine<StageApprovalContext, typeof StageApprovalSteps>): Promise<StageApprovalOutput> {
    const context = engine.getContext()
    const startTime = Date.now()
    const completedStages: string[] = []

    logger.info(`🚀 [STAGE_APPROVAL] Starting stage approval workflow for task: ${context.taskTitle}`)
    logger.info(`📋 Task ID: ${context.taskId}`)
    logger.info(`📝 Description: ${context.taskDescription}`)
    if (context.assignedTo) {
      logger.info(`👤 Assigned to: ${context.assignedTo}`)
    }

    // Stage 1: Debugging
    logger.info(`\n🐛 [STAGE 1/8] Debugging`)
    const debuggingApproval = await engine.createExternalStep<{
      approved: boolean
      approvedAt: string
      approvedBy?: string
      comments?: string
    }, [string]>(
      StageApprovalSteps.DEBUGGING,
      {
        type: 'user_approval',
        title: 'Debugging - Identify and fix bugs in the code'
      },
      emptyUserApprovalHandler,
      processApprovalResponse,
      'Debugging'
    )

    if (debuggingApproval.approved) {
      completedStages.push('Debugging')
      logger.info(`✅ Debugging approved at ${debuggingApproval.approvedAt}`)
    }

    // Stage 2: Design In Progress
    logger.info(`\n🎨 [STAGE 2/8] Design In Progress`)
    const designApproval = await engine.createExternalStep<{
      approved: boolean
      approvedAt: string
      approvedBy?: string
      comments?: string
    }, [string]>(
      StageApprovalSteps.DESIGN_IN_PROGRESS,
      {
        type: 'user_approval',
        title: 'Design In Progress - Review and approve the design'
      },
      emptyUserApprovalHandler,
      processApprovalResponse,
      'Design In Progress'
    )

    if (designApproval.approved) {
      completedStages.push('Design In Progress')
      logger.info(`✅ Design approved at ${designApproval.approvedAt}`)
    }

    // Stage 3: Dev In Progress
    logger.info(`\n💻 [STAGE 3/8] Dev In Progress`)
    const devApproval = await engine.createExternalStep<{
      approved: boolean
      approvedAt: string
      approvedBy?: string
      comments?: string
    }, [string]>(
      StageApprovalSteps.DEV_IN_PROGRESS,
      {
        type: 'user_approval',
        title: 'Dev In Progress - Development work is underway'
      },
      emptyUserApprovalHandler,
      processApprovalResponse,
      'Dev In Progress'
    )

    if (devApproval.approved) {
      completedStages.push('Dev In Progress')
      logger.info(`✅ Development approved at ${devApproval.approvedAt}`)
    }

    // Stage 4: PR Review
    logger.info(`\n👀 [STAGE 4/8] PR Review`)
    const prReviewApproval = await engine.createExternalStep<{
      approved: boolean
      approvedAt: string
      approvedBy?: string
      comments?: string
    }, [string]>(
      StageApprovalSteps.PR_REVIEW,
      {
        type: 'user_approval',
        title: 'PR Review - Code review and pull request approval'
      },
      emptyUserApprovalHandler,
      processApprovalResponse,
      'PR Review'
    )

    if (prReviewApproval.approved) {
      completedStages.push('PR Review')
      logger.info(`✅ PR Review approved at ${prReviewApproval.approvedAt}`)
    }

    // Stage 5: Waiting for Merge
    logger.info(`\n🔀 [STAGE 5/8] Waiting for Merge`)
    const mergeApproval = await engine.createExternalStep<{
      approved: boolean
      approvedAt: string
      approvedBy?: string
      comments?: string
    }, [string]>(
      StageApprovalSteps.WAITING_FOR_MERGE,
      {
        type: 'user_approval',
        title: 'Waiting for Merge - PR is ready to be merged'
      },
      emptyUserApprovalHandler,
      processApprovalResponse,
      'Waiting for Merge'
    )

    if (mergeApproval.approved) {
      completedStages.push('Waiting for Merge')
      logger.info(`✅ Merge approved at ${mergeApproval.approvedAt}`)
    }

    // Stage 6: Sandbox Testing
    logger.info(`\n🧪 [STAGE 6/8] Sandbox Testing`)
    const sandboxApproval = await engine.createExternalStep<{
      approved: boolean
      approvedAt: string
      approvedBy?: string
      comments?: string
    }, [string]>(
      StageApprovalSteps.SANDBOX_TESTING,
      {
        type: 'user_approval',
        title: 'Sandbox Testing - Test changes in sandbox environment'
      },
      emptyUserApprovalHandler,
      processApprovalResponse,
      'Sandbox Testing'
    )

    if (sandboxApproval.approved) {
      completedStages.push('Sandbox Testing')
      logger.info(`✅ Sandbox Testing approved at ${sandboxApproval.approvedAt}`)
    }

    // Stage 7: Prod Deployment
    logger.info(`\n🚀 [STAGE 7/8] Prod Deployment`)
    const prodApproval = await engine.createExternalStep<{
      approved: boolean
      approvedAt: string
      approvedBy?: string
      comments?: string
    }, [string]>(
      StageApprovalSteps.PROD_DEPLOYMENT,
      {
        type: 'user_approval',
        title: 'Prod Deployment - Deploy to production environment'
      },
      emptyUserApprovalHandler,
      processApprovalResponse,
      'Prod Deployment'
    )

    if (prodApproval.approved) {
      completedStages.push('Prod Deployment')
      logger.info(`✅ Production Deployment approved at ${prodApproval.approvedAt}`)
    }

    // Stage 8: Verification
    logger.info(`\n✔️ [STAGE 8/8] Verification`)
    const verificationApproval = await engine.createExternalStep<{
      approved: boolean
      approvedAt: string
      approvedBy?: string
      comments?: string
    }, [string]>(
      StageApprovalSteps.VERIFICATION,
      {
        type: 'user_approval',
        title: 'Verification - Verify that everything works in production'
      },
      emptyUserApprovalHandler,
      processApprovalResponse,
      'Verification'
    )

    if (verificationApproval.approved) {
      completedStages.push('Verification')
      logger.info(`✅ Verification approved at ${verificationApproval.approvedAt}`)
    }

    const totalDuration = Date.now() - startTime
    const completedAt = new Date().toISOString()

    logger.info(`\n🎉 [STAGE_APPROVAL] Workflow completed!`)
    logger.info(`📊 Summary:`)
    logger.info(`   ✅ Completed Stages: ${completedStages.length}/8`)
    logger.info(`   ⏱️  Total Duration: ${Math.round(totalDuration / 1000)} seconds`)
    logger.info(`   📋 Stages: ${completedStages.join(' → ')}`)
    logger.info(`   🕐 Completed At: ${completedAt}`)

    return {
      completedStages,
      totalDuration,
      completedAt,
      allStagesApproved: completedStages.length === 8
    }
  }
}
