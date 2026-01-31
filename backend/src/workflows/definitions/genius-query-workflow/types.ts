// Type definitions for Genius Query Workflow

export interface MerchantIdErrorData {
  merchantIdOptions: string[];
}

export interface QueryRoutingRequest {
  query: string;
  agent: string;
  source: string;
  session_id: string;
  email: string;
  stream: string;
}

export interface QueryRoutingResponse {
  session_id: string;
  user_type: string;
  environment: string;
  merchant_id: string;
  status: 'success' | 'merchant_id_mismatch' | string;
  merchant_id_options?: string[];
}

export interface InvestigationStatusResponse {
  session_id: string;
  query: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number | null;
  ai_thinking: string | null;
  latest_thinking: string | null;
  partial_result: any | null;
  result: {
    markdown: string;
    template_response: {
      text: string;
    };
    tools_used: string[];
    duration_seconds: number;
    token_usage: any | null;
  } | null;
  error: string | null;
  can_accept_followup: boolean;
  has_notification_configured: boolean;
  created_at: string;
  started_at: string;
  completed_at: string | null;
  stage: string;
  facts: any[];
  hypotheses: any[];
  tasks: any[];
  primary_root_cause: any | null;
  confidence: number | null;
}

export interface CategorizationRequest {
  product: string;
  question: string;
  mode: string;
}

export interface CategorizationApiResponse {
  data: {
    result: CategorizationResult;
    success: boolean;
  };
  message: string;
  success: boolean;
}

export interface CategorizationResult {
  'Action By': string;
  Attachment: boolean;
  Classifications: string;
  Environment: string;
  'Extra IDs': string | null;
  Incidence: string;
  'Incidence Primary': string;
  'Incidence Secondary': string;
  'Issue Sub Category': string;
  'Issue Type': string;
  'Last Modified By': string;
  Merchant: string;
  'Merchant Followup': boolean;
  'Payment Gateway': string | null;
  'Payment Method': string | null;
  'Payment Method Type': string | null;
  Platform: string | null;
  'Priority Type': string[];
  'Proposed Resolution': string | null;
  'Query Type': string;
  'Reported Date': string | null;
  'Sample Customer ID': string | null;
  'Sample Order ID': string | null;
  'Sample Refund ID': string | null;
  Severity: string;
  Subject: string;
  Tag: string;
  'Text Tone': string;
  'Thread Id': string;
  'Ticket Category': string | null;
  'Ticket Genre': string;
  'Ticket Id': string;
  'Ticket Status': string;
  'Time to give Resolution': string | null;
  Tone: string;
  additional_data: {
    duplicate_ticket_number?: string;
    endTime?: string;
    is_duplicate_ticket?: boolean;
    startTime?: string;
  };
  assignee: string | null;
  ccEmailAddress: string | null;
  departmentId: string | null;
  eventType: string | null;
  fromEmailAddress: string;
  html_body: string;
  input: {
    body: string;
    negative_sentiment: number;
    neutral_sentiment: number;
    positive_sentiment: number;
    sentiment: string;
    ticket_id: string;
  };
  mandate_id: string | null;
  merchant_order_status: string | null;
  negative_sentiment: number;
  neutral_sentiment: number;
  notification_id: string | null;
  parse_reason: Record<string, any>;
  positive_sentiment: number;
  sentiment: string;
  summary: string;
  ticketNumber: string | null;
  toEmailAddress: string;
  txn_id: string | null;
  txn_uuid: string | null;
  webUrl: string | null;
}
export type CategorizationResponse = CategorizationResult;

export interface TicketDetails {
  id: string;
  title: string;
  description: string;
  metadata: Record<string, any>;
  zohoTicketId?: string;
  email?: string;
}

export interface DraftResponse {
  session_id: string;
  draft: string;
  merchant_id: string;
  message: string;
}

export interface GeniusQueryWorkflowOutput {
  success: boolean;
  sessionId: string;
  investigationResult: string;
  categorizationApplied: boolean;
  messageCreated: boolean;
}
