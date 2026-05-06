/**
 * Configuration for Issue Workflow
 * Makes prompts and behavior configurable via environment variables
 */

export interface IssueWorkflowConfig {
  // Mock mode configuration (for local development/testing only)
  useMockAnalysis: boolean;

  // Repository paths (for local development)
  localRepoPath?: {
    'api-txns': string;
    'api-gateway': string;
  };

  // Local mode - apply changes directly to local repo (for testing)
  applyChangesToLocalRepo: boolean;  // If true, copy changes from /tmp to local repo

  // Retry configuration
  retry: {
    enabled: boolean;
    maxRetries: number;
    retryDelayMs: number;
    exponentialBackoff: boolean;
  };

  // Prompts configuration
  prompts: {
    // Constraint for which files can be modified
    fileModificationConstraint: string;

    // Instructions for PR creation
    prCreationInstructions: string;

    // Additional context for the agent
    additionalContext?: string;
  };

  // Research Agent Names (system prompts come from agent table in database)
  agents: {
    step1: string;  // Repository identifier agent
    step2: string;  // Issue analyzer agent
    step3: string;  // Code analyzer agent
  };
}

// Git configuration constants (hardcoded - rarely change)
export const ISSUE_GIT_CONFIG = {
  analysisBaseBranch: 'main',      // Branch to checkout for code analysis
  prTargetBranch: 'staging',        // Target branch for PR creation
  branchPrefix: 'issue-fix',        // Prefix for fix branch names
  commitMessageTemplate: 'fix: {summary}\n\n{details}\n\nTicket: {ticketId}',
} as const;

/**
 * Load configuration from environment variables
 */
export function loadWorkflowConfig(): IssueWorkflowConfig {
  const useMockAnalysis = process.env.USE_MOCK_ANALYSIS === 'true';

  // In local/mock mode, apply changes to local repo by default (for testing only)
  const applyChangesToLocalRepo = process.env.APPLY_CHANGES_TO_LOCAL_REPO === 'true'
    || useMockAnalysis;

  // Default prompts
  const defaultFileConstraint = process.env.ISSUE_FILE_CONSTRAINT ||
    'Only modify files relevant to the reported issue. Do NOT modify unrelated core service files or shared utilities.';

  const defaultPRInstructions = 'Create a pull request with the changes and provide the PR link.';

  return {
    useMockAnalysis,
    applyChangesToLocalRepo,

    localRepoPath: process.env.LOCAL_REPO_PATHS ? JSON.parse(process.env.LOCAL_REPO_PATHS) : {
      'api-txns': process.env.API_TXNS_REPO_PATH,
      'api-gateway': process.env.API_GATEWAY_REPO_PATH,
    },

    // Retry configuration - defaults to 5 retries with exponential backoff
    retry: {
      enabled: process.env.ISSUE_RETRY_ENABLED !== 'false', // Enabled by default
      maxRetries: parseInt(process.env.ISSUE_MAX_RETRIES || '5', 10),
      retryDelayMs: parseInt(process.env.ISSUE_RETRY_DELAY_MS || '2000', 10),
      exponentialBackoff: process.env.ISSUE_EXPONENTIAL_BACKOFF !== 'false', // Enabled by default
    },

    prompts: {
      fileModificationConstraint: defaultFileConstraint,
      prCreationInstructions: defaultPRInstructions,
      additionalContext: process.env.ISSUE_ADDITIONAL_CONTEXT,
    },

    // Research Agent Names (system prompts defined in workflow config and stored in database)
    agents: {
      step1: 'issue-step1-repository-identifier',
      step2: 'issue-step2-issue-analyzer',
      step3: 'issue-step3-code-analyzer',
    },
  };
}
