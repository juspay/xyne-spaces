import type { ToolOutput as GeniusToolOutput } from 'cosmic-ai-genius';

// ============================================================================
// Input context snapshot
// ============================================================================

export interface SelectedChannel {
  id: string;
  name: string;
  isPrivate: boolean;
}

export interface SelectedCanvas {
  id: string;
  title: string;
}

export interface SelectedTicket {
  id: string;
  name: string;
  title?: string;
}

export interface SelectedTranscript {
  id: string;
  title: string;
}

export interface SelectedRecording {
  id: string;
  title: string;
}

export interface SelectionContextInput {
  canvasViewAccessId: string;
  selectedText: string;
  preview?: string;
  canvasTitle?: string;
}

export interface ResearchContext {
  type: 'product' | 'repository';
  name: string;
}

export interface LastInputContext {
  selectedChannels: SelectedChannel[];
  threadConversationId?: string;
  selectedCanvases?: SelectedCanvas[];
  selectedTickets?: SelectedTicket[];
  selectedTranscripts?: SelectedTranscript[];
  selectedRecordings?: SelectedRecording[];
  canvasViewAccessId?: string;
  selectionContexts?: SelectionContextInput[];
  webSearchEnabled: boolean;
  deepResearchEnabled: boolean;
  createCanvasEnabled: boolean;
  researchContext?: ResearchContext | null;
}

// ============================================================================
// Stored / persisted types (backend PostgreSQL)
// ============================================================================

export interface StoredMessage {
  id: string;
  type: 'user' | 'bot';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
  streamingContent?: string;
  parsedContent?: {
    summary: string;
    keypoints: string[];
    citations: Record<number, number>;
    isComplete: boolean;
  };
  messageIdMapping?: Record<string, string>;
  conversationIdMapping?: Record<string, string>;
  channelIdMapping?: Record<string, string>;
  toolOutputs?: GeniusToolOutput[];
  feedback?: 0 | 1 | 2; // 0 = no feedback, 1 = like, 2 = dislike
  attachments?: MessageAttachment[];
  parentId?: string | null; // Parent message ID for tree branching
}

export interface ConversationHistory {
  id: string;
  channelId: string;
  sessionId: string;
  threadConversationId?: string;
  title: string;
  messages: StoredMessage[];
  createdAt: Date;
  lastUpdated: Date;
  isStarred?: boolean;
  branchSelections?: Record<string, string>; // parentId → selected childId for branching
  lastInputContext?: LastInputContext;
}

// ============================================================================
// Streaming / runtime types
// ============================================================================

export interface StreamingParsedContent {
  summary: string;
  keypoints: string[];
  citations: Record<number, number>;
  isComplete: boolean;
}

// Summarizer-specific interfaces
export interface SummarizerCitation {
  messageIndex: number;
  messageId: string;
  conversationId: string;
  channelId?: string; // Optional - may not be available during streaming
  isTicket?: boolean; // Distinguishes ticket citations from message citations (legacy)

  // NEW: Multi-entity support
  entityType?: 'message' | 'attachment' | 'call' | 'recording' | 'canvas' | 'ticket' | 'web_search';
  entityId?: string;
  canvasId?: string;
  callId?: string;
  ticketId?: string;
  externalUrl?: string;
  isExternal?: boolean;
  // File attachment chunk data
  chunkIndex?: number;
  chunkText?: string;
  chunkPos?: number; // 1-indexed page number (PDFs) or sheet index (Excel)
  fileName?: string;
  mimeType?: string;
}

export interface SummarizerKeyPoint {
  point: string;
  citation?: SummarizerCitation;
}

export interface SummarizerOutput {
  summary: string;
  keyPoints: SummarizerKeyPoint[];
}

export interface UserTag {
  name: string;
  userId: string;
}

export interface Participant {
  id: string;
  name: string;
  email: string;
  picture: string;
}
export interface MessageAttachment {
  filename: string;
  mimeType: string;
  data: string; // base64 data
}

// Selection context from canvas
export interface SelectionContext {
  canvasViewAccessId: string;
  selectedText: string;
  canvasTitle?: string;
  preview: string; // Truncated preview for display
}

export interface Message {
  id: string;
  type: 'user' | 'bot';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
  streamingContent?: string;
  parsedContent?: StreamingParsedContent;
  messageIdMapping?: Record<string, string>;
  conversationIdMapping?: Record<string, string>;
  channelIdMapping?: Record<string, string>;
  toolOutputs?: GeniusToolOutput[];
  statusMessage?: string | string[]; // Agent status — string or rotating phrases array for long-running tools
  // Tool input tracking
  toolName?: string; // Name of the tool being called
  toolInput?: unknown; // Input parameters for the tool
  // Summarizer-specific fields
  summarizerOutput?: SummarizerOutput;
  fetchedMessages?: string; // Tool output content from fetch_channel_messages
  agentType?: 'genius' | 'summarizer'; // Track which agent is responding
  isGeniusResponse?: boolean; // Flag set when genius_start event is detected
  isAborted?: boolean; // Flag set when message was aborted due to page reload
  traceId?: string; // Langfuse trace ID for feedback
  feedback?: 0 | 1 | 2; // 0 = no feedback, 1 = like, 2 = dislike
  attachments?: MessageAttachment[]; // Attachments sent with the message
  userTags?: Record<string, UserTag>; // Tag -> {name, userId} for user mentions
  participants?: Participant[]; // List of participants for Summarizer responses
  selectionContexts?: SelectionContext[]; // Canvas selection contexts
  parentId?: string | null; // Parent message ID for tree branching
}
