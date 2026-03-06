/**
 * TypeScript types for Integrity Debug Workflow
 * Matches the JSON schemas from research agent prompts
 */

/**
 * Session data from CSV input
 */
export interface SessionData {
  orderId: string;
  merchantId: string;
  failureReason: string;
  gateway: string;
  flow: 'WEBHOOK' | 'REDIRECTION' | 'SYNC';
}

/**
 * Transaction detail fields from DB
 */
export interface TxnDetailLog {
  offerDeductionAmount: number | null | 'NOT_FOUND';
  txnAmount: number | 'NOT_FOUND';
  netAmount: number | 'NOT_FOUND';
  surchargeAmount: number | 'NOT_FOUND';
  taxAmount: number | 'NOT_FOUND';
  currency: string | 'NOT_FOUND';
}

/**
 * Order reference fields from DB
 */
export interface OrderReferenceLog {
  orderAmount: number | 'NOT_FOUND';
  currency: string | 'NOT_FOUND';
}

/**
 * Gateway initiation log entry
 */
export interface GatewayInitiationLog {
  timestamp?: string;
  action?: string;
  gateway?: string;
  amount_sent_to_gateway?: string;
  [key: string]: any; // Allow additional fields
}

/**
 * GW-based pay webhook log entry
 */
export interface GwBasedPayWebhookLog {
  timestamp?: string;
  api_tag?: string;
  url?: string;
  gateway_response?: any;
  response_code?: number;
  error_info?: any;
  [key: string]: any; // Allow additional fields
}

/**
 * Pay response log entry
 */
export interface PayResponseLog {
  endpoint_references?: string[];
  status?: string;
  error_code?: string;
  error_message?: string;
  amount?: string;
  [key: string]: any; // Allow additional fields
}

/**
 * Sync log entry
 */
export interface SyncLog {
  flow_name?: string;
  timestamp?: string;
  api_tag?: string;
  action?: string;
  sync_response?: any;
  [key: string]: any; // Allow additional fields
}

/**
 * Flow-specific logs
 */
export interface FlowLogs {
  gateway_initiation_logs: GatewayInitiationLog[];
  gw_based_pay_webhooks: GwBasedPayWebhookLog[];
  pay_response_logs: PayResponseLog[];
  sync_logs: SyncLog[];
}

/**
 * Aggregated log session
 */
export interface AggregatedLogSession {
  order_id: string;
  merchant_id: string;
  gateway: string;
  flow: 'WEBHOOK' | 'REDIRECTION' | 'SYNC';
  txn_detail: TxnDetailLog;
  order_reference: OrderReferenceLog;
  flow_logs: FlowLogs;
}

/**
 * Log completeness metrics
 */
export interface LogCompleteness {
  sessions_with_complete_data: number;
  sessions_with_missing_data: number;
  missing_fields_summary: string[];
}

/**
 * Complete aggregated logs response from research agent
 */
export interface AggregatedLogs {
  sessions: AggregatedLogSession[];
  log_completeness: LogCompleteness;
}

/**
 * Log discrepancy found during analysis
 */
export interface LogDiscrepancy {
  session: string;
  field: string;
  expected_value: string;
  actual_value: string;
  source: 'txn_detail' | 'order_reference' | 'gateway_response';
}

/**
 * Code issue found during analysis
 */
export interface CodeIssue {
  problem: string;
  current_implementation: string;
  correct_implementation: string;
}

/**
 * Detailed findings from code analysis
 */
export interface DetailedFindings {
  log_discrepancies: LogDiscrepancy[];
  code_issues: CodeIssue[];
}

/**
 * Affected file information
 */
export interface AffectedFile {
  file_path: string;
  function_name: string;
  line_numbers: string;
  issue_description: string;
}

/**
 * Code change required for fix
 */
export interface CodeChange {
  file: string;
  change_description: string;
}

/**
 * Suggested fix details
 */
export interface SuggestedFix {
  type: 'field_replacement' | 'add_validation' | 'calculation_fix' | 'gateway_escalation';
  description: string;
  code_changes: CodeChange[];
}

/**
 * Repository identification result from research agent
 */
export interface RepositoryIdentificationResult {
  repository: 'euler-api-gateway' | 'euler-api-txns';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  reasoning: string;
  found_files: string[];
}

/**
 * Code analysis result from research agent
 */
export interface CodeAnalysisResult {
  analysis_summary: string;
  is_our_issue: boolean;
  issue_type: 'wrong_field_usage' | 'missing_validation' | 'incorrect_calculation' | 'gateway_data_issue' | 'gateway_missing_field';
  responsible_party: 'our_code' | 'gateway';
  repository: 'api-gateway' | 'api-txns' | null;
  affected_files: AffectedFile[];
  detailed_findings: DetailedFindings;
  suggested_fix: SuggestedFix;
  pr_description_draft: string | null;
  gateway_escalation_details: string | null;
}

/**
 * Workflow output - NEW 4-STEP WORKFLOW
 */
export interface IntegrityDebugWorkflowOutput {
  sessionsAnalyzed: number;
  issueType: 'our_issue' | 'gateway_issue';
  repository?: string;
  prLink?: string;
  gitDiff?: string;
  commitHash?: string;
  gatewayIssueReport?: string;
  logsAggregated: any; // Now contains collected logs (Step 3 output)
  analysisDetails: any; // Now contains comprehensive analysis (Step 4 output)
  logRequirements?: any; // NEW: Log requirements from Step 2
  integrityLocationsAnalyzed?: number; // NEW: Count of integrity locations analyzed

  // Step errors (individual steps that failed but workflow continued)
  stepErrors?: Array<{
    step: string;
    stepName: string;
    error: string;
  }>;

  // Fatal error (workflow completely failed)
  error?: {
    message: string;
    step: string;
    stepName?: string;
    details?: string;
    timestamp: string;
  };
}
