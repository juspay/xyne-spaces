/**
 * Tools for Xyne AI Agent
 * 
 * JAF Tool definitions that use context for channelId/conversationId:
 * 1. fetch_channel_messages - Only date_from, date_to params (channelId from context)
 * 2. fetch_thread_messages - No params (channelId, conversationId from context)
 * 3. search_relevant_messages - Only query param (channelId from context)
 * 
 * Tool descriptions are fetched from Langfuse at initialization.
 */

import { z } from 'zod';
import { type Tool, Streaming } from '@xynehq/jaf';
import { db } from '../../database/client.js';
import { logger } from '../../utils/logger.js';
import { config } from '../../config/env.js';
import { getPromptFromLangfuse, PROMPT_NAMES } from './langfuse/index.js';
import { getFallbackPrompt } from './langfuse/fallback-prompts.js';
import { vespaService } from '../../services/vespaSearch/index.js';
import { transformVespaResults } from '../../services/vespaSearch/resultTransform.js';
import { redisService } from '../../services/redisService.js';
import { createFieldValueDiscoveryTool } from './tools/field_value_discovery.js';

// Re-export types from JAF Streaming module
export type StreamProvider = Streaming.StreamProvider;
export type StreamEvent = Streaming.StreamEvent;

// ============================================================================
// Types
// ============================================================================

/**
 * Callback for streaming events directly to response
 */
export type StreamEventCallback = (event: Record<string, unknown>) => void;

/**
 * User information for agent context
 */
export interface UserInfo {
  userId: string;
  userName: string;
  userEmail: string;
}

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
// Tool Description Cache
// ============================================================================

interface ToolDescriptions {
  fetch_channel_messages: string;
  fetch_thread_messages: string;
  search_relevant_messages: string;
  search_relevant_tickets: string;
  genius: string;
  field_value_discovery: string;
}

let cachedDescriptions: ToolDescriptions | null = null;
let isInitialized = false;

/**
 * Get tool description - tries Langfuse first, then falls back to hardcoded prompts
 */
async function fetchToolDescriptions(): Promise<ToolDescriptions> {
  
  const [fetchChannel, searchMessages, searchTickets, geniusQuery, fieldValueDiscovery] = await Promise.all([
    getPromptFromLangfuse(PROMPT_NAMES.FETCH_CHANNEL_MESSAGES),
    getPromptFromLangfuse(PROMPT_NAMES.SEARCH_RELEVANT_MESSAGES),
    getPromptFromLangfuse(PROMPT_NAMES.SEARCH_RELEVANT_TICKETS),
    getPromptFromLangfuse(PROMPT_NAMES.GENIUS),
    getPromptFromLangfuse(PROMPT_NAMES.FIELD_VALUE_DISCOVERY),
  ]);
  
  return {
    fetch_channel_messages: fetchChannel || 'Fetch messages from the current channel.',
    fetch_thread_messages: '',
    search_relevant_messages: searchMessages || 'Search for relevant messages in the channel.',
    search_relevant_tickets: searchTickets || 'Search for relevant support tickets using semantic search.',
    genius: geniusQuery || 'Query Genius for analytics and data insights.',
    field_value_discovery: fieldValueDiscovery || 'Discover field values from data sources.',
  }
}

/**
 * Initialize tools by fetching descriptions from Langfuse
 * Call this at application startup
 * Throws error if prompts are not found in Langfuse
 */
export async function initializeTools(): Promise<void> {
  if (isInitialized) {
    return;
  }
  
  cachedDescriptions = await fetchToolDescriptions();
  isInitialized = true;
}

/**
 * Get tool description from cache (sync version - must be called after initializeTools)
 */
function getDescription(toolName: string): string {
  if (!cachedDescriptions) {
    logger.warn('[Tools] Not initialized, returning fallback prompt');
    return getFallbackPrompt(toolName as any) || '';
  }
  return cachedDescriptions[toolName as keyof ToolDescriptions] || '';
}
export { getDescription };

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert UTC timestamp to IST (India Standard Time, UTC+5:30)
 */
function toIST(date: Date): string {
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(date.getTime() + istOffset);
  return istDate.toISOString().replace('Z', '+05:30');
}

/**
 * Strip HTML tags from content
 */
function stripHtml(content: string): string {
  let cleaned = content.replace(/<[^>]*>/g, '');
  cleaned = cleaned
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  return cleaned;
}

function getDefaultDateRange(channelCount: number = 1): { from: Date; to: Date; days: number } {
  const now = new Date();
  
  // Dynamic date range based on channel count
  let days: number;
  switch (channelCount) {
    case 1:
      days = 30;
      break;
    case 2:
      days = 20;
      break;
    case 3:
      days = 15;
      break;
    case 4:
      days = 10;
      break;
    case 5:
    default:
      days = 5;
      break;
  }
  

  const fromDate = new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  return { from: fromDate, to: now, days };
}

/**
 * Format messages for tool output
 */
function formatMessages(
  messages: Array<{
    messageId: string;
    content: string;
    senderId: string;
    createdAt: Date;
    conversationId: string;
    hasAttachment: boolean;
  }>,
  userMap: Map<string, { name: string | null; email: string | null }>,
  channelId: string,
  channelName: string = ''
): ToolMessage[] {
  return messages.map((msg, idx) => {
    const user = userMap.get(msg.senderId);
    return {
      messageId: msg.messageId,
      messageIndex: idx + 1,
      content: stripHtml(msg.content),
      authorName: user?.name || user?.email || 'Unknown User',
      authorId: msg.senderId,
      timestamp: toIST(msg.createdAt),
      conversationId: msg.conversationId,
      channelId,
      channelName,
      hasAttachment: msg.hasAttachment,
    };
  });
}

/**
 * Message mappings for frontend (messageIndex -> messageId/conversationId/channelId)
 */
export interface MessageMappings {
  messageIdMapping: Record<number, string>;  // messageIndex -> messageId
  conversationIdMapping: Record<number, string>;  // messageIndex -> conversationId
  isTicketMapping: Record<number, boolean>;  // messageIndex -> isTicket flag
  channelIdMapping: Record<number, string>;  // messageIndex -> channelId
}

/**
 * Build message mappings from tool result
 */
export function buildMessageMappings(result: ToolResult): MessageMappings {
  const messageIdMapping: Record<number, string> = {};
  const conversationIdMapping: Record<number, string> = {};
  const isTicketMapping: Record<number, boolean> = {};
  const channelIdMapping: Record<number, string> = {};

  for (const msg of result.messages) {
    messageIdMapping[msg.messageIndex] = msg.messageId;
    conversationIdMapping[msg.messageIndex] = msg.conversationId;
    isTicketMapping[msg.messageIndex] = msg.isTicket || false;
    channelIdMapping[msg.messageIndex] = msg.channelId;
  }
  
  return { messageIdMapping, conversationIdMapping, isTicketMapping, channelIdMapping };
}


function resolveUserName(
  userName: string,
  requestMappings?: { channelNameToId: Map<string, string>; userNameToId: Map<string, string> }
): { userId: string | null; notFound: boolean } {
  const normalizedUserName = userName.trim().toLowerCase();
  const userId = requestMappings?.userNameToId.get(normalizedUserName) || null;
  return {
    userId,
    notFound: !userId,
  };
}

function resolveChannelNames(
  channelNames: string[],
  contextChannelMap?: Map<string, string>,
  requestMappings?: { channelNameToId: Map<string, string>; userNameToId: Map<string, string> }
): { channelIds: string[]; notFound: string[] } {
  const channelIds: string[] = [];
  const notFound: string[] = [];

  const contextMap = contextChannelMap || new Map();

  for (const name of channelNames) {
    const normalizedName = name.trim().toLowerCase();
    
    // First check pre-computed context map
    if (contextMap.has(normalizedName)) {
      channelIds.push(contextMap.get(normalizedName)!);
      logger.info(`[ChannelResolve] "${name}" found in context map - no lookup needed`);
      continue;
    }
    
    // Then check request mappings from FVD tool
    const channelId = requestMappings?.channelNameToId.get(normalizedName);
    if (channelId) {
      channelIds.push(channelId);
      logger.info(`[ChannelResolve] "${name}" found in request mappings`);
    } else {
      notFound.push(name);
    }
  }

  return { channelIds, notFound };
}

// ============================================================================
// Redis Keys for Citation Mappings
// ============================================================================

const REDIS_CITATION_PREFIX = 'xyne-ai:citations:';
const REDIS_COUNTER_PREFIX = 'xyne-ai:counter:';
const CITATION_TTL_SECONDS = 24 * 60 * 60; // 24 hours TTL

/**
 * Get Redis key for session mappings
 */
function getCitationKey(sessionId: string): string {
  return `${REDIS_CITATION_PREFIX}${sessionId}`;
}

/**
 * Get Redis key for session tool call counter
 */
function getCounterKey(sessionId: string): string {
  return `${REDIS_COUNTER_PREFIX}${sessionId}`;
}

/**
 * Get next prefix letter for a session (A, B, C, ... Z, AA, AB, ...)
 * Stores counter in Redis with TTL
 */
async function getNextPrefix(sessionId: string): Promise<string> {
  const key = getCounterKey(sessionId);
  const redis = redisService.getClient();
  
  const count = await redis.incr(key);
  await redis.expire(key, CITATION_TTL_SECONDS);
  
  const prefixIndex = count - 1;
  
  if (prefixIndex < 26) {
    return String.fromCharCode(65 + prefixIndex); // A-Z
  }
  const first = String.fromCharCode(65 + Math.floor(prefixIndex / 26) - 1);
  const second = String.fromCharCode(65 + (prefixIndex % 26));
  return first + second;
}

/**
 * Append session mappings to Redis
 * Stores citation mappings with TTL for automatic cleanup
 */
export async function appendSessionMappings(
  sessionId: string, 
  mappings: MessageMappings, 
  prefix: string
): Promise<void> {
  try {
    const key = getCitationKey(sessionId);
    const redis = redisService.getClient();
    
    // Get existing mappings from Redis
    const existingData = await redis.get(key);
    const existing: MessageMappings = existingData 
      ? JSON.parse(existingData) 
      : { messageIdMapping: {}, conversationIdMapping: {}, isTicketMapping: {}, channelIdMapping: {} };
    
    // Add new mappings with prefix
    for (const [index, msgId] of Object.entries(mappings.messageIdMapping)) {
      const prefixedKey = `${prefix}${index}`;
      existing.messageIdMapping[prefixedKey as unknown as number] = msgId;
    }
    
    for (const [index, convId] of Object.entries(mappings.conversationIdMapping)) {
      const prefixedKey = `${prefix}${index}`;
      existing.conversationIdMapping[prefixedKey as unknown as number] = convId;
    }

    for (const [index, isTicket] of Object.entries(mappings.isTicketMapping)) {
      const prefixedKey = `${prefix}${index}`;
      existing.isTicketMapping[prefixedKey as unknown as number] = isTicket;
    }

    for (const [index, chanId] of Object.entries(mappings.channelIdMapping)) {
    const prefixedKey = `${prefix}${index}`;
    existing.channelIdMapping[prefixedKey as unknown as number] = chanId;
    }
    
    await redis.setex(key, CITATION_TTL_SECONDS, JSON.stringify(existing));
  } catch (error) {
    logger.error(`[Tools] [${sessionId}] Failed to store citation mappings:`, error);
    throw error;
  }
}


/**
 * Get and clear mappings for a session from Redis
 */
export async function getAndClearSessionMappings(sessionId: string): Promise<MessageMappings | undefined> {
  try {
    const citationKey = getCitationKey(sessionId);
    const counterKey = getCounterKey(sessionId);
    const redis = redisService.getClient();
    
    const data = await redis.get(citationKey);
    
    if (!data) {
      return undefined;
    }
    
    const mappings = JSON.parse(data) as MessageMappings;
    
    await redis.del(citationKey);
    await redis.del(counterKey);
    
    return mappings;
  } catch (error) {
    logger.error(`[Tools] [${sessionId}] Failed to get/clear citation mappings:`, error);
    return undefined;
  }
}


/**
 * Format tool result as string for LLM context
 * Uses prefixed message indices like [A1], [A2], [B1], [B2], etc.
 */
export function formatToolResultForContext(result: ToolResult, prefix: string): string {
  if (!result.success) {
    return `Error: ${result.error}`;
  }

  if (result.messages.length === 0) {
    return 'No messages found.';
  }

  const formatted = result.messages.map(msg => {
    const attachmentNote = msg.hasAttachment ? ' [has attachment]' : '';
    const channelInfo = msg.channelName ? ` in **${msg.channelName}**` : '';
    return `[${prefix}${msg.messageIndex}] ${msg.authorName} (${msg.timestamp})${channelInfo}${attachmentNote}:\n${msg.content}`;
  }).join('\n\n');

  return `Found ${result.messages.length} messages:\n\n${formatted}`;
}

// ============================================================================
// Tool Implementations (internal)
// ============================================================================

/**
 * Extended ToolResult with date range capping info
 */
interface ToolResultWithCapping extends ToolResult {
  dateRangeCapped?: boolean;
  requestedDays?: number;
  actualDays?: number;
}

async function fetchChannelMessagesMultiChannelImpl(
  channelIds: string[],
  sessionId: string,
  dateFrom?: string,
  dateTo?: string,
  precomputedChannelNameMap?: Map<string, string>
): Promise<ToolResultWithCapping> {
  try {
    const channelCount = channelIds.length;
    logger.info(`[Tool] [${sessionId}] fetch_channel_messages_multi: channelIds=${JSON.stringify(channelIds)}, channelCount=${channelCount}, dateFrom=${dateFrom}, dateTo=${dateTo}`);

    // Handle empty channelIds - ask user for clarification
    if (!channelIds || channelIds.length === 0) {
      return {
        success: false,
        messages: [],
        error: 'NO_CHANNEL_CONTEXT: No channels are currently in context. Ask the user to specify which channel they want to summarize. Use field_value_discovery to validate the channel name once provided.',
      };
    }

    // Validate max channels limit
    if (channelIds.length > 5) {
      return {
        success: false,
        messages: [],
        error: 'Too many channels specified. Maximum 5 channels allowed per summarization.',
      };
    }

    // Get dynamic date range based on channel count
    const defaults = getDefaultDateRange(channelCount);
    const now = new Date();
    
    // Calculate user-requested date range
    let fromDate: Date;
    let toDate: Date;
    let dateRangeCapped = false;
    let requestedDays = 0;
    
    if (dateFrom) {
      const userFromDate = new Date(dateFrom);
      const userToDate = dateTo ? new Date(dateTo) : now;
      
      // Calculate how many days the user requested
      requestedDays = Math.ceil((userToDate.getTime() - userFromDate.getTime()) / (24 * 60 * 60 * 1000));
      
      // If user requested more days than allowed, cap it to the default
      if (requestedDays > defaults.days) {
        logger.info(`[Tool] [${sessionId}] fetch_channel_messages_multi: User requested ${requestedDays} days, but max allowed for ${channelCount} channels is ${defaults.days} days. Capping to default.`);
        fromDate = defaults.from;
        toDate = defaults.to;
        dateRangeCapped = true;
      } else {
        // User requested within limits, use their dates
        fromDate = userFromDate;
        toDate = userToDate;
      }
    } else {
      // No user-specified dates, use defaults
      fromDate = defaults.from;
      toDate = defaults.to;
    }

    logger.info(`[Tool] [${sessionId}] fetch_channel_messages_multi: Using ${defaults.days} days date range for ${channelCount} channels (from: ${fromDate.toISOString()}, to: ${toDate.toISOString()})${dateRangeCapped ? ' [CAPPED]' : ''}`);

    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      return {
        success: false,
        messages: [],
        error: 'Invalid date format. Use ISO date format.',
      };
    }

    // Use pre-computed channel name map if available
    let channelNameMap: Map<string, string>;
    if (precomputedChannelNameMap && precomputedChannelNameMap.size > 0) {
      channelNameMap = precomputedChannelNameMap;
      logger.debug(`[Tool] [${sessionId}] fetch_channel_messages_multi: Using pre-computed channel name map`);
    } else {
      const channels = await db.channel.findMany({
        where: { id: { in: channelIds } },
        select: { id: true, name: true },
      });
      channelNameMap = new Map(channels.map(c => [c.id, c.name]));
    }

    // Get all conversations from all channels
    const conversations = await db.conversation.findMany({
      where: { channelId: { in: channelIds } },
      select: { conversationId: true, channelId: true },
    });

    if (conversations.length === 0) {
      return {
        success: true,
        messages: [],
        metadata: { totalCount: 0, dateFrom: fromDate.toISOString(), dateTo: toDate.toISOString() },
      };
    }

    // Create a map of conversationId -> channelId for later use
    const conversationToChannelMap = new Map(conversations.map(c => [c.conversationId, c.channelId]));
    const conversationIds = conversations.map(c => c.conversationId);

    // Fetch messages from all channels
    const messages = await db.message.findMany({
      where: {
        conversationId: { in: conversationIds },
        createdAt: { gte: fromDate, lte: toDate },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    const senderIds = [...new Set(messages.map(m => m.senderId))];
    const users = await db.user.findMany({
      where: { id: { in: senderIds } },
      select: { id: true, name: true, email: true },
    });
    const userMap = new Map(users.map(u => [u.id, u]));

    // Format messages with channel info
    const formattedMessages: ToolMessage[] = messages.map((msg, idx) => {
      const user = userMap.get(msg.senderId);
      const msgChannelId = conversationToChannelMap.get(msg.conversationId) || '';
      return {
        messageId: msg.messageId,
        messageIndex: idx + 1,
        content: stripHtml(msg.content),
        authorName: user?.name || user?.email || 'Unknown User',
        authorId: msg.senderId,
        timestamp: toIST(msg.createdAt),
        conversationId: msg.conversationId,
        channelId: msgChannelId,
        channelName: channelNameMap.get(msgChannelId) || '',
        hasAttachment: msg.hasAttachment,
      };
    });

    // Sort by timestamp ascending for chronological order
    formattedMessages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    // Re-index after sorting
    formattedMessages.forEach((msg, idx) => {
      msg.messageIndex = idx + 1;
    });

    logger.info(`[Tool] [${sessionId}] fetch_channel_messages_multi: Found ${formattedMessages.length} messages across ${channelCount} channels (${defaults.days} days range)`);

    return {
      success: true,
      messages: formattedMessages,
      metadata: {
        totalCount: formattedMessages.length,
        dateFrom: fromDate.toISOString(),
        dateTo: toDate.toISOString(),
      },
      dateRangeCapped,
      requestedDays,
      actualDays: defaults.days,
    };
  } catch (error) {
    logger.error(`[Tool] [${sessionId}] fetch_channel_messages_multi error:`, error);
    return {
      success: false,
      messages: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Fetch Thread Messages implementation
 */
async function fetchThreadMessagesImpl(
  channelId: string,
  conversationId: string,
  sessionId: string
): Promise<ToolResult> {
  try {

    const conversation = await db.conversation.findUnique({
      where: { conversationId },
    });

    if (!conversation || conversation.channelId !== channelId) {
      return {
        success: false,
        messages: [],
        error: 'Conversation not found or does not belong to the specified channel',
      };
    }

    const messages = await db.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });

    const senderIds = [...new Set(messages.map(m => m.senderId))];
    const users = await db.user.findMany({
      where: { id: { in: senderIds } },
      select: { id: true, name: true, email: true },
    });
    const userMap = new Map(users.map(u => [u.id, u]));

    const formattedMessages = formatMessages(messages, userMap, channelId);
    logger.info(`[Tool] [${sessionId}] fetch_thread_messages: ${formattedMessages.length} messages`);

    return {
      success: true,
      messages: formattedMessages,
      metadata: { totalCount: formattedMessages.length },
    };
  } catch (error) {
    logger.error(`[Tool] [${sessionId}] fetch_thread_messages error:`, error);
    return {
      success: false,
      messages: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Search Relevant Tickets implementation using Vespa service directly
 */
async function searchRelevantTicketsImpl(
  query: string,
  channelId: string,
  userId: string,
  sessionId: string
): Promise<ToolResult> {
  try {

    // Get the channel's projectId to use as filter
    // Note: We use projectId instead of channelId because YqlBuilder's ticket filtering
    // has issues with channelId (tickets use channelRef field, not channelId)
    const channel = await db.channel.findUnique({
      where: { id: channelId },
      select: { projectId: true },
    });

    const ticketFilters: Record<string, string[]> = {};
    if (channel?.projectId) {
      ticketFilters.projectId = [channel.projectId];
    }

    const vespaResults = await vespaService.searchService.searchVespa(
      query,
      userId,
      ['ticket'],
      {
        offset: 0,
        limit: 50,
        rankProfile: 'default_native',
        ticket: ticketFilters,
      }
    );

    const hits = vespaResults.root.children || [];

    // Transform Vespa results
    const transformedResults = await transformVespaResults(hits, db);
    
    // Convert results to ToolMessage format (tickets from ticket app)
    const messages: ToolMessage[] = transformedResults
      .map((result, idx) => {
        const creatorName = result.searchContext?.creatorName || 'Unknown Creator';
        const assigneeName = result.searchContext?.assigneeName || 'Unassigned';
        const status = result.searchContext?.ticketStatus || 'Unknown Status';
        const description = stripHtml(result.context || result.title || '');
        
        // Format ticket content with all required fields
        const ticketContent = `Title: ${result.title}\nStatus: ${status}\nCreated by: ${creatorName}\nAssigned to: ${assigneeName}\n\nDescription:\n${description}`;
        
        return {
          messageId: result.id,
          messageIndex: idx + 1,
          content: ticketContent,
          authorName: creatorName,
          authorId: result.searchContext?.createdBy || '',
          timestamp: result.metadata?.timestamp || new Date().toISOString(),
          conversationId: result.searchContext?.ticketId || '',
          channelId: channelId,
          channelName: '',
          hasAttachment: false,
          isTicket: true, // Mark this as a ticket citation
        };
      });

    logger.info(`[Tool] [${sessionId}] search_relevant_tickets: ${messages.length} tickets`);

    return {
      success: true,
      messages,
      metadata: { totalCount: messages.length },
    };
  } catch (error) {
    logger.error(`[Tool] [${sessionId}] search_relevant_tickets error:`, error);
    return {
      success: false,
      messages: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function searchRelevantMessagesWithFiltersImpl(
  query: string,
  channelIds: string[],
  userId: string,
  sessionId: string,
  sender?: string,
  precomputedChannelNameMap?: Map<string, string>
): Promise<ToolResult> {
  try {
    logger.info(`[Tool] search_relevant_messages_with_filters: query="${query}", channelIds=${JSON.stringify(channelIds)}, userId=${userId}, sender=${sender}`);

    // Handle empty channelIds - ask user for clarification
    if (!channelIds || channelIds.length === 0) {
      return {
        success: false,
        messages: [],
        error: 'NO_CHANNEL_CONTEXT: No channels are currently in context. Ask the user to specify which channel they want to search in. Use field_value_discovery to validate the channel name once provided.',
      };
    }

    // Validate max channels limit
    if (channelIds.length > 5) {
      return {
        success: false,
        messages: [],
        error: 'Too many channels specified. Maximum 5 channels allowed per search.',
      };
    }

    // Build Vespa search options based on sender parameter
    const vespaOptions: any = {
      offset: 0,
      limit: 100,
      rankProfile: 'default_native',
      slack: {
        channelId: channelIds,
        senderId: sender ? [sender] : undefined,
      },
    };

    logger.info(`[Tool] search_relevant_messages_with_filters: Vespa options - senderId=${sender || 'none'}`);

    const vespaResults = await vespaService.searchService.searchVespa(
      query,
      userId,
      ['chat'],
      vespaOptions
    );

    const hits = vespaResults.root.children || [];
    logger.info(`[Tool] search_relevant_messages_with_filters: Vespa returned ${hits.length} raw hits`);

    // Transform Vespa results
    const transformedResults = await transformVespaResults(hits, db);
    
    // Use pre-computed channel name map if available, otherwise fetch from DB
    let channelNameMap: Map<string, string>;
    if (precomputedChannelNameMap && precomputedChannelNameMap.size > 0) {
      channelNameMap = precomputedChannelNameMap;
      logger.debug('[Tool] search_relevant_messages_with_filters: Using pre-computed channel name map');
    } else {
      const channels = await db.channel.findMany({
        where: { id: { in: channelIds } },
        select: { id: true, name: true },
      });
      channelNameMap = new Map(channels.map((c: any) => [c.id, c.name]));
    }
    
    // Convert results to ToolMessage format
    const messages: ToolMessage[] = transformedResults
      .map((result, idx) => {
        const msgChannelId = result.searchContext?.channelId || channelIds[0] || '';
        return {
          messageId: result.id,
          messageIndex: idx + 1,
          content: stripHtml(result.context || result.title || ''),
          authorName: result.subtitle || 'Unknown User',
          authorId: result.searchContext?.senderId || '',
          timestamp: result.metadata?.timestamp || new Date().toISOString(),
          conversationId: result.searchContext?.conversationId || '',
          channelId: msgChannelId,
          channelName: channelNameMap.get(msgChannelId) || '',
          hasAttachment: false,
        };
      });

    logger.info(`[Tool] [${sessionId}] search_relevant_messages_with_filters: Found ${messages.length} messages`);

    return {
      success: true,
      messages,
      metadata: { totalCount: messages.length },
    };
  } catch (error) {
    logger.error(`[Tool] [${sessionId}] search_relevant_messages_with_filters error:`, error);
    return {
      success: false,
      messages: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================================================
// JAF Tool Factory Functions
// ============================================================================

/**
 * Create fetch_channel_messages tool with description from Langfuse
 */
function createFetchChannelMessagesTool(): Tool<{ date_from?: string; date_to?: string; channels?: string[] }, XyneAIAgentContext> {
  return {
    schema: {
      name: 'fetch_channel_messages',
      description: getDescription('fetch_channel_messages'),
      parameters: z.object({
        date_from: z.string().optional().describe('Start date in ISO format'),
        date_to: z.string().optional().describe('End date in ISO format (defaults to now)'),
        channels: z.array(z.string()).optional().describe('ONLY pass EXPLICIT channel names like "genius-discussions", "xyne-spaces". Do NOT pass for "this channel", "the channel", "here" - leave empty to use context channels.'),
      }),
    },
    execute: async (args, context) => {
      const { channels, date_from, date_to } = args;
  
      if (channels && channels.length > 0) {
        logger.info(`[Tool] fetch_channel_messages called with channel names=${JSON.stringify(channels)}`);
        
        // Resolve channel names to IDs - uses pre-computed context map first, then request mappings from FVD
        const { channelIds, notFound } = resolveChannelNames(channels, context.contextChannelMap, context.requestMappings);
        
        if (notFound.length > 0) {
          return `Error: The following channel names were not found in the session mappings: ${notFound.join(', ')}. Please call field_value_discovery first to validate these channel names.`;
        }
        
        if (channelIds.length === 0) {
          return 'Error: No valid channel IDs could be resolved. Please call field_value_discovery first to validate channel names.';
        }
        
        logger.info(`[Tool] Resolved channel names to IDs: ${JSON.stringify(channelIds)}`);
        
        // Validate that channels exist in the database
        const existingChannels = await db.channel.findMany({
          where: { id: { in: channelIds } },
          select: { id: true, name: true },
        });
        
        const existingChannelIds = existingChannels.map(c => c.id);
        const nonExistentChannelIds = channelIds.filter(id => !existingChannelIds.includes(id));
        
        if (nonExistentChannelIds.length > 0) {
          return `Error: Some channels do not exist in the database. Please verify the channel names and try again.`;
        }
        
        // Validate that user has access to all specified channels
        const userChannels = await db.channelParticipant.findMany({
          where: { 
            userId: context.userId,
            channelId: { in: channelIds },
          },
          select: { channelId: true },
        });
        
        const accessibleChannelIds = userChannels.map(c => c.channelId);
        const inaccessibleChannelIds = channelIds.filter(c => !accessibleChannelIds.includes(c));
        
        if (inaccessibleChannelIds.length > 0) {
          const inaccessibleChannelNames = existingChannels
            .filter(c => inaccessibleChannelIds.includes(c.id))
            .map(c => c.name);
          
          return `Error: You do not have access to the following channels: ${inaccessibleChannelNames.join(', ')}. Please use field_value_discovery to get a list of channels you have access to.`;
        }
        
        // Use the resolved channel IDs with pre-computed channel name map
        const channelCount = accessibleChannelIds.length;
        const result = await fetchChannelMessagesMultiChannelImpl(accessibleChannelIds, context.sessionId, date_from, date_to, context.contextChannelIdToName) as ToolResultWithCapping;
        const prefix = await getNextPrefix(context.sessionId);
        if (result.success && result.messages.length > 0) {
          await appendSessionMappings(context.sessionId, buildMessageMappings(result), prefix);
        }
        
        // Add info about date range used
        const dateRange = getDefaultDateRange(channelCount);
        let dateInfo = '';
        
        if (result.dateRangeCapped && result.requestedDays) {
          dateInfo = `\n\nNOTE: You requested ${result.requestedDays} days, but with ${channelCount} channel${channelCount > 1 ? 's' : ''} we can only summarize the last ${dateRange.days} days. Showing messages from the last ${dateRange.days} days.`;
        } else if (!date_from) {
          dateInfo = `\n\nDate range: Last ${dateRange.days} days (based on ${channelCount} channel${channelCount > 1 ? 's' : ''})`;
        }
        
        return formatToolResultForContext(result, prefix) + dateInfo;
      }
      
      // Default: use all channels from context with pre-computed channel name map
      const channelCount = context.channelIds.length;
      logger.info(`[Tool] fetch_channel_messages called with context.channelIds=${JSON.stringify(context.channelIds)}, channelCount=${channelCount}`);
      
      // Use multi-channel implementation for all cases
      const result = await fetchChannelMessagesMultiChannelImpl(context.channelIds, context.sessionId, date_from, date_to, context.contextChannelIdToName) as ToolResultWithCapping;
      const prefix = await getNextPrefix(context.sessionId);
      if (result.success && result.messages.length > 0) {
        await appendSessionMappings(context.sessionId, buildMessageMappings(result), prefix);
      }
      
      // Add info about date range used
      const dateRange = getDefaultDateRange(channelCount);
      let dateInfo = '';
      
      // Check if date range was capped
      if (result.dateRangeCapped && result.requestedDays) {
        dateInfo = `\n\nNOTE: You requested ${result.requestedDays} days, but with ${channelCount} channel${channelCount > 1 ? 's' : ''} we can only summarize the last ${dateRange.days} days. Showing messages from the last ${dateRange.days} days.`;
      } else if (!date_from) {
        dateInfo = `\n\nDate range: Last ${dateRange.days} days (based on ${channelCount} channel${channelCount > 1 ? 's' : ''})`;
      }
      
      return formatToolResultForContext(result, prefix) + dateInfo;
    },
  };
}

/**
 * Create fetch_thread_messages tool with description from Langfuse
 */
function createFetchThreadMessagesTool(): Tool<Record<string, never>, XyneAIAgentContext> {
  return {
    schema: {
      name: 'fetch_thread_messages',
      description: getDescription('fetch_thread_messages'),
      parameters: z.object({}),
    },
    execute: async (_args, context) => {
      const channelId = context.channelIds[0];
      if (!context.conversationId) {
        return 'Error: No conversation ID in context. This tool can only be used in thread context.';
      }
      const result = await fetchThreadMessagesImpl(channelId, context.conversationId, context.sessionId);
      const prefix = await getNextPrefix(context.sessionId);
      if (result.success && result.messages.length > 0) {
        await appendSessionMappings(context.sessionId, buildMessageMappings(result), prefix);
      }
      return formatToolResultForContext(result, prefix);
    },
  };
}

/**
 * Create search_relevant_messages tool with description from Langfuse
 */
function createSearchRelevantMessagesTool(): Tool<{ query: string; channels?: string[]; sender?: string }, XyneAIAgentContext> {
  return {
    schema: {
      name: 'search_relevant_messages',
      description: getDescription('search_relevant_messages'),
      parameters: z.object({
        query: z.string().describe('The search query to find relevant messages'),
        channels: z.array(z.string()).optional().describe('Optional list of channel names to search in'),
        sender: z.string().optional().describe('Filter by sender - only return messages SENT BY this user. Use when asking "messages from X", "what did X say", "X\'s messages". Pass the USERNAME from field_value_discovery (e.g., "Aman Srivastava").'),
      }),
    },
    execute: async (args, context) => {
      const { query, channels, sender } = args;
      
      // Resolve sender name to ID if provided
      let resolvedSenderId: string | undefined;
      if (sender) {
        const { userId, notFound } = resolveUserName(sender, context.requestMappings);
        if (notFound) {
          return `Error: The username "${sender}" was not found in the request mappings. Please call field_value_discovery with field="username" first to validate this username.`;
        }
        resolvedSenderId = userId || undefined;
        logger.info(`[Tool] Resolved sender name "${sender}" to ID: ${resolvedSenderId}`);
      }
      
      // If channels are provided, resolve names to IDs and use multi-channel search
      if (channels && channels.length > 0) {
        logger.info(`[Tool] search_relevant_messages called with query="${query}", channel names=${JSON.stringify(channels)}, sender=${sender} (resolved: ${resolvedSenderId})`);
        
        // Resolve channel names to IDs
        const { channelIds, notFound } = resolveChannelNames(channels, context.contextChannelMap, context.requestMappings);
        
        if (notFound.length > 0) {
          return `Error: The following channel names were not found in the session mappings: ${notFound.join(', ')}. Please call field_value_discovery first to validate these channel names.`;
        }
        
        if (channelIds.length === 0) {
          return 'Error: No valid channel IDs could be resolved. Please call field_value_discovery first to validate channel names.';
        }
        
        logger.info(`[Tool] Resolved channel names to IDs: ${JSON.stringify(channelIds)}`);
        
        // Validate that channels exist in the database
        const existingChannels = await db.channel.findMany({
          where: { id: { in: channelIds } },
          select: { id: true, name: true },
        });
        
        const existingChannelIds = existingChannels.map(c => c.id);
        const nonExistentChannelIds = channelIds.filter(id => !existingChannelIds.includes(id));
        
        if (nonExistentChannelIds.length > 0) {
          return `Error: Some of the specified channels do not exist in the database. Please verify the channel names and try again.`;
        }
        
        // Validate that user has access to all specified channels
        const userChannels = await db.channelParticipant.findMany({
          where: { 
            userId: context.userId,
            channelId: { in: channelIds },
          },
          select: { channelId: true },
        });
        
        const accessibleChannelIds = userChannels.map(c => c.channelId);
        const inaccessibleChannelIds = channelIds.filter(c => !accessibleChannelIds.includes(c));
        
        if (inaccessibleChannelIds.length > 0) {
          // Get channel names for better error message
          const inaccessibleChannelNames = existingChannels
            .filter(c => inaccessibleChannelIds.includes(c.id))
            .map(c => c.name);
          
          return `Error: You do not have access to the following channels: ${inaccessibleChannelNames.join(', ')}. Please use field_value_discovery to get a list of channels you have access to.`;
        }

      const result = await searchRelevantMessagesWithFiltersImpl(query, accessibleChannelIds, context.userId, context.sessionId, resolvedSenderId, context.contextChannelIdToName);
      const prefix = await getNextPrefix(context.sessionId);
      if (result.success && result.messages.length > 0) {
        await appendSessionMappings(context.sessionId, buildMessageMappings(result), prefix);
      }
      return formatToolResultForContext(result, prefix);
    }
      
      // Default: search in all channels from context
      logger.info(`[Tool] search_relevant_messages called with query="${query}", context.channelIds=${JSON.stringify(context.channelIds)}, sender=${sender} (resolved: ${resolvedSenderId})`);
      const result = await searchRelevantMessagesWithFiltersImpl(query, context.channelIds, context.userId, context.sessionId, resolvedSenderId, context.contextChannelIdToName);
      const prefix = await getNextPrefix(context.sessionId);
      if (result.success && result.messages.length > 0) {
        await appendSessionMappings(context.sessionId, buildMessageMappings(result), prefix);
      }
      return formatToolResultForContext(result, prefix);
    },
  };
}

/**
 * Create search_relevant_tickets tool with description from Langfuse
 */
function createSearchRelevantTicketsTool(): Tool<{ query: string }, XyneAIAgentContext> {
  return {
    schema: {
      name: 'search_relevant_tickets',
      description: getDescription('search_relevant_tickets'),
      parameters: z.object({
        query: z.string().describe('The search query to find relevant tickets'),
      }),
    },
    execute: async (args, context) => {
      const channelId = context.channelIds[0] || '';
      const result = await searchRelevantTicketsImpl(args.query, channelId, context.userId, context.sessionId);
      const prefix = await getNextPrefix(context.sessionId);
      if (result.success && result.messages.length > 0) {
        await appendSessionMappings(context.sessionId, buildMessageMappings(result), prefix);
      }
      return formatToolResultForContext(result, prefix);
    },
  };
}
function getISTTimestampForGenius(): string {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(now.getTime() + istOffset);
  return istDate.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function createGeniusTool(): Tool<{ query: string }, XyneAIAgentContext> {
  return {
    schema: {
      name: 'genius',
      description: getDescription('genius'),
      parameters: z.object({
        query: z.string().describe('The analytics query to send to Genius'),
      }),
    },
    execute: async (args, context) => {
      const { query } = args;
      const { userId, onStreamEvent } = context;
      
      logger.info(`[Tool] [${context.sessionId}] genius: query="${query}"`);
      
      const geniusApiUrl = config.genius.apiUrl ? (config.genius.apiUrl + '/api/v3/query_routing/') : '';
      const queryRoutingKey = config.genius.queryRoutingKey;
      
      if (!geniusApiUrl || !queryRoutingKey) {
        logger.error('[Tool] genius: Missing GENIUS_API_URL or QUERY_ROUTING_KEY in config');
        return 'Error: Genius API not configured. Please set GENIUS_API_URL and QUERY_ROUTING_KEY environment variables.';
      }
      
      const currentTimestamp = getISTTimestampForGenius();
      
      // Fetch user email from database
      let userEmail = '';
      try {
        const user = await db.user.findUnique({
          where: { id: userId },
          select: { email: true },
        });
        userEmail = user?.email || '';
      } catch (error) {
        logger.warn(`[Tool] [${context.sessionId}] genius: Failed to fetch user email for userId=${userId}`);
      }
      
      const GENIUS_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), GENIUS_TIMEOUT_MS);
      
      try {
        // Send start event directly via callback for real-time streaming
        if (onStreamEvent) {
          onStreamEvent({ type: 'genius_start', toolName: 'genius', query, timestamp: currentTimestamp });
        }
        
        const response = await fetch(geniusApiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': queryRoutingKey,
            'Accept': 'text/event-stream',
            'X-Xyne-User-Id': userId,
          },
          body: JSON.stringify({
            query,
            current_timestamp: currentTimestamp,
            agent: 'analytics',
            source: 'xyne_spaces',
            email: userEmail,
          }),
          signal: controller.signal,
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
          const errorText = await response.text();
          
          if (onStreamEvent) {
            onStreamEvent({ type: 'genius_error', toolName: 'genius', error: `API error: ${response.status}`, details: errorText });
          }
          
          return `Error: Genius API returned status ${response.status}: ${errorText}`;
        }
        
        const reader = response.body?.getReader();
        if (!reader) {
          return 'Error: No response body from Genius API';
        }
        
        const decoder = new TextDecoder();
        let buffer = '';
        let finalResult = '';
        let eventCount = 0;
        let currentEventType = 'data';
        
        while (true) {
          const { done, value } = await reader.read();
          
          if (done) {
            break;
          }
          
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          
          for (const line of lines) {
            if (line.startsWith('event:')) {
              currentEventType = line.slice(6).trim();
              continue;
            }
            
            if (line.startsWith('data:')) {
              const dataContent = line.slice(5).trim();
              if (!dataContent) continue;
              
              try {
                const eventData = JSON.parse(dataContent);
                eventCount++;
                
                const geniusEventType = currentEventType !== 'data' 
                  ? currentEventType 
                  : (eventData.type || 'data');
                
                // Stream event directly via callback - real-time!
                if (onStreamEvent) {
                  onStreamEvent({ type: geniusEventType, ...eventData });
                }
                
                currentEventType = 'data';
                
                if (geniusEventType === 'final_output') {
                  if (eventData.message) {
                    finalResult = eventData.message;
                  }
                }
              } catch {
                // Non-JSON SSE data, skip
              }
            }
          }
        }
        
        logger.info(`[Tool] [${context.sessionId}] genius: completed with ${eventCount} events`);
        
        return finalResult || 'Genius query completed but no text content was returned.';
        
      } catch (error) {
        clearTimeout(timeoutId);
        
        if (error instanceof Error && error.name === 'AbortError') {
          if (onStreamEvent) {
            onStreamEvent({ type: 'genius_error', toolName: 'genius', error: 'Request timed out' });
          }
          return 'Error: Genius API request timed out';
        }
        
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`[Tool] [${context.sessionId}] genius error:`, error);
        
        if (onStreamEvent) {
          onStreamEvent({ type: 'genius_error', toolName: 'genius', error: errorMessage });
        }
        
        return `Error calling Genius API: ${errorMessage}`;
      }
    },
  };
}

// ============================================================================
// Exported Tools
// ============================================================================

/**
 * Get all Xyne AI tools (with descriptions from Langfuse)
 * MUST call initializeTools() before using this function
 */
export function getXyneAITools(): Tool<any, XyneAIAgentContext>[] {
  return [
    createFetchChannelMessagesTool(),
    // createFetchThreadMessagesTool(),
    createSearchRelevantMessagesTool(),
    createSearchRelevantTicketsTool(),
    createFieldValueDiscoveryTool(),
    createGeniusTool(),
  ];
}

/**
 * Get fetch_channel_messages tool
 * MUST call initializeTools() before using
 */
export function getFetchChannelMessagesTool() {
  return createFetchChannelMessagesTool();
}

/**
 * Get fetch_thread_messages tool
 * MUST call initializeTools() before using
 */
export function getFetchThreadMessagesTool() {
  return createFetchThreadMessagesTool();
}

/**
 * Get search_relevant_messages tool
 * MUST call initializeTools() before using
 */
export function getSearchRelevantMessagesTool() {
  return createSearchRelevantMessagesTool();
}

/**
 * Get search_relevant_tickets tool
 * MUST call initializeTools() before using
 */
export function getSearchRelevantTicketsTool() {
  return createSearchRelevantTicketsTool();
}
/**
 * Get field_value_discovery tool
 * MUST call initializeTools() before using
 */
export function getFieldValueDiscoveryTool() {
  return createFieldValueDiscoveryTool();
}

/**
 * Get genius tool
 * MUST call initializeTools() before using
 */
export function getGeniusTool() {
  return createGeniusTool();
}
