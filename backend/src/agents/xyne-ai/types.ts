/**
 * Xyne AI Agent Types
 * 
 * API request, streaming chunks, and output types.
 */

import type { UserInfo } from './tools/index.js';

// ============================================================================
// Request Types
// ============================================================================

export interface XyneAIRequest {
  query: string;
  sessionId?: string;
  channelIds: string[];
  conversationId?: string;
  userId: string;
  currentTimestamp?: string | null;
  userInfo?: UserInfo;
  webSearchEnabled?: boolean;  // Enable/disable web search tool
}

// ============================================================================
// Citation & Output Types
// ============================================================================

export interface Citation {
  messageIndex: number;
  messageId: string;
  conversationId: string;
  channelId: string;
  prefixedRef: string;
  isTicket?: boolean; // Distinguishes ticket citations from message citations
  url?: string; // URL from web search results for this citation
}

export interface KeyPointWithCitation {
  point: string;
  citation: Citation;
}

export interface XyneAIOutput {
  summary: string;
  keyPoints: KeyPointWithCitation[];
}

// ============================================================================
// Streaming Types
// ============================================================================

export interface XyneAIStreamChunk {
  type: string;
  sessionId?: string;
  messageId?: string;
  isNewSession?: boolean;
  traceId?: string;
  content?: string;
  toolName?: string;
  input?: Record<string, unknown>;
  output?: XyneAIOutput;
  error?: string;
  [key: string]: unknown;
}

// ============================================================================
// Internal Types
// ============================================================================

export interface AgentRawOutput {
  summary: string;
  keypoints: string | string[];
  citations?: Record<number, string>;  // {keypointNum: "prefixedRef"} e.g., {1: "A2", 2: "B1"}
}

// ============================================================================
// History Types
// ============================================================================

/**
 * Agent output format for conversation history
 */
export interface AgentHistoryOutput {
  summary: string;
  keypoints: string[];
  citations: Record<number, string>;
}

/**
 * Formatted history message for JAF
 */
export type FormattedHistoryMessage = 
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: AgentHistoryOutput };
