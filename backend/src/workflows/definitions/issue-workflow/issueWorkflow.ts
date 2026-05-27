/**
 * Issue Workflow
 * Automated issue analysis and resolution
 */

import { WorkflowDefinition } from '../../registry/workflowRegistry.js';
import { WorkflowType } from '../../types/workflow-enums.js';
import { WorkflowEngine } from '../../workflow-types.js';
import { logger } from '../../../utils/logger.js';
import { researchAgentService } from '../../../services/researchAgentService.js';
import { z } from 'zod';
import { loadWorkflowConfig, ISSUE_GIT_CONFIG } from './config.js';
import { config as agentConfig } from '../../config.js';
import { executeWithRetry, formatRetryErrors } from './retry-utils.js';

// Import user prompts (system prompts come from agent configs)
import {
  buildStep1RepositoryIdentificationPrompt,
  buildStep2IssueAnalysisPrompt,
  buildStep3CodeAnalysisPrompt,
} from './prompts.js';
import type {
  IssueWorkflowInput,
  IssueWorkflowOutput,
  RepositoryIdentificationResult,
  IssueAnalysisResult,
  CodeAnalysisResult,
  StepExecutionDetail,
} from './types.js';
import {
  formatInvestigationReport,
  getRepositoryBaseBranch,
  getRepositoryId,
} from './utils.js';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Helper to track step execution start
 */
function startStepExecution(
  stepId: string,
  stepName: string,
  stepNumber: number
): StepExecutionDetail {
  return {
    stepId,
    stepName,
    stepNumber,
    status: 'running',
    startTime: new Date().toISOString(),
  };
}

/**
 * Helper to mark step execution as successful
 */
function completeStepSuccess(
  step: StepExecutionDetail,
  output: {
    summary: string;
    keyData?: Record<string, any>;
    researchAgentSessionId?: string;
  }
): StepExecutionDetail {
  const endTime = new Date().toISOString();
  const startMs = new Date(step.startTime).getTime();
  const endMs = new Date(endTime).getTime();

  return {
    ...step,
    status: 'success',
    endTime,
    durationMs: endMs - startMs,
    researchAgentSessionId: output.researchAgentSessionId,
    output: {
      summary: output.summary,
      keyData: output.keyData,
    },
  };
}

/**
 * Helper to mark step execution as failed
 */
function completeStepFailure(
  step: StepExecutionDetail,
  error: Error,
  fallback?: {
    reason: string;
    value: any;
  },
  retryResult?: {
    attempts: number;
    errors: Array<{ error: string }>;
  }
): StepExecutionDetail {
  const endTime = new Date().toISOString();
  const startMs = new Date(step.startTime).getTime();
  const endMs = new Date(endTime).getTime();

  const retryInfo = (error as any)?.retryInfo || retryResult ? {
    totalAttempts: (error as any)?.retryInfo?.totalAttempts || retryResult?.attempts || 1,
    maxRetries: (error as any)?.retryInfo?.maxRetries || 0,
    attemptsFailed: retryResult?.errors?.length || 1,
    attemptsSucceeded: 0,
    allErrors: (error as any)?.retryInfo?.allErrors || retryResult?.errors?.map(e => e.error) || [error.message],
  } : undefined;

  return {
    ...step,
    status: 'failed',
    endTime,
    durationMs: endMs - startMs,
    error: {
      message: error.message,
      stack: error.stack?.substring(0, 500),
      timestamp: endTime,
    },
    fallback: fallback ? {
      used: true,
      reason: fallback.reason,
      value: fallback.value,
    } : undefined,
    retryInfo,
  };
}

/**
 * Helper to mark step as skipped
 */
function skipStep(
  stepId: string,
  stepName: string,
  stepNumber: number,
  reason: string
): StepExecutionDetail {
  const timestamp = new Date().toISOString();
  return {
    stepId,
    stepName,
    stepNumber,
    status: 'skipped',
    startTime: timestamp,
    endTime: timestamp,
    durationMs: 0,
    output: {
      summary: `Skipped: ${reason}`,
    },
  };
}

/**
 * Parse JSON response that may be wrapped in markdown code blocks
 */
function parseJsonResponse<T>(responseText: string): T {
  try {
    let parsedData: any;

    // Strategy 1: Try to extract JSON from markdown code blocks
    const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/);
    if (jsonMatch && jsonMatch[1]) {
      parsedData = JSON.parse(jsonMatch[1]);
    } else {
      // Strategy 2: Try to find JSON object by looking for { and } at the end
      const lastBraceIndex = responseText.lastIndexOf('}');
      if (lastBraceIndex !== -1) {
        // Find the matching opening brace by counting
        let braceCount = 0;
        let startIndex = -1;
        for (let i = lastBraceIndex; i >= 0; i--) {
          if (responseText[i] === '}') {
            braceCount++;
          } else if (responseText[i] === '{') {
            braceCount--;
            if (braceCount === 0) {
              startIndex = i;
              break;
            }
          }
        }

        if (startIndex !== -1) {
          const jsonCandidate = responseText.substring(startIndex, lastBraceIndex + 1);
          try {
            parsedData = JSON.parse(jsonCandidate);
            logger.info('✅ Successfully extracted JSON from conversational response');
          } catch (e) {
            // If extraction failed, try parsing entire response
            parsedData = JSON.parse(responseText);
          }
        } else {
          // Fallback: Try to parse the entire response as JSON
          parsedData = JSON.parse(responseText);
        }
      } else {
        // Fallback: Try to parse the entire response as JSON
        parsedData = JSON.parse(responseText);
      }
    }

    return parsedData as T;
  } catch (error) {
    logger.error('Failed to parse JSON response:', error);
    logger.error('Response text:', responseText);
    throw error;
  }
}

// ============================================================================
// Step IDs
// ============================================================================

export enum IssueWorkflowSteps {
  REPOSITORY_IDENTIFICATION = 'repository-identification',
  ISSUE_ANALYSIS = 'issue-analysis',
  CODE_ANALYSIS = 'code-analysis',
  CREATE_FIX_OR_REPORT = 'create-fix-or-report',
}

// ============================================================================
// Input/Output Schemas
// ============================================================================

const IssueWorkflowInputSchema = z.object({
  description: z.string().min(1, 'Description is required'),
  raiseQuestions: z.boolean().optional().default(true),
  solution: z.string().optional(),
  clarificationAnswers: z.string().optional(),
  debugAndFixDirectly: z.boolean().optional().default(false),
});

// ============================================================================
// Workflow Definition
// ============================================================================

/**
 * Helper: Prepare parameters for fix PR (single repo)
 */
interface FixPRParams {
  repoUrl: string;
  fixBranchName: string;
  skipBranchCheckout: boolean;
  repository: string;
}

function prepareFixPRParams(
  repository: string,
  ticketId: string,
): FixPRParams {
  const repoId = getRepositoryId(repository);
  const repoUrl = `https://bitbucket.org/${repoId}.git`;
  const fixBranchName = `${ISSUE_GIT_CONFIG.branchPrefix}/${ticketId.toLowerCase()}`;
  const skipBranchCheckout = false;

  return {
    repoUrl,
    fixBranchName,
    skipBranchCheckout,
    repository,
  };
}

/**
 * Helper: Prepare parameters for multi-repo fix
 */
interface MultiRepoFixParams {
  repositories: Array<{
    name: string;
    repoUrl: string;
    fixBranchName: string;
    baseBranch: string;
  }>;
}

function prepareMultiRepoFixParams(
  repositories: string[],
  ticketId: string,
): MultiRepoFixParams {
  return {
    repositories: repositories.map(repo => ({
      name: repo,
      repoUrl: `https://bitbucket.org/${getRepositoryId(repo)}.git`,
      fixBranchName: `${ISSUE_GIT_CONFIG.branchPrefix}/${ticketId.toLowerCase()}`,
      baseBranch: getRepositoryBaseBranch(repo),
    })),
  };
}

/**
 * Step 1: Identify Repository
 */
async function executeStep1RepositoryIdentification(
  input: IssueWorkflowInput,
  ticketId: string,
  workflowConfig: ReturnType<typeof loadWorkflowConfig>
): Promise<RepositoryIdentificationResult> {
  const stepName = 'Repository Identification';
  const agentName = workflowConfig.agents.step1;

  logger.info(`[${ticketId} - ${stepName}] Starting...`);

  // Build user prompt
  const userPrompt = buildStep1RepositoryIdentificationPrompt(
    input.description,
    ticketId,
    input.clarificationAnswers
  );

  // Get agent system prompt from global agent configs
  const agentSystemPrompt = agentConfig[agentName]?.systemPrompt;
  if (!agentSystemPrompt) {
    throw new Error(`Agent ${agentName} not found in agent configs`);
  }

  // Execute with retry logic
  const retryResult = await executeWithRetry(
    `${ticketId} - ${stepName}`,
    async () => {
      // Create research session
      const sessionId = await researchAgentService.createSession(
        process.env.RESEARCH_AGENT_PRODUCT_ID || null,
        null,
        undefined
      );

      // Call research agent via streaming API
      const response = await researchAgentService.streamQuery(
        sessionId,
        userPrompt,
        {
          systemPrompt: agentSystemPrompt,
          onEvent: () => {}, // Empty callback for events
        }
      );

      return { sessionId, response };
    },
    {
      maxRetries: 2, // 3 total attempts (1 initial + 2 retries)
      retryDelayMs: 2000, // 2 seconds base delay
      exponentialBackoff: true,
    }
  );

  if (!retryResult.success || !retryResult.result) {
    const errorSummary = formatRetryErrors(stepName, retryResult);
    logger.error(`[${ticketId} - ${stepName}] Failed after ${retryResult.attempts} attempts:\n${errorSummary}`);

    // Create enriched error with retry information
    const enrichedError: any = retryResult.error || new Error('Repository identification failed');
    enrichedError.retryInfo = {
      totalAttempts: retryResult.attempts,
      maxRetries: 2,
      allErrors: retryResult.errors.map(e => e.error),
    };
    throw enrichedError;
  }

  const { sessionId, response } = retryResult.result;

  if (!response.analysis) {
    throw new Error('Research query completed but no complete response was received');
  }

  // Parse result (handle markdown code blocks)
  const parsedResult: RepositoryIdentificationResult = parseJsonResponse<RepositoryIdentificationResult>(response.analysis);

  logger.info(`[${ticketId} - ${stepName}] Completed. Repositories: ${parsedResult.repositories.join(', ')}, Multi-Repo: ${parsedResult.multiRepo}`);
  logger.info(`[${ticketId} - ${stepName}] Research Agent Session ID: ${sessionId}`);

  return { ...parsedResult, researchAgentSessionId: sessionId };
}

/**
 * Step 2: Analyze Issue
 */
async function executeStep2IssueAnalysis(
  input: IssueWorkflowInput,
  repositoryResult: RepositoryIdentificationResult,
  ticketId: string,
  workflowConfig: ReturnType<typeof loadWorkflowConfig>
): Promise<IssueAnalysisResult> {
  const stepName = 'Issue Analysis';
  const agentName = workflowConfig.agents.step2;

  logger.info(`[${ticketId} - ${stepName}] Starting...`);

  // Build user prompt
  const userPrompt = buildStep2IssueAnalysisPrompt(
    input.description,
    repositoryResult.repositories,
    repositoryResult.multiRepo,
    repositoryResult.affectedComponents,
    ticketId,
    input.clarificationAnswers
  );

  // Get agent system prompt from global agent configs
  const agentSystemPrompt = agentConfig[agentName]?.systemPrompt;
  if (!agentSystemPrompt) {
    throw new Error(`Agent ${agentName} not found in agent configs`);
  }

  // Execute with retry logic
  const retryResult = await executeWithRetry(
    `${ticketId} - ${stepName}`,
    async () => {
      // Create research session
      const sessionId = await researchAgentService.createSession(
        process.env.RESEARCH_AGENT_PRODUCT_ID || null,
        null,
        undefined
      );

      // Call research agent via streaming API
      const response = await researchAgentService.streamQuery(
        sessionId,
        userPrompt,
        {
          systemPrompt: agentSystemPrompt,
          onEvent: () => {}, // Empty callback for events
        }
      );

      return { sessionId, response };
    },
    {
      maxRetries: 2,
      retryDelayMs: 2000,
      exponentialBackoff: true,
    }
  );

  if (!retryResult.success || !retryResult.result) {
    const errorSummary = formatRetryErrors(stepName, retryResult);
    logger.error(`[${ticketId} - ${stepName}] Failed after ${retryResult.attempts} attempts:\n${errorSummary}`);

    // Create enriched error with retry information
    const enrichedError: any = retryResult.error || new Error('Issue analysis failed');
    enrichedError.retryInfo = {
      totalAttempts: retryResult.attempts,
      maxRetries: 2,
      allErrors: retryResult.errors.map(e => e.error),
    };
    throw enrichedError;
  }

  const { sessionId, response } = retryResult.result;

  if (!response.analysis) {
    throw new Error('Research query completed but no complete response was received');
  }

  // Parse result (handle markdown code blocks)
  const parsedResult: IssueAnalysisResult = parseJsonResponse<IssueAnalysisResult>(response.analysis);

  logger.info(`[${ticketId} - ${stepName}] Completed. Issue Type: ${parsedResult.issueType}, Severity: ${parsedResult.severity}, Requires Code Change: ${parsedResult.requiresCodeChange}`);
  logger.info(`[${ticketId} - ${stepName}] Research Agent Session ID: ${sessionId}`);

  return { ...parsedResult, researchAgentSessionId: sessionId };
}

/**
 * Step 3: Code Analysis (only if requiresCodeChange is true)
 */
async function executeStep3CodeAnalysis(
  input: IssueWorkflowInput,
  repositoryResult: RepositoryIdentificationResult,
  issueAnalysisResult: IssueAnalysisResult,
  ticketId: string,
  workflowConfig: ReturnType<typeof loadWorkflowConfig>
): Promise<CodeAnalysisResult | null> {
  const stepName = 'Code Analysis';

  // Skip if no code change is required
  if (!issueAnalysisResult.requiresCodeChange) {
    logger.info(`[${ticketId} - ${stepName}] Skipped (no code change required)`);
    return null;
  }

  const agentName = workflowConfig.agents.step3;

  logger.info(`[${ticketId} - ${stepName}] Starting...`);

  // Build user prompt
  const userPrompt = buildStep3CodeAnalysisPrompt(
    input.description,
    repositoryResult.repositories,
    repositoryResult.multiRepo,
    issueAnalysisResult.issueType,
    issueAnalysisResult.severity,
    issueAnalysisResult.affectedComponents,
    issueAnalysisResult.rootCause,
    issueAnalysisResult.suggestedSolution,
    ticketId,
    input.clarificationAnswers
  );

  // Get agent system prompt from global agent configs
  const agentSystemPrompt = agentConfig[agentName]?.systemPrompt;
  if (!agentSystemPrompt) {
    throw new Error(`Agent ${agentName} not found in agent configs`);
  }

  // Execute with retry logic
  const retryResult = await executeWithRetry(
    `${ticketId} - ${stepName}`,
    async () => {
      // Create research session
      const sessionId = await researchAgentService.createSession(
        process.env.RESEARCH_AGENT_PRODUCT_ID || null,
        null,
        undefined
      );

      // Call research agent via streaming API
      const response = await researchAgentService.streamQuery(
        sessionId,
        userPrompt,
        {
          systemPrompt: agentSystemPrompt,
          onEvent: () => {}, // Empty callback for events
        }
      );

      return { sessionId, response };
    },
    {
      maxRetries: 2,
      retryDelayMs: 2000,
      exponentialBackoff: true,
    }
  );

  if (!retryResult.success || !retryResult.result) {
    const errorSummary = formatRetryErrors(stepName, retryResult);
    logger.error(`[${ticketId} - ${stepName}] Failed after ${retryResult.attempts} attempts:\n${errorSummary}`);

    // Create enriched error with retry information
    const enrichedError: any = retryResult.error || new Error('Code analysis failed');
    enrichedError.retryInfo = {
      totalAttempts: retryResult.attempts,
      maxRetries: 2,
      allErrors: retryResult.errors.map(e => e.error),
    };
    throw enrichedError;
  }

  const { sessionId, response } = retryResult.result;

  if (!response.analysis) {
    throw new Error('Research query completed but no complete response was received');
  }

  // Parse result (handle markdown code blocks)
  const parsedResult: CodeAnalysisResult = parseJsonResponse<CodeAnalysisResult>(response.analysis);

  logger.info(`[${ticketId} - ${stepName}] Completed. Is Fixable: ${parsedResult.is_fixable}`);
  logger.info(`[${ticketId} - ${stepName}] Research Agent Session ID: ${sessionId}`);

  return { ...parsedResult, researchAgentSessionId: sessionId };
}

/**
 * Step 4: Create Fix or Investigation Report
 */
async function executeStep4CreateFixOrReport(
  input: IssueWorkflowInput,
  repositoryResult: RepositoryIdentificationResult,
  issueAnalysisResult: IssueAnalysisResult,
  codeAnalysisResult: CodeAnalysisResult | null,
  ticketId: string,
  workflowConfig: ReturnType<typeof loadWorkflowConfig>,
  engine: WorkflowEngine<any, any>
): Promise<{ prLink?: string; prLinks?: Record<string, string>; gitDiff?: string; commitHash?: string; investigationReport?: string }> {
  const stepId = IssueWorkflowSteps.CREATE_FIX_OR_REPORT;
  const stepName = 'Create Fix or Investigation Report';

  logger.info(`[${ticketId} - ${stepName}] Starting...`);

  // If no code change required or not fixable, generate investigation report
  if (!issueAnalysisResult.requiresCodeChange || !codeAnalysisResult || !codeAnalysisResult.is_fixable) {
    const investigationReport = formatInvestigationReport(
      issueAnalysisResult.issueType,
      issueAnalysisResult.severity,
      issueAnalysisResult.affectedComponents,
      issueAnalysisResult.rootCause,
      codeAnalysisResult?.investigation_steps
    );

    logger.info(`[${ticketId} - ${stepName}] Completed. Investigation report generated.`);

    return { investigationReport };
  }

  // Check if this is a multi-repo issue
  const isMultiRepo = repositoryResult.multiRepo && repositoryResult.repositories.length > 1;

  if (isMultiRepo) {
    // Multi-repo fix
    logger.info(`[${ticketId} - ${stepName}] Creating multi-repo fix for repositories: ${repositoryResult.repositories.join(', ')}`);

    const multiRepoParams = prepareMultiRepoFixParams(repositoryResult.repositories, ticketId);

    // Build multi-repo agentic checkpoint prompt
    const agenticPrompt = `# Task: Fix Multi-Repository Issue

**Issue Description:**
${input.description}

**Issue Type:** ${issueAnalysisResult.issueType}
**Severity:** ${issueAnalysisResult.severity}
**Affected Repositories:** ${repositoryResult.repositories.join(', ')}

**Code Analysis:**
${codeAnalysisResult.analysis_summary}

**Affected Files by Repository:**
${codeAnalysisResult.affected_files.map(f =>
  `- [${f.repository || 'unknown'}] ${f.file_path}${f.function_name ? ` (${f.function_name})` : ''}: ${f.issue_description}`
).join('\n')}

**Suggested Fix:**
${codeAnalysisResult.suggested_fix?.description || 'See code changes below'}

**Code Changes Needed by Repository:**
${codeAnalysisResult.suggested_fix?.code_changes?.map(c =>
  `- [${c.repository || 'unknown'}] ${c.file}: ${c.change_description}`
).join('\n') || 'Please implement the fix based on the analysis above'}

**Constraints:**
${workflowConfig.prompts.fileModificationConstraint}

**Instructions:**
1. Clone all affected repositories: ${multiRepoParams.repositories.map(r => r.name).join(', ')}
2. Implement fixes in each repository as described above
3. ${workflowConfig.prompts.prCreationInstructions}
4. Ensure all changes work together correctly
5. Test cross-repository dependencies
6. Follow coding standards and best practices

**Repository Details:**
${multiRepoParams.repositories.map(r => `- ${r.name}: ${r.repoUrl} (base: ${r.baseBranch})`).join('\n')}

**Ticket ID:** ${ticketId}
`;

    // Execute agentic checkpoint with multi-repo support
    const checkpointResult = await engine.createAgenticCheckpoint(
      stepId,
      'coder-agent',
      {
        repoInfo: {
          // Use primary repository as main repo
          repoUrl: multiRepoParams.repositories[0].repoUrl,
          repoBranch: multiRepoParams.repositories[0].fixBranchName,
          baseBranch: multiRepoParams.repositories[0].baseBranch,
          earlyPRCreation: !workflowConfig.useMockAnalysis,
          getCommitMessage: (raw_commit_message: string) => `EUL-0000 ${raw_commit_message}`,
        },
        conversationContext: {
          initialUserMessage: agenticPrompt,
        },
      }
    );

    // Extract PR links from multi-repo results
    const prLinks: Record<string, string> = {};
    interface RepoInfo {
      pr_link?: string;
      pullRequestUrl?: string;
    }
    if (checkpointResult.gitInfo.multiRepoResults) {
      for (const [repoName, repoInfo] of Object.entries(checkpointResult.gitInfo.multiRepoResults as Record<string, RepoInfo>)) {
        const prLink = repoInfo.pr_link || repoInfo.pullRequestUrl;
        if (prLink) {
          prLinks[repoName] = prLink;
        }
      }
    }

    // Fallback: use main PR link if multi-repo results not available
    const mainPrLink = checkpointResult.gitInfo.pr_link || checkpointResult.gitInfo.pullRequestUrl;
    if (mainPrLink && Object.keys(prLinks).length === 0) {
      prLinks[repositoryResult.repositories[0]] = mainPrLink;
    }

    interface DiffEntry {
      hunks: Array<{ content: string }>;
    }
    const gitDiff = checkpointResult.gitInfo.gitDiff?.map((d: DiffEntry) => d.hunks.map((h: { content: string }) => h.content).join('\n')).join('\n\n');
    const commitHash = checkpointResult.gitInfo.commitHash;

    logger.info(`[${ticketId} - ${stepName}] Completed. Multi-repo PRs created: ${Object.keys(prLinks).join(', ')}`);

    return { prLinks, prLink: mainPrLink, gitDiff, commitHash };
  } else {
    // Single repo fix
    const repository = repositoryResult.primary_repository || repositoryResult.repositories[0];
    const fixPRParams = prepareFixPRParams(repository, ticketId);

    logger.info(`[${ticketId} - ${stepName}] Creating fix PR for repository: ${repository}`);

    // Build agentic checkpoint prompt
    const agenticPrompt = `# Task: Fix Issue

**Issue Description:**
${input.description}

**Issue Type:** ${issueAnalysisResult.issueType}
**Severity:** ${issueAnalysisResult.severity}
**Repository:** ${repository}

**Code Analysis:**
${codeAnalysisResult.analysis_summary}

**Affected Files:**
${codeAnalysisResult.affected_files.map(f =>
  `- ${f.file_path}${f.function_name ? ` (${f.function_name})` : ''}: ${f.issue_description}`
).join('\n')}

**Suggested Fix:**
${codeAnalysisResult.suggested_fix?.description || 'See code changes below'}

**Code Changes Needed:**
${codeAnalysisResult.suggested_fix?.code_changes?.map(c =>
  `- ${c.file}: ${c.change_description}`
).join('\n') || 'Please implement the fix based on the analysis above'}

**Constraints:**
${workflowConfig.prompts.fileModificationConstraint}

**Instructions:**
1. Implement the fix as described above
2. ${workflowConfig.prompts.prCreationInstructions}
3. Ensure all changes are properly tested
4. Follow coding standards and best practices

**Ticket ID:** ${ticketId}
`;

    // Execute agentic checkpoint
    const checkpointResult = await engine.createAgenticCheckpoint(
      stepId,
      'coder-agent', // Using generic coder agent
      {
        repoInfo: {
          repoUrl: fixPRParams.repoUrl,
          repoBranch: fixPRParams.skipBranchCheckout ? undefined : fixPRParams.fixBranchName,
          baseBranch: fixPRParams.skipBranchCheckout ? undefined : getRepositoryBaseBranch(fixPRParams.repository),
          earlyPRCreation: !workflowConfig.useMockAnalysis,
          getCommitMessage: (raw_commit_message: string) => `EUL-0000 ${raw_commit_message}`,
        },
        conversationContext: {
          initialUserMessage: agenticPrompt,
        },
      }
    );

    const prLink = checkpointResult.gitInfo.pr_link || checkpointResult.gitInfo.pullRequestUrl;
    interface SingleRepoDiffEntry {
      hunks: Array<{ content: string }>;
    }
    const gitDiff = checkpointResult.gitInfo.gitDiff?.map((d: SingleRepoDiffEntry) => d.hunks.map((h: { content: string }) => h.content).join('\n')).join('\n\n');
    const commitHash = checkpointResult.gitInfo.commitHash;

    logger.info(`[${ticketId} - ${stepName}] Completed. PR created: ${prLink}`);

    return { prLink, gitDiff, commitHash };
  }
}

// ============================================================================
// Input Schema and Context Mapper
// ============================================================================

/**
 * Context mapper - transforms validated input to workflow context
 */
function contextMapper(input: IssueWorkflowInput): IssueWorkflowInput & { ticketId: string } {
  return {
    ...input,
    ticketId: '', // Will be set by workflow engine
  };
}

/**
 * Main workflow execution function
 */
async function execute(
  engine: WorkflowEngine<any, any>,
  _preExecuteResult: unknown
): Promise<IssueWorkflowOutput> {
  const ticketId = engine.getWorkflowExecutionId();

  logger.info(`[${ticketId}] 🚀 Issue Workflow started`);
  logger.info(`[${ticketId}] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  // Load workflow config
  const workflowConfig = loadWorkflowConfig();

  // Get input from engine context
  const context = engine.getContext();
  const input: IssueWorkflowInput = {
    description: (context as any).description,
    raiseQuestions: (context as any).raiseQuestions ?? true,
    solution: (context as any).solution,
    clarificationAnswers: (context as any).clarificationAnswers,
    debugAndFixDirectly: (context as any).debugAndFixDirectly ?? false,
  };

  logger.info(`[${ticketId}] Input:`, {
    descriptionLength: input.description?.length || 0,
    descriptionPreview: input.description?.substring(0, 100) || 'N/A',
    raiseQuestions: input.raiseQuestions,
    hasSolution: !!input.solution,
    hasClarificationAnswers: !!input.clarificationAnswers,
    debugAndFixDirectly: input.debugAndFixDirectly,
  });
  logger.info(`[${ticketId}] Config:`, {
    agents: {
      step1: workflowConfig.agents.step1,
      step2: workflowConfig.agents.step2,
      step3: workflowConfig.agents.step3,
    },
    retry: workflowConfig.retry,
  });
  logger.info(`[${ticketId}] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  // Track step errors (legacy)
  const stepErrors: Array<{
    step: string;
    stepName: string;
    error: string;
    errorStack?: string;
    fallbackUsed?: any;
    timestamp: string;
    attemptNumber?: number;
    retryInfo?: {
      totalAttempts: number;
      maxRetries: number;
      allErrors: string[];
    };
  }> = [];

  // Track step executions for table view
  const stepExecutions: StepExecutionDetail[] = [];

  // ============================================================================
  // STEP 1: Repository Identification
  // ============================================================================
  logger.info(`[${ticketId}] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  logger.info(`[${ticketId}] 📍 STEP 1: Repository Identification`);
  logger.info(`[${ticketId}] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  let step1Execution = startStepExecution(
    IssueWorkflowSteps.REPOSITORY_IDENTIFICATION,
    'Repository Identification',
    1
  );

  let repositoryResult: RepositoryIdentificationResult = {
    repositories: ['euler-api-gateway'], // Fallback
    multiRepo: false,
    reasoning: 'Fallback: Using default repository due to step failure',
    confidence: 'LOW',
    affectedComponents: [],
  };

  try {
    repositoryResult = await engine.createCheckpoint(
      IssueWorkflowSteps.REPOSITORY_IDENTIFICATION,
      executeStep1RepositoryIdentification,
      input,
      ticketId,
      workflowConfig
    );

    // Mark step as successful
    step1Execution = completeStepSuccess(step1Execution, {
      summary: `Identified ${repositoryResult.repositories.length} repository(ies): ${repositoryResult.repositories.join(', ')}`,
      keyData: {
        repositories: repositoryResult.repositories,
        multiRepo: repositoryResult.multiRepo,
        confidence: repositoryResult.confidence,
        primaryRepository: repositoryResult.primary_repository,
      },
      researchAgentSessionId: repositoryResult.researchAgentSessionId,
    });
    stepExecutions.push(step1Execution);

    logger.info(`[${ticketId}] ✅ Step 1 completed: Repositories identified - ${repositoryResult.repositories.join(', ')}`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    const retryInfo = (error as any)?.retryInfo;

    logger.error(`[${ticketId}] ❌ STEP 1 Failed: ${errorMsg} - continuing with fallback repository`);

    // Mark step as failed with fallback
    step1Execution = completeStepFailure(
      step1Execution,
      error instanceof Error ? error : new Error(errorMsg),
      {
        reason: 'Step failed - using default repository',
        value: repositoryResult,
      }
    );
    stepExecutions.push(step1Execution);

    stepErrors.push({
      step: IssueWorkflowSteps.REPOSITORY_IDENTIFICATION,
      stepName: 'Repository Identification',
      error: errorMsg,
      errorStack: errorStack?.substring(0, 500),
      fallbackUsed: repositoryResult,
      timestamp: new Date().toISOString(),
      retryInfo: retryInfo || undefined,
    });
  }

  // ============================================================================
  // SOLUTION PROVIDED - SKIP ANALYSIS AND GO DIRECTLY TO PR
  // ============================================================================
  if (input.solution) {
    logger.info(`[${ticketId}] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    logger.info(`[${ticketId}] 🎯 SOLUTION PROVIDED - Skipping analysis, going directly to PR creation`);
    logger.info(`[${ticketId}] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    // Skip to Step 4 with solution
    const issueAnalysisForSolution: IssueAnalysisResult = {
      issueType: 'bug',
      severity: 'medium',
      issueCategory: 'other',
      gatewayName: null,
      affectedComponents: [],
      rootCause: 'Solution provided by user',
      suggestedSolution: input.solution,
      requiresCodeChange: true,
      estimatedComplexity: 'simple',
      analysisApproach: 'code_and_logs_first',
      needsClarification: false,
      isQuestionOnly: false,
    };

    // Create Step 4 to generate PR with provided solution
    logger.info(`[${ticketId}] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    logger.info(`[${ticketId}] 🔧 STEP 4: Create Fix with Provided Solution`);
    logger.info(`[${ticketId}] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    let step4Execution = startStepExecution(
      IssueWorkflowSteps.CREATE_FIX_OR_REPORT,
      'Create Fix with Solution',
      4
    );

    let fixResult: {
      prLink?: string;
      prLinks?: Record<string, string>;
      gitDiff?: string;
      commitHash?: string;
      investigationReport?: string;
    } = {};

    try {
      // Call Step 4 with solution
      const repository = repositoryResult.primary_repository || repositoryResult.repositories[0];
      const isMultiRepo = repositoryResult.multiRepo && repositoryResult.repositories.length > 1;

      if (isMultiRepo) {
        // Multi-repo fix
        const multiRepoParams = prepareMultiRepoFixParams(repositoryResult.repositories, ticketId);
        const agenticPrompt = `# Task: Implement Solution Across Multiple Repositories

**Issue Description:**
${input.description}

**Repositories:** ${repositoryResult.repositories.join(', ')}

**Solution to Implement:**
${input.solution}

**Instructions:**
1. Clone all affected repositories: ${multiRepoParams.repositories.map(r => r.name).join(', ')}
2. Implement the provided solution in each repository
3. Create PRs for all changes
4. Ensure all changes work together correctly
5. Test cross-repository dependencies
6. Follow coding standards and best practices

**Repository Details:**
${multiRepoParams.repositories.map(r => `- ${r.name}: ${r.repoUrl} (base: ${r.baseBranch})`).join('\n')}

**Ticket ID:** ${ticketId}
`;

        const checkpointResult = await engine.createAgenticCheckpoint(
          IssueWorkflowSteps.CREATE_FIX_OR_REPORT,
          'coder-agent',
          {
            executorType: 'xyne-code',
            conversationContext: {
              initialUserMessage: agenticPrompt,
            },
            repoInfo: {
              repoUrl: multiRepoParams.repositories[0].repoUrl,
              repoBranch: multiRepoParams.repositories[0].fixBranchName,
              baseBranch: multiRepoParams.repositories[0].baseBranch,
              earlyPRCreation: true,
              getCommitMessage: (raw_commit_message: string) => `EUL-0000 ${raw_commit_message}`,
            },
          }
        );

        const prLinks: Record<string, string> = {};
        if (checkpointResult.gitInfo.multiRepoResults) {
          for (const [repoName, repoInfo] of Object.entries(checkpointResult.gitInfo.multiRepoResults)) {
            const prLink = repoInfo.pr_link || repoInfo.pullRequestUrl;
            if (prLink) {
              prLinks[repoName] = prLink;
            }
          }
        }

        const mainPrLink = checkpointResult.gitInfo.pr_link || checkpointResult.gitInfo.pullRequestUrl;
        if (mainPrLink && Object.keys(prLinks).length === 0) {
          prLinks[repositoryResult.repositories[0]] = mainPrLink;
        }

        fixResult = {
          prLinks,
          prLink: mainPrLink,
          gitDiff: checkpointResult.gitInfo.gitDiff?.map(d => d.hunks.map(h => h.content).join('\n')).join('\n\n'),
          commitHash: checkpointResult.gitInfo.commitHash,
        };
      } else {
        // Single repo fix
        const fixPRParams = prepareFixPRParams(repository, ticketId);
        const agenticPrompt = `# Task: Implement Solution

**Issue Description:**
${input.description}

**Repository:** ${repository}

**Solution to Implement:**
${input.solution}

**Instructions:**
1. Implement the provided solution
2. Create a PR with the changes
3. Ensure all changes are properly tested
4. Follow coding standards and best practices

**Ticket ID:** ${ticketId}
`;

        const checkpointResult = await engine.createAgenticCheckpoint(
          IssueWorkflowSteps.CREATE_FIX_OR_REPORT,
          'coder-agent',
          {
            executorType: 'xyne-code',
            conversationContext: {
              initialUserMessage: agenticPrompt,
            },
            repoInfo: {
              repoUrl: fixPRParams.repoUrl,
              repoBranch: fixPRParams.skipBranchCheckout ? undefined : fixPRParams.fixBranchName,
              baseBranch: fixPRParams.skipBranchCheckout ? undefined : getRepositoryBaseBranch(fixPRParams.repository),
              earlyPRCreation: true,
              getCommitMessage: (raw_commit_message: string) => `EUL-0000 ${raw_commit_message}`,
            },
          }
        );

        fixResult = {
          prLink: checkpointResult.gitInfo.pr_link || checkpointResult.gitInfo.pullRequestUrl,
          gitDiff: checkpointResult.gitInfo.gitDiff?.map(d => d.hunks.map(h => h.content).join('\n')).join('\n\n'),
          commitHash: checkpointResult.gitInfo.commitHash,
        };
      }

      step4Execution = completeStepSuccess(
        step4Execution,
        {
          summary: fixResult.prLink ? `PR created: ${fixResult.prLink}` : (fixResult.prLinks ? `Multi-repo PRs created (${Object.keys(fixResult.prLinks).length} repos)` : 'Completed'),
          keyData: {
            prCreated: !!fixResult.prLink || !!(fixResult.prLinks && Object.keys(fixResult.prLinks).length > 0),
            prLink: fixResult.prLink,
            prLinks: fixResult.prLinks,
          },
        }
      );
      stepExecutions.push(step4Execution);

      logger.info(`[${ticketId}] ✅ Step 4 completed: ${fixResult.prLink ? 'PR created' : (fixResult.prLinks ? 'Multi-repo PRs created' : 'Completed')}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      logger.error(`[${ticketId}] ❌ STEP 4 Failed: ${errorMsg}`);

      step4Execution = completeStepFailure(
        step4Execution,
        error instanceof Error ? error : new Error(errorMsg),
        {
          reason: 'Failed to create PR with provided solution',
          value: fixResult,
        }
      );
      stepExecutions.push(step4Execution);

      stepErrors.push({
        step: IssueWorkflowSteps.CREATE_FIX_OR_REPORT,
        stepName: 'Create Fix with Solution',
        error: errorMsg,
        errorStack: errorStack?.substring(0, 500),
        fallbackUsed: fixResult,
        timestamp: new Date().toISOString(),
      });
    }

    // Build output for solution-based workflow
    const output: IssueWorkflowOutput = {
      issueType: issueAnalysisForSolution.issueType,
      severity: issueAnalysisForSolution.severity,
      issueCategory: issueAnalysisForSolution.issueCategory,
      gatewayName: issueAnalysisForSolution.gatewayName,
      repositories: repositoryResult.repositories,
      primaryRepository: repositoryResult.primary_repository,
      multiRepo: repositoryResult.multiRepo,
      affectedComponents: issueAnalysisForSolution.affectedComponents,
      rootCause: issueAnalysisForSolution.rootCause,
      suggestedSolution: issueAnalysisForSolution.suggestedSolution,
      requiresCodeChange: true,
      analysisApproach: issueAnalysisForSolution.analysisApproach,
      prLink: fixResult.prLink,
      prLinks: fixResult.prLinks,
      gitDiff: fixResult.gitDiff,
      commitHash: fixResult.commitHash,
      stepExecutions,
      stepErrors: stepErrors.length > 0 ? stepErrors : undefined,
    };

    logger.info(`[${ticketId}] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    logger.info(`[${ticketId}] ✅ Solution-based Workflow completed`);
    logger.info(`[${ticketId}] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    logger.info(`[${ticketId}] 📊 WORKFLOW SUMMARY`);
    logger.info(`[${ticketId}] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    logger.info(`[${ticketId}] Repositories:      ${output.repositories.join(', ')}`);
    logger.info(`[${ticketId}] Multi-Repo:        ${output.multiRepo}`);
    logger.info(`[${ticketId}] PR Created:        ${output.prLink ? 'Yes' : (output.prLinks ? 'Yes (Multi)' : 'No')}`);
    if (stepErrors.length > 0) {
      logger.warn(`[${ticketId}] Step Errors:       ${stepErrors.length}`);
    }
    logger.info(`[${ticketId}] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    return output;
  }

  // ============================================================================
  // STEP 2: Issue Analysis
  // ============================================================================
  logger.info(`[${ticketId}] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  logger.info(`[${ticketId}] 🔍 STEP 2: Issue Analysis`);
  logger.info(`[${ticketId}] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  let step2Execution = startStepExecution(
    IssueWorkflowSteps.ISSUE_ANALYSIS,
    'Issue Analysis',
    2
  );

  let issueAnalysisResult: IssueAnalysisResult = {
    issueType: 'other',
    severity: 'medium',
    issueCategory: 'other',
    gatewayName: null,
    affectedComponents: [],
    rootCause: 'Fallback: Unable to analyze issue due to step failure',
    suggestedSolution: 'Manual investigation required',
    requiresCodeChange: false,
    estimatedComplexity: 'simple',
    analysisApproach: 'requires_investigation',
    needsClarification: false,
    isQuestionOnly: false,
  };

  try {
    issueAnalysisResult = await engine.createCheckpoint(
      IssueWorkflowSteps.ISSUE_ANALYSIS,
      executeStep2IssueAnalysis,
      input,
      repositoryResult,
      ticketId,
      workflowConfig
    );

    // Mark step as successful
    step2Execution = completeStepSuccess(step2Execution, {
      summary: `Classified as ${issueAnalysisResult.issueType} (${issueAnalysisResult.severity})${issueAnalysisResult.isQuestionOnly ? ' - Question Only' : ''}${issueAnalysisResult.needsClarification ? ' - Needs Clarification' : ''}`,
      keyData: {
        issueType: issueAnalysisResult.issueType,
        severity: issueAnalysisResult.severity,
        requiresCodeChange: issueAnalysisResult.requiresCodeChange,
        isQuestionOnly: issueAnalysisResult.isQuestionOnly,
        needsClarification: issueAnalysisResult.needsClarification,
        questionsCount: issueAnalysisResult.clarificationQuestions?.length || 0,
      },
      researchAgentSessionId: issueAnalysisResult.researchAgentSessionId,
    });
    stepExecutions.push(step2Execution);

    logger.info(`[${ticketId}] ✅ Step 2 completed: Issue classified as ${issueAnalysisResult.issueType} (${issueAnalysisResult.severity})`);

    // Check if this is a question-only issue or needs clarification
    // Skip questions if:
    // 1. raiseQuestions is explicitly false
    // 2. debugAndFixDirectly is true (run analysis but skip questions)
    // 3. clarificationAnswers is provided (already answered in re-run)
    const shouldRaiseQuestions =
      input.raiseQuestions !== false &&
      !input.debugAndFixDirectly &&
      !input.clarificationAnswers;

    if (!shouldRaiseQuestions && (issueAnalysisResult.isQuestionOnly || issueAnalysisResult.needsClarification)) {
      const reason = input.debugAndFixDirectly
        ? 'debugAndFixDirectly: true'
        : input.clarificationAnswers
          ? 'clarificationAnswers provided'
          : 'raiseQuestions: false';
      logger.info(`[${ticketId}] ⏭️  Skipping question/clarification handling (${reason}) - proceeding to PR creation`);
    }

    if (shouldRaiseQuestions && issueAnalysisResult.isQuestionOnly) {
      logger.info(`[${ticketId}] 💬 Issue is a question - providing answer instead of creating PR`);
      logger.info(`[${ticketId}] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      logger.info(`[${ticketId}] 📊 WORKFLOW SUMMARY`);
      logger.info(`[${ticketId}] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      logger.info(`[${ticketId}] Issue Type:        ${issueAnalysisResult.issueType}`);
      logger.info(`[${ticketId}] Question Only:     Yes`);
      logger.info(`[${ticketId}] Answer Provided:   Yes`);
      if (stepErrors.length > 0) {
        logger.warn(`[${ticketId}] Step Errors:       ${stepErrors.length}`);
        stepErrors.forEach(err => {
          logger.error(`[${ticketId}]   - ${err.stepName}: ${err.error}`);
          if (err.retryInfo) {
            logger.error(`[${ticketId}]     Retries: ${err.retryInfo.totalAttempts - 1}/${err.retryInfo.maxRetries} (${err.retryInfo.totalAttempts} total attempts)`);
          }
        });
      }
      logger.info(`[${ticketId}] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

      return {
        issueType: issueAnalysisResult.issueType,
        severity: issueAnalysisResult.severity,
        issueCategory: issueAnalysisResult.issueCategory,
        gatewayName: issueAnalysisResult.gatewayName,
        repositories: repositoryResult.repositories,
        primaryRepository: repositoryResult.primary_repository,
        multiRepo: repositoryResult.multiRepo,
        affectedComponents: issueAnalysisResult.affectedComponents,
        requiresCodeChange: false,
        analysisApproach: issueAnalysisResult.analysisApproach,
        isQuestionOnly: true,
        answerToQuestion: issueAnalysisResult.answerToQuestion,
        stepExecutions,
        stepErrors: stepErrors.length > 0 ? stepErrors : undefined,
      };
    }

    if (shouldRaiseQuestions && issueAnalysisResult.needsClarification) {
      logger.info(`[${ticketId}] ❓ Issue needs clarification - asking questions instead of creating PR`);
      logger.info(`[${ticketId}] Questions: ${issueAnalysisResult.clarificationQuestions?.join('; ')}`);
      logger.info(`[${ticketId}] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      logger.info(`[${ticketId}] 📊 WORKFLOW SUMMARY`);
      logger.info(`[${ticketId}] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      logger.info(`[${ticketId}] Issue Type:        ${issueAnalysisResult.issueType}`);
      logger.info(`[${ticketId}] Needs Clarification: Yes`);
      logger.info(`[${ticketId}] Questions Count:   ${issueAnalysisResult.clarificationQuestions?.length || 0}`);
      if (stepErrors.length > 0) {
        logger.warn(`[${ticketId}] Step Errors:       ${stepErrors.length}`);
        stepErrors.forEach(err => {
          logger.error(`[${ticketId}]   - ${err.stepName}: ${err.error}`);
          if (err.retryInfo) {
            logger.error(`[${ticketId}]     Retries: ${err.retryInfo.totalAttempts - 1}/${err.retryInfo.maxRetries} (${err.retryInfo.totalAttempts} total attempts)`);
          }
        });
      }
      logger.info(`[${ticketId}] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

      return {
        issueType: issueAnalysisResult.issueType,
        severity: issueAnalysisResult.severity,
        issueCategory: issueAnalysisResult.issueCategory,
        gatewayName: issueAnalysisResult.gatewayName,
        repositories: repositoryResult.repositories,
        primaryRepository: repositoryResult.primary_repository,
        multiRepo: repositoryResult.multiRepo,
        affectedComponents: issueAnalysisResult.affectedComponents,
        rootCause: issueAnalysisResult.rootCause,
        suggestedSolution: issueAnalysisResult.suggestedSolution,
        requiresCodeChange: issueAnalysisResult.requiresCodeChange,
        analysisApproach: issueAnalysisResult.analysisApproach,
        needsClarification: true,
        clarificationQuestions: issueAnalysisResult.clarificationQuestions,
        stepExecutions,
        stepErrors: stepErrors.length > 0 ? stepErrors : undefined,
      };
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    const retryInfo = (error as any)?.retryInfo;

    logger.error(`[${ticketId}] ❌ STEP 2 Failed: ${errorMsg} - continuing with fallback analysis`);

    // Mark step as failed with fallback
    step2Execution = completeStepFailure(
      step2Execution,
      error instanceof Error ? error : new Error(errorMsg),
      {
        reason: 'Step failed - using default analysis',
        value: issueAnalysisResult,
      }
    );
    stepExecutions.push(step2Execution);

    stepErrors.push({
      step: IssueWorkflowSteps.ISSUE_ANALYSIS,
      stepName: 'Issue Analysis',
      error: errorMsg,
      errorStack: errorStack?.substring(0, 500),
      fallbackUsed: issueAnalysisResult,
      timestamp: new Date().toISOString(),
      retryInfo: retryInfo || undefined,
    });
  }

  // ============================================================================
  // STEP 3: Code Analysis (Conditional)
  // ============================================================================
  logger.info(`[${ticketId}] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  logger.info(`[${ticketId}] 💻 STEP 3: Code Analysis`);
  logger.info(`[${ticketId}] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  let codeAnalysisResult: CodeAnalysisResult | null = null;

  if (issueAnalysisResult.requiresCodeChange) {
    let step3Execution = startStepExecution(
      IssueWorkflowSteps.CODE_ANALYSIS,
      'Code Analysis',
      3
    );

    try {
      codeAnalysisResult = await engine.createCheckpoint(
        IssueWorkflowSteps.CODE_ANALYSIS,
        executeStep3CodeAnalysis,
        input,
        repositoryResult,
        issueAnalysisResult,
        ticketId,
        workflowConfig
      );

      // Mark step as successful
      if (codeAnalysisResult) {
        step3Execution = completeStepSuccess(step3Execution, {
          summary: `Code analysis completed - ${codeAnalysisResult.is_fixable ? 'Fixable' : 'Not Fixable'}`,
          keyData: {
            isFixable: codeAnalysisResult.is_fixable,
            affectedFilesCount: codeAnalysisResult.affected_files.length,
            requiresInvestigation: codeAnalysisResult.requires_investigation,
          },
          researchAgentSessionId: codeAnalysisResult.researchAgentSessionId,
        });
        stepExecutions.push(step3Execution);
      }

      logger.info(`[${ticketId}] ✅ Step 3 completed: Code analysis finished - Fixable: ${codeAnalysisResult?.is_fixable}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      const retryInfo = (error as any)?.retryInfo;

      logger.error(`[${ticketId}] ❌ STEP 3 Failed: ${errorMsg} - continuing without code analysis`);

      // Mark step as failed (no fallback for this step)
      step3Execution = completeStepFailure(
        step3Execution,
        error instanceof Error ? error : new Error(errorMsg)
      );
      stepExecutions.push(step3Execution);

      stepErrors.push({
        step: IssueWorkflowSteps.CODE_ANALYSIS,
        stepName: 'Code Analysis',
        error: errorMsg,
        errorStack: errorStack?.substring(0, 500),
        fallbackUsed: null,
        timestamp: new Date().toISOString(),
        retryInfo: retryInfo || undefined,
      });
    }
  } else {
    logger.info(`[${ticketId}] ⏭️  Step 3 skipped: No code change required`);
    stepExecutions.push(skipStep(
      IssueWorkflowSteps.CODE_ANALYSIS,
      'Code Analysis',
      3,
      'No code change required'
    ));
  }

  // ============================================================================
  // STEP 4: Create Fix or Investigation Report
  // ============================================================================
  logger.info(`[${ticketId}] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  logger.info(`[${ticketId}] 🔧 STEP 4: Create Fix or Investigation Report`);
  logger.info(`[${ticketId}] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  let step4Execution = startStepExecution(
    IssueWorkflowSteps.CREATE_FIX_OR_REPORT,
    'Create Fix or Investigation Report',
    4
  );

  let fixResult: {
    prLink?: string;
    prLinks?: Record<string, string>;
    gitDiff?: string;
    commitHash?: string;
    investigationReport?: string;
  } = {};

  try {
    logger.info(`[${ticketId}] Calling createCheckpoint for Step 4...`);

    fixResult = await engine.createCheckpoint(
      IssueWorkflowSteps.CREATE_FIX_OR_REPORT,
      executeStep4CreateFixOrReport,
      input,
      repositoryResult,
      issueAnalysisResult,
      codeAnalysisResult,
      ticketId,
      workflowConfig,
      engine
    );

    logger.info(`[${ticketId}] createCheckpoint returned successfully`);

    // Mark step as successful
    const hasPR = fixResult.prLink || fixResult.prLinks;
    const hasReport = fixResult.investigationReport;
    step4Execution = completeStepSuccess(step4Execution, {
      summary: hasPR ? `PR created: ${fixResult.prLink || Object.keys(fixResult.prLinks || {}).length + ' PRs'}` : (hasReport ? 'Investigation report generated' : 'Completed'),
      keyData: {
        prCreated: !!hasPR,
        reportGenerated: !!hasReport,
        prLink: fixResult.prLink,
        prLinks: fixResult.prLinks,
        commitHash: fixResult.commitHash,
      },
    });
    stepExecutions.push(step4Execution);

    logger.info(`[${ticketId}] ✅ Step 4 completed: ${fixResult.prLink ? 'PR created' : 'Investigation report generated'}`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    const retryInfo = (error as any)?.retryInfo;

    logger.error(`[${ticketId}] ❌ STEP 4 Failed: ${errorMsg}`);
    logger.error(`[${ticketId}] Error stack: ${errorStack?.substring(0, 1000)}`);

    // Mark step as failed with fallback
    step4Execution = completeStepFailure(
      step4Execution,
      error instanceof Error ? error : new Error(errorMsg),
      {
        reason: 'Step 4 failed - see error details',
        value: fixResult,
      }
    );
    stepExecutions.push(step4Execution);

    stepErrors.push({
      step: IssueWorkflowSteps.CREATE_FIX_OR_REPORT,
      stepName: 'Create Fix or Report',
      error: errorMsg,
      errorStack: errorStack?.substring(0, 500),
      fallbackUsed: fixResult,
      timestamp: new Date().toISOString(),
      retryInfo: retryInfo || undefined,
    });

    // Continue workflow - don't rethrow
    logger.warn(`[${ticketId}] Continuing workflow despite Step 4 failure`);
  }

  // Build output (no try-catch needed here)
  try {

    // Build output
    const output: IssueWorkflowOutput = {
      issueType: issueAnalysisResult.issueType,
      severity: issueAnalysisResult.severity,
      issueCategory: issueAnalysisResult.issueCategory,
      gatewayName: issueAnalysisResult.gatewayName,
      repositories: repositoryResult.repositories,
      primaryRepository: repositoryResult.primary_repository,
      multiRepo: repositoryResult.multiRepo,
      affectedComponents: issueAnalysisResult.affectedComponents,
      rootCause: issueAnalysisResult.rootCause,
      suggestedSolution: issueAnalysisResult.suggestedSolution,
      requiresCodeChange: issueAnalysisResult.requiresCodeChange,
      analysisApproach: issueAnalysisResult.analysisApproach,
      analysisDetails: codeAnalysisResult || undefined,
      needsClarification: issueAnalysisResult.needsClarification,
      clarificationQuestions: issueAnalysisResult.clarificationQuestions,
      isQuestionOnly: issueAnalysisResult.isQuestionOnly,
      answerToQuestion: issueAnalysisResult.answerToQuestion,
      prLink: fixResult.prLink,
      prLinks: fixResult.prLinks,
      gitDiff: fixResult.gitDiff,
      commitHash: fixResult.commitHash,
      investigationReport: fixResult.investigationReport,
      stepExecutions,
      stepErrors: stepErrors.length > 0 ? stepErrors : undefined,
    };

    // ============================================================================
    // WORKFLOW COMPLETION
    // ============================================================================
    logger.info(`[${ticketId}] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    const hasErrors = stepErrors.length > 0;
    if (hasErrors) {
      logger.warn(`[${ticketId}] ⚠️  Issue Workflow completed WITH ERRORS (${stepErrors.length} step(s) failed)`);
      logger.warn(`[${ticketId}] Failed steps: ${stepErrors.map(e => e.stepName).join(', ')}`);
      stepErrors.forEach(err => {
        logger.error(`[${ticketId}]   - ${err.stepName}: ${err.error}`);
        if (err.retryInfo) {
          logger.error(`[${ticketId}]     Retries: ${err.retryInfo.totalAttempts - 1}/${err.retryInfo.maxRetries} (${err.retryInfo.totalAttempts} total attempts)`);
        }
      });
    } else {
      logger.info(`[${ticketId}] ✅ Issue Workflow completed successfully - ALL STEPS PASSED`);
    }

    logger.info(`[${ticketId}] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    logger.info(`[${ticketId}] 📊 WORKFLOW SUMMARY`);
    logger.info(`[${ticketId}] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    logger.info(`[${ticketId}] Issue Type:        ${output.issueType}`);
    logger.info(`[${ticketId}] Severity:          ${output.severity}`);
    logger.info(`[${ticketId}] Category:          ${output.issueCategory}`);
    logger.info(`[${ticketId}] Gateway:           ${output.gatewayName || 'N/A'}`);
    logger.info(`[${ticketId}] Repositories:      ${output.repositories.join(', ')}`);
    logger.info(`[${ticketId}] Multi-Repo:        ${output.multiRepo}`);
    logger.info(`[${ticketId}] Requires Code:     ${output.requiresCodeChange}`);
    logger.info(`[${ticketId}] Analysis Approach: ${output.analysisApproach}`);

    // Log question/clarification status
    if (output.isQuestionOnly) {
      logger.info(`[${ticketId}] Question Only:     Yes`);
      logger.info(`[${ticketId}] Answer Provided:   ${output.answerToQuestion ? 'Yes' : 'No'}`);
    } else if (output.needsClarification) {
      logger.info(`[${ticketId}] Needs Clarification: Yes`);
      logger.info(`[${ticketId}] Questions Count:   ${output.clarificationQuestions?.length || 0}`);
    } else {
      logger.info(`[${ticketId}] PR Created:        ${output.prLink ? 'Yes' : (output.prLinks ? 'Yes (Multi)' : 'No')}`);
      logger.info(`[${ticketId}] Investigation:     ${output.investigationReport ? 'Yes' : 'No'}`);
    }

    if (hasErrors) {
      logger.info(`[${ticketId}] Step Errors:       ${stepErrors.length}`);
    }
    logger.info(`[${ticketId}] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    return output;
  } catch (error) {
    // This catch block should rarely be hit since all steps have their own try-catch
    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    logger.error(`[${ticketId}] ❌ Workflow failed with unexpected error: ${errorMsg}`);
    logger.error(`[${ticketId}] Error stack:`, errorStack);

    // Return error output
    return {
      issueType: 'unknown',
      severity: 'unknown',
      repositories: [],
      multiRepo: false,
      affectedComponents: [],
      requiresCodeChange: false,
      stepErrors,
      error: {
        message: errorMsg,
        step: 'unknown',
        details: errorStack,
        timestamp: new Date().toISOString(),
      },
    };
  }
}

// ============================================================================
// Export Workflow Definition
// ============================================================================

export const issueWorkflow: WorkflowDefinition<
  IssueWorkflowInput & { ticketId: string },
  IssueWorkflowOutput,
  typeof IssueWorkflowSteps
> = {
  type: WorkflowType.ISSUE_WORKFLOW,
  name: 'Issue Workflow',
  description: 'Automated issue analysis and resolution workflow',
  inputSchema: IssueWorkflowInputSchema,
  contextMapper,
  execute,
  category: 'automation',
  tags: ['issues', 'bug-fixing', 'automated', 'analysis'],
  priority: 'medium',
  estimatedDuration: 10 * 60 * 1000, // 10 minutes
};
