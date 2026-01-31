/**
 * Types for Xyne AI Session Storage
 * 
 * Message content structure by role (matches stream events):
 * - user: { query: string, timestamp: string }
 * - tool (input): { type: "tool_input", toolName: string, input: unknown }
 * - tool (output): { type: "tool_output", toolName: string, content: unknown }
 * - assistant: { summary: string, keyPoints: KeyPointWithCitation[] }
 */

export type { Citation, KeyPointWithCitation, XyneAIOutput } from '../types';

import type { XyneAIOutput } from '../types';
export type AgentOutput = XyneAIOutput;

// User message content structure
export interface UserMessageContent {
  query: string;
  timestamp: string;
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
