/**
 * Configuration for Integrity Debug Workflow
 * Makes prompts and behavior configurable via environment variables
 */

export interface IntegrityDebugWorkflowConfig {
  // Mock mode configuration (for local development/testing only)
  useMockAnalysis: boolean;

  // Repository paths (for local development)
  localRepoPath?: {
    'api-txns': string;
    'api-gateway': string;
  };

  // Local mode - apply changes directly to local repo (for testing)
  applyChangesToLocalRepo: boolean;  // If true, copy changes from /tmp to local repo

  // Prompts configuration
  prompts: {
    // Constraint for which files can be modified
    fileModificationConstraint: string;

    // Instructions for PR creation (always creates PR in production)
    prCreationInstructions: string;

    // Additional context for the agent
    additionalContext?: string;
  };

  // Research Agent Names (system prompts come from agent table in database)
  agents: {
    step1: string;  // Repository identifier agent
    step2: string;  // Amount format analyzer agent
    step3: string;  // Log requirements analyzer agent
    step4: string;  // Log collector agent
    step5: string;  // Code analyzer agent
  };
}

// Git configuration constants (hardcoded - rarely change)
export const INTEGRITY_GIT_CONFIG = {
  analysisBaseBranch: 'main',      // Branch to checkout for code analysis
  prTargetBranch: 'staging',        // Target branch for PR creation
  branchPrefix: 'integrity-fix',    // Prefix for fix branch names
  commitMessageTemplate: 'fix: {summary}\n\n{details}\n\nTicket: {ticketId}',
} as const;

/**
 * Load configuration from environment variables
 */
export function loadWorkflowConfig(): IntegrityDebugWorkflowConfig {
  const useMockAnalysis = process.env.USE_MOCK_ANALYSIS === 'true';

  // In local/mock mode, apply changes to local repo by default (for testing only)
  const applyChangesToLocalRepo = process.env.APPLY_CHANGES_TO_LOCAL_REPO === 'true'
    || useMockAnalysis;

  // Default prompts
  const defaultFileConstraint = process.env.INTEGRITY_FILE_CONSTRAINT ||
    'Only modify gateway-specific files (e.g., Gateway/*/Flow.hs, Gateway/*/*.hs). Do NOT modify core service files like VerifyIntegrityService.hs or any shared utility files.';

  // Always create PR in production (default behavior)
  const defaultPRInstructions = 'Create a pull request with the changes and provide the PR link.';

  return {
    useMockAnalysis,
    applyChangesToLocalRepo,

    localRepoPath: process.env.LOCAL_REPO_PATHS ? JSON.parse(process.env.LOCAL_REPO_PATHS) : {
      'api-txns': process.env.API_TXNS_REPO_PATH,
      'api-gateway': process.env.API_GATEWAY_REPO_PATH,
    },

    prompts: {
      fileModificationConstraint: defaultFileConstraint,
      prCreationInstructions: defaultPRInstructions,
      additionalContext: process.env.INTEGRITY_ADDITIONAL_CONTEXT,
    },

    // Research Agent Names (system prompts defined in workflow config and stored in database)
    agents: {
      step1: 'integrity-step1-repository-identifier',
      step2: 'integrity-step2-amount-format-analyzer',
      step3: 'integrity-step3-log-requirements-analyzer',
      step4: 'integrity-step4-log-collector',
      step5: 'integrity-step5-code-analyzer',
    },
  };
}
