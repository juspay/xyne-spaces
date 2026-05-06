/**
 * TypeScript types for Issue Workflow
 */

/**
 * Input to the issue workflow
 */
export interface IssueWorkflowInput {
  description: string;  // User's description of the issue
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

  // Multi-repo PR links
  prLinks?: {
    [repository: string]: string;
  };
  prLink?: string; // Legacy single PR link for backward compatibility

  gitDiff?: string;
  commitHash?: string;
  investigationReport?: string;

  // Error tracking
  stepErrors?: Array<{
    step: string;
    stepName: string;
    error: string;
  }>;

  error?: {
    message: string;
    step: string;
    stepName?: string;
    details?: string;
    timestamp: string;
  };
}
