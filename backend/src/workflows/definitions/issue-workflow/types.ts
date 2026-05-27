/**
 * TypeScript types for Issue Workflow
 */

/**
 * Input to the issue workflow
 */
export interface IssueWorkflowInput {
  description: string;  // User's description of the issue
  raiseQuestions?: boolean;  // If false, skip question/clarification and always create PR (default: true)
  solution?: string;  // If provided, skip analysis and directly create PR with this solution
  clarificationAnswers?: string;  // Answers to clarification questions from previous run (enables re-run after questions)
  debugAndFixDirectly?: boolean;  // If true, run full analysis but skip questions and create PR directly (default: false)
}

/**
 * Repository identification result
 */
export interface RepositoryIdentificationResult {
  repositories: string[]; // List of affected repositories
  primary_repository?: string; // Primary repository if there's a main one
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  reasoning: string;
  affectedComponents: string[];
  multiRepo: boolean; // Whether this affects multiple repositories
  researchAgentSessionId?: string; // Research Agent session ID for debugging
}

/**
 * Issue analysis result
 */
export interface IssueAnalysisResult {
  issueType: 'bug' | 'feature_request' | 'improvement' | 'question' | 'other';
  severity: 'critical' | 'high' | 'medium' | 'low';
  issueCategory: 'gateway' | 'core_flow' | 'multi_repo' | 'other';
  gatewayName?: string | null; // Specific gateway name if it's a gateway issue
  affectedComponents: string[];
  rootCause?: string;
  suggestedSolution?: string;
  requiresCodeChange: boolean;
  estimatedComplexity: 'simple' | 'moderate' | 'complex';
  analysisApproach: 'code_and_logs_first' | 'configuration_check' | 'requires_investigation';

  // Question/Clarification handling
  needsClarification: boolean; // True if we need to ask questions before proceeding
  clarificationQuestions?: string[]; // List of questions to ask the user
  isQuestionOnly: boolean; // True if this is purely a question that needs an answer (not a fix)
  answerToQuestion?: string; // If isQuestionOnly=true, this contains the answer

  researchAgentSessionId?: string; // Research Agent session ID for debugging
}

/**
 * Code analysis result
 */
export interface CodeAnalysisResult {
  analysis_summary: string;
  is_fixable: boolean;
  affected_files: Array<{
    repository?: string; // Repository name (optional for backward compatibility)
    file_path: string;
    function_name?: string;
    line_numbers?: string;
    issue_description: string;
  }>;
  suggested_fix?: {
    type: 'code_change' | 'configuration' | 'documentation' | 'investigation_needed';
    description: string;
    code_changes?: Array<{
      repository?: string; // Repository name (optional for backward compatibility)
      file: string;
      change_description: string;
    }>;
  };
  requires_investigation?: boolean;
  investigation_steps?: string[];
  researchAgentSessionId?: string; // Research Agent session ID for debugging
}

/**
 * Step execution details for table view debugging
 */
export interface StepExecutionDetail {
  stepId: string; // Step identifier (e.g., "repository-identification")
  stepName: string; // Human-readable name (e.g., "Repository Identification")
  stepNumber: number; // Sequential number (1, 2, 3, 4)
  status: 'success' | 'failed' | 'skipped' | 'running'; // Execution status
  startTime: string; // ISO timestamp when step started
  endTime?: string; // ISO timestamp when step completed
  durationMs?: number; // Execution duration in milliseconds

  // Research Agent tracking
  researchAgentSessionId?: string; // Research agent session ID for this step

  // Retry information
  retryInfo?: {
    totalAttempts: number; // Total attempts made (including initial)
    maxRetries: number; // Maximum retries configured
    attemptsFailed: number; // How many attempts failed
    attemptsSucceeded: number; // How many attempts succeeded (0 or 1)
    allErrors: string[]; // All error messages from failed attempts
  };

  // Error details (if failed)
  error?: {
    message: string; // Error message
    stack?: string; // Stack trace (truncated)
    timestamp: string; // When error occurred
  };

  // Fallback information (if used)
  fallback?: {
    used: boolean; // Was a fallback used?
    reason: string; // Why fallback was used
    value: any; // Fallback value used
  };

  // Step output summary (for quick reference)
  output?: {
    summary: string; // Brief summary of step output
    keyData?: Record<string, any>; // Key data points from this step
  };
}

/**
 * Workflow output
 */
export interface IssueWorkflowOutput {
  issueType: string;
  severity: string;
  issueCategory?: string; // gateway | core_flow | multi_repo | other
  gatewayName?: string | null; // Specific gateway name if applicable
  repositories: string[]; // All affected repositories
  primaryRepository?: string; // Primary repository if applicable
  multiRepo: boolean; // Whether this is a multi-repo issue
  affectedComponents: string[];
  rootCause?: string;
  suggestedSolution?: string;
  requiresCodeChange: boolean;
  analysisApproach?: string; // code_and_logs_first | configuration_check | requires_investigation
  analysisDetails?: CodeAnalysisResult;

  // Question/Clarification handling
  needsClarification?: boolean; // True if workflow needs more information
  clarificationQuestions?: string[]; // Questions to ask the user
  isQuestionOnly?: boolean; // True if this was a question that got answered
  answerToQuestion?: string; // The answer to the user's question

  // Multi-repo PR links
  prLinks?: {
    [repository: string]: string;
  };
  prLink?: string; // Legacy single PR link for backward compatibility

  gitDiff?: string;
  commitHash?: string;
  investigationReport?: string;

  // Step execution details (for table view debugging)
  stepExecutions?: StepExecutionDetail[];

  // Error tracking (legacy - kept for backward compatibility)
  stepErrors?: Array<{
    step: string;
    stepName: string;
    error: string;
    errorStack?: string;
    fallbackUsed?: any;
    timestamp: string;
    attemptNumber?: number; // Which retry attempt failed (if applicable)
    retryInfo?: {
      totalAttempts: number;
      maxRetries: number;
      allErrors: string[]; // All error messages from retries
    };
  }>;

  error?: {
    message: string;
    step: string;
    stepName?: string;
    details?: string;
    timestamp: string;
  };
}
