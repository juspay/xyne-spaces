// Feature Implementation Workflow definition

import { WorkflowEngine, BaseWorkflowContext, LoopControl, AgenticCheckpointConfig } from '../workflow-types'
import { WorkflowDefinition, EmptyPreExecuteResult } from '../registry/workflowRegistry'
import { WorkflowType } from '../types/workflow-enums'
import type { ConversationResult } from '@framework'
import { z } from "zod";
import {logger} from '@/utils/logger';

// Step IDs for feature implementation workflow
export enum FeatureImplementationSteps {
  EXTRACT_CONTEXT = 'extract_context',
  PARALLEL_PLANNING = 'parallel_planning',
  SELECT_OPTIMAL_PLAN = 'select_optimal_plan',
  CODING_VERIFICATION_LOOP = 'coding_verification_loop',
  IMPLEMENT_CODE = 'implement_code',
  VERIFY_IMPLEMENTATION = 'verify_implementation',
  FINALIZE = 'finalize'
}

export interface FeatureImplementationContext extends BaseWorkflowContext {
  ticketId: string
  title: string
  description: string
  requirements: string
}

export interface FeatureImplementationOutput {
  ticketId: string
  status: 'completed' | 'failed'
  implementationDetails?: {
    filesChanged: string[]
    commitHash: string
    verificationPassed: boolean
  }
}

// Agent configuration helper - properly typed with complete AgentConfig
const createAgentConfig = (
  _name: string,
  instructions: string,
  initialMessage: string,
  _toolNames?: string[]
): AgenticCheckpointConfig => {
  return {
    conversationContext: {
      systemPrompt: instructions,
      initialUserMessage: initialMessage
    },
    repoInfo: {
      repoUrl: process.env.REPO_URL || 'https://github.com/Shailendra-03/Simon-Game'
    }
  }
}

// Agent configs for different phases
const getContextExtractionConfig = (title: string, description: string, requirements: string) =>
  createAgentConfig(
    'context_extractor',
    `Analyze the feature request and extract all necessary technical context including:
- Affected modules/components
- Dependencies
- Technical constraints
- Implementation scope`,
    `Feature Request:
Title: ${title}
Description: ${description}
Requirements: ${requirements}

Please analyze and extract technical context.`
  )

const getPlanSelectionConfig = (plan1: any, plan2: any) =>
  createAgentConfig(
    'plan_selector',
    `You are a senior technical architect. Review both implementation plans and select the optimal one based on:
- Code quality and maintainability
- Performance implications
- Risk level
- Implementation complexity
- Alignment with requirements

Return your selection as: "Plan 1" or "Plan 2" with reasoning.`,
    `Plan 1:
${JSON.stringify(plan1, null, 2)}

Plan 2:
${JSON.stringify(plan2, null, 2)}

Which plan is optimal?`
  )

const getCodingConfig = (isFirstIteration: boolean, optimalPlan: ConversationResult, title: string, requirements: string, verificationResult?: any) => {
  const prompt = isFirstIteration
    ? `Implement the feature based on this plan:

Selected Plan: ${JSON.stringify(optimalPlan, null, 2)}

Ticket: ${title}
Requirements: ${requirements}

Implement the changes using available tools.`
    : `Previous verification found issues:

${JSON.stringify(verificationResult, null, 2)}

Please address the feedback and make necessary corrections.`

  return createAgentConfig(
    'feature_developer',
    `You are a senior software engineer. Implement the feature changes using the available tools.
Write clean, maintainable code following best practices.`,
    prompt
  )
}

const getVerificationConfig = () =>
  createAgentConfig(
    'code_reviewer',
    `You are a code reviewer. Verify the implementation by:
- Checking code quality
- Validating requirements are met
- Identifying bugs or issues
- Suggesting improvements

DO NOT make any changes. Only provide feedback.

Return a JSON object with:
{
  "passed": boolean,
  "issues": string[],
  "suggestions": string[]
}`,
    `Review the changes made in this iteration. Provide verification feedback.`,
     ['read', 'grep', 'bash', 'ls'] // Read-only tools
  )

const getFinalizationConfig = (ticketId: string) =>
  createAgentConfig(
    'implementation_summarizer',
    `Create a summary of the implementation including:
- Files changed
- Key changes made
- Commit message

Return as JSON:
{
  "filesChanged": string[],
  "commitHash": string,
  "summary": string
}`,
    `Summarize the completed implementation for ticket ${ticketId}.`
  )

// Helper: Parse verification result
const checkVerificationPassed = (verificationResult: ConversationResult): boolean => {
  try {
    const lastMessage = verificationResult.messages[verificationResult.messages.length - 1]
    const verificationData = JSON.parse(lastMessage.content || '{}')
    return verificationData.passed === true
  } catch {
    const resultText = JSON.stringify(verificationResult).toLowerCase()
    return resultText.includes('passed') && !resultText.includes('failed')
  }
}

const featureImplementationSchema = z.object({
  title: z.string().min(3),
  description: z.string().min(1, 'Description cannot be empty'),
  requirements: z.string()
});

const featureImplementationMapper = (payload: z.infer<typeof featureImplementationSchema> & { ticketId: string }): FeatureImplementationContext => ({
  ticketId: payload.ticketId,
  title: payload.title,
  description: payload.description,
  requirements: payload.requirements
});



export const featureImplementationWorkflow: WorkflowDefinition<FeatureImplementationContext, FeatureImplementationOutput, typeof FeatureImplementationSteps> = {
  type: WorkflowType.FEATURE_IMPLEMENTATION,
  name: 'Feature Implementation Workflow',
  description: 'Complete feature implementation with planning, coding, and verification',
  inputSchema: featureImplementationSchema,
  contextMapper: featureImplementationMapper,

  async execute(engine: WorkflowEngine<FeatureImplementationContext, typeof FeatureImplementationSteps>, _preExecuteResult: EmptyPreExecuteResult): Promise<FeatureImplementationOutput> {
    const context = engine.getContext()
    const { ticketId, title, description, requirements } = context

    // Phase 1: Extract context data
    const contextAnalysisResult = await engine.createAgenticCheckpoint(
      FeatureImplementationSteps.EXTRACT_CONTEXT,
      'context_extractor',
      getContextExtractionConfig(title, description, requirements)
    )
    const contextAnalysis = contextAnalysisResult.result

    // Phase 2: Parallel planning - trigger 2 instances of the same planning workflow
    const planningResults = await engine.createParallelWorkflows(
      FeatureImplementationSteps.PARALLEL_PLANNING,
      {
        workflows: [
          {
            workflowType: WorkflowType.FEATURE_PLANNING as const,
            initialContext: {
              ticketId,
              title,
              description,
              requirements,
              contextAnalysis: JSON.stringify(contextAnalysis)
            }
          },
          {
            workflowType: WorkflowType.FEATURE_PLANNING as const,
            initialContext: {
              ticketId,
              title,
              description,
              requirements,
              contextAnalysis: JSON.stringify(contextAnalysis)
            }
          }
        ] as const,
        onExecutionComplete: async (_childResult) => {
          logger.info(`✅ Planning workflow completed`)
          return LoopControl.CONTINUE
        },
        onAllCompleted: async (allResults) => {
          return {
            plans: allResults.map(r => r.result)
          }
        }
      }
    )

    // Phase 3: Agent selects optimal plan
    const optimalPlanResult = await engine.createAgenticCheckpoint(
      FeatureImplementationSteps.SELECT_OPTIMAL_PLAN,
      'plan_selector',
      getPlanSelectionConfig(planningResults.plans[0], planningResults.plans[1])
    )
    const optimalPlan = optimalPlanResult.result

    // Phase 4: While loop - coding + verification
    let verificationResult: any = null
    const MAX_ITERATIONS = 5

    await engine.createWhileLoop(
      FeatureImplementationSteps.CODING_VERIFICATION_LOOP,
      MAX_ITERATIONS,
      async (iteration: number, scopedEngine: WorkflowEngine<FeatureImplementationContext, typeof FeatureImplementationSteps>) => {
        logger.info(`\n🔄 Iteration ${iteration + 1}/${MAX_ITERATIONS}`)

        // Coding phase
        await scopedEngine.createAgenticCheckpoint(
          FeatureImplementationSteps.IMPLEMENT_CODE,
          'feature_developer',
          getCodingConfig(iteration === 0, optimalPlan, title, requirements, verificationResult)
        )

        // Verification phase - read-only review
        const verificationCheckpointResult = await scopedEngine.createAgenticCheckpoint(
          FeatureImplementationSteps.VERIFY_IMPLEMENTATION,
          'code_reviewer',
          getVerificationConfig()
        )
        verificationResult = verificationCheckpointResult.result

        // Check if verification passed
        const verificationPassed = checkVerificationPassed(verificationResult)

        if (verificationPassed) {
          logger.info('✅ Verification passed! Breaking loop.')
          return LoopControl.BREAK
        }

        logger.info('⚠️ Verification failed. Continuing to next iteration...')
        return LoopControl.CONTINUE
      }
    )

    await engine.createAgenticCheckpoint(FeatureImplementationSteps.FINALIZE, 'implementation_summarizer', getFinalizationConfig(ticketId))

    logger.info(`✅ Feature workflow completed for ${ticketId}`)

    return {
      ticketId,
      status: 'completed',
      implementationDetails: {
        filesChanged: [],
        commitHash: 'placeholder',
        verificationPassed: true
      }
    }
  }
}
