// Feature Planning Workflow definition

import { WorkflowEngine, BaseWorkflowContext, AgenticCheckpointConfig } from '../workflow-types'
import { WorkflowDefinition, EmptyPreExecuteResult } from '../registry/workflowRegistry'
import { WorkflowType } from '../types/workflow-enums'
import { z } from 'zod'
import {logger} from '@/utils/logger';

// Step IDs for feature planning workflow
export enum FeaturePlanningSteps {
  CREATE_PLAN = 'create_plan'
}

export interface FeaturePlanningContext extends BaseWorkflowContext {
  ticketId: string
  title: string
  description: string
  requirements: string
  contextAnalysis: string
  repoUrl?: string
  repoBranch?: string
  planningType?: string
}

export interface FeaturePlanningOutput {
  plan: string
}

// Agent configuration for planning
const createPlanningAgentConfig = (
  title: string,
  description: string,
  requirements: string,
  contextAnalysis: string,
  repoUrl?: string,
  repoBranch?: string
): AgenticCheckpointConfig => {

  return {
    conversationContext: {
      initialUserMessage: `Create an implementation plan for this feature:

Title: ${title}
Description: ${description}
Requirements: ${requirements}

Context Analysis:
${contextAnalysis}

Please provide a detailed implementation plan.`
    },
    repoInfo: {
      repoUrl: repoUrl || 'https://github.com/Shailendra-03/Simon-Game',
      repoBranch: repoBranch
    }
  }
}

const FeaturePlanningInputSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().min(1, "Description is required"),
  requirements: z.string().min(1, "Requirements are required"),
  contextAnalysis: z.string().min(1, "Context analysis is required"),
  repoUrl: z.string().url().optional(),
  repoBranch: z.string().optional(),
  planningType: z.string().optional()
})

const featurePlanningContextMapper = (payload: any): FeaturePlanningContext => ({
  ticketId: payload.ticketId,
  title: payload.title,
  description: payload.description,
  requirements: payload.requirements,
  contextAnalysis: payload.contextAnalysis,
  repoUrl: payload.repoUrl,
  repoBranch: payload.repoBranch,
  planningType: payload.planningType
})

export const featurePlanningWorkflow: WorkflowDefinition<FeaturePlanningContext, FeaturePlanningOutput, typeof FeaturePlanningSteps> = {
  type: WorkflowType.FEATURE_PLANNING,
  name: 'Feature Planning Workflow',
  description: 'Creates implementation plan for feature requests',
  inputSchema: FeaturePlanningInputSchema,
  contextMapper: featurePlanningContextMapper,

  async execute(engine: WorkflowEngine<FeaturePlanningContext, typeof FeaturePlanningSteps>, _preExecuteResult: EmptyPreExecuteResult): Promise<FeaturePlanningOutput> {
    const context = engine.getContext()
    const { ticketId, title, description, requirements, contextAnalysis, repoUrl, repoBranch } = context

    // Create implementation plan using AI agent
    const planningCheckpointResult = await engine.createAgenticCheckpoint(
      FeaturePlanningSteps.CREATE_PLAN,
      'feature_planner',
      createPlanningAgentConfig(title, description, requirements, contextAnalysis, repoUrl, repoBranch)
    )
    const planningResult = planningCheckpointResult.result

    // Extract the last message content from the agent response
    const lastMessage = planningResult.messages[planningResult.messages.length - 1]
    const planContent = lastMessage?.content || 'No plan generated'

    logger.info(`✅ Feature planning completed for ${ticketId}`)

    return {
      plan: planContent
    }
  }
}
