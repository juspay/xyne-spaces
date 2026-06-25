// Bug Workflow definition

import {
  WorkflowEngine,
  LoopControl,
  AgenticCheckpointConfig,
  PrLinkGenerator,
  GitInfo,
} from '../../workflow-types';
import { WorkflowDefinition } from '../../registry/workflowRegistry';
import { WorkflowType, BugWorkflowContext, ImageAttachment } from '../../types/workflow-enums';
import { config } from '../../../config/env';
import { createUserMessage, type ConversationResult } from '@framework';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { logger } from '../../../utils/logger';
import {
  CodeFixResult,
  rcaResult,
  multiRepoCoeResult,
  groupedMultiRepoCoeResult,
  repoIdMap,
} from './types';
import {
  buildProblemStatementPrompt,
  buildRCAPrompt,
  buildCOEPrompt,
  buildRepoCOEPrompt,
  PROBLEM_STATEMENT_SYSTEM_PROMPT,
  RCA_SYSTEM_PROMPT,
  COE_SYSTEM_PROMPT,
  REPO_COE_SYSTEM_PROMPT,
} from './prompts';
import {
  createChatSession,
  streamAgentResponse,
  getSessionToolCalls,
  parseJsonResponse,
  formatObjectToString,
  crossVerify,
  getGraphServerUrlForTicket,
  ensureLatestGraphsLoaded,
} from './utils';

// Common repositories that might be needed for any ticket
const COMMON_REPOS = [
  'euler-api-txns',
  'euler-api-customer',
  'euler-api-order',
  'euler-api-gateway',
  'euler-api-cards',
  'euler-api-pre-txn',
  'euler-api-token',
  'euler-api-dashboard',
  'offer-engine',
];

/**
 * Loads latest graphs from CODE_GRAPHS_DO_NOT_TOUCH for BUG_WORKFLOW
 * This ensures fresh graphs are available at the start of each ticket
 * Uses retry logic with 3-minute waits on failures
 */
const set_up_graph_server_latest = async (ticketId: string) => {
  logger.info(`📊 [BUG_WORKFLOW] Setting up graph server with latest graphs`);
  logger.info(`${ticketId}_set_up_graph_server_latest_1_input`, {
    ticketId,
    commonRepos: COMMON_REPOS,
  });

  const graphServerUrl = getGraphServerUrlForTicket(ticketId);
  logger.info(`🎯 Using graph server pod: ${graphServerUrl}`);
  logger.info(`${ticketId}_set_up_graph_server_latest_1_graphServerUrl`, { graphServerUrl });

  // Use the retry-enabled function that waits 3 minutes on failures
  const success = await ensureLatestGraphsLoaded(graphServerUrl, COMMON_REPOS);

  if (success) {
    logger.info(`✅ [BUG_WORKFLOW] All required graphs loaded successfully`);
    logger.info(`${ticketId}_set_up_graph_server_latest_1_output`, {
      loadedGraphs: COMMON_REPOS,
      failedGraphs: [],
    });
    return {
      loadedGraphs: COMMON_REPOS,
      failedGraphs: [],
    };
  } else {
    logger.error(`❌ [BUG_WORKFLOW] Failed to load graphs after retries`);
    logger.error(`${ticketId}_set_up_graph_server_latest_1_error`, {
      message: 'Failed to load graphs after retries',
      failedGraphs: COMMON_REPOS,
    });
    return {
      loadedGraphs: [],
      failedGraphs: COMMON_REPOS,
    };
  }
};
// Step IDs for bug workflow
export enum BugWorkflowSteps {
  SET_UP_GRAPH_SERVER_LATEST = 'set_up_graph_server_latest',
  EXPAND_PROBLEM_STATEMENT = 'expand_problem_statement',
  RCA_LOOP = 'RCA Loop',
  ROOT_CAUSE_ANALYSIS = 'Root Cause Analysis',
  COE_LOOP = 'COE Loop',
  CORRECTION_OF_ERROR = 'Correction of Error',
  MULTI_REPO_COE_LOOP = 'MultiRepoCOE Loop',
  MULTI_REPO_COE_ANALYSIS = 'Multi Repo COE Analysis',
  REPOSITORY_SETUP = 'repository_setup',
  CODE_FIX_REPOSITORIES = 'code_fix_repositories',
  CODE_FIX_LOOP = 'code_fix_loop',
  MAKING_AGENTIC_CODE_CHANGES = 'making_agentic_code_changes',
  VERIFY_BUILD = 'verify_build',
  VALIDATE_RESULTS = 'validate_results',
}

const expandProblemStatement = async (
  bugId: string,
  title: string,
  description: string,
  severity: string,
  imageAttachments?: ImageAttachment[]
) => {
  logger.info(`Starting Expand Problem Statement for ticket: ${bugId}`);
  logger.info(`${bugId}_expand_problem_statement_1_input`, { bugId, title, description, severity, imageCount: imageAttachments?.length });

  // Check if we should use mock analysis
  if (config.use_mock_analysis) {
    logger.info('Using MOCK Problem Statement expansion');
    logger.info(`${bugId}_expand_problem_statement_1_mock`, {
      message: 'Using MOCK Problem Statement expansion',
    });
    await new Promise((resolve) => setTimeout(resolve, 1000)); // Simulate processing time

    const mockProblemStatement = {
      expanded_problem: {
        llm_understanding:
          'The issue seems related to payment checkout timing out when multiple users attempt concurrent transactions.',
        expected_behavior:
          'The payment should complete successfully within expected response time under concurrent loads.',
        observed_behavior:
          'Some transactions fail or timeout intermittently when multiple users perform checkout simultaneously.',
        steps_to_reproduce:
          '1. Log in as 3 different users. 2. Attempt checkout simultaneously with same payment gateway. 3. Observe that one or more users encounter timeout or failure.',
        validation_steps_after_fix:
          '1. Repeat the concurrent checkout scenario after fix deployment. 2. Ensure all transactions complete without timeout. 3. Validate payment confirmations in backend logs.',
      },
    };

    const result = {
      problemStatement: mockProblemStatement.expanded_problem,
      problemStatementToolCalls: [],
      researchAgent: true,
    };
    logger.info(`${bugId}_expand_problem_statement_1_output`, result);
    return result;
  }

  try {
    const sessionId = await createChatSession(
      'Xyne - Expand Problem Statement',
      'f9d7a289-12d2-4794-a260-bedc5ae2e562'
    );
    const query = buildProblemStatementPrompt({ title, description, severity });
    const accumulatedResponse = await streamAgentResponse(
      sessionId,
      query,
      bugId,
      PROBLEM_STATEMENT_SYSTEM_PROMPT
    );
    logger.info('Expand Problem Statement Response: ', accumulatedResponse);
    logger.info(`${bugId}_expand_problem_statement_1_llm_response`, { accumulatedResponse });

    const jsonResponse = parseJsonResponse<{
      expanded_problem: {
        llm_understanding: string;
        expected_behavior: string;
        observed_behavior: string;
        steps_to_reproduce: string;
        validation_steps_after_fix: string;
      };
    }>(accumulatedResponse);

    const problemStatementToolCalls = await getSessionToolCalls(sessionId);
    logger.info(problemStatementToolCalls);
    logger.info(`${bugId}_expand_problem_statement_1_tool_calls`, { problemStatementToolCalls });

    const result = {
      problemStatement: jsonResponse.expanded_problem,
      problemStatementToolCalls,
      researchAgent: true,
    };
    logger.info(`${bugId}_expand_problem_statement_1_output`, result);
    return result;
  } catch (error) {
    logger.error('Error during Expand Problem Statement:', error);
    logger.error(`${bugId}_expand_problem_statement_1_error`, {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    if (error instanceof Error) {
      logger.error('Error message:', error.message);
      logger.error('Error stack:', error.stack);
    }
    throw error;
  }
};

export const researchAgentRCAanalysis = async (bugId: string, rcaPrompt: string) => {
  logger.info(`Starting RCA Analysis for ticket: ${bugId}`);
  logger.info(`${bugId}_rca_analysis_1_input`, { bugId, rcaPrompt });

  // Check if we should use mock analysis
  if (config.use_mock_analysis) {
    logger.info('Using MOCK RCA analysis');
    logger.info(`${bugId}_rca_analysis_1_mock`, { message: 'Using MOCK RCA analysis' });
    await new Promise((resolve) => setTimeout(resolve, 1000)); // Simulate processing time

    const mockRcaAnalysis = [
      {
        repo_name: 'euler-api-txns',
        function_name: 'server',
        module_name: 'Euler.API.Txns.Server',
        code_snippet: 'Just add a comment # we are testing',
        reason:
          'Mock reason: The system does not properly handle null user input, leading to a crash.',
        references: [],
        mermaid_diagram: '',
      },
    ];

    const result = {
      rca: mockRcaAnalysis,
      rcaToolCalls: [],
      rawResponse: undefined,
      researchAgent: true,
    };
    logger.info(`${bugId}_rca_analysis_1_output`, result);
    return result;
  }

  let rawResponse: string | undefined;
  try {
    const sessionId = await createChatSession(
      'Xyne - RCA Analysis',
      'f9d7a289-12d2-4794-a260-bedc5ae2e562'
    );

    const accumulatedResponse = await streamAgentResponse(
      sessionId,
      rcaPrompt,
      bugId,
      RCA_SYSTEM_PROMPT
    );
    rawResponse = accumulatedResponse;
    logger.info('RCA Response: ', accumulatedResponse);
    logger.info(`${bugId}_rca_analysis_1_llm_response`, { accumulatedResponse });

    const jsonResponse = parseJsonResponse<rcaResult>(accumulatedResponse);

    const rcaToolCalls = await getSessionToolCalls(sessionId);
    logger.info(`${bugId}_rca_analysis_1_tool_calls`, { rcaToolCalls });

    const result = {
      rca: jsonResponse,
      rcaToolCalls,
      rawResponse,
      researchAgent: true,
    };
    logger.info(`${bugId}_rca_analysis_1_output`, result);
    return result;
  } catch (error) {
    logger.error('Error during RCA analysis:', error);
    logger.error(`${bugId}_rca_analysis_1_error`, {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      rawResponse,
    });
    if (error instanceof Error) {
      logger.error('Error message:', error.message);
      logger.error('Error stack:', error.stack);
    }

    // Special handling: Don't modify retriable errors (let retry loop handle them)
    if (error instanceof Error && error.message.includes('Retriable error:')) {
      logger.info(`🔄 [RCA-RETRY] Letting retriable error bubble up to retry loop`);
      throw error; // Don't attach rawResponse - let retry loop handle it
    }

    // Re-throw with raw response attached for non-retriable errors
    const enhancedError = error as any;
    enhancedError.rawResponse = rawResponse;
    throw enhancedError;
  }
};

export const researchAgenCOEAnalysis = async (
  bugId: string,
  prompt: string,
  requiredRepos?: string[]
) => {
  logger.info(`Researching COE for bug: ${bugId}`);
  logger.info(`${bugId}_coe_analysis_1_input`, { bugId, prompt, requiredRepos });

  // Check if we should use mock analysis
  if (config.use_mock_analysis) {
    logger.info('Using MOCK COE analysis');
    logger.info(`${bugId}_coe_analysis_1_mock`, { message: 'Using MOCK COE analysis' });
    await new Promise((resolve) => setTimeout(resolve, 1000)); // Simulate processing time

    const mockCoeAnalysis = `# Correction of Error Analysis - MOCK Response`;
    const result = {
      coe: mockCoeAnalysis,
      coeToolCalls: [],
      researchAgent: true,
    };
    logger.info(`${bugId}_coe_analysis_1_output`, result);
    return result;
  }

  try {
    const sessionId = await createChatSession(
      'Xyne - COE Analysis',
      'f9d7a289-12d2-4794-a260-bedc5ae2e562'
    );

    const accumulatedResponse = await streamAgentResponse(
      sessionId,
      prompt,
      bugId,
      COE_SYSTEM_PROMPT,
      undefined,
      requiredRepos
    );
    logger.info('COE Response: ', accumulatedResponse);
    logger.info(`${bugId}_coe_analysis_1_llm_response`, { accumulatedResponse });

    const coeToolCalls = await getSessionToolCalls(sessionId);
    logger.info(`${bugId}_coe_analysis_1_tool_calls`, { coeToolCalls });

    const result = {
      coe: accumulatedResponse,
      coeToolCalls,
      researchAgent: true,
    };
    logger.info(`${bugId}_coe_analysis_1_output`, result);
    return result;
  } catch (error) {
    logger.error('Error during COE analysis:', error);
    logger.error(`${bugId}_coe_analysis_1_error`, {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
};

export const multiRepoCoeAnalysis = async (
  bugId: string,
  prompt: string,
  requiredRepos?: string[]
) => {
  logger.info(`Researching Multi Repo COE for bug: ${bugId}`);
  logger.info(`${bugId}_multi_repo_coe_analysis_1_input`, { bugId, prompt, requiredRepos });

  // Check if we should use mock analysis
  if (config.use_mock_analysis) {
    logger.info(`Using MOCK Multi Repo COA analysis`);
    logger.info(`${bugId}_multi_repo_coe_analysis_1_mock`, {
      message: 'Using MOCK Multi Repo COA analysis',
    });

    const mockMultiRepoCOAAnalysis = {
      repos: [
        {
          repo_name: 'euler-api-customer',
          module_name: 'Euler.Server',
          function_name: "eulerServer'",
          suggested_changes: "Add a comment '// Multi-repo test change'",
        },
      ],
    };

    await new Promise((resolve) => setTimeout(resolve, 1000)); // Simulate processing time

    const result = {
      multi_repo_coe_analysis: mockMultiRepoCOAAnalysis,
      multiRepoCoeToolCalls: [],
      rawResponse: undefined,
      researchAgent: true,
    };
    logger.info(`${bugId}_multi_repo_coe_analysis_1_output`, result);
    return result;
  }

  let rawResponse: string | undefined;
  try {
    const sessionId = await createChatSession(
      'Xyne - Multi Repo COE Analysis',
      'f9d7a289-12d2-4794-a260-bedc5ae2e562'
    );

    const accumulatedResponse = await streamAgentResponse(
      sessionId,
      prompt,
      bugId,
      REPO_COE_SYSTEM_PROMPT,
      undefined,
      requiredRepos
    );
    rawResponse = accumulatedResponse;
    logger.info('MultiRepoCEO Response: ', accumulatedResponse);
    logger.info(`${bugId}_multi_repo_coe_analysis_1_llm_response`, { accumulatedResponse });

    const jsonResponse = parseJsonResponse<multiRepoCoeResult>(accumulatedResponse);

    const multiRepoCoeToolCalls = await getSessionToolCalls(sessionId);
    logger.info(`${bugId}_multi_repo_coe_analysis_1_tool_calls`, { multiRepoCoeToolCalls });

    const result = {
      multi_repo_coe_analysis: jsonResponse,
      multiRepoCoeToolCalls,
      rawResponse,
      researchAgent: true,
    };
    logger.info(`${bugId}_multi_repo_coe_analysis_1_output`, result);
    return result;
  } catch (error) {
    logger.error('Error during Multi Repo COE analysis:', error);
    logger.error(`${bugId}_multi_repo_coe_analysis_1_error`, {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      rawResponse,
    });

    // Special handling: Don't modify retriable errors (let retry loop handle them)
    if (error instanceof Error && error.message.includes('Retriable error:')) {
      logger.info(`🔄 [COE-RETRY] Letting retriable error bubble up to retry loop`);
      throw error; // Don't attach rawResponse - let retry loop handle it
    }

    // Re-throw with raw response attached for non-retriable errors
    const enhancedError = error as any;
    enhancedError.rawResponse = rawResponse;
    throw enhancedError;
  }
};

const transformToGroupedFormat = (
  multiRepoAnalysis: multiRepoCoeResult
): groupedMultiRepoCoeResult => {
  const grouped: groupedMultiRepoCoeResult = {};

  for (const repo of multiRepoAnalysis.repos) {
    if (!grouped[repo.repo_name]) {
      grouped[repo.repo_name] = [];
    }
    grouped[repo.repo_name].push({
      module_name: repo.module_name,
      function_name: repo.function_name,
      suggested_changes: repo.suggested_changes,
    });
  }

  return grouped;
};

const repositorySetup = async (bugId: string, multiRepoAnalysis: groupedMultiRepoCoeResult) => {
  logger.info(`📦 [REPO-DEBUG] Starting repository detection and cloning for bug: ${bugId}`);
  logger.info(`${bugId}_repository_setup_1_input`, {
    bugId,
    repoCount: Object.keys(multiRepoAnalysis).length,
  });

  try {
    if (Object.keys(multiRepoAnalysis).length === 0) {
      throw new Error('Multi-repo analysis is not available or is empty.');
    }

    // Create working directory for all repos
    const workingDir = await mkdtemp(join(tmpdir(), `bug-${bugId}-`));
    logger.info(`📁 [REPO-SETUP] Created working directory: ${workingDir}`);
    logger.info(`${bugId}_repository_setup_1_working_dir`, { workingDir });

    const repositorySetups = [];
    const clonedRepos: {
      [key: string]: { path: string; branch: string; baseBranch: string; repoUrl: string };
    } = {};

    for (const repo_name of Object.keys(multiRepoAnalysis)) {
      const targetRepository = repo_name;
      const cloneUrl =
        targetRepository === 'euler-api-gateway'
          ? `ssh://git@github.com/example-org/euler-api-gateway.git`
          : `ssh://git@github.com/example-org/${targetRepository}.git`;

      const baseBranch = 'staging';
      logger.info('BaseBranch: ', baseBranch);
      logger.info(`${bugId}_repository_setup_1_repo_${repo_name}`, { baseBranch });
      // Create feature branch name for bug fix - hardcoded to EUL-0000 with ticket ID
      const jiraId = 'EUL-0000';
      logger.info(`Using JIRA ID for branch naming: ${jiraId}`);
      logger.info(`${bugId}_repository_setup_1_jira_id`, { jiraId });
      const branchName = `${jiraId}-bugfix-${bugId}-${targetRepository}-${randomUUID()}`;

      // Clone repository with retry logic
      const repoPath = join(workingDir, targetRepository);
      const MAX_CLONE_RETRIES = 3;
      const RETRY_DELAY_MS = 30000; // 30 seconds

      let cloneSuccess = false;
      for (let attempt = 1; attempt <= MAX_CLONE_RETRIES; attempt++) {
        try {
          logger.info(
            `📥 [REPO-SETUP] Cloning ${targetRepository} (attempt ${attempt}/${MAX_CLONE_RETRIES})...`
          );
          logger.info(`${bugId}_repository_setup_1_clone_attempt_${attempt}`, {
            targetRepository,
            attempt,
            maxRetries: MAX_CLONE_RETRIES,
          });

          await new Promise<void>((resolve, reject) => {
            const cloneProcess = spawn('git', ['clone', cloneUrl, repoPath], {
              stdio: ['inherit', 'pipe', 'pipe'],
            });

            cloneProcess.stdout?.on('data', (data) => {
              logger.info(`[GIT CLONE ${targetRepository}] ${data.toString().trim()}`);
              logger.info(`${bugId}_repository_setup_1_git_clone_stdout`, {
                targetRepository,
                output: data.toString().trim(),
              });
            });

            cloneProcess.stderr?.on('data', (data) => {
              logger.info(`[GIT CLONE ${targetRepository}] ${data.toString().trim()}`);
              logger.info(`${bugId}_repository_setup_1_git_clone_stderr`, {
                targetRepository,
                output: data.toString().trim(),
              });
            });

            cloneProcess.on('close', (code) => {
              if (code === 0) resolve();
              else reject(new Error(`Git clone failed with code ${code}`));
            });
          });

          cloneSuccess = true;
          logger.info(`✅ [REPO-SETUP] Clone successful for ${targetRepository}`);
          logger.info(`${bugId}_repository_setup_1_clone_success`, { targetRepository, attempt });
          break; // Success - exit retry loop
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.error(
            `❌ [REPO-SETUP] Clone attempt ${attempt}/${MAX_CLONE_RETRIES} failed for ${targetRepository}: ${errorMessage}`
          );
          logger.error(`${bugId}_repository_setup_1_clone_error`, {
            targetRepository,
            attempt,
            maxRetries: MAX_CLONE_RETRIES,
            error: errorMessage,
          });

          if (attempt < MAX_CLONE_RETRIES) {
            logger.info(`⏳ [REPO-SETUP] Waiting 30 seconds before retry...`);
            logger.info(`${bugId}_repository_setup_1_retry_wait`, { waitSeconds: 30 });
            await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
          } else {
            throw new Error(
              `Failed to clone ${targetRepository} after ${MAX_CLONE_RETRIES} attempts: ${errorMessage}`
            );
          }
        }
      }

      if (!cloneSuccess) {
        throw new Error(`Failed to clone ${targetRepository} after ${MAX_CLONE_RETRIES} attempts`);
      }

      // Create and checkout feature branch from origin/baseBranch
      logger.info(`🔀 [REPO-SETUP] Creating branch ${branchName} from origin/${baseBranch}...`);
      logger.info(`${bugId}_repository_setup_1_create_branch`, { branchName, baseBranch });

      await new Promise<void>((resolve, reject) => {
        const checkoutProcess = spawn(
          'git',
          ['checkout', '-b', branchName, `origin/${baseBranch}`],
          {
            cwd: repoPath,
            stdio: ['inherit', 'pipe', 'pipe'],
          }
        );

        checkoutProcess.stdout?.on('data', (data) => {
          logger.info(`[GIT CHECKOUT ${targetRepository}] ${data.toString().trim()}`);
          logger.info(`${bugId}_repository_setup_1_git_checkout_stdout`, {
            targetRepository,
            output: data.toString().trim(),
          });
        });

        checkoutProcess.stderr?.on('data', (data) => {
          logger.info(`[GIT CHECKOUT ${targetRepository}] ${data.toString().trim()}`);
          logger.info(`${bugId}_repository_setup_1_git_checkout_stderr`, {
            targetRepository,
            output: data.toString().trim(),
          });
        });

        checkoutProcess.on('close', (code) => {
          if (code === 0) resolve();
          else
            reject(
              new Error(
                `Git checkout failed with code ${code}. Branch: ${branchName}, Base: origin/${baseBranch}`
              )
            );
        });
      });

      logger.info(`✅ [REPO-SETUP] ${targetRepository} cloned successfully`);
      logger.info(`${bugId}_repository_setup_1_repo_ready`, { targetRepository, branchName });

      repositorySetups.push({
        targetRepository: targetRepository,
        repoUrl: cloneUrl,
        branch: branchName,
        baseBranch: baseBranch,
      });

      clonedRepos[targetRepository] = {
        path: repoPath,
        branch: branchName,
        baseBranch: baseBranch,
        repoUrl: cloneUrl,
      };
    }

    const result = { repositorySetups, clonedRepos, workingDir };
    logger.info(`${bugId}_repository_setup_1_output`, {
      repoCount: repositorySetups.length,
      workingDir,
    });
    return result;
  } catch (error) {
    logger.error('Repository setup failed:', error);
    logger.error(`${bugId}_repository_setup_1_error`, {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
};


/**
 * Helper function to strip ANSI escape codes from terminal output
 * This makes the output readable in web UIs while keeping all the text
 */
function createXyneCliAgenticConfig(
  bugId: string,
  title: string,
  repository: string,
  changes: string,
  repoUrl: string,
  repoBranch: string,
  baseBranch: string,
  getPrLink: PrLinkGenerator,
  imageAttachments?: ImageAttachment[],
  buildErrors?: string
): { agentName: string; config: AgenticCheckpointConfig } {
  let userMessage = `Implement the following bug fix for repository "${repository}":

# BUG INFORMATION
- Bug ID: ${bugId}
- Title: ${title}

# REQUIRED CHANGES
${changes}

# INSTRUCTIONS
Please implement the necessary code changes as described above. Use the file_writer tool to make changes. Ensure the code is production-ready and follows existing coding standards.`;

  if (buildErrors) {
    userMessage += `\n\n# PREVIOUS BUILD FAILED
The previous attempt resulted in build errors. Please fix the following errors:
\`\`\`
${buildErrors}
\`\`\`

IMPORTANT INSTRUCTIONS:
1. ONLY fix compilation ERRORS (lines starting with "error:")
2. IGNORE all warnings - do NOT attempt to fix:
   - Warnings about "Please enable these extensions"
   - Nix configuration warnings (trusted users, direnv, etc.)
   - "ld: warning" messages
   - "HsParTy" messages
   - Any other warnings
3. Focus exclusively on actual compilation failures that prevent the build
4. Look for lines with "error:" to identify what needs to be fixed

Analyze the ERRORS carefully (not warnings) and make the necessary corrections.
After making all changes, provide a summary of what you changed.`;
  }

  return {
    agentName: 'bug-fix-engineer',
    config: {
      conversationContext: {
        messages: [
          createUserMessage(userMessage, imageAttachments ? { attachments: imageAttachments } : undefined)
        ],
      },
      repoInfo: {
        repoUrl,
        repoBranch: repoBranch,
        baseBranch: baseBranch,
        repository: repository,
        getCommitMessage: (raw_commit_message) => {
          return 'EUL-0000 ' + raw_commit_message;
        },
        getPrLink: getPrLink,
      },
    },
  };
}

const validateResults = async (
  codeFixesResults: CodeFixResult[],
  repositorySetups: any[],
  failureInfo?: { step: string; reason: string; rawResponse?: string }
) => {
  logger.info('Validating workflow results and generating PR links...');
  logger.info('validate_results_1_input', {
    resultCount: codeFixesResults.length,
    setupCount: repositorySetups.length,
    hasFailureInfo: !!failureInfo,
  });

  // If workflow failed before code generation, show failure information
  if (failureInfo) {
    logger.info(`❌ [VALIDATION] Workflow failed at step: ${failureInfo.step}`);
    logger.error('validate_results_1_workflow_failed', failureInfo);

    const failureResponse: any = {
      workflowStatus: 'FAILED',
      failureStep: failureInfo.step,
      failureReason: failureInfo.reason,
      totalRepositories: 0,
      successfulRepositories: 0,
      failedRepositories: 0,
    };

    // If raw LLM response is available, include it
    if (failureInfo.rawResponse) {
      failureResponse.rawLlmResponse = failureInfo.rawResponse;
      logger.info(
        `📋 [VALIDATION] Including raw LLM response in validation output (${failureInfo.rawResponse.length} characters)`
      );
      logger.info('validate_results_1_raw_response_included', {
        responseLength: failureInfo.rawResponse.length,
      });
    }

    logger.info('validate_results_1_output', failureResponse);
    return failureResponse;
  }

  const successfulFixes = codeFixesResults.filter((fix) => fix.success && fix.latestCommit);
  const failedFixes = codeFixesResults.filter((fix) => !fix.success || !fix.latestCommit);

  // Generate repository details with PR links for successful fixes
  const repositoryDetails: { [key: string]: any } = {};

  for (const fix of codeFixesResults) {
    const { repository, success, latestCommit, branchName, error } = fix;
    const repoInfo = repoIdMap[repository as keyof typeof repoIdMap];

    if (!repoInfo) {
      repositoryDetails[repository] = {
        status: 'CONFIG_ERROR',
        error: `Repository ${repository} not found in repoIdMap`,
        branch: branchName,
        commit: latestCommit,
      };
      logger.info(`❌ [VALIDATION] Repository ${repository} not found in repoIdMap`);
      logger.error('validate_results_1_repo_not_found', { repository });
      continue;
    }

    if (!success || !latestCommit) {
      repositoryDetails[repository] = {
        status: 'FAILED',
        error: error || 'Code generation failed',
        branch: branchName,
      };
      logger.info(`❌ [VALIDATION] ${repository}: Failed - ${error || 'Unknown error'}`);
      logger.error('validate_results_1_repo_failed', {
        repository,
        error: error || 'Unknown error',
      });
      continue;
    }

    // Find the base branch for this repository from repositorySetups
    const repoSetup = repositorySetups.find((setup) => setup.targetRepository === repository);
    const baseBranch = repoSetup?.baseBranch || 'staging';

    const { projectId } = repoInfo;

    // Generate PR link comparing feature branch (with commit) to base branch
    const pr_link = `https://bitbucket.example.com/projects/${projectId}/repos/${repository}/compare/commits?sourceBranch=${latestCommit}&targetBranch=${baseBranch}`;

    repositoryDetails[repository] = {
      status: 'SUCCESS',
      pr_link,
      branch: branchName,
      commit: latestCommit,
      base_branch: baseBranch,
    };
    logger.info(`✅ [VALIDATION] ${repository}: PR link generated - ${pr_link}`);
    logger.info('validate_results_1_pr_link_generated', { repository, pr_link });
  }

  const validationSummary = {
    workflowStatus: 'SUCCESS',
    totalRepositories: codeFixesResults.length,
    successfulRepositories: successfulFixes.length,
    failedRepositories: failedFixes.length,
    successRate:
      codeFixesResults.length > 0
        ? `${Math.round((successfulFixes.length / codeFixesResults.length) * 100)}%`
        : '0%',
    repositoryDetails,
  };

  logger.info(
    `✅ [VALIDATION] Results validated: ${successfulFixes.length}/${codeFixesResults.length} repositories successful`
  );
  logger.info('validate_results_1_output', validationSummary);

  return validationSummary;
};

export const extractLastMessageContent = (result: ConversationResult): string => {
  const lastMessage = result.messages[result.messages.length - 1];
  return lastMessage?.content || 'No content generated';
};

const BugWorkflowInputSchema = z.object({
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
  imageAttachments: z.array(z.object({
    id: z.string(),
    type: z.literal('image'),
    data: z.string(),
    mimeType: z.string(),
    name: z.string(),
  })).optional(),
});

const bugWorkflowContextMapper = (
  payload: z.infer<typeof BugWorkflowInputSchema> & { ticketId: string }
): BugWorkflowContext => ({
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
  imageAttachments: payload.imageAttachments,
});

export const bugWorkflow: WorkflowDefinition<
  BugWorkflowContext,
  { results: CodeFixResult[]; failureInfo?: { step: string; reason: string; details?: any }; gitInfo?: GitInfo },
  typeof BugWorkflowSteps
> = {
  type: WorkflowType.BUG_WORKFLOW,
  name: 'Bug Workflow',
  description:
    'Complete bug resolution workflow including analysis, coding, testing, and deployment',
  inputSchema: BugWorkflowInputSchema,
  contextMapper: bugWorkflowContextMapper,

  async execute(engine: WorkflowEngine<BugWorkflowContext, typeof BugWorkflowSteps>): Promise<{
    results: CodeFixResult[];
    failureInfo?: { step: string; reason: string; details?: any };
    gitInfo?: GitInfo;
  }> {
    const context = engine.getContext();
    const { bugId, title, description, severity, imageAttachments } = context;

    let codeFixesResults: CodeFixResult[] = [];
    let repositorySetups: any[] = [];
    let workflowFailureInfo: { step: string; reason: string } | undefined = undefined;
    let workingDir: string | undefined = undefined;

    try {
      // Load latest graphs at the start of workflow
      const graphSetupResult = await engine.createCheckpoint(
        BugWorkflowSteps.SET_UP_GRAPH_SERVER_LATEST,
        set_up_graph_server_latest,
        bugId
      );

      if (!graphSetupResult || graphSetupResult.loadedGraphs.length === 0) {
        logger.warn('⚠️  No graphs were loaded - workflow may fail at analysis steps');
        logger.warn(`${bugId}_execute_1_no_graphs_loaded`, {
          message: 'No graphs were loaded - workflow may fail at analysis steps',
        });
      } else {
        logger.info(
          `✅ [VALIDATION] Successfully loaded ${graphSetupResult.loadedGraphs.length} latest graphs`
        );
        logger.info(`${bugId}_execute_1_graphs_loaded`, {
          loadedCount: graphSetupResult.loadedGraphs.length,
        });
      }

      const problemStatementResult = await engine.createCheckpoint(
        BugWorkflowSteps.EXPAND_PROBLEM_STATEMENT,
        expandProblemStatement,
        bugId,
        title,
        description,
        severity,
        imageAttachments
      );

      let rcaResult: { rca: rcaResult; rcaToolCalls: any[] } | undefined;
      const formattedProblemStatement = formatObjectToString(
        problemStatementResult.problemStatement
      );
      let rcaPrompt = buildRCAPrompt({ title, description: formattedProblemStatement, severity });

      await engine.createWhileLoop(
        BugWorkflowSteps.RCA_LOOP,
        3,
        async (
          iteration: number,
          scopedEngine: WorkflowEngine<BugWorkflowContext, typeof BugWorkflowSteps>
        ) => {
          logger.info(`🔄 Attempt ${iteration + 1}/3 for RCA`);
          logger.info(`${bugId}_rca_loop_iteration_${iteration + 1}`, {
            iteration: iteration + 1,
            maxAttempts: 3,
          });

          // Handle retriable errors (exit_code 300) with retry logic
          let result;
          try {
            result = await scopedEngine.createCheckpoint(
              BugWorkflowSteps.ROOT_CAUSE_ANALYSIS,
              researchAgentRCAanalysis,
              bugId,
              rcaPrompt
            );
          } catch (error) {
            if (error instanceof Error && error.message.includes('Retriable error:')) {
              logger.info(
                `🔄 [RCA-LOOP] Caught retriable error on attempt ${iteration + 1}/3: ${error.message}`
              );
              logger.info(`${bugId}_rca_loop_retriable_error`, {
                iteration: iteration + 1,
                error: error.message,
              });
              return LoopControl.CONTINUE; // Retry with the same prompt
            }
            // Re-throw non-retriable errors
            throw error;
          }

          const repos: { [key: string]: { modules: string[]; functions: string[] } } = {};
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
            logger.info(`${bugId}_rca_loop_cross_verify_failed`, {
              iteration: iteration + 1,
              feedback: allCrossVerifyFeedback,
            });
            rcaPrompt += `\n\nPrevious attempt failed. Please correct the following errors:\n${allCrossVerifyFeedback}`;
            return LoopControl.CONTINUE;
          }

          rcaResult = result;
          return LoopControl.BREAK;
        }
      );

      if (!rcaResult) {
        const error = new Error(
          'RCA analysis failed after 3 attempts due to empty tool responses or cross-verification failures'
        );
        error.name = 'RCAAnalysisError';
        throw error;
      }

      // Validate RCA results are not empty
      if (!rcaResult.rca || rcaResult.rca.length === 0) {
        const error = new Error('RCA analysis completed but returned empty results');
        error.name = 'RCAAnalysisError';
        throw error;
      }
      logger.info(`✅ [VALIDATION] RCA analysis successful with ${rcaResult.rca.length} findings`);
      logger.info(`${bugId}_execute_1_rca_success`, { findingsCount: rcaResult.rca.length });

      // Extract required repos from RCA for graph availability checks
      const requiredRepos = [...new Set(rcaResult.rca.map((item) => item.repo_name))];
      logger.info(`[BUG_WORKFLOW] Required repos identified from RCA: ${requiredRepos.join(', ')}`);
      logger.info(`${bugId}_execute_1_required_repos`, { requiredRepos });

      let coeResult: { coe: string; coeToolCalls: any[] } | undefined;
      const formattedRca = rcaResult?.rca
        .map((item) => formatObjectToString(item))
        .join('\n\n---\n\n');
      const coePrompt = buildCOEPrompt({
        title,
        description: formattedProblemStatement,
        severity,
        rca: formattedRca,
      });

      await engine.createWhileLoop(
        BugWorkflowSteps.COE_LOOP,
        3,
        async (
          iteration: number,
          scopedEngine: WorkflowEngine<BugWorkflowContext, typeof BugWorkflowSteps>
        ) => {
          logger.info(`🔄 Attempt ${iteration + 1}/3 for COE`);
          logger.info(`${bugId}_coe_loop_iteration_${iteration + 1}`, {
            iteration: iteration + 1,
            maxAttempts: 3,
          });

          const result = await scopedEngine.createCheckpoint(
            BugWorkflowSteps.CORRECTION_OF_ERROR,
            researchAgenCOEAnalysis,
            bugId,
            coePrompt,
            requiredRepos
          );

          const shouldRetry =
            result.coeToolCalls &&
            result.coeToolCalls.length > 0 &&
            result.coeToolCalls.every((call: any) => {
              const response = call.tool_response;
              return (
                response === null ||
                response === '' ||
                (Array.isArray(response) && response.length === 0)
              );
            });

          if (shouldRetry) {
            logger.info(
              `COE analysis resulted in empty tool responses. Retrying... Attempt ${iteration + 2}`
            );
            logger.info(`${bugId}_coe_loop_empty_response`, { iteration: iteration + 1 });
            await new Promise((resolve) => setTimeout(resolve, 1000));
            return LoopControl.CONTINUE;
          } else {
            coeResult = result;
            return LoopControl.BREAK;
          }
        }
      );

      if (!coeResult) {
        const error = new Error('COE analysis failed after 3 attempts due to empty tool responses');
        error.name = 'COEAnalysisError';
        throw error;
      }

      // Validate COE results are not empty
      if (!coeResult.coe || coeResult.coe.trim() === '') {
        const error = new Error('COE analysis completed but returned empty content');
        error.name = 'COEAnalysisError';
        throw error;
      }
      logger.info(`✅ [VALIDATION] COE analysis successful`);
      logger.info(`${bugId}_execute_1_coe_success`, { message: 'COE analysis successful' });

      let multiRepoCoeResult:
        | { multi_repo_coe_analysis: multiRepoCoeResult; multiRepoCoeToolCalls: any[] }
        | undefined;
      const coe = coeResult?.coe;
      let multRepoCoePrompt = buildRepoCOEPrompt({
        title,
        description: formattedProblemStatement,
        severity,
        rca: formattedRca,
        coe: coe,
      });

      await engine.createWhileLoop(
        BugWorkflowSteps.MULTI_REPO_COE_LOOP,
        3,
        async (
          iteration: number,
          scopedEngine: WorkflowEngine<BugWorkflowContext, typeof BugWorkflowSteps>
        ) => {
          logger.info(`🔄 Attempt ${iteration + 1}/3 for MultRepoCoeAnalysis`);
          logger.info(`${bugId}_multi_repo_coe_loop_iteration_${iteration + 1}`, {
            iteration: iteration + 1,
            maxAttempts: 3,
          });

          // Handle retriable errors (exit_code 300/302) with retry logic
          let result;
          try {
            result = await scopedEngine.createCheckpoint(
              BugWorkflowSteps.MULTI_REPO_COE_ANALYSIS,
              multiRepoCoeAnalysis,
              bugId,
              multRepoCoePrompt,
              requiredRepos
            );
          } catch (error) {
            if (error instanceof Error && error.message.includes('Retriable error:')) {
              logger.info(
                `🔄 [COE-LOOP] Caught retriable error on attempt ${iteration + 1}/3: ${error.message}`
              );
              logger.info(`${bugId}_multi_repo_coe_loop_retriable_error`, {
                iteration: iteration + 1,
                error: error.message,
              });
              return LoopControl.CONTINUE; // Retry with the same prompt
            }
            // Re-throw non-retriable errors
            throw error;
          }

          const repos: { [key: string]: { modules: string[]; functions: string[] } } = {};
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
            logger.info(
              `Multi-repo COE analysis failed cross-verification. Retrying with feedback...`
            );
            logger.info(`${bugId}_multi_repo_coe_loop_cross_verify_failed`, {
              iteration: iteration + 1,
              feedback: allCrossVerifyFeedback,
            });
            multRepoCoePrompt += `\n\nPrevious attempt failed. Please correct the following errors:\n${allCrossVerifyFeedback}`;
            return LoopControl.CONTINUE;
          }

          multiRepoCoeResult = result;
          return LoopControl.BREAK;
        }
      );

      if (!multiRepoCoeResult) {
        const error = new Error(
          'Multi-repo COE analysis failed after 3 attempts due to empty tool responses or cross-verification failures'
        );
        error.name = 'MultiRepoCOEAnalysisError';
        throw error;
      }

      // Validate multi-repo COE results are not empty
      if (
        !multiRepoCoeResult.multi_repo_coe_analysis ||
        !multiRepoCoeResult.multi_repo_coe_analysis.repos ||
        multiRepoCoeResult.multi_repo_coe_analysis.repos.length === 0
      ) {
        const error = new Error(
          'Multi-repo COE analysis completed but returned no repository changes'
        );
        error.name = 'MultiRepoCOEAnalysisError';
        throw error;
      }
      logger.info(
        `✅ [VALIDATION] Multi-repo COE analysis successful with ${multiRepoCoeResult.multi_repo_coe_analysis.repos.length} repositories`
      );
      logger.info(`${bugId}_execute_1_multi_repo_coe_success`, {
        repoCount: multiRepoCoeResult.multi_repo_coe_analysis.repos.length,
      });

      const multi_repo_coe_analysis = transformToGroupedFormat(
        multiRepoCoeResult.multi_repo_coe_analysis
      );
      const repoSetupResult = await engine.createCheckpoint(
        BugWorkflowSteps.REPOSITORY_SETUP,
        repositorySetup,
        bugId,
        multi_repo_coe_analysis
      );

      // Xyne Code Fixes with Retry Loop - Now using createWhileLoop for visible retry logic
      const repositorySetups = repoSetupResult.repositorySetups || [];
      const clonedRepos = repoSetupResult.clonedRepos || {};
      workingDir = repoSetupResult.workingDir;
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
      logger.info(
        `✅ [VALIDATION] Repository setup successful for ${repositorySetups.length} repositories`
      );
      logger.info(`${bugId}_execute_1_repo_setup_success`, { repoCount: repositorySetups.length });

      // Configuration: Maximum number of retry attempts for build failures
      const MAX_BUILD_RETRY_ATTEMPTS = 10;

      // Process each repository
      await engine.createWhileLoop(
        BugWorkflowSteps.CODE_FIX_REPOSITORIES,
        repositorySetups.length,
        async (
          iteration: number,
          scopedEngine: WorkflowEngine<BugWorkflowContext, typeof BugWorkflowSteps>
        ) => {
          const repoSetup = repositorySetups[iteration];
          const repoInfo = multiRepoAnalysis[repoSetup.targetRepository];
          if (!repoInfo) {
            logger.warn(`No changes specified for ${repoSetup.targetRepository}. Skipping.`);
            logger.warn(`${bugId}_code_fix_no_changes`, { repository: repoSetup.targetRepository });
            return LoopControl.CONTINUE;
          }

          const { targetRepository } = repoSetup;
          logger.info(`🎯 [XYNE-DEBUG] Processing repository: ${targetRepository}`);
          logger.info(`${bugId}_code_fix_processing_repo`, { targetRepository });

          let buildErrorFeedback = '';
          let repoSuccess = false;

          // Retry loop for this repository
          // IMPORTANT: Use unique loop ID per repository to avoid conflicts

          try {
            await scopedEngine.createWhileLoop(
              BugWorkflowSteps.CODE_FIX_LOOP,
              MAX_BUILD_RETRY_ATTEMPTS,
              async (
                iteration: number,
                scopedEngine: WorkflowEngine<BugWorkflowContext, typeof BugWorkflowSteps>
              ) => {
                const suggested_change_instruction = repoInfo.reduce((acc, value) => {
                  const changes =
                    value.module_name + '\n' + value.function_name + '\n' + value.suggested_changes;
                  return acc + '\n\n' + changes;
                }, '');

                const targetRepoInfo = repoIdMap[targetRepository as keyof typeof repoIdMap];
                const projectId = targetRepoInfo?.projectId || '';

                // Create PR link generator callback for this repository
                const getPrLinkCallback = (params: {
                  commitHash: string;
                  baseBranch: string;
                  repository: string;
                }) => {
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
                  scopedEngine.getContext().imageAttachments,
                  buildErrorFeedback
                );

                // Execute as agentic checkpoint - this will show as "agentic" in frontend!
                const agenticResult = await scopedEngine.createAgenticCheckpoint(
                  BugWorkflowSteps.MAKING_AGENTIC_CODE_CHANGES,
                  agenticConfig.agentName,
                  agenticConfig.config
                );

                // Check if commit was successful
                logger.info('latestCommit: ', agenticResult.gitInfo.commitHash);
                logger.info(`${bugId}_code_fix_commit_hash`, {
                  targetRepository,
                  commitHash: agenticResult.gitInfo.commitHash,
                });
                if (!agenticResult.gitInfo.commitHash) {
                  logger.info('codingAgent cant push changes so retry started...');
                  logger.warn(`${bugId}_code_fix_no_commit`, {
                    targetRepository,
                    iteration: iteration + 1,
                  });
                  return LoopControl.CONTINUE;
                }

                // CRITICAL: Pull the committed changes into our cloned directory
                // The agentic agent works in its own directory, so we need to fetch the changes
                logger.info(`📥 [CODE-SYNC] Fetching committed changes into build directory...`);
                logger.info(`${bugId}_code_fix_pull_start`, { targetRepository });
                const clonedRepo = clonedRepos[targetRepository];
                if (clonedRepo) {
                  try {
                    await new Promise<void>((resolve, reject) => {
                      const gitPull = spawn('git', ['pull', 'origin', repoSetup.branch], {
                        cwd: clonedRepo.path,
                        stdio: ['inherit', 'pipe', 'pipe'],
                      });

                      gitPull.stdout?.on('data', (data) => {
                        logger.info(`[GIT PULL ${targetRepository}] ${data.toString().trim()}`);
                        logger.info(`${bugId}_code_fix_pull_stdout`, {
                          targetRepository,
                          output: data.toString().trim(),
                        });
                      });

                      gitPull.stderr?.on('data', (data) => {
                        logger.info(`[GIT PULL ${targetRepository}] ${data.toString().trim()}`);
                        logger.info(`${bugId}_code_fix_pull_stderr`, {
                          targetRepository,
                          output: data.toString().trim(),
                        });
                      });

                      gitPull.on('close', (code) => {
                        if (code === 0) {
                          logger.info(
                            `✅ [CODE-SYNC] Successfully pulled changes for ${targetRepository}`
                          );
                          logger.info(`${bugId}_code_fix_pull_success`, { targetRepository });
                          resolve();
                        } else {
                          logger.error(`${bugId}_code_fix_pull_failed`, { targetRepository, code });
                          reject(new Error(`Git pull failed with code ${code}`));
                        }
                      });
                    });
                  } catch (pullError) {
                    logger.error(`❌ [CODE-SYNC] Failed to pull changes:`, pullError);
                    logger.error(`${bugId}_code_fix_pull_error`, {
                      targetRepository,
                      error: pullError instanceof Error ? pullError.message : String(pullError),
                    });
                    throw pullError;
                  }
                }

                // Extract user description (original problem from frontend)
                const user_description = description || title || 'No description provided';

                // Extract full code changes summary from the last assistant message
                const lastAssistantMsg = agenticResult.result.messages
                  .filter((msg) => msg.type === 'assistant')
                  .pop();

                const full_codeChangesSummary = lastAssistantMsg?.content || 'No summary available';

                // Save for next retry attempt (if needed)
                // let previousAttemptSummary = full_codeChangesSummary Need to check where to add this

                // Verify build after code generation using a deterministic checkpoint
                // Wrap in try/catch to handle build failures and enable retry logic
                try {
                  // Get the cloned repo path for explicit parameter passing
                  const clonedRepo = clonedRepos[targetRepository];
                  if (!clonedRepo) {
                    throw new Error(`Cloned repository path not found for ${targetRepository}`);
                  }

                  // Call the named checkpoint function with explicit parameters
                  // This makes inputs/outputs visible in the UI
                  // const buildResult = await scopedEngine.createCheckpoint(
                  //   BugWorkflowSteps.VERIFY_BUILD,
                  //   verifyBuild,
                  //   targetRepository,
                  //   clonedRepo.path
                  // )

                  // Extract error feedback from build result if build failed
                  // (though verifyBuild throws on failure, this is for clarity)
                  // logger.info(`✅ [BUILD-CHECK] Build verified for ${targetRepository}:`, buildResult)
                  // logger.info(`${bugId}_code_fix_build_verified`, { targetRepository, buildResult });

                  // If we reach here, build was successful
                  codeFixesResults.push({
                    repository: targetRepository,
                    success: true,
                    branchName: repoSetup.branch,
                    executedAt: new Date().toISOString(),
                    userDescription: user_description,
                    codeChangesSummary: full_codeChangesSummary,
                    latestCommit: agenticResult.gitInfo.commitHash,
                    gitDiff: agenticResult.gitInfo.gitDiff,
                    diffStats: agenticResult.gitInfo.diffStats,
                  });
                  repoSuccess = true;
                  logger.info(
                    `✅ [VALIDATION] ${targetRepository}: Code generation and build successful`
                  );
                  logger.info(`${bugId}_code_fix_success`, { targetRepository });
                  return LoopControl.BREAK; // Success - stop retrying!
                } catch (error) {
                  // Build failed - extract error message for next retry
                  const errorMessage = error instanceof Error ? error.message : String(error);
                  buildErrorFeedback = errorMessage;
                  logger.error(`❌ [BUILD-CHECK] Build failed with error: ${errorMessage}`);

                  // Check if we should retry
                  if (iteration < MAX_BUILD_RETRY_ATTEMPTS - 1) {
                    logger.info(
                      `🔄 [BUILD-CHECK] Retrying with error feedback... (attempt ${iteration + 2}/${MAX_BUILD_RETRY_ATTEMPTS})`
                    );
                    return LoopControl.CONTINUE; // Continue to next attempt with error feedback
                  } else {
                    // Last attempt failed - break and record failure
                    logger.error(
                      `❌ [BUILD-CHECK] All ${MAX_BUILD_RETRY_ATTEMPTS} attempts exhausted for ${targetRepository}`
                    );
                    return LoopControl.BREAK; // Stop after max attempts
                  }
                }
              }
            );
          } catch (loopError) {
            logger.error(`Error in loop for ${targetRepository}:`, loopError);
            logger.error(`${bugId}_code_fix_loop_error`, {
              targetRepository,
              error: loopError instanceof Error ? loopError.message : String(loopError),
            });
            // Don't throw - let the workflow continue to record the failure
          }

          // If all retries failed, record the failure
          if (!repoSuccess) {
            logger.error(
              `❌ [VALIDATION] ${targetRepository}: All ${MAX_BUILD_RETRY_ATTEMPTS} attempts failed`
            );
            logger.error(`${bugId}_code_fix_all_failed`, { targetRepository });
            codeFixesResults.push({
              repository: targetRepository,
              success: false,
              error: buildErrorFeedback || 'All retry attempts exhausted',
              executedAt: new Date().toISOString(),
            });
          }
          return LoopControl.CONTINUE; // Success!
        }
      );

      // Validate that at least some code fixes were successful
      const successfulFixes = codeFixesResults.filter((fix) => fix.success && fix.latestCommit);
      if (codeFixesResults.length > 0 && successfulFixes.length === 0) {
        const failedRepos = codeFixesResults
          .map((fix) => `${fix.repository}: ${fix.error || 'Unknown error'}`)
          .join('; ');

        const error = new Error(
          `All ${codeFixesResults.length} repositories failed code generation/commit - ${failedRepos}`
        );
        error.name = 'CodeGenerationError';
        throw error;
      }

      // Store results in context (this would normally be done via state management)
      logger.info(`📊 [XYNE-DEBUG] Code fixes completed. Results:`, codeFixesResults);
      logger.info(`${bugId}_execute_1_code_fixes_completed`, {
        totalRepos: codeFixesResults.length,
        successCount: successfulFixes.length,
      });
      logger.info(
        `✅ [VALIDATION] Successfully completed ${successfulFixes.length}/${codeFixesResults.length} repositories`
      );
      logger.info(`${bugId}_execute_1_validation_complete`, {
        successCount: successfulFixes.length,
        totalCount: codeFixesResults.length,
      });
      logger.info(
        `📊 [XYNE-DEBUG] Repository branches already saved in repository_setup checkpoint`
      );
      logger.info(`🎉 [WORKFLOW-DEBUG] Bug workflow completed successfully for ${bugId}`);
      logger.info(`${bugId}_execute_1_workflow_success`, { bugId });
    } catch (error) {
      logger.error(`❌ [WORKFLOW-DEBUG] Bug workflow failed for ${bugId}:`, error);
      logger.error(`${bugId}_execute_1_workflow_failed`, {
        bugId,
        error: error instanceof Error ? error.message : String(error),
      });

      // Enhanced error detection to identify which step failed
      let step = 'WORKFLOW_EXCEPTION';
      let reason = `Unexpected workflow error: ${error instanceof Error ? error.message : 'Unknown error'}`;
      let rawResponse: string | undefined = undefined;

      if (error instanceof Error) {
        logger.error(`❌ [WORKFLOW-DEBUG] Error message: ${error.message}`);
        logger.error(`❌ [WORKFLOW-DEBUG] Error stack: ${error.stack}`);
        logger.error(`${bugId}_execute_1_error_details`, {
          message: error.message,
          stack: error.stack,
        });

        // Extract raw response if attached to error
        const enhancedError = error as any;
        if (enhancedError.rawResponse) {
          rawResponse = enhancedError.rawResponse;
          logger.error(`❌ [WORKFLOW-DEBUG] Raw LLM Response:`);
          logger.error('━'.repeat(80));
          logger.error(rawResponse);
          logger.error('━'.repeat(80));
        }

        // Detect specific failure steps based on error name and stack trace
        const stack = error.stack || '';
        const errorName = error.name || '';

        if (
          errorName === 'RCAAnalysisError' ||
          stack.includes('researchAgentRCAanalysis') ||
          stack.includes('RCA')
        ) {
          step = 'RCA_ANALYSIS';
          reason = error.message;
          logger.error(`❌ [VALIDATION] Failed at step: ${step} - ${reason}`);
          logger.error(`${bugId}_execute_1_step_failed`, { step, reason });

          // Note: RCA already has built-in 3-attempt retry logic, so this failure represents exhausted retries
        } else if (
          errorName === 'COEAnalysisError' ||
          stack.includes('researchAgenCOEAnalysis') ||
          stack.includes('COE')
        ) {
          step = 'COE_ANALYSIS';
          reason = error.message;
          logger.error(`❌ [VALIDATION] Failed at step: ${step} - ${reason}`);
          logger.error(`${bugId}_execute_1_step_failed`, { step, reason });
        } else if (
          errorName === 'MultiRepoCOEAnalysisError' ||
          stack.includes('multiRepoCoeAnalysis') ||
          stack.includes('Multi Repo')
        ) {
          step = 'MULTI_REPO_COE_ANALYSIS';
          reason = error.message;
          logger.error(`❌ [VALIDATION] Failed at step: ${step} - ${reason}`);
          logger.error(`${bugId}_execute_1_step_failed`, { step, reason });
        } else if (errorName === 'RepositorySetupError' || stack.includes('repositorySetup')) {
          step = 'REPOSITORY_SETUP';
          reason = error.message;
          logger.error(`❌ [VALIDATION] Failed at step: ${step} - ${reason}`);
          logger.error(`${bugId}_execute_1_step_failed`, { step, reason });
        } else if (
          errorName === 'CodeGenerationError' ||
          stack.includes('createAgenticCheckpoint') ||
          stack.includes('code_fix')
        ) {
          step = 'CODE_GENERATION';
          reason = error.message;
          logger.error(`❌ [VALIDATION] Failed at step: ${step} - ${reason}`);
          logger.error(`${bugId}_execute_1_step_failed`, { step, reason });
        } else if (stack.includes('expandProblemStatement')) {
          step = 'PROBLEM_STATEMENT';
          reason = 'Problem statement expansion failed: ' + error.message;
          logger.error(`❌ [VALIDATION] Failed at step: ${step} - ${reason}`);
          logger.error(`${bugId}_execute_1_step_failed`, { step, reason });
        }
      }

      // Store failure info to be used in validation checkpoint
      workflowFailureInfo = {
        step,
        reason,
        ...(rawResponse && { rawResponse }),
      };
    } finally {
      // Cleanup working directory
      if (workingDir) {
        logger.info(`🧹 [CLEANUP] Removing working directory: ${workingDir}`);
        logger.info(`${bugId}_cleanup_start`, { workingDir });
        try {
          await rm(workingDir, { recursive: true, force: true });
          logger.info(`✅ [CLEANUP] Working directory cleaned up successfully`);
          logger.info(`${bugId}_cleanup_success`, { workingDir });
        } catch (cleanupError) {
          logger.warn(`⚠️ [CLEANUP] Failed to cleanup working directory:`, cleanupError);
          logger.warn(`${bugId}_cleanup_failed`, {
            workingDir,
            error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
          });
        }
      }
    }

    // ALWAYS run validation checkpoint (whether success or failure)
    // This ensures results/failures are visible in the UI
    const validationSummary = await engine.createCheckpoint(
      BugWorkflowSteps.VALIDATE_RESULTS,
      validateResults,
      codeFixesResults,
      repositorySetups,
      workflowFailureInfo
    );
    logger.info('Workflow validation summary:', validationSummary);
    logger.info(`${bugId}_validation_summary`, validationSummary);

    // If there was a workflow failure, throw an error to mark the workflow as failed
    if (workflowFailureInfo) {
      logger.error(
        `❌ [WORKFLOW-FAILURE-SUMMARY] Step: ${workflowFailureInfo.step}, Reason: ${workflowFailureInfo.reason}`
      );
      logger.error(`${bugId}_workflow_failure_summary`, workflowFailureInfo);
      throw new Error(
        `Bug workflow failed at step ${workflowFailureInfo.step}: ${workflowFailureInfo.reason}`
      );
    }

    // Return results
    // Build aggregated gitInfo from successful code fixes (for multi-repo support)
    const successfulResults = codeFixesResults.filter((fix) => fix.success && fix.latestCommit);
    const firstSuccessful = successfulResults[0];
    
    // Build multiRepoResults for all successful repositories
    const multiRepoResults: GitInfo['multiRepoResults'] = {};
    for (const fix of successfulResults) {
      if (fix.latestCommit) {
        multiRepoResults[fix.repository] = {
          branch: fix.branchName || '',
          commitHash: fix.latestCommit,
          repoUrl: '', // repoUrl is in repositorySetups, not in codeFixesResults
          success: fix.success,
        };
      }
    }

    // Aggregate gitInfo - use first successful result as primary, include all in multiRepoResults
    const aggregatedGitInfo: GitInfo | undefined = firstSuccessful ? {
      branch: firstSuccessful.branchName || '',
      commitHash: firstSuccessful.latestCommit,
      gitDiff: firstSuccessful.gitDiff,
      diffStats: firstSuccessful.diffStats,
      multiRepoResults: Object.keys(multiRepoResults).length > 1 ? multiRepoResults : undefined,
    } : undefined;

    return {
      results: codeFixesResults,
      failureInfo: workflowFailureInfo,
      gitInfo: aggregatedGitInfo,
    };
  },
};
