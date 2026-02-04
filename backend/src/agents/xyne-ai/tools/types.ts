/**
 * Types and Interfaces for Xyne AI Agent Tools
 */

import { Streaming } from '@xynehq/jaf';

// Re-export types from JAF Streaming module
export type StreamProvider = Streaming.StreamProvider;
export type StreamEvent = Streaming.StreamEvent;

// ============================================================================
// Callback Types
// ============================================================================

/**
 * Callback for streaming events directly to response
 */
export type StreamEventCallback = (event: Record<string, unknown>) => void;

// ============================================================================
// User Types
// ============================================================================

/**
 * User information for agent context
 */
export interface UserInfo {
  userId: string;
  userName: string;
  userEmail: string;
}

// ============================================================================
// Agent Context
// ============================================================================

/**
 * Agent context with channelId and conversationId
 */
export interface XyneAIAgentContext {
  channelIds: string[];
  conversationId?: string;
  userId: string;
  sessionId: string;
  source: 'thread' | 'channel';
  timestamp: string;
  streamProvider?: StreamProvider;
  onStreamEvent?: StreamEventCallback;  // Direct callback for real-time streaming
  userInfo?: UserInfo;  // User information for personalization and trace grouping
  contextChannelMap?: Map<string, string>;  // Pre-computed channel name→ID map
  contextChannelIdToName?: Map<string, string>;
  requestMappings?: {  // Request-scoped mappings from FVD tool
    channelNameToId: Map<string, string>;
    userNameToId: Map<string, string>;
  };
}

// ============================================================================
// Message Types
// ============================================================================

/**
 * Message format returned by tools
 */
export interface ToolMessage {
  messageId: string;
  messageIndex: number;
  content: string;
  authorName: string;
  authorId: string;
  timestamp: string;
  conversationId: string;
  channelId: string;
  channelName: string;
  hasAttachment: boolean;
  isTicket?: boolean; // Indicates if this is a ticket citation
}

// ============================================================================
// Tool Result Types
// ============================================================================

/**
 * Tool result wrapper
 */
export interface ToolResult {
  success: boolean;
  messages: ToolMessage[];
  error?: string;
  metadata?: {
    totalCount: number;
    dateFrom?: string;
    dateTo?: string;
  };
}

/**
 * Extended ToolResult with date range capping info
 */
export interface ToolResultWithCapping extends ToolResult {
  dateRangeCapped?: boolean;
  requestedDays?: number;
  actualDays?: number;
}

// ============================================================================
// Message Mappings
// ============================================================================

/**
 * Message mappings for frontend (messageIndex -> messageId/conversationId/channelId)
 */
export interface MessageMappings {
  messageIdMapping: Record<number, string>;  // messageIndex -> messageId
  conversationIdMapping: Record<number, string>;  // messageIndex -> conversationId
  isTicketMapping: Record<number, boolean>;  // messageIndex -> isTicket flag
  channelIdMapping: Record<number, string>;  // messageIndex -> channelId
}

// ============================================================================
// Tool Description Cache
// ============================================================================

export interface ToolDescriptions {
  fetch_channel_messages: string;
  fetch_thread_messages: string;
  search_relevant_messages: string;
  search_relevant_tickets: string;
  genius: string;
  field_value_discovery: string;
  research_agent: string;
}

// ============================================================================
// Research Agent Types
// ============================================================================

/**
 * Research Agent response structure
 */
export interface ResearchAgentResponse {
  session_id: string;
  analysis: string;
  follow_ups: Array<{
    question: string;
    justification: string;
    data_type: string;
    specific_keys?: string[];
  }>;
  is_complete: boolean;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Hardcoded ExpressCheckout product ID
 * Note: This is the only product currently available
 */
export const XYNE_SPACES_REPOSITORY_ID = '989d9105-d8f0-4549-b63b-ac2363054ec0';

/**
 * Redis keys and TTL for citation mappings
 */
export const REDIS_CITATION_PREFIX = 'xyne-ai:citations:';
export const REDIS_COUNTER_PREFIX = 'xyne-ai:counter:';
export const CITATION_TTL_SECONDS = 24 * 60 * 60; // 24 hours TTL
