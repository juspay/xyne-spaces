import {
  WorkflowEngine,
  LoopControl,
  AgenticCheckpointResult,
  AgenticCheckpointConfig,
  GitInfo
} from '../../workflow-types'
import { WorkflowDefinition, EmptyPreExecuteResult } from '../../registry/workflowRegistry'
import { WorkflowType } from '../../types/workflow-enums'
import type { ConversationResult } from '@framework'
import { BaseWorkflowContextSchema, baseContextMapper } from '../../schemas/workflow-schema';
import { z } from 'zod'
import { 
  FidoServerWorkflowContext, 
  fidoServerWorkflowOutput, 
  BuildResult, 
  ConformanceResult,
  FidoWorkType,
} from './types'
import { 
  executeBuildCode,
  // executeRemoteConformanceTesting,
  // executeLocalTesting,
  // executeBoilerCode
} from './utils'
import { createRequirementAnalysisTemplate } from './templates/requirement-analysis-template'
import {logger} from '@/utils/logger';
// =============================================================================
// WORKFLOW STEP NAMES
// =============================================================================
export enum FidoEnhancedWorkflowStepsEnum{  
  REQUIREMENT_ANALYSIS = 'requirement_analysis',
  CODING_LOOP = 'coding_loop',
  CODE_IMPLEMENTATION = 'code_implementation',
  DETERMINISTIC_TESTING = 'deterministic_testing',
  BUILD_CODE = 'build_code',
  POST_IMPLEMENTATION = 'post_implementation',
  PRE_REQUIREMENT_STEP = 'pre_requirement_step',
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
 * Helper to build getCommitMessage function for repoInfo
 */
const buildGetCommitMessage = (preCommit?: string) =>
  preCommit
    ? (defaultMsg: string) => `${preCommit} | ${defaultMsg}`
    : undefined

/**
 * Creates agent configuration for enhanced requirement analysis
 */
const getEnhancedRequirementAnalysisConfig = (
  repositoryUrl: string,
  repoBranch?: string,
  baseBranch?: string,
  description?: string,
  type?: FidoWorkType,
  getCommitMessage?: (defaultMsg: string) => string
): { agentName: string; config: AgenticCheckpointConfig } => {
  // Use dynamic workflow description or fallback to default
  const finalDescription = description;
  
  return {
    agentName: 'feature-requirement-analyzer',
    config: {
      conversationContext: {
        initialUserMessage: createRequirementAnalysisTemplate(finalDescription,type)
      },
      repoInfo: {
        repoUrl: repositoryUrl,
        repoBranch,
        baseBranch,
        getCommitMessage
      },
    }
  }
}
/**
 * Creates agent configuration for file removal
 */
const 
getFileRemovalConfig = (
  repositoryUrl: string,
  repoBranch?: string,
  baseBranch?: string,
  getCommitMessage?: (defaultMsg: string) => string
): { agentName: string; config: AgenticCheckpointConfig } => {
  return {
    agentName: 'feature-implementation-engineer',
    config: {
      conversationContext: {
        initialUserMessage: `Please remove the file named "generated-requirement-analysis.xml" from the repository if it exists. If the file does not exist, simply confirm this and do nothing else. Do not modify any other files.`
      },
      repoInfo: {
        repoUrl: repositoryUrl,
        repoBranch,
        baseBranch,
        getCommitMessage
      }
    }
  }
}
/**
 * Creates agent configuration for conformance implementation with emphasis on feature Conformance feedback
 */
const getConformanceImplementationConfig = (
  _requirementAnalysis: string,
  buildFeedback: string | null,
  repositoryUrl: string,
  repoBranch?: string,
  baseBranch?: string,
  deterministicTestResults?: ConformanceResult | null,
  _codeReviewFeedback?: string | null,
  agentConfigVersions?: any,
  type?: FidoWorkType,
  getCommitMessage?: (defaultMsg: string) => string,
) => {
  // Single unified prompt that includes feature Conformance feedback when available
  const prompt = `
${buildFeedback ? `**BUILD FAILURE - IMMEDIATE ACTION REQUIRED:**
**CRITICAL CONSTRAINT:** The existing implementation is based on the requirement analysis and MUST be preserved. Your ONLY task is to fix the build errors below without modifying the core implementation logic, architecture, or functionality.
**What you MUST do:**
- Fix syntax errors, missing imports, type mismatches, or compilation issues
- Maintain 100% compatibility with the existing requirement analysis
**What you MUST NOT do:**
- Change the implementation approach or architecture
- Refactor or restructure existing working code
- Add new features or modify existing functionality
- Alter the core logic that was implemented per requirement analysis
**Build Error Details:**
${buildFeedback}
---
` : ''}
${deterministicTestResults ? `**TEST RESULTS:**
Output:
${JSON.stringify(deterministicTestResults)}
---
` : ''}
${type === FidoWorkType.DEEP ? `
** REFERENCE DOCUMENTATION:**
- Requirement Analysis: Check file \`generated-requirement-analysis.xml\` for detailed XML-formatted requirements 
** IMPORTANT BUILD INSTRUCTION:**
- Do NOT attempt to compile or run code yourself 
- The build process is handled automatically by the workflow system after your implementation
- Focus on writing/fixing the code - the system will compile it for you` : `${_requirementAnalysis}`}`
logger.info('Generated Implementation Prompt->:',prompt);
  return {
    agentName: 'feature-implementation-engineer',
    config: {
      conversationContext: {
        initialUserMessage: prompt
      },
      repoInfo: {
        repoUrl: repositoryUrl,
        repoBranch,
        baseBranch,
        getCommitMessage
      },
      agentConfigVersions
    }
  }
}
// =============================================================================
// WORKFLOW IMPLEMENTATION
// =============================================================================
const fidoServerWorkflowInputSchema = BaseWorkflowContextSchema.extend({
  repositoryUrl: z.string().describe('Enter in SSH format (e.g., ssh://git@github.com/example-org/xyne-spaces.git)'),
  maxIterations: z.number().positive().optional(),
  repoBranch: z.string().optional().describe('Custom branch name (e.g., feature-branch), branch should not exist in the repository'),
  baseBranch: z.string().describe('Enter branch name from where new branch will be created (e.g., main)'),
  preCommit: z.string().optional().describe('Custom text before commit message (e.g., "JIRA-1234 | Auto Commit")'),
  buildCommand: z.string().optional(),
  // testDetails: z.array(z.object({
  //   filename: z.string(),
  //   command: z.string(),
  //   parameters: z.array(z.string())
  // })).optional(),
  description: z.string(),
  instructions: z.string().optional().describe('Additional instructions or context for the workflow execution (e.g., use AGENTS.md for agent guidelines)'),
  // ispoller: z.boolean().default(false),
  // connectorName: z.string().optional(),
  // connectorBaseUrl: z.string().optional(),
  type: z.nativeEnum(FidoWorkType).optional(),
  // custom: z.record(z.string(), z.unknown()).optional()
})
const FidoServerWorkflowContextMapper = (payload: z.infer<typeof fidoServerWorkflowInputSchema> & {ticketId: string}): FidoServerWorkflowContext => ({
   ...baseContextMapper(payload),
  repositoryUrl: payload.repositoryUrl,
  maxIterations: payload.maxIterations,
  repoBranch: payload.repoBranch,
  baseBranch: payload.baseBranch,
  description: payload.description,
  instructions: payload.instructions,
  preCommit: payload.preCommit,
  buildCommand: payload.buildCommand,
  // testDetails: payload.testDetails,
  // ispoller: payload.ispoller,
  type: payload.type,
  // connectorName: payload.connectorName,
  // connectorBaseUrl: payload.connectorBaseUrl,
  // custom: payload.custom,
})
export const fidoServerWorkflow: WorkflowDefinition<
  FidoServerWorkflowContext,
  fidoServerWorkflowOutput,
  typeof FidoEnhancedWorkflowStepsEnum
> = {
  type: WorkflowType.FIDO_SERVER_WORKFLOW,
  name: 'FIDO Server Workflow',
  description: 'Enhanced conformance-driven Feature Server implementation workflow',
  estimatedDuration: 2400000, // 40 minutes (longer for comprehensive conformance validation)
  tags: ['feature', 'server', 'rust', 'security', 'authentication', 'conformance', 'validation'],
  inputSchema: fidoServerWorkflowInputSchema,
  contextMapper: FidoServerWorkflowContextMapper,
  async execute(workflow: WorkflowEngine<FidoServerWorkflowContext,typeof FidoEnhancedWorkflowStepsEnum>, _preExecuteResult: EmptyPreExecuteResult): Promise<fidoServerWorkflowOutput> {
    const context = workflow.getContext()
    let { 
      ticketId, 
      repositoryUrl, 
      repoBranch,
      baseBranch,
      description,
      preCommit,
      buildCommand,
      // testDetails,
      // ispoller,
      type,
      // connectorName,
      instructions,
      // connectorBaseUrl,
      // custom,
      maxIterations = 10,
    } = context
    // if(!baseBranch){
    // baseBranch = typeof (custom as any)?.baseBranch === 'string' ? (custom as any).baseBranch : 'main'
    // }
    // if(!repoBranch && typeof (custom as any)?.repoBranch === 'string'){
    // repoBranch = typeof (custom as any)?.repoBranch === 'string' ? (custom as any).repoBranch : undefined
    // }
    // if(!description && typeof (custom as any)?.description === 'string'){
    // description = typeof (custom as any)?.description === 'string' ? (custom as any).description : undefined
    // }
    // if(!buildCommand && typeof (custom as any)?.buildCommand === 'string'){
    // buildCommand = typeof (custom as any)?.buildCommand === 'string' ? (custom as any).buildCommand : undefined
    // }
    // if(!testDetails && Array.isArray((custom as any)?.testDetails)){
    // testDetails = Array.isArray((custom as any)?.testDetails) ? (custom as any).testDetails : undefined
    // }
    // if(!ispoller && typeof (custom as any)?.ispoller === 'boolean'){
    // ispoller = typeof (custom as any)?.ispoller === 'boolean' ? (custom as any).ispoller : undefined
    // }
    // if(!type && typeof (custom as any)?.type === 'string'){
    // const typeString = typeof (custom as any)?.type === 'string' ? (custom as any).type : undefined;
    // type = typeString && Object.values(FidoWorkType).includes(typeString as FidoWorkType) ? typeString as FidoWorkType : undefined;
    // }
    // if(!connectorName && typeof (custom as any)?.connectorName === 'string'){
    // connectorName = typeof (custom as any)?.connectorName === 'string' ? (custom as any).connectorName : undefined;
    // }
    // if(!connectorBaseUrl && typeof (custom as any)?.connectorBaseUrl === 'string'){
    // connectorBaseUrl = typeof (custom as any)?.connectorBaseUrl === 'string' ? (custom as any).connectorBaseUrl : undefined;
    // }
    // console.log('Workflow input parameters:', { custom })
    // console.log('Parsed workflow parameters:', { repositoryUrl, repoBranch, baseBranch, description, buildCommand, testDetails, ispoller, type, connectorName, connectorBaseUrl })

    // Build commit message function if preCommit is provided
    const getCommitMessage = buildGetCommitMessage(preCommit)
    description= description + (instructions ? `\n\nAdditional Instructions:\n${instructions}` : '');
    // Validate required fields
    if (!repositoryUrl) {
      throw new Error('Repository URL is required for Enhanced FIDO Server Workflow')
    }
    let gitInfo: GitInfo = {
      branch: repoBranch || 'main',
      repoUrl: repositoryUrl,
      hasCommits: false
    }
  //    let branchCreated: string | undefined = undefined;
  //   if(connectorName && connectorBaseUrl){
  //     logger.info('Connector details provided, executing boiler code generation checkpoint...')
  //   const boilerCode = await workflow.createCheckpoint(FidoEnhancedWorkflowStepsEnum.PRE_REQUIREMENT_STEP, executeBoilerCode,repositoryUrl,baseBranch, connectorName, connectorBaseUrl )
  //   if(boilerCode.success){
  //     logger.info('Boiler code generation successful, proceeding with workflow execution.')
  //        branchCreated = boilerCode.branchName;
  //        repoBranch=branchCreated;
  //   }
  //   else{
  //     logger.error('Boiler code generation failed, terminating workflow execution.')
  //     return {
  //     ticketId,
  //     status: 'failed',
  //     implementationDetails: {
  //       filesChanged: [], 
  //       commitHash: gitInfo.commitHash,
  //       branch: gitInfo.branch,
  //       buildPassed: false,
  //       conformancePassed: false,
  //       iterationsCompleted: 0
  //     },
  //     summary: 'Boiler code generation failed.',
  //     gitInfo
  //   }
  //   }
  // }
  // else{
  //   logger.info('No connector details provided, skipping boiler code generation checkpoint.')
  // }
    // =========================================================================
    // PHASE 1: REQUIREMENT UNDERSTANDING
    // =========================================================================
    // Extract workflow description from custom context (if provided)
    console.log(' Starting requirement analysis phase...',description)
    // console.log('featurevalidationtype:', testDetails?.map((td: any) => td.filename))
    console.log(' Starting requirement analysis phase...',description)
    // console.log('featurevalidationtype:', testDetails?.map((td: any) => td.filename))
    const requirementConfig = getEnhancedRequirementAnalysisConfig(repositoryUrl, repoBranch, baseBranch, description, type, getCommitMessage)
    const requirementResult: AgenticCheckpointResult = await workflow.createAgenticCheckpoint(
      FidoEnhancedWorkflowStepsEnum.REQUIREMENT_ANALYSIS,
      requirementConfig.agentName,
      requirementConfig.config
    )
    const requirementAnalysis = extractLastMessageContent(requirementResult.result)
    gitInfo = { ...gitInfo, ...requirementResult.gitInfo }
    console.log(' Requirement analysis completed.',requirementAnalysis);
    // =========================================================================
    // PHASE 3: TDD IMPLEMENTATION AND BUILD LOOP
    // =========================================================================
    let buildResult: BuildResult | null = null
    let conformanceResult: ConformanceResult | null = null
    let buildPassed = false
    let conformancePassed = false
    let iterationsCompleted = 0
    await workflow.createWhileLoop( 
      FidoEnhancedWorkflowStepsEnum.CODING_LOOP, 
      maxIterations, 
      async (iteration, scopedEngine) => {
        iterationsCompleted = iteration + 1
        console.log(`Starting conformance implementation iteration ${iterationsCompleted}/${maxIterations}`)
        // Prepare build feedback for the implementation agent if previous build failed
        const buildFeedback = buildResult && !buildResult.success 
          ? `Previous cargo build failed:\nError: ${buildResult.error}\nOutput: ${buildResult.output}`
          : null;
        // Implementation step - conformance focused with build and feature conformance feedback
        const implementationConfig = getConformanceImplementationConfig(
          requirementAnalysis,
          buildFeedback,
          repositoryUrl,
          gitInfo.branch,
          baseBranch,
          conformanceResult,
          undefined,
          undefined,
          type,
          getCommitMessage
        )
        const implementationResult: AgenticCheckpointResult = await scopedEngine.createAgenticCheckpoint(
          FidoEnhancedWorkflowStepsEnum.CODE_IMPLEMENTATION,
          implementationConfig.agentName,
          implementationConfig.config
        )
         gitInfo = { ...gitInfo, ...implementationResult.gitInfo }
        // Non-agentic build step: clone -> cd -> cargo build
        console.log('🔨 Running cargo build to check implementation...')
        if(buildCommand && buildCommand?.trim().length > 0){
        buildResult = await scopedEngine.createCheckpoint(FidoEnhancedWorkflowStepsEnum.BUILD_CODE, executeBuildCode,buildCommand, repositoryUrl, gitInfo.branch);
        
        if (!buildResult.success) {
          console.log(` Implementation compilation failed - Error: ${buildResult.error}`)
          console.log(' Build issues detected - continuing TDD implementation loop to fix errors')
          buildPassed = false
          return LoopControl.CONTINUE
        }
      }
        // console.log(' Implementation compiles successfully!', testDetails);
        buildPassed = true;
        // if (testDetails && Array.isArray(testDetails) && testDetails.length > 0) {
        //     let allValidationsPassed = true;
        //     if(ispoller){
        //       for (const testDetail of testDetails) {
        //         console.log(`🌐 Executing feature conformance testing for: ${testDetail.filename}...`);
        //          conformanceResult = await scopedEngine.createCheckpoint(FidoEnhancedWorkflowStepsEnum.DETERMINISTIC_TESTING, executeRemoteConformanceTesting, testDetail, repositoryUrl , gitInfo.branch);
        //          if(conformanceResult){
        //             const { success , output  } = conformanceResult;
        //             console.log(` feature Conformance Results for ${testDetail.filename} - Success: ${success} -- ${output}`);
        //             if (!success) {
        //                 allValidationsPassed = false;
        //                 break;
        //             }
        //          } else {
        //             console.log(` Conformance Results for ${testDetail.filename} - No results returned.`);
        //             allValidationsPassed = false;
        //             break;
        //          }
        //     }
        //     }
        //     else{
        //       console.log('ispoller is false, skipping feature conformance testing.');
        //       for (const testDetail of testDetails) {
        //         console.log(`🌐 Executing feature conformance testing for: ${testDetail.filename}...`);
        //          conformanceResult = await scopedEngine.createCheckpoint(FidoEnhancedWorkflowStepsEnum.DETERMINISTIC_TESTING, executeLocalTesting, repositoryUrl , gitInfo.branch, testDetail,buildResult!.workingDirectory);
        //          if(conformanceResult){
        //             const { success , output  } = conformanceResult;
        //             console.log(` feature Conformance Results for ${testDetail.filename} - Success: ${success} -- ${output}`);
        //             if (!success) {
        //                 allValidationsPassed = false;
        //             }
        //          } else {
        //             console.log(` Conformance Results for ${testDetail.filename} - No results returned.`);
        //             allValidationsPassed = false;
        //          }
        //     }
        //     }
        //     if (allValidationsPassed) {
        //         console.log('All validation types passed successfully!');
        //         conformancePassed = true;
        //         return LoopControl.BREAK;
        //     } else {
        //         console.log(' Some validations failed, continuing implementation loop to fix errors.');
        //         conformancePassed = false;
        //         return LoopControl.CONTINUE;
        //     }
        // } else {
        //     console.log(' No feature validation types specified, marking as complete.');
        //     conformancePassed = true;
        //     return LoopControl.BREAK;
        // }
        return LoopControl.BREAK;
      }
    )
    if(type === FidoWorkType.DEEP){
      logger.info('Removing generated-requirement-analysis.xml if it exists...');
      const removeFileConfig = getFileRemovalConfig(repositoryUrl, gitInfo.branch, baseBranch, getCommitMessage);
      await workflow.createAgenticCheckpoint(
        FidoEnhancedWorkflowStepsEnum.POST_IMPLEMENTATION,
        removeFileConfig.agentName,
        removeFileConfig.config
      );
    }
    // =========================================================================
    // PHASE 4: SUMMARIZATION - COMMENTED OUT
    // =========================================================================
    // const summarizationConfig = getEnhancedSummarizationConfig(ticketId, repositoryUrl, workspaceDirectory, gitInfo.branch, agentConfigVersions)
    // const summarizationResult: AgenticCheckpointResult = await workflow.createAgenticCheckpoint(
    //   FidoEnhancedWorkflowStepsEnum.SUMMARIZATION,
    //   summarizationConfig.agentName,
    //   summarizationConfig.config
    // )
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
    return {
      ticketId,
      status: finalStatus,
      implementationDetails: {
        filesChanged: [], 
        commitHash: gitInfo.commitHash,
        branch: gitInfo.branch,
        buildPassed,
        conformancePassed,
        iterationsCompleted
      },
      summary,
      gitInfo
    }
  }
}