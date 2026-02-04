/**
 * Shared Helper Functions for Xyne AI Agent Tools
 */

import { logger } from '../../../utils/logger.js';
import { redisService } from '../../../services/redisService.js';
import { getPromptFromLangfuse, PROMPT_NAMES } from '../langfuse/index.js';
import { getFallbackPrompt } from '../langfuse/fallback-prompts.js';
import type {
  ToolMessage,
  ToolResult,
  MessageMappings,
  ToolDescriptions,
} from './types.js';
import {
  REDIS_CITATION_PREFIX,
  REDIS_COUNTER_PREFIX,
  CITATION_TTL_SECONDS,
} from './types.js';

// ============================================================================
// Tool Description Cache
// ============================================================================

let cachedDescriptions: ToolDescriptions | null = null;
let isInitialized = false;

/**
 * Get tool description - tries Langfuse first, then falls back to hardcoded prompts
 */
async function fetchToolDescriptions(): Promise<ToolDescriptions> {
  const [fetchChannel, searchMessages, searchTickets, geniusQuery, fieldValueDiscovery, researchAgent] = await Promise.all([
    getPromptFromLangfuse(PROMPT_NAMES.FETCH_CHANNEL_MESSAGES),
    getPromptFromLangfuse(PROMPT_NAMES.SEARCH_RELEVANT_MESSAGES),
    getPromptFromLangfuse(PROMPT_NAMES.SEARCH_RELEVANT_TICKETS),
    getPromptFromLangfuse(PROMPT_NAMES.GENIUS),
    getPromptFromLangfuse(PROMPT_NAMES.FIELD_VALUE_DISCOVERY),
    getPromptFromLangfuse(PROMPT_NAMES.RESEARCH_AGENT),
  ]);
  
  return {
    fetch_channel_messages: fetchChannel || 'Fetch messages from the current channel.',
    fetch_thread_messages: '',
    search_relevant_messages: searchMessages || 'Search for relevant messages in the channel.',
    search_relevant_tickets: searchTickets || 'Search for relevant support tickets using semantic search.',
    genius: geniusQuery || 'Query Genius for analytics and data insights.',
    field_value_discovery: fieldValueDiscovery || 'Discover field values from data sources.',
    research_agent: researchAgent || 'Query the Research Agent for codebase analysis and technical investigation.',
  };
}

/**
 * Initialize tools by fetching descriptions from Langfuse
 * Call this at application startup
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
export function getDescription(toolName: string): string {
  if (!cachedDescriptions) {
    logger.warn('[Tools] Not initialized, returning fallback prompt');
    return getFallbackPrompt(toolName as keyof ToolDescriptions) || '';
  }
  return cachedDescriptions[toolName as keyof ToolDescriptions] || '';
}

// ============================================================================
// Time Helpers
// ============================================================================

/**
 * Convert UTC timestamp to IST (India Standard Time, UTC+5:30)
 */
export function toIST(date: Date): string {
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(date.getTime() + istOffset);
  return istDate.toISOString().replace('Z', '+05:30');
}

/**
 * Get IST timestamp for Genius API
 */
export function getISTTimestampForGenius(): string {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(now.getTime() + istOffset);
  return istDate.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// ============================================================================
// String Helpers
// ============================================================================

/**
 * Strip HTML tags from content
 */
export function stripHtml(content: string): string {
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

// ============================================================================
// Date Range Helpers
// ============================================================================

/**
 * Get default date range based on channel count
 */
export function getDefaultDateRange(channelCount: number = 1): { from: Date; to: Date; days: number } {
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

// ============================================================================
// Message Formatting
// ============================================================================

/**
 * Format messages for tool output
 */
export function formatMessages(
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
// Resolution Helpers
// ============================================================================

/**
 * Resolve user name to user ID
 */
export function resolveUserName(
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

/**
 * Resolve channel names to channel IDs
 */
export function resolveChannelNames(
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
// Redis Citation Helpers
// ============================================================================

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
export async function getNextPrefix(sessionId: string): Promise<string> {
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
