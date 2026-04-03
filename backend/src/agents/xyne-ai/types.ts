/**
 * Xyne AI Agent Types
 *
 * API request, streaming chunks, and output types.
 */

import type { Attachment } from '@xynehq/jaf';
import type { UserInfo, ResearchContext } from './tools/index.js';

// ============================================================================
// Request Types
// ============================================================================

/**
 * Attachment data from request
 */
export interface AttachmentData {
  data: string;  // Base64-encoded file content
  mime_type: string;
  filename?: string;
}

/**
 * Selection context from canvas - selected text with canvas reference
 */
export interface SelectionContext {
  canvasViewAccessId: string;
  selectedText: string;
  canvasTitle?: string;
}

export interface XyneAIRequest {
  query: string;
  sessionId?: string;
  channelIds: string[];
  conversationId?: string;
  canvasViewAccessId?: string;  // Canvas context when Ask AI is triggered from canvas
  selectionContexts?: SelectionContext[];  // Selected text contexts from canvases
  createCanvasEnabled?: boolean;  // Enable create canvas instruction in prompt
  userId: string;
  currentTimestamp?: string | null;
  attachments?: AttachmentData[];
  userInfo?: UserInfo;
  webSearchEnabled?: boolean;  // Enable/disable web search tool
  researchContext?: ResearchContext;
  messageAttachmentIds?: string[]; // Attachment IDs to fetch from GCS on backend
  parentMessageId?: string; // Parent message ID for branching (tree structure)
  isRegenerate?: boolean; // Whether this is a regenerate request
  systemPrompt?: string;  // Override system prompt (bypasses Langfuse prompt fetch)
  agentPromptName?: string;  // Langfuse prompt name to use; defaults to XYNE_AI_SYSTEM
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

export interface UserTag {
  name: string;
  userId: string;
}

export interface XyneAIOutput {
  summary: string;
  keyPoints: KeyPointWithCitation[];
  userTags?: Record<string, UserTag>; // Tag -> {name, userId}
}

// ============================================================================
// Streaming Types
// ============================================================================

export interface XyneAIStreamChunk {
  type: string;
  sessionId?: string;
  messageId?: string; // Bot message ID
  userMessageId?: string; // User message ID (returned in 'complete' for branching)
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
  userTags?: Record<string, string>;  // {tag: username} e.g., {"<Mohan Kumar>": "Mohan Kumar", "<Ram>": "Ram"}
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
  | { role: 'user'; content: string; attachments?: Attachment[] }
  | { role: 'assistant'; content: AgentHistoryOutput };
