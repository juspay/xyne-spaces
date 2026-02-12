/**
 * Types for Xyne AI Session Storage
 *
 * Message content structure by role (matches stream events):
 * - user: { query: string, timestamp: string }
 * - tool (input): { type: "tool_input", toolName: string, input: unknown }
 * - tool (output): { type: "tool_output", toolName: string, content: unknown }
 * - assistant: { summary: string, keyPoints: KeyPointWithCitation[] }
 *
 * Note: Attachments are no longer stored in the data column.
 * They are uploaded to GCS and metadata is stored in the attachment column.
 */

export type { Citation, KeyPointWithCitation, XyneAIOutput, AttachmentData } from '../types';

import type { XyneAIOutput, AttachmentData } from '../types';
export type AgentOutput = XyneAIOutput;

/**
 * GCS Attachment Metadata
 * Stored in WorkflowStep.attachment column as JSON string
 */
export interface AttachmentMetadata {
  attachment_id: string;  // Unique ID for this attachment
  url: string;            // GCS path (e.g., "attachments/ASKAI/session_abc/...")
  mime_type: string;      // MIME type (e.g., "image/png")
  file_name: string;      // Sanitized filename
  size: number;           // File size in bytes
}

/**
 * User message content structure
 *
 * Note: attachments are NOT stored in the data column.
 * They are uploaded to GCS (metadata in attachment column).
 * When building history, convertMessagesToHistory() fetches them from GCS
 * and populates this attachments field with base64 data for JAF.
 */
export interface UserMessageContent {
  query: string;
  timestamp: string;
  attachments?: AttachmentData[];  // Populated by fetching from GCS (not from DB)
}

// User message
export interface UserMessage {
  role: 'USER';
  content: UserMessageContent;
}

// Assistant message - contains final output (summary + keyPoints)
export interface AssistantMessage {
  role: 'ASSISTANT';
  content: XyneAIOutput;
}

// History message is user or assistant only (tools are stored but not in history)
export type HistoryMessage = UserMessage | AssistantMessage;

// ============================================================================
// Tool Message Content Types (matches stream events exactly)
// ============================================================================

export interface ToolInputContent {
  type: 'tool_input';
  toolName: string;
  input: unknown;
}

export interface ToolOutputContent {
  type: 'tool_output';
  toolName: string;
  content: unknown;
}

export type ToolContent = ToolInputContent | ToolOutputContent;

// Session context - information about the channels/thread
export interface SessionContext {
  channelIds: string[];
  conversationId?: string;
  userId: string;
}

// Full session data
export interface XyneAISession {
  sessionId: string;
  context: SessionContext;
  history: HistoryMessage[];
  createdAt: string;
  updatedAt: string;
}
