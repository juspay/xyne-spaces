// Type definitions for Xyne Auto RCA Workflow

import type { BaseWorkflowContext } from '../../workflow-types';

/**
 * User context for the RCA investigation API headers
 * Populated from the user who triggered the workflow
 */
export interface RcaUserContext {
  email: string;
  userId: string;
  userName: string;
}


/**
 * Webhook payload received when RCA investigation completes
 */
export interface RcaWebhookPayload {
  session_id: string;
  status: 'completed' | 'failed' | string;
  message?: string;
  error?: string;
}

/**
 * Response from the RCA Investigation API
 */
export interface RcaInvestigationResponse {
  session_id: string;
  status: 'success' | 'invoked' | string;
}

/**
 * Result type for investigation step
 */
export interface RcaInvestigationStepResult {
  sessionId: string;
  status: string;
}

/**
 * Investigation status response from status endpoint
 */
export interface RcaInvestigationStatusResponse {
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

/**
 * Ticket details for the workflow
 */
export interface TicketDetails {
  id: string;
  title: string;
  description: string;
  metadata: Record<string, any>;
  createdBy: string;
}

/**
 * Workflow context - contains ticketId and affected user email
 */
export interface XyneAutoRcaWorkflowContext extends BaseWorkflowContext {
  ticketId: string;
  affectedUserEmail: string;
}

/**
 * Canvas creation result
 */
export interface CanvasResult {
  canvasId: string;
  canvasUrl: string;
}

/**
 * Share canvas link result
 */
export interface ShareCanvasResult {
  success: boolean;
  messageId: string;
}

/**
 * Workflow output
 */
export interface XyneAutoRcaWorkflowOutput {
  success: boolean;
  sessionId: string;
  investigationResult: string;
  canvasUrl?: string;
  canvasId?: string;
}
