import type { ToolOutput as GeniusToolOutput } from 'cosmic-ai-genius';

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
  entityType?: 'message' | 'attachment' | 'call' | 'canvas' | 'ticket' | 'web_search';
  entityId?: string;
  canvasId?: string;
  callId?: string;
  ticketId?: string;
  externalUrl?: string;
  isExternal?: boolean;
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
  statusMessage?: string; // Agent status like "analysing your query..." or "Running JAF agent..."
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
}
