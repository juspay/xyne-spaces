
import { WorkflowEngine, LoopControl, AgenticCheckpointConfig, PrLinkGenerator } from '../../workflow-types'
import { WorkflowDefinition } from '../../registry/workflowRegistry'
import { WorkflowType, BugWorkflowEvalContext } from '../../types/workflow-enums'
import { config } from '../../../config/env'
import type { ConversationResult } from '@framework'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { spawn } from 'child_process'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { CodeFixResult, rcaResult, multiRepoCoeResult, groupedMultiRepoCoeResult, commits, WorkflowRunResult, repoIdMap } from './types'
import { buildProblemStatementPrompt, buildRCAPrompt, buildCOEPrompt, buildRepoCOEPrompt, PROBLEM_STATEMENT_SYSTEM_PROMPT, RCA_SYSTEM_PROMPT, COE_SYSTEM_PROMPT, REPO_COE_SYSTEM_PROMPT} from './prompts'
import { createChatSession, streamAgentResponse, getSessionToolCalls, parseJsonResponse, formatObjectToString, crossVerify } from './utils'
import {logger} from '@/utils/logger';

// Step IDs for bug workflow eval inner steps
export enum BugWorkflowEvalInnerSteps {
  EXPAND_PROBLEM_STATEMENT = 'expand_problem_statement',
  RCA_LOOP = 'RCA Loop',
  ROOT_CAUSE_ANALYSIS = 'Root Cause Analysis',
  COE_LOOP = 'COE Loop',
  CORRECTION_OF_ERROR = 'Correction of Error',
  MULTI_REPO_COE_LOOP = 'MultiRepoCOE Loop',
  MULTI_REPO_COE_ANALYSIS = 'Multi Repo COE Analysis',
  REPOSITORY_SETUP = 'repository_setup',
  CODE_FIX_REPOSITORIES = 'code_fix_repositories',
  CODE_FIX = 'code_fix',
  GENERATE_FIX = 'generate_fix'
}

const expandProblemStatement = async (bugId: string, title: string, description: string, severity: string) => {
  logger.info(`Starting Expand Problem Statement for ticket: ${bugId}`)

  // Check if we should use mock analysis
  if (config.use_mock_analysis) {
    logger.info('Using MOCK Problem Statement expansion')
    await new Promise(resolve => setTimeout(resolve, 1000)) // Simulate processing time
    
    const mockProblemStatement = 
    {
      "expanded_problem": {
        "llm_understanding": "The issue seems related to payment checkout timing out when multiple users attempt concurrent transactions.",
        "expected_behavior": "The payment should complete successfully within expected response time under concurrent loads.",
        "observed_behavior": "Some transactions fail or timeout intermittently when multiple users perform checkout simultaneously.",
        "steps_to_reproduce": "1. Log in as 3 different users. 2. Attempt checkout simultaneously with same payment gateway. 3. Observe that one or more users encounter timeout or failure.",
        "validation_steps_after_fix": "1. Repeat the concurrent checkout scenario after fix deployment. 2. Ensure all transactions complete without timeout. 3. Validate payment confirmations in backend logs."
      }
    }

    return {
        problemStatement: mockProblemStatement.expanded_problem,
        problemStatementToolCalls: [],
    }
  }

  try {
    const sessionId = await createChatSession("Xyne - Expand Problem Statement", "f9d7a289-12d2-4794-a260-bedc5ae2e562");
    const query = buildProblemStatementPrompt({ title, description, severity });
    const accumulatedResponse = await streamAgentResponse(sessionId, query, bugId, PROBLEM_STATEMENT_SYSTEM_PROMPT);
    logger.info("Expand Problem Statement Response: ", accumulatedResponse);

    const jsonResponse = parseJsonResponse<{
        expanded_problem: {
            llm_understanding: string,
            expected_behavior: string,
            observed_behavior: string,
            steps_to_reproduce: string,
            validation_steps_after_fix: string
        }
    }>(accumulatedResponse);

    const problemStatementToolCalls = await getSessionToolCalls(sessionId);
    logger.info(problemStatementToolCalls);

    return {
        problemStatement: jsonResponse.expanded_problem,
        problemStatementToolCalls,
    }
  } catch (error) {
    logger.error('Error during Expand Problem Statement:', error)
    if (error instanceof Error) {
      logger.error('Error message:', error.message)
      logger.error('Error stack:', error.stack)
    }
    throw error
  }
}

export const researchAgentRCAanalysis = async (bugId: string, rcaPrompt: string, commits?: commits) => {
  logger.info(`Starting RCA Analysis for ticket: ${bugId}`)

  // Check if we should use mock analysis
  if (config.use_mock_analysis) {
    logger.info('Using MOCK RCA analysis')
    await new Promise(resolve => setTimeout(resolve, 1000)) // Simulate processing time
    
    const mockRcaAnalysis = [
      {
        "repo_name": "euler-api-txns",
        "function_name": "server",
        "module_name": "Euler.API.Txns.Server",
        "code_snippet": "Just add a comment # we are testing",
        "reason": "Mock reason: The system does not properly handle null user input, leading to a crash.",
        "references": [],
        "mermaid_diagram": ""
      }
    ];

    return {
        rca: mockRcaAnalysis,
        rcaToolCalls: [],
    }
  }

  try {
    const sessionId = await createChatSession("Xyne - RCA Analysis", "f9d7a289-12d2-4794-a260-bedc5ae2e562");

    const accumulatedResponse = await streamAgentResponse(sessionId, rcaPrompt, bugId, RCA_SYSTEM_PROMPT, commits);
    logger.info("RCA Response: ", accumulatedResponse);

    const jsonResponse = parseJsonResponse<rcaResult>(accumulatedResponse);

    const rcaToolCalls = await getSessionToolCalls(sessionId);

    return {
      rca: jsonResponse,
      rcaToolCalls,
    }
  } catch (error) {
    logger.error('Error during RCA analysis:', error)
    if (error instanceof Error) {
      logger.error('Error message:', error.message)
      logger.error('Error stack:', error.stack)
    }
    throw error
  }
}

export const researchAgenCOEAnalysis = async (bugId: string, prompt: string, commits?: commits) => {
  logger.info(`Researching COE for bug: ${bugId}`)

  // Check if we should use mock analysis
  if (config.use_mock_analysis) {
    logger.info('Using MOCK COE analysis')
    await new Promise(resolve => setTimeout(resolve, 1000)) // Simulate processing time
    
    const mockCoeAnalysis = `# Correction of Error Analysis - MOCK Response`
    return {
      coe: mockCoeAnalysis,
      coeToolCalls: [],
    }
  }

  try {
    const sessionId = await createChatSession("Xyne - COE Analysis", "f9d7a289-12d2-4794-a260-bedc5ae2e562");

    const accumulatedResponse = await streamAgentResponse(sessionId, prompt, bugId, COE_SYSTEM_PROMPT, commits);
    logger.info("COE Response: ", accumulatedResponse);

    const coeToolCalls = await getSessionToolCalls(sessionId);

    return {
      coe: accumulatedResponse,
      coeToolCalls,
    }
  } catch (error) {
    logger.error('Error during COE analysis:', error)
    throw error
  }
}

export const multiRepoCoeAnalysis = async (bugId: string, prompt: string, commits?: commits) => {
  logger.info(`Researching Multi Repo COE for bug: ${bugId}`)

  // Check if we should use mock analysis
  if (config.use_mock_analysis) {
    logger.info(`Using MOCK Multi Repo COA analysis`)
    
    const mockMultiRepoCOAAnalysis = {
      "repos": [
        {
          "repo_name": "euler-api-customer",
          "module_name": "Euler.Server",
          "function_name": "eulerServer'",
          "suggested_changes": "Add a comment '// Multi-repo test change'"
        },
      ]
    }

    await new Promise(resolve => setTimeout(resolve, 1000)) // Simulate processing time
    
    return {
      multi_repo_coe_analysis: mockMultiRepoCOAAnalysis,
      multiRepoCoeToolCalls: [],
    }
  }

  try {
    const sessionId = await createChatSession("Xyne - Multi Repo COE Analysis", "f9d7a289-12d2-4794-a260-bedc5ae2e562");

    const accumulatedResponse = await streamAgentResponse(sessionId, prompt, bugId, REPO_COE_SYSTEM_PROMPT, commits);
    logger.info("MultiRepoCEO Response: ", accumulatedResponse);

    const jsonResponse = parseJsonResponse<multiRepoCoeResult>(accumulatedResponse);

    const multiRepoCoeToolCalls = await getSessionToolCalls(sessionId);

    return {
      multi_repo_coe_analysis: jsonResponse,
      multiRepoCoeToolCalls,
    }
  } catch (error) {
    logger.error('Error during Multi Repo COE analysis:', error)
    throw error
  }
}

const transformToGroupedFormat = (multiRepoAnalysis: multiRepoCoeResult): groupedMultiRepoCoeResult => {
  const grouped: groupedMultiRepoCoeResult = {};
  
  for (const repo of multiRepoAnalysis.repos) {
    if (!grouped[repo.repo_name]) {
      grouped[repo.repo_name] = [];
    }
    grouped[repo.repo_name].push({
      module_name: repo.module_name,
      function_name: repo.function_name,
      suggested_changes: repo.suggested_changes
    });
  }
  
  return grouped;
}

const repositorySetup = async (bugId: string, multiRepoAnalysis: groupedMultiRepoCoeResult, commits: commits | undefined) => {
  logger.info(`📦 [REPO-DEBUG] Starting repository detection and cloning for bug: ${bugId}`)
  
  try {
    if (Object.keys(multiRepoAnalysis).length === 0) {
      throw new Error("Multi-repo analysis is not available or is empty.")
    }

    // Create working directory for all repos
    const workingDir = await mkdtemp(join(tmpdir(), `bug-${bugId}-`))
    logger.info(`📁 [REPO-SETUP] Created working directory: ${workingDir}`)

    const repositorySetups = []
    const clonedRepos: { [key: string]: { path: string; branch: string; baseBranch: string; repoUrl: string } } = {}

    for (const repo_name of Object.keys(multiRepoAnalysis)) {
      const targetRepository = repo_name 
      const cloneUrl = targetRepository === 'euler-api-gateway' 
        ? `ssh://git@github.com/example-org/euler-api-gateway.git`
        : `ssh://git@github.com/example-org/${targetRepository}.git`;

      let baseBranch = 'staging'
      if (commits && commits[targetRepository as keyof typeof commits]) {
        baseBranch = commits[targetRepository as keyof typeof commits]!
      }

      logger.info("BaseBranch: ",baseBranch)
      // Create feature branch name for bug fix - hardcoded to EUL-0000 with ticket ID
      const jiraId = 'EUL-0000'
      logger.info(`Using JIRA ID for branch naming: ${jiraId}`)
      const branchName = `${jiraId}-bugfix-${bugId}-${targetRepository}-${randomUUID()}`
      
      // Clone repository with retry logic
      const repoPath = join(workingDir, targetRepository)
      const MAX_CLONE_RETRIES = 3
      const RETRY_DELAY_MS = 30000 // 30 seconds
      
      let cloneSuccess = false
      for (let attempt = 1; attempt <= MAX_CLONE_RETRIES; attempt++) {
        try {
          logger.info(`📥 [REPO-SETUP] Cloning ${targetRepository} (attempt ${attempt}/${MAX_CLONE_RETRIES})...`)
          
          await new Promise<void>((resolve, reject) => {
            const cloneProcess = spawn('git', ['clone', cloneUrl, repoPath], {
              stdio: ['inherit', 'pipe', 'pipe']
            })
            
            cloneProcess.stdout?.on('data', (data) => {
              logger.info(`[GIT CLONE ${targetRepository}] ${data.toString().trim()}`)
            })
            
            cloneProcess.stderr?.on('data', (data) => {
              logger.info(`[GIT CLONE ${targetRepository}] ${data.toString().trim()}`)
            })
            
            cloneProcess.on('close', (code) => {
              if (code === 0) resolve()
              else reject(new Error(`Git clone failed with code ${code}`))
            })
          })
          
          cloneSuccess = true
          logger.info(`✅ [REPO-SETUP] Clone successful for ${targetRepository}`)
          break // Success - exit retry loop
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error)
          logger.error(`❌ [REPO-SETUP] Clone attempt ${attempt}/${MAX_CLONE_RETRIES} failed for ${targetRepository}: ${errorMessage}`)
          
          if (attempt < MAX_CLONE_RETRIES) {
            logger.info(`⏳ [REPO-SETUP] Waiting 30 seconds before retry...`)
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS))
          } else {
            throw new Error(`Failed to clone ${targetRepository} after ${MAX_CLONE_RETRIES} attempts: ${errorMessage}`)
          }
        }
      }
      
      if (!cloneSuccess) {
        throw new Error(`Failed to clone ${targetRepository} after ${MAX_CLONE_RETRIES} attempts`)
      }
      
      // Create and checkout feature branch from baseBranch
      // If baseBranch is a commit hash (40 char hex), use it directly
      // If baseBranch is a branch name, use origin/${baseBranch}
      const isCommitHash = /^[0-9a-f]{40}$/i.test(baseBranch)
      const checkoutRef = isCommitHash ? baseBranch : `origin/${baseBranch}`
      logger.info(`🔀 [REPO-SETUP] Creating branch ${branchName} from ${checkoutRef}...`)
      
      await new Promise<void>((resolve, reject) => {
        const checkoutProcess = spawn('git', ['checkout', '-b', branchName, checkoutRef], {
          cwd: repoPath,
          stdio: ['inherit', 'pipe', 'pipe']
        })
        
        checkoutProcess.stdout?.on('data', (data) => {
          logger.info(`[GIT CHECKOUT ${targetRepository}] ${data.toString().trim()}`)
        })
        
        checkoutProcess.stderr?.on('data', (data) => {
          logger.info(`[GIT CHECKOUT ${targetRepository}] ${data.toString().trim()}`)
        })
        
        checkoutProcess.on('close', (code) => {
          if (code === 0) resolve()
          else reject(new Error(`Git checkout failed with code ${code}. Branch: ${branchName}, Base: origin/${baseBranch}`))
        })
      })
      
      logger.info(`✅ [REPO-SETUP] ${targetRepository} cloned successfully`)
      
      repositorySetups.push({
        targetRepository: targetRepository,
        repoUrl: cloneUrl,
        branch: branchName,
        baseBranch: baseBranch,
      })
      
      clonedRepos[targetRepository] = {
        path: repoPath,
        branch: branchName,
        baseBranch: baseBranch,
        repoUrl: cloneUrl
      }
    }

    return { repositorySetups, clonedRepos, workingDir }

  } catch (error) {
    logger.error('Repository setup failed:', error)
    throw error
  }
}

// Create xyne-cli agentic checkpoint configuration using config-based approach
function createXyneCliAgenticConfig(
  bugId: string,
  title: string,
  repository: string,
  changes: string,
  repoUrl: string,
  repoBranch: string,
  baseBranch: string,
  getPrLink: PrLinkGenerator,
  buildErrors?: string
): { agentName: string; config: AgenticCheckpointConfig } {
  let userMessage = `Implement the following bug fix for repository "${repository}":

# BUG INFORMATION
- Bug ID: ${bugId}
- Title: ${title}

# REQUIRED CHANGES
${changes}

# INSTRUCTIONS
Please implement the necessary code changes as described above. Use the file_writer tool to make changes. Ensure the code is production-ready and follows existing coding standards.`

  if (buildErrors) {
    userMessage += `\n\n# PREVIOUS BUILD FAILED
The previous attempt resulted in build errors. Please fix the following errors:
\`\`\`
${buildErrors}
\`\`\`

Analyze the errors carefully and make the necessary corrections.
After make all the changes can you give the summary of what are the things that you changed here properly`
  }

  return {
    agentName: 'bug-fix-engineer',
    config: {
      conversationContext: {
        initialUserMessage: userMessage
      },
      repoInfo: {
        repoUrl,
        repoBranch: repoBranch,
        baseBranch: baseBranch,
        repository: repository,
        getCommitMessage: (raw_commit_message) => {
          return "EUL-0000 " + raw_commit_message
        },
        getPrLink: getPrLink
      }
    }
  }
}

export const extractLastMessageContent = (result: ConversationResult): string => {
  const lastMessage = result.messages[result.messages.length - 1]
  return lastMessage?.content || 'No content generated'
}

const BugWorkflowEvalInnerStepsInputSchema = z.object({
  bugId: z.string(),
  title: z.string(),
  description: z.string(),
  severity: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  reportedBy: z.string(),
  merchantId: z.string().optional(),
  assignedTo: z.string().optional(),
  labels: z.array(z.string()).optional(),
  codeFiles: z.array(z.string()).optional(),
  humanReadableId: z.string().optional(),
  pr_url: z.string().optional(),
  commits: z.record(z.string()).optional()
})

const bugWorkflowEvalInnerStepsContextMapper = (payload: any): BugWorkflowEvalContext => ({
  ticketId: payload.ticketId,
  bugId: payload.bugId,
  title: payload.title,
  description: payload.description,
  severity: payload.severity,
  reportedBy: payload.reportedBy,
  merchantId: payload.merchantId,
  assignedTo: payload.assignedTo,
  labels: payload.labels,
  codeFiles: payload.codeFiles,
  humanReadableId: payload.humanReadableId,
  pr_url: payload.pr_url,
  commits: payload.commits
})

export const bugWorkflowEvalInnerSteps: WorkflowDefinition<BugWorkflowEvalContext, WorkflowRunResult, typeof BugWorkflowEvalInnerSteps> = {
  type: WorkflowType.BUG_WORKFLOW_EVAL_INNER_STEPS,
  name: 'Bug Workflow Eval Inner Steps',
  description: 'Complete bug resolution workflow including analysis, coding, testing, and deployment with evaluation',
  inputSchema: BugWorkflowEvalInnerStepsInputSchema,
  contextMapper: bugWorkflowEvalInnerStepsContextMapper,

  async execute(engine: WorkflowEngine<BugWorkflowEvalContext, typeof BugWorkflowEvalInnerSteps>): Promise<WorkflowRunResult> {
    const context = engine.getContext()
    const { bugId, title, description, severity, commits, runIndex } = context
    
    let workingDir: string | undefined = undefined

    try {
      const problemStatementResult = await engine.createCheckpoint(BugWorkflowEvalInnerSteps.EXPAND_PROBLEM_STATEMENT, expandProblemStatement, bugId, title, description, severity)

      let rcaResult: { rca: rcaResult; rcaToolCalls: any[] } | undefined;
      const formattedProblemStatement = formatObjectToString(problemStatementResult.problemStatement)
      let rcaPrompt = buildRCAPrompt({ title, description:formattedProblemStatement, severity})

      await engine.createWhileLoop(
        BugWorkflowEvalInnerSteps.RCA_LOOP,
        3,
        async (iteration: number, scopedEngine: WorkflowEngine<BugWorkflowEvalContext, typeof BugWorkflowEvalInnerSteps>) => {
          logger.info(`🔄 Attempt ${iteration + 1}/3 for RCA`)
          const result = await scopedEngine.createCheckpoint(BugWorkflowEvalInnerSteps.ROOT_CAUSE_ANALYSIS, researchAgentRCAanalysis, bugId, rcaPrompt, commits)

          const repos: { [key: string]: { modules: string[], functions: string[] } } = {};
          for (const item of result.rca) {
              if (!repos[item.repo_name]) {
                  repos[item.repo_name] = { modules: [], functions: [] };
              }
              repos[item.repo_name].modules.push(item.module_name);
              repos[item.repo_name].functions.push(item.function_name);
          }

          let allCrossVerifyFeedback = '';
          for (const repoName in repos) {
              const { modules, functions } = repos[repoName];
              const crossVerifyFeedback = await crossVerify(repoName, modules, functions, bugId);
              if (crossVerifyFeedback) {
                  allCrossVerifyFeedback += `For repo ${repoName}:\n${crossVerifyFeedback}\n`;
              }
          }

          if (allCrossVerifyFeedback) {
              logger.info(`RCA analysis failed cross-verification. Retrying with feedback...`);
              rcaPrompt += `\n\nPrevious attempt failed. Please correct the following errors:\n${allCrossVerifyFeedback}`;
              return LoopControl.CONTINUE;
          }
          
          rcaResult = result;
          return LoopControl.BREAK
        }
      )
      
      if (!rcaResult) {
        const error = new Error('RCA analysis failed after 3 attempts due to empty tool responses or cross-verification failures');
        error.name = 'RCAAnalysisError';
        throw error;
      }

      
      if (!rcaResult.rca || rcaResult.rca.length === 0) {
        const error = new Error('RCA analysis completed but returned empty results');
        error.name = 'RCAAnalysisError';
        throw error;
      }

      let coeResult: { coe: string; coeToolCalls: any[] } | undefined;
      const formattedRca = rcaResult?.rca.map(item => formatObjectToString(item)).join('\n\n---\n\n');
      const coePrompt = buildCOEPrompt( {title, description: formattedProblemStatement, severity, rca: formattedRca} )

      await engine.createWhileLoop(
        BugWorkflowEvalInnerSteps.COE_LOOP,
        3,
        async (iteration: number, scopedEngine: WorkflowEngine<BugWorkflowEvalContext, typeof BugWorkflowEvalInnerSteps>) => {
          logger.info(`🔄 Attempt ${iteration + 1}/3 for COE`)

          const result = await scopedEngine.createCheckpoint(BugWorkflowEvalInnerSteps.CORRECTION_OF_ERROR, researchAgenCOEAnalysis, bugId, coePrompt, commits)

          const shouldRetry = result.coeToolCalls && result.coeToolCalls.length > 0 && result.coeToolCalls.every((call: any) => {
            const response = call.tool_response;
            return response === null || response === '' || (Array.isArray(response) && response.length === 0);
          });

          if (shouldRetry) {
            logger.info(`COE analysis resulted in empty tool responses. Retrying... Attempt ${iteration + 2}`);
            await new Promise(resolve => setTimeout(resolve, 1000));
            return LoopControl.CONTINUE
          } else {
            coeResult = result;
            return LoopControl.BREAK
          }
        }
      )
      
      if (!coeResult) {
        const error = new Error('COE analysis failed after 3 attempts due to empty tool responses');
        error.name = 'COEAnalysisError';
        throw error;
      }
      if (!coeResult.coe || coeResult.coe.trim() === '') {
        const error = new Error('COE analysis completed but returned empty content');
        error.name = 'COEAnalysisError';
        throw error;
      }

      let multiRepoCoeResult: { multi_repo_coe_analysis: multiRepoCoeResult; multiRepoCoeToolCalls: any[] } | undefined;
      const coe = coeResult?.coe
      let multRepoCoePrompt = buildRepoCOEPrompt({ title, description: formattedProblemStatement, severity, rca: formattedRca, coe: coe})

      await engine.createWhileLoop(
        BugWorkflowEvalInnerSteps.MULTI_REPO_COE_LOOP,
        3,
        async (iteration: number, scopedEngine: WorkflowEngine<BugWorkflowEvalContext, typeof BugWorkflowEvalInnerSteps>) => {
          logger.info(`🔄 Attempt ${iteration + 1}/3 for MultRepoCoeAnalysis`)
          const result = await scopedEngine.createCheckpoint(BugWorkflowEvalInnerSteps.MULTI_REPO_COE_ANALYSIS, multiRepoCoeAnalysis, bugId, multRepoCoePrompt, commits)

          const repos: { [key: string]: { modules: string[], functions: string[] } } = {};
          for (const item of result.multi_repo_coe_analysis.repos) {
              if (!repos[item.repo_name]) {
                  repos[item.repo_name] = { modules: [], functions: [] };
              }
              repos[item.repo_name].modules.push(item.module_name);
              repos[item.repo_name].functions.push(item.function_name);
          }

          let allCrossVerifyFeedback = '';
          for (const repoName in repos) {
              const { modules, functions } = repos[repoName];
              const crossVerifyFeedback = await crossVerify(repoName, modules, functions, bugId);
              if (crossVerifyFeedback) {
                  allCrossVerifyFeedback += `For repo ${repoName}:\n${crossVerifyFeedback}\n`;
              }
          }

          if (allCrossVerifyFeedback) {
            logger.info(`Multi-repo COE analysis failed cross-verification. Retrying with feedback...`);
            multRepoCoePrompt += `\n\nPrevious attempt failed. Please correct the following errors:\n${allCrossVerifyFeedback}`;
            return LoopControl.CONTINUE;
          }

          multiRepoCoeResult = result;
          return LoopControl.BREAK
        }
      )
      
      if (!multiRepoCoeResult) {
        const error = new Error('Multi-repo COE analysis failed after 3 attempts due to empty tool responses or cross-verification failures');
        error.name = 'MultiRepoCOEAnalysisError';
        throw error;
      }

      if (!multiRepoCoeResult.multi_repo_coe_analysis || !multiRepoCoeResult.multi_repo_coe_analysis.repos || multiRepoCoeResult.multi_repo_coe_analysis.repos.length === 0) {
        const error = new Error('Multi-repo COE analysis completed but returned no repository changes');
        error.name = 'MultiRepoCOEAnalysisError';
        throw error;
      }

      const multi_repo_coe_analysis = transformToGroupedFormat(multiRepoCoeResult.multi_repo_coe_analysis);


      const repoSetupResult = await engine.createCheckpoint(BugWorkflowEvalInnerSteps.REPOSITORY_SETUP, repositorySetup, bugId, multi_repo_coe_analysis, commits)

      // Xyne Code Fixes with Retry Loop - Now using createWhileLoop for visible retry logic
      const repositorySetups = repoSetupResult.repositorySetups || []
      workingDir = repoSetupResult.workingDir
      const multiRepoAnalysis = multi_repo_coe_analysis;

      if (!repositorySetups || repositorySetups.length === 0) {
        const error = new Error('Repository setup failed - no repositories configured for cloning');
        error.name = 'RepositorySetupError';
        throw error;
      }

      if (!multiRepoAnalysis || Object.keys(multiRepoAnalysis).length === 0) {
        const error = new Error('Multi-repo analysis data not available for repository setup');
        error.name = 'RepositorySetupError';
        throw error;
      }

      const codeFixesResults: CodeFixResult[] = [];

      await engine.createWhileLoop(
        BugWorkflowEvalInnerSteps.CODE_FIX_REPOSITORIES,
        repositorySetups.length,
       async (iteration: number, scopedEngine: WorkflowEngine<BugWorkflowEvalContext, typeof BugWorkflowEvalInnerSteps>) => {
        const repoSetup = repositorySetups[iteration];
        const repoInfo = multi_repo_coe_analysis[repoSetup.targetRepository];
        if (!repoInfo || !Array.isArray(repoInfo) || repoInfo.length === 0) {
          logger.warn(`⚠️ [VALIDATION] No changes specified for ${repoSetup.targetRepository}. Skipping code generation.`);
          logger.info(`[DEBUG] repoInfo for ${repoSetup.targetRepository}:`, repoInfo);
          return LoopControl.CONTINUE
        }

        const { targetRepository } = repoSetup
        logger.info(`🎯 [XYNE-DEBUG] Processing repository: ${targetRepository}`)

        const buildErrorFeedback = ''
        let repoSuccess = false

        // Retry loop for this repository (max 3 attempts)
        await scopedEngine.createWhileLoop(
          BugWorkflowEvalInnerSteps.CODE_FIX,
          3,
          async (iteration: number, scopedEngine: WorkflowEngine<BugWorkflowEvalContext, typeof BugWorkflowEvalInnerSteps>) => {
            logger.info(`🔄 [XYNE-DEBUG] Attempt ${iteration + 1}/3 for ${targetRepository}`)
            if(!repoInfo) {
              return LoopControl.CONTINUE;
            }

            const suggested_change_instruction = repoInfo.reduce((acc, value) => {
              const changes =  "Module Name:" + value.module_name + "\n" + "Function Name:" + value.function_name + "\n" + "Changes to be made:" + value.suggested_changes
              return acc + "\n\n" + changes;
            }, "")   //

            const targetRepoInfo = repoIdMap[targetRepository as keyof typeof repoIdMap];
            const projectId = targetRepoInfo?.projectId || '';

            // Create PR link generator callback for this repository
            const getPrLinkCallback = (params: { commitHash: string; baseBranch: string; repository: string }) => {
              return `https://bitbucket.example.com/projects/${projectId}/repos/${params.repository}/compare/commits?sourceBranch=${params.commitHash}&targetBranch=${params.baseBranch}`;
            };

            // Create agentic checkpoint for code generation
            const agenticConfig = createXyneCliAgenticConfig(
              bugId,
              title,
              targetRepository,
              suggested_change_instruction,
              repoSetup.repoUrl,
              repoSetup.branch,
              repoSetup.baseBranch,
              getPrLinkCallback,
              buildErrorFeedback
            )

            logger.info("agenticConfig: ", agenticConfig)

            // Execute as agentic checkpoint - this will show as "agentic" in frontend!
            const result = await scopedEngine.createAgenticCheckpoint(
              BugWorkflowEvalInnerSteps.GENERATE_FIX,
              agenticConfig.agentName,
              agenticConfig.config
            )
            
            logger.info(`✅ [XYNE-DEBUG] Agentic code generation completed for ${targetRepository}`)

            logger.info("latestCommit: ", result.gitInfo.commitHash)
            if (!result.gitInfo.commitHash){
              logger.info("codingAgent cant push changes so retry started...")
              return LoopControl.CONTINUE
            }

            codeFixesResults.push({
              repository: targetRepository,
              changeSummary: extractLastMessageContent(result.result),
              success: true,
              branchName: repoSetup.branch,
              latestCommit: result.gitInfo.commitHash,
              executedAt: new Date().toISOString()
            })
            repoSuccess = true
            return LoopControl.BREAK // Success!
          }
        )

        // If all retries failed, record the failure
        if (!repoSuccess) {
          logger.error(`❌ [XYNE-DEBUG] All attempts failed for ${targetRepository}`)
          codeFixesResults.push({
            repository: targetRepository,
            changeSummary: "Can't create summary due to failed to create code generation",
            success: false,
            error: buildErrorFeedback || 'All retry attempts exhausted',
            executedAt: new Date().toISOString(),
            latestCommit: undefined
          })
        }
        return LoopControl.CONTINUE // Success!
      })

      // Check if all code fixes failed
      const successfulFixes = codeFixesResults.filter(fix => fix.success && fix.latestCommit);
      if (codeFixesResults.length > 0 && successfulFixes.length === 0) {
        const failedRepos = codeFixesResults.map(fix => 
          `${fix.repository}: ${fix.error || 'Unknown error'}`
        ).join('; ');
        
        const error = new Error(`All ${codeFixesResults.length} repositories failed code generation/commit - ${failedRepos}`);
        error.name = 'CodeGenerationError';
        throw error;
      }

      // Store results in context (this would normally be done via state management)
      logger.info(`📊 [XYNE-DEBUG] Code fixes completed. Results:`, codeFixesResults)
      
      // The result of the inner workflow is the context itself.
      // The parent workflow will decide what to pick from it.
      return {
        runIndex: runIndex as number | undefined,
        results: codeFixesResults,
      }

    } catch (error) {
      logger.error(`❌ [WORKFLOW-DEBUG] Bug workflow failed for ${bugId}:`, error)
      
      // Enhanced error detection to identify which step failed
      let step = 'WORKFLOW_EXCEPTION';
      let reason = `Unexpected workflow error: ${error instanceof Error ? error.message : 'Unknown error'}`;
      
      if (error instanceof Error) {
        logger.error(`❌ [WORKFLOW-DEBUG] Error message: ${error.message}`)
        logger.error(`❌ [WORKFLOW-DEBUG] Error stack: ${error.stack}`)
        
        // Detect specific failure steps based on error name and stack trace
        const stack = error.stack || '';
        const errorName = error.name || '';
        
        if (errorName === 'RCAAnalysisError' || stack.includes('researchAgentRCAanalysis') || stack.includes('RCA')) {
          step = 'RCA_ANALYSIS';
          reason = error.message;
        } else if (errorName === 'COEAnalysisError' || stack.includes('researchAgenCOEAnalysis') || stack.includes('COE')) {
          step = 'COE_ANALYSIS';
          reason = error.message;
        } else if (errorName === 'MultiRepoCOEAnalysisError' || stack.includes('multiRepoCoeAnalysis') || stack.includes('Multi Repo')) {
          step = 'MULTI_REPO_COE_ANALYSIS';
          reason = error.message;
        } else if (errorName === 'RepositorySetupError' || stack.includes('repositorySetup')) {
          step = 'REPOSITORY_SETUP';
          reason = error.message;
        } else if (errorName === 'CodeGenerationError' || stack.includes('createAgenticCheckpoint') || stack.includes('generate_fix')) {
          step = 'CODE_GENERATION';
          reason = error.message;
        } else if (stack.includes('expandProblemStatement')) {
          step = 'PROBLEM_STATEMENT';
          reason = 'Problem statement expansion failed: ' + error.message;
        }
      }
      
      return {
        runIndex: runIndex as number | undefined,
        results: [],
        failureInfo: {
          step: step,
          reason: reason
        }
      };
    } finally {
      // Cleanup working directory
      if (workingDir) {
        logger.info(`🧹 [CLEANUP] Removing working directory: ${workingDir}`)
        try {
          await rm(workingDir, { recursive: true, force: true })
          logger.info(`✅ [CLEANUP] Working directory cleaned up successfully`)
        } catch (cleanupError) {
          logger.warn(`⚠️ [CLEANUP] Failed to cleanup working directory:`, cleanupError)
        }
      }
    }
    
  }
}
