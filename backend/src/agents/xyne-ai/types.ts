/**
 * Xyne AI Agent Types
 *
 * API request, streaming chunks, and output types.
 */

import type { Attachment } from '@juspay-jaf/jaf';
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
  collectionIds?: string[];
  fileIds?: string[];  // Scope KB file search to specific file document(s) by docId
  conversationId?: string;
  canvasViewAccessId?: string;  // Canvas context when Ask AI is triggered from canvas
  selectionContexts?: SelectionContext[];  // Selected text contexts from canvases
  createCanvasEnabled?: boolean;  // Enable create canvas instruction in prompt
  userId: string;
  currentTimestamp?: string | null;
  attachments?: AttachmentData[];
  userInfo?: UserInfo;
  webSearchEnabled?: boolean;  // Enable/disable web search tool
  deepResearchEnabled?: boolean;  // Enable/disable deep research tool
  researchContext?: ResearchContext;
  messageAttachmentIds?: string[]; // Attachment IDs to fetch from GCS on backend
  parentMessageId?: string; // Parent message ID for branching (tree structure)
  isRegenerate?: boolean; // Whether this is a regenerate request
  agentName?: string;  // Agent identifier: 'ask-ai' (sidebar) or 'ask-ai-chat' (bot). Also selects the Langfuse prompt.
  displayQuery?: string;  // Original user query (without canvas/selection enhancements) — stored in DB, not sent to LLM
  canvasIds?: string[];  // Canvas IDs to fetch and inject as context
  ticketIds?: string[];  // Ticket IDs to fetch and inject as context
  callIds?: string[];    // Call IDs (transcripts + recordings) to fetch and inject as context
  systemPromptOverride?: string; // When set, replaces the agent's system prompt entirely (used for draft mode)
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
  entityType?: 'message' | 'attachment' | 'call' | 'recording' | 'canvas' | 'ticket' | 'web_search'| 'knowledge_base';
  entityId?: string;
  canvasId?: string;
  externalUrl?: string;
  isExternal?: boolean;
  fileName?: string;
  mimeType?: string;
  chunkIndex?: number;
  chunkText?: string;
  chunkPos?: number;  // 1-indexed page number for PDFs, sheet index for Excel
  ticketTitle?: string;
  ticketXyneId?: string; 
  canvasTitle?: string;
  channelName?: string;
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
  sources?: Citation[];
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
  httpStatus?: number;
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
