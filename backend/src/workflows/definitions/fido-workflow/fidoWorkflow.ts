/**
 * FIDO Server Workflow Enhanced
 *
 * An enhanced conformance-driven FIDO2/WebAuthn implementation workflow designed for building secure
 * Relying Party servers in Rust. This workflow follows a rigorous conformance-driven development approach
 * with FIDO conformance script validation.
 *
 * 🚀 Enhanced Workflow Architecture:
 * ┌─────────────────────────────────────────────────────────────────────────────────┐
 * │ Phase 1: Requirement Analysis → LLM analyzes FIDO2/WebAuthn requirements       │
 * │ Phase 2: Architecture Planning → Rust project structure and design             │
 * │ Phase 3: Enhanced Implementation Loop → Code + Build + Review + Test           │
 * │         ┌─────────────────────────────────────────────────────────────────┐     │
 * │         │ 1. 🔧 Code Implementation (LLM writes/fixes code)               │     │
 * │         │ 2. 🔨 Build Verification (Cargo build check)                   │     │
 * │         │ 3. 🔍 Code Review (LLM production readiness review)            │     │
 * │         │ 4. 🧪 FIDO Conformance Testing (Remote testing)               │     │
 * │         └─────────────────────────────────────────────────────────────────┘     │
 * │ Phase 4: Summarization → Documentation and deployment notes                    │
 * └─────────────────────────────────────────────────────────────────────────────────┘
 *
 * ✨ Enhanced Key Features:
 * - Conformance-Driven Development approach using FIDO conformance script
 * - Direct FIDO compliance validation through automated conformance testing
 * - Iterative code-build-conformance loop with strict conformance validation
 * - FIDO2/WebAuthn compliance verification through conformance script
 * - Complete git integration with branch and commit tracking
 * - Rust-specific tooling and cargo integration
 * - Security-focused implementation patterns with conformance coverage
 *
 * @author Xyne Engineering Team
 * @version 5.0.0
 */

import {
  WorkflowEngine,
  LoopControl,
  AgenticCheckpointResult,
  AgenticCheckpointConfig,
  GitInfo
} from '../../workflow-types'
import { executeRemoteConformanceTesting, runFrameworkHealthChecks } from './utils'
import { WorkflowDefinition, EmptyPreExecuteResult } from '../../registry/workflowRegistry'
import { WorkflowType } from '../../types/workflow-enums'
import type { ConversationResult } from '@framework'
import { z } from 'zod'
import { 
  FidoServerWorkflowContext, 
  FidoServerWorkflowOutput, 
  BuildResult, 
  ConformanceResult,
} from './types'
import { 
  executeCargoBuild,
} from './utils'
import { createRequirementAnalysisTemplate } from './templates/requirement-analysis-template'
import {logger} from '@/utils/logger';

// =============================================================================
// WORKFLOW STEP NAMES
// =============================================================================

export enum FidoEnhancedWorkflowStepsEnum{  // Phase 1: Requirement Understanding
  REQUIREMENT_ANALYSIS = 'requirement_analysis',
  
  // Phase 3: Conformance Implementation Loop
  CONFORMANCE_IMPLEMENTATION_LOOP = 'conformance_implementation_loop',
  CODE_IMPLEMENTATION = 'code_implementation',
  FIDO_CONFORMANCE_TESTING_ATTESTATION = 'fido_conformance_assertion_testing',
  FIDO_CONFORMANCE_TESTING_ASSERTION = 'fido_conformance_attestation_testing',
  BUILD_CODE = 'build_code',
  FRAMEWORK_HEALTH_CHECK = 'framework_health_check',
}

/**
 * Extract the last message content from a conversation result
 */
const extractLastMessageContent = (result: ConversationResult): string => {
  const lastMessage = result.messages[result.messages.length - 1]
  return lastMessage?.content || 'No content generated'
}

// =============================================================================
// PROMPT TEMPLATES
// =============================================================================

/**
 * Creates agent configuration for enhanced requirement analysis
 */
const getEnhancedRequirementAnalysisConfig = (
  _projectName: string,
  repositoryUrl: string,
  _workspaceDirectory: string,
  repoBranch?: string,
  baseBranch?: string,
  workflowDescription?: string,
  agentConfigVersions?: any
): { agentName: string; config: AgenticCheckpointConfig } => {
  // Use dynamic workflow description or fallback to default
  const finalDescription = workflowDescription;
  
  return {
    agentName: 'fido-requirement-analyzer',
    config: {
      conversationContext: {
        initialUserMessage: createRequirementAnalysisTemplate(finalDescription)
      },
      repoInfo: {
        repoUrl: repositoryUrl,
        repoBranch,
        baseBranch
      },
      agentConfigVersions
    }
  }
}



/**
 * Creates agent configuration for conformance implementation with emphasis on FIDO Conformance feedback
 */
const getConformanceImplementationConfig = (
  _requirementAnalysis: string,
  _architecturePlan: string,
  buildFeedback: string | null,
  repositoryUrl: string,
  _workspaceDirectory: string,
  repoBranch?: string,
  conformanceResult?: ConformanceResult | null,
  _codeReviewFeedback?: string | null,
  implementationStrategy?: string | null,
  frameworkResult?: string | null,
  agentConfigVersions?: any
) => {
  // Single unified prompt that includes FIDO Conformance feedback when available
  const prompt = `
  ${buildFeedback ? `**Build Issues to Address:**
  ${buildFeedback}` : ''}
  ${frameworkResult ? `**Validation Health Check Issues (missing or wrong implementation):**
  ${frameworkResult}` : ''}
  ${implementationStrategy} 
  ${conformanceResult}
  Use the address http://localhost:8080 for server
**REFERENCE FILES AVAILABLE:**
- Requirement Analysis: Check file \`generated-requirement-analysis.xml\` for detailed XML-formatted requirements 
`
logger.info('Generated Implementation Prompt->:',prompt);
  return {
    agentName: 'fido-implementation-engineer',
    config: {
      conversationContext: {
        initialUserMessage: prompt
      },
      repoInfo: {
        repoUrl: repositoryUrl,
        repoBranch
      },
      agentConfigVersions
    }
  }
}

// =============================================================================
// WORKFLOW IMPLEMENTATION
// =============================================================================

const FidoServerWorkflowInputSchema = z.object({
  projectName: z.string().optional(),
  repositoryUrl: z.string().url("Repository URL must be valid"),
  workspaceDirectory: z.string().min(1, "Workspace directory is required"),
  maxIterations: z.number().positive().optional(),
  repoBranch: z.string().optional(),
  custom: z.record(z.string(), z.unknown()).optional()
})

const fidoServerWorkflowContextMapper = (payload: z.infer<typeof FidoServerWorkflowInputSchema> & {ticketId: string}): FidoServerWorkflowContext => ({
  ticketId: payload.ticketId,
  projectName: payload.projectName,
  repositoryUrl: payload.repositoryUrl,
  workspaceDirectory: payload.workspaceDirectory,
  maxIterations: payload.maxIterations,
  repoBranch: payload.repoBranch,
  custom: payload.custom
})

export const fidoServerWorkflow: WorkflowDefinition<
  FidoServerWorkflowContext,
  FidoServerWorkflowOutput,
  typeof FidoEnhancedWorkflowStepsEnum
> = {
  type: WorkflowType.FIDO_SERVER_WORKFLOW,
  name: 'FIDO Server Workflow',
  description: 'Enhanced conformance-driven FIDO2/WebAuthn Relying Party server implementation workflow',
  estimatedDuration: 2400000, // 40 minutes (longer for comprehensive conformance validation)
  tags: ['fido2', 'webauthn', 'rust', 'security', 'authentication', 'conformance', 'validation'],
  inputSchema: FidoServerWorkflowInputSchema,
  contextMapper: fidoServerWorkflowContextMapper,

  async execute(workflow: WorkflowEngine<FidoServerWorkflowContext,typeof FidoEnhancedWorkflowStepsEnum>, _preExecuteResult: EmptyPreExecuteResult): Promise<FidoServerWorkflowOutput> {
    const context = workflow.getContext()
    const { 
      ticketId, 
      projectName = 'Enhanced FIDO Server', 
      repositoryUrl, 
      workspaceDirectory, 
      maxIterations = 10,
      custom,
    } = context
    
    // Extract agent config versions from custom configuration
    const agentConfigVersions = custom?.agentConfigVersions
    const description= typeof custom?.description === 'string' ? custom.description : undefined
    const baseBranch = typeof custom?.baseBranch === 'string' ? custom.baseBranch : 'staging'
    const repoBranch = typeof custom?.repoBranch === 'string' ? custom.repoBranch : undefined
    const workflowDescription = typeof description === 'string' ? description : undefined
    const implementationStrategy = custom?.implementationMessage as string | null
    const fidoValidationTypes=custom?.fidoValidationTypes as string[] | null


    // Validate required fields
    if (!repositoryUrl) {
      throw new Error('Repository URL is required for Enhanced FIDO Server workflow')
    }
    let gitInfo: GitInfo = {
      branch: repoBranch || 'staging',
      repoUrl: repositoryUrl,
      hasCommits: false
    }

    // =========================================================================
    // PHASE 1: REQUIREMENT UNDERSTANDING
    // =========================================================================

    // Extract workflow description from custom context (if provided)
    logger.info('📝 Starting requirement analysis phase...',workflowDescription)
    logger.info('fidovalidationtype:', fidoValidationTypes)

    const requirementConfig = getEnhancedRequirementAnalysisConfig(projectName, repositoryUrl, workspaceDirectory, repoBranch, baseBranch, workflowDescription, agentConfigVersions)
    const requirementResult: AgenticCheckpointResult = await workflow.createAgenticCheckpoint(
      FidoEnhancedWorkflowStepsEnum.REQUIREMENT_ANALYSIS,
      requirementConfig.agentName,
      requirementConfig.config
    )

    const requirementAnalysis = extractLastMessageContent(requirementResult.result)
    gitInfo = { ...gitInfo, ...requirementResult.gitInfo }
    logger.info('✅ Requirement analysis completed.',requirementAnalysis);
    // =========================================================================
    // PHASE 2: ARCHITECTURE PLANNING - COMMENTED OUT
    // =========================================================================

    // const architectureConfig = getEnhancedArchitecturePlanningConfig(requirementAnalysis, repositoryUrl, workspaceDirectory, gitInfo.branch, agentConfigVersions)
    // const architectureResult: AgenticCheckpointResult = await workflow.createAgenticCheckpoint(
    //   FidoEnhancedWorkflowStepsEnum.ARCHITECTURE_PLANNING,
    //   architectureConfig.agentName,
    //   architectureConfig.config
    // )

    // const architecturePlan = extractLastMessageContent(architectureResult.result)
    // gitInfo = { ...gitInfo, ...architectureResult.gitInfo }
    

    // =========================================================================
    // PHASE 3: TDD IMPLEMENTATION AND BUILD LOOP
    // =========================================================================

    let buildResult: BuildResult | null = null
    let conformanceResult: ConformanceResult | null = null
    let codeReviewFeedback: string | null = null
    let buildPassed = false
    let conformancePassed = false
    let iterationsCompleted = 0
    let frameworkresult: string = "";

    // Implementation loop with FIDO conformance testing
    await workflow.createWhileLoop( 
      FidoEnhancedWorkflowStepsEnum.CONFORMANCE_IMPLEMENTATION_LOOP, 
      maxIterations, 
      async (iteration, scopedEngine) => {
        iterationsCompleted = iteration + 1
        logger.info(`🔄 Starting conformance implementation iteration ${iterationsCompleted}/${maxIterations}`)

        // Prepare build feedback for the implementation agent if previous build failed
        const buildFeedback = buildResult && !buildResult.success 
          ? `Previous cargo build failed:\nError: ${buildResult.error}\nOutput: ${buildResult.output}`
          : null

        // Implementation step - conformance focused with build and FIDO conformance feedback
        const implementationConfig = getConformanceImplementationConfig(
          requirementAnalysis,
          '', // architecturePlan removed
          buildFeedback,
          repositoryUrl,
          workspaceDirectory,
          gitInfo.branch,
          conformanceResult,
          codeReviewFeedback,
          implementationStrategy,
          frameworkresult,
          agentConfigVersions
        )
        const implementationResult: AgenticCheckpointResult = await scopedEngine.createAgenticCheckpoint(
          FidoEnhancedWorkflowStepsEnum.CODE_IMPLEMENTATION,
          implementationConfig.agentName,
          implementationConfig.config
        )

         gitInfo = { ...gitInfo, ...implementationResult.gitInfo }

        // Non-agentic build step: clone -> cd -> cargo build
        logger.info('🔨 Running cargo build to check implementation...')
        buildResult = await scopedEngine.createCheckpoint(FidoEnhancedWorkflowStepsEnum.BUILD_CODE, executeCargoBuild, workspaceDirectory, repositoryUrl, gitInfo.branch)

        if (!buildResult.success) {
          logger.info(`❌ Implementation compilation failed - Error: ${buildResult.error}`)
          logger.info('🔄 Build issues detected - continuing TDD implementation loop to fix errors')
          buildPassed = false
          return LoopControl.CONTINUE
        }

        logger.info('✅ Implementation compiles successfully!', fidoValidationTypes);
        buildPassed = true;

        if (fidoValidationTypes && Array.isArray(fidoValidationTypes) && fidoValidationTypes.length > 0) {
            let allValidationsPassed = true;
            for (const fidoValidationType of fidoValidationTypes) {
                if (fidoValidationType === 'FRAMEWORK') {
                    logger.info('🩺 Running framework health checks as validation type is FRAMEWORK');
                    const healthCheckResult = await scopedEngine.createCheckpoint(
                        FidoEnhancedWorkflowStepsEnum.FRAMEWORK_HEALTH_CHECK,
                        runFrameworkHealthChecks,
                        workspaceDirectory,
                        repositoryUrl,
                        gitInfo.branch
                    );

                    if (!healthCheckResult.success) {
                        logger.info(`❌ Framework health checks failed. Summary:\n${healthCheckResult.summary}`);
                        frameworkresult = `Framework health checks failed:\n${healthCheckResult.summary}`;
                        allValidationsPassed = false;
                        break; 
                    }
                    logger.info('✅ Framework health checks passed!');
                } else if (fidoValidationType === 'ASSERTION' || fidoValidationType === 'ATTESTATION') {
                  const type = fidoValidationType === 'ATTESTATION' ? FidoEnhancedWorkflowStepsEnum.FIDO_CONFORMANCE_TESTING_ATTESTATION: FidoEnhancedWorkflowStepsEnum.FIDO_CONFORMANCE_TESTING_ASSERTION;
                    logger.info(`🧪 Running FIDO conformance testing for ${fidoValidationType}...`);
                    const fidoAppPath: string = "/Applications/FIDO Alliance - Certification Conformance Testing Tools.app/Contents/MacOS/FIDO Alliance - Certification Conformance Testing Tools";
                    
                    try {
                        conformanceResult = await scopedEngine.createCheckpoint(type, executeRemoteConformanceTesting, fidoValidationType, repositoryUrl , gitInfo.branch, fidoAppPath);
                    } catch (error: any) {
                        logger.info(`❌ Remote execution failed: ${error.message}`);
                        if (error.message.includes('Build failed')) {
                            buildResult = { success: false, output: '', error: error.message, executedAt: new Date().toISOString() };
                            buildPassed = false;
                            allValidationsPassed = false;
                            break;
                        } else {
                            conformanceResult = {
                                success: false,
                                output: `Remote execution error: ${error.message}`,
                                executedAt: new Date().toISOString(),
                                testResults: { passed: 0, failed: 1, total: 1 }
                            };
                            allValidationsPassed = false;
                            break;
                        }

                    }

                    if (conformanceResult) {
                        logger.info('✅ FIDO conformance testing completed', {
                            success: conformanceResult.success,
                            passed: conformanceResult.testResults?.passed,
                            failed: conformanceResult.testResults?.failed,
                            total: conformanceResult.testResults?.total
                        });

                        const allTestsPassed = conformanceResult.success &&
                            conformanceResult.testResults?.failed === 0 &&
                            conformanceResult.testResults?.passed === conformanceResult.testResults?.total &&
                            conformanceResult.testResults?.total > 0;

                        if (!allTestsPassed) {
                            logger.info('❌ Not all FIDO conformance tests passed.');
                            allValidationsPassed = false;
                          break;
                        }
                        logger.info(`🎉 All FIDO conformance tests for ${fidoValidationType} passed!`);
                    }
                }
            }

            if (allValidationsPassed) {
                logger.info('🎉 All FIDO validation types passed successfully!');
                conformancePassed = true;
                return LoopControl.BREAK;
            } else {
                logger.info('🔄 Some validations failed, continuing implementation loop to fix errors.');
                conformancePassed = false;
                return LoopControl.CONTINUE;
            }
        } else {
            logger.info('✅ No FIDO validation types specified, marking as complete.');
            conformancePassed = true;
            return LoopControl.BREAK;
        }
      }
    )

    // =========================================================================
    // PHASE 4: SUMMARIZATION - COMMENTED OUT
    // =========================================================================

    // const summarizationConfig = getEnhancedSummarizationConfig(ticketId, repositoryUrl, workspaceDirectory, gitInfo.branch, agentConfigVersions)
    // const summarizationResult: AgenticCheckpointResult = await workflow.createAgenticCheckpoint(
    //   FidoEnhancedWorkflowStepsEnum.SUMMARIZATION,
    //   summarizationConfig.agentName,
    //   summarizationConfig.config
    // )

    // const summary = extractLastMessageContent(summarizationResult.result)
    // gitInfo = { ...gitInfo, ...summarizationResult.gitInfo }
    const summary = ``
    // =========================================================================
    // FINAL RESULTS WITH ENHANCED TDD METRICS
    // =========================================================================

    const finalStatus = buildPassed && conformancePassed ? 'completed' : 'failed'


    // Extract FIDO Conformance results safely with simplified structure
    let conformanceResults = undefined
    if (conformanceResult !== null) {
      const safeConformanceResult = conformanceResult as ConformanceResult
      conformanceResults = {
        totalTests: safeConformanceResult.testResults?.total || 0,
        passedTests: safeConformanceResult.testResults?.passed || 0,
        failedTests: safeConformanceResult.testResults?.failed || 0,
        errorTests: 0,
        failedTestCases: []
      }
    }

    return {
      ticketId,
      status: finalStatus,
      implementationDetails: {
        filesChanged: [], 
        commitHash: gitInfo.commitHash,
        branch: gitInfo.branch,
        buildPassed,
        conformancePassed,
        iterationsCompleted,
        conformanceResults
      },
      summary,
      gitInfo
    }
  }
}
