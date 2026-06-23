/**
 * Types and Interfaces for Xyne AI Agent Tools
 */

import { Streaming } from '@juspay-jaf/jaf';
import type { SelectionContext } from '../types.js';

// Re-export types from JAF Streaming module
export type StreamProvider = Streaming.StreamProvider;
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
 * Research context - currently selected product or repository from frontend
 * Only contains name (no ID) - ID lookup happens internally via productNameToId/repositoryNameToId
 */
export interface ResearchContext {
  type: 'product' | 'repository';
  name: string;
}

/**
 * Agent context with channelId and conversationId
 */
export interface XyneAIAgentContext {
  channelIds: string[];
  collectionIds?: string[];  // Selected collections for KB search
  fileIds?: string[];  // Scope KB file search to specific file document(s) by docId
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
  webSearchEnabled?: boolean;  // Flag to enable/disable web search functionality
  deepResearchEnabled?: boolean;  // Flag to enable/disable deep research functionality
  memoryEnabled?: boolean;  // Flag to enable/disable memory tools (get_memories, update_memory); default true
  disableTools?: boolean;  // When true, the agent runs with NO tools at all — pure single LLM call.
  requestMappings?: {  // Request-scoped mappings from FVD tool
    channelNameToId: Map<string, string>;
    userNameToId: Map<string, string>;
  };
  // Research Agent context
  researchContext?: ResearchContext;  // Currently selected product/repository (for agent prompt)
  productNameToId?: Map<string, string>;  // Product name→ID mapping (for tool validation)
  repositoryNameToId?: Map<string, string>;
  customInstruction?: string;
  // Canvas context
  canvasViewAccessId?: string;  // viewAccessId of the canvas when Ask AI is triggered from canvas
  selectionContexts?: SelectionContext[];  // Selected text contexts from canvases
  createCanvasEnabled?: boolean;  // Flag to add create canvas instruction to prompt
  // Model config
  modelName?: string;  // LLM model name from CAC config (xyneAiModelName), used by tools that make internal LLM calls
  agentName?: string;  // Agent identifier ('ask-ai' or 'ask-ai-chat'); also selects Langfuse prompt
  systemPromptOverride?: string;  // When set, replaces the agent's system prompt entirely (used for draft mode)
  // Per-tool soft token budgets from CAC (xyneAiToolBudget*). Required —
  // callers populate from AgentsConfig so we have a single source of truth.
  toolBudgets: {
    searchRelevantContent: number;
    fetchChannelMessages: number;
    fetchThreadMessages: number;
    fetchLinkContent: number;
    userActivity: number;
    searchFiles: number;
  };
  // Session-history compaction thresholds from CAC. Required — single source
  // of truth is AgentsConfig; no fallback constants in the compaction util.
  historyCompaction: {
    trigger: number;
    target: number;
  };
  // Request context for tracing/metadata purposes
  agentRequestContext?: AgentRequestContext;
}

/**
 * Request context for tracing and metadata collection
 * Contains all request parameters sent from the controller
 */
export interface AgentRequestContext {
  // Channel and Thread Context
  channelIds?: string[];
  conversationId?: string;
  
  // Source Info
  source?: 'thread' | 'channel';
  
  // Feature Flags
  webSearchEnabled?: boolean;
  deepResearchEnabled?: boolean;
  createCanvasEnabled?: boolean;
  
  // Research Context
  researchContext?: ResearchContext;
  
  // Canvas Context
  canvasViewAccessId?: string;
  selectionContexts?: SelectionContext[];
  
  // Attachments (data is omitted in tracing context)
  attachments?: Array<{ mime_type: string; filename?: string; data?: string }>;
  messageAttachmentIds?: string[];
  
  // Provided Contexts
  canvasIds?: string[];
  ticketIds?: string[];
  callIds?: string[];
  
  // Message/Branching Info
  parentMessageId?: string;
  isRegenerate?: boolean;
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
  contentType?: 'message' | 'ticket' | 'canvas' | 'call' | 'recording'; // Content type for citation URL construction
  canvasTitle?: string; // For canvas results — title carried so the UI needn't refetch
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

// ============================================================================
// Enhanced Types for Multi-Entity Support
// ============================================================================

/**
 * Entity type discriminator for different content types
 */
export type EntityType = 'message' | 'attachment' | 'call' | 'recording' | 'canvas' | 'ticket' | 'web_search' | 'email' | 'knowledge_base';

/**
 * Enhanced tool entity that can represent any content type
 */
export interface ToolEntity {
  // Common fields
  entityType: EntityType;
  entityId: string;  // messageId, attachmentId, callId, canvasId, ticketId
  entityIndex: number;  // Sequential index within tool call
  content: string;  // Formatted content for display
  authorName: string;
  authorId: string;
  timestamp: string;  // IST format
  channelId: string;
  channelName: string;

  // Entity-specific IDs for citation URL construction
  conversationId?: string;  // For messages, attachments, calls, tickets
  messageId?: string;  // For messages and attachments (optional for attachments)
  canvasId?: string;  // For canvas entities
  ticketId?: string;  // For ticket entities
  callId?: string;  // For call entities
  externalUrl?: string;  // For web search results (external URLs)

  // Additional metadata
  hasAttachment?: boolean;  // For messages
  attachmentMimetype?: string;  // For attachments
  callStatus?: string;  // For calls
  ticketStatus?: string;  // For tickets
  hasTranscript?: boolean;  // For calls
  base64Data?: string;  // For image attachments (data URI)
  canvasViewIds?: string[];  // Array of canvas viewAccessIds found in message content
  fileName?: string;
  mimeType?: string;
  chunkIndex?: number;
  chunkText?: string;
  chunkPos?: number;  // 1-indexed page number (PDFs) or sheet index from chunks_pos_summary
  ticketTitle?: string;
  ticketXyneId?: string; 
  canvasTitle?: string;
}

/**
 * Enhanced tool result with multiple entity types
 */
export interface EnhancedToolResult {
  success: boolean;
  entities: ToolEntity[];  // Unified array of all entities
  error?: string;
  metadata?: {
    totalCount: number;
    messageCount: number;
    attachmentCount: number;
    callCount: number;
    canvasCount: number;
    ticketCount: number;
    emailCount?: number;
    knowledgeBaseCount?: number;
    dateFrom?: string;
    dateTo?: string;
  };
  dateRangeCapped?: boolean;
  requestedDays?: number;
  actualDays?: number;
}

/**
 * Enhanced citation mappings for different entity types
 * Frontend builds URLs from this metadata instead of using pre-built URLs
 */
export interface EnhancedCitationMappings {
  entityIdMapping: Record<number, string>;  // index -> entityId
  entityTypeMapping: Record<number, EntityType>;  // index -> entity type
  conversationIdMapping: Record<number, string | undefined>;  // index -> conversationId
  messageIdMapping: Record<number, string | undefined>;  // index -> messageId (for messages/attachments)
  canvasIdMapping: Record<number, string | undefined>;  // index -> canvasId
  channelIdMapping: Record<number, string>;  // index -> channelId
  externalUrlMapping: Record<number, string | undefined>;  // index -> external URL (for web search)
  isExternalMapping: Record<number, boolean>;  // index -> whether citation is external (web search)
  chunkIndexMapping: Record<number, number | undefined>;
  chunkTextMapping: Record<number, string | undefined>;
  chunkPosMapping: Record<number, number | undefined>;  // page/sheet position from chunks_pos_summary
  fileNameMapping: Record<number, string | undefined>;
  mimeTypeMapping: Record<number, string | undefined>;
  ticketTitleMapping?: Record<number, string | undefined>;  // index -> ticket title (ticket entities only)
  ticketXyneIdMapping?: Record<number, string | undefined>;  // index -> ticket human id (ticket entities only)
  canvasTitleMapping?: Record<number, string | undefined>;  // index -> canvas title (canvas entities only)
  channelNameMapping?: Record<number, string | undefined>;  // index -> channel/group name (all entity types)
}

// ============================================================================
// Message Mappings
// ============================================================================

/**
 * Message mappings for frontend (messageIndex -> messageId/conversationId/channelId/url)
 */
export interface MessageMappings {
  messageIdMapping: Record<number, string>;  // messageIndex -> messageId
  conversationIdMapping: Record<number, string>;  // messageIndex -> conversationId
  isTicketMapping: Record<number, boolean>;  // messageIndex -> isTicket flag
  channelIdMapping: Record<number, string>;  // messageIndex -> channelId
  urlMapping: Record<number, string>;  // messageIndex -> URL from web search results
  contentTypeMapping: Record<number, string>;  // messageIndex -> content type ('message' | 'ticket' | 'canvas' | 'call' | 'recording')
}

// ============================================================================
// Tool Description Cache
// ============================================================================

export interface ToolDescriptions {
  fetch_channel_messages: string;
  fetch_thread_messages: string;
  search_relevant_content: string;
  search_meeting_insights: string;
  genius: string;
  xyne_rca: string;
  field_value_discovery: string;
  web_search: string;
  deep_research: string;
  research_agent: string;
  create_canvas: string;
  read_canvas: string;
  edit_canvas: string;
  fetch_link_content: string;
  search_files: string;
  create_ppt: string;
  generate_image: string;
  fetch_skill_instructions: string;
  manage_user_skill: string;
  get_memories: string;
  update_memory: string;
  user_activity: string;
  list_user_channels: string;
  get_page_content: string;
  get_document_outline: string;
}

// ============================================================================
// Research Agent Types
// ============================================================================

// Re-export from the centralized service
export type { ResearchAgentResponse, ResearchFollowUp } from '../../../services/researchAgentService.js';

// ============================================================================
// Constants
// ============================================================================
/**
 * Redis keys and TTL for citation mappings
 */
export const REDIS_CITATION_PREFIX = 'xyne-ai:citations:';
export const REDIS_COUNTER_PREFIX = 'xyne-ai:counter:';
export const CITATION_TTL_SECONDS = 24 * 60 * 60; // 24 hours TTL
