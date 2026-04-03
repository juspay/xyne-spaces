/**
 * Shared Helper Functions for Xyne AI Agent Tools
 */

import { logger } from '../../../utils/logger.js';
import { redisService } from '../../../services/redisService.js';
import { getPromptFromLangfuse, PROMPT_NAMES } from '../langfuse/index.js';
import { getFallbackPrompt } from '../langfuse/fallback-prompts.js';
import type { EnrichedCall } from '../../../services/aiContextService.js';
import type {
  ToolMessage,
  ToolResult,
  MessageMappings,
  ToolDescriptions,
  EntityType,
  EnhancedToolResult,
  EnhancedCitationMappings,
  ToolEntity,
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
const [fetchChannel, fetchThread, searchMessages, searchTickets, geniusQuery, xyneRcaQuery, fieldValueDiscovery, webSearch, researchAgent, createCanvas, readCanvas, editCanvas, fetchLinkContent, createPpt, searchMeetingInsights] = await Promise.all([
    getPromptFromLangfuse(PROMPT_NAMES.FETCH_CHANNEL_MESSAGES),
    getPromptFromLangfuse(PROMPT_NAMES.FETCH_THREAD_MESSAGES),
    getPromptFromLangfuse(PROMPT_NAMES.SEARCH_RELEVANT_MESSAGES),
    getPromptFromLangfuse(PROMPT_NAMES.SEARCH_RELEVANT_TICKETS),
    getPromptFromLangfuse(PROMPT_NAMES.GENIUS),
    getPromptFromLangfuse(PROMPT_NAMES.XYNE_RCA),
    getPromptFromLangfuse(PROMPT_NAMES.FIELD_VALUE_DISCOVERY),
    getPromptFromLangfuse(PROMPT_NAMES.WEB_SEARCH),
    getPromptFromLangfuse(PROMPT_NAMES.RESEARCH_AGENT),
    getPromptFromLangfuse(PROMPT_NAMES.CREATE_CANVAS),
    getPromptFromLangfuse(PROMPT_NAMES.READ_CANVAS),
    getPromptFromLangfuse(PROMPT_NAMES.EDIT_CANVAS),
    getPromptFromLangfuse(PROMPT_NAMES.FETCH_LINK_CONTENT),
    getPromptFromLangfuse(PROMPT_NAMES.CREATE_PPT),
    getPromptFromLangfuse(PROMPT_NAMES.SEARCH_MEETING_INSIGHTS),
  ]);

  const descriptions = {
    fetch_channel_messages: fetchChannel || 'Fetch messages from the current channel.',
    fetch_thread_messages: fetchThread || 'Fetch all content from the current thread including messages, attachments, and tickets.',
    search_relevant_messages: searchMessages || 'Search for relevant messages in the channel.',
    search_relevant_tickets: searchTickets || 'Search for relevant support tickets using semantic search.',
    genius: geniusQuery || 'Query Genius for analytics and data insights.',
    xyne_rca: xyneRcaQuery || 'Query the Xyne RCA Agent for Root Cause Analysis of production issues and errors.',
    field_value_discovery: fieldValueDiscovery || 'Discover field values from data sources.',
    web_search: webSearch || 'Perform a web search to find current information from the internet.',
    research_agent: researchAgent || 'Query the Research Agent for codebase analysis and technical investigation.',
    create_canvas: createCanvas || 'Create a canvas from markdown content.',
    read_canvas: readCanvas || 'Read a canvas by its viewAccessId and return the content as markdown.',
    edit_canvas: editCanvas || 'Edit an existing canvas by replacing its content.',
    fetch_link_content: fetchLinkContent || 'Fetch content from a Xyne Spaces link (message, conversation, ticket, or canvas).',
    create_ppt: createPpt || 'Create a visually stunning PowerPoint presentation from structured slide content.',
    search_meeting_insights: searchMeetingInsights || 'Search for AI-analyzed meeting insights including summaries, action items, pain points, and merchant discussions.',
  };
  
  return descriptions;
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
 * Extract canvas viewAccessIds from message content
 * Matches patterns like /chat/canvas/{viewAccessId}
 */
export function extractCanvasViewIds(content: string): string[] {
  const regex = /\/chat\/canvas\/([a-zA-Z0-9-]+)/g;
  const matches: string[] = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    matches.push(match[1]);
  }
  return matches;
}

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
export function buildMessageMappings(result: ToolResult, urlMapping?: Record<number, string>): MessageMappings {
  const messageIdMapping: Record<number, string> = {};
  const conversationIdMapping: Record<number, string> = {};
  const isTicketMapping: Record<number, boolean> = {};
  const channelIdMapping: Record<number, string> = {};
  const finalUrlMapping: Record<number, string> = {};

  for (const msg of result.messages) {
    messageIdMapping[msg.messageIndex] = msg.messageId;
    conversationIdMapping[msg.messageIndex] = msg.conversationId;
    isTicketMapping[msg.messageIndex] = msg.isTicket || false;
    channelIdMapping[msg.messageIndex] = msg.channelId;
    // Include URL from provided mapping if available
    if (urlMapping && urlMapping[msg.messageIndex]) {
      finalUrlMapping[msg.messageIndex] = urlMapping[msg.messageIndex];
    }
  }
  
  return { messageIdMapping, conversationIdMapping, isTicketMapping, channelIdMapping, urlMapping: finalUrlMapping };
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
      : { messageIdMapping: {}, conversationIdMapping: {}, isTicketMapping: {}, channelIdMapping: {}, urlMapping: {} };
    
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

    // Add URL mappings with prefix
    for (const [index, url] of Object.entries(mappings.urlMapping)) {
      const prefixedKey = `${prefix}${index}`;
      existing.urlMapping[prefixedKey as unknown as number] = url;
    }
    
    await redis.setex(key, CITATION_TTL_SECONDS, JSON.stringify(existing));
  } catch (error) {
    logger.error(`[Tools] [${sessionId}] Failed to store citation mappings:`, error);
    throw error;
  }
}

/**
 * Get and clear mappings for a session from Redis
 * Returns EnhancedCitationMappings with entity metadata
 */
export async function getAndClearSessionMappings(sessionId: string): Promise<EnhancedCitationMappings | undefined> {
  try {
    const citationKey = getCitationKey(sessionId);
    const counterKey = getCounterKey(sessionId);
    const redis = redisService.getClient();
    
    const data = await redis.get(citationKey);
    
    if (!data) {
      return undefined;
    }

    const mappings = JSON.parse(data) as EnhancedCitationMappings;

    await redis.del(citationKey);
    await redis.del(counterKey);
    
    return mappings;
  } catch (error) {
    logger.error(`[Tools] [${sessionId}] Failed to get/clear citation mappings:`, error);
    return undefined;
  }
}

// ============================================================================
// Enhanced Multi-Entity Helpers
// ============================================================================

/**
 * Build citation URL based on entity type
 */
/**
 * Build enhanced citation mappings from tool result
 * Frontend will build URLs from this metadata
 */
export function buildEnhancedCitationMappings(result: EnhancedToolResult): EnhancedCitationMappings {
  const entityIdMapping: Record<number, string> = {};
  const entityTypeMapping: Record<number, EntityType> = {};
  const conversationIdMapping: Record<number, string | undefined> = {};
  const messageIdMapping: Record<number, string | undefined> = {};
  const canvasIdMapping: Record<number, string | undefined> = {};
  const channelIdMapping: Record<number, string> = {};
  const externalUrlMapping: Record<number, string | undefined> = {};
  const isExternalMapping: Record<number, boolean> = {};

  for (const entity of result.entities) {
    const idx = entity.entityIndex;

    entityIdMapping[idx] = entity.entityId;
    entityTypeMapping[idx] = entity.entityType;
    conversationIdMapping[idx] = entity.conversationId;
    messageIdMapping[idx] = entity.messageId;
    canvasIdMapping[idx] = entity.canvasId;
    channelIdMapping[idx] = entity.channelId;
    externalUrlMapping[idx] = entity.externalUrl;
    isExternalMapping[idx] = entity.entityType === 'web_search';
  }

  return {
    entityIdMapping,
    entityTypeMapping,
    conversationIdMapping,
    messageIdMapping,
    canvasIdMapping,
    channelIdMapping,
    externalUrlMapping,
    isExternalMapping,
  };
}

/**
 * Enhanced entity metadata for summarizer citations
 * Matches the interface from summariser/index.ts
 * Note: citationUrl removed - frontend builds URLs from entity metadata
 */
export interface EnhancedEntityMetadata {
  readonly entityType: EntityType;
  readonly entityId: string;
  readonly messageId?: string;
  readonly conversationId?: string;
  readonly canvasId?: string;
  readonly callId?: string;
  readonly ticketId?: string;
  readonly channelId: string;
  readonly externalUrl?: string;  // For web search results
  readonly isExternal?: boolean;  // Whether citation is external
}

/**
 * Build entity mapping for summarizer from tool result
 * Converts entities to Map format expected by summarizer
 * Frontend will build URLs from this metadata
 */
export function buildEntityMappingForSummarizer(result: EnhancedToolResult): Map<number, EnhancedEntityMetadata> {
  const entityMapping = new Map<number, EnhancedEntityMetadata>();

  for (const entity of result.entities) {
    const idx = entity.entityIndex;

    entityMapping.set(idx, {
      entityType: entity.entityType,
      entityId: entity.entityId,
      messageId: entity.messageId,
      conversationId: entity.conversationId,
      canvasId: entity.canvasId,
      callId: entity.callId,
      ticketId: entity.ticketId,
      channelId: entity.channelId,
      externalUrl: entity.externalUrl,
      isExternal: entity.entityType === 'web_search',
    });
  }

  return entityMapping;
}

/**
 * Append enhanced session mappings to Redis
 */
export async function appendEnhancedSessionMappings(
  sessionId: string,
  mappings: EnhancedCitationMappings,
  prefix: string
): Promise<void> {
  try {
    const key = getCitationKey(sessionId);
    const redis = redisService.getClient();

    // Get existing mappings from Redis
    const existingData = await redis.get(key);
    const existing: EnhancedCitationMappings = existingData
      ? JSON.parse(existingData)
      : {
          entityIdMapping: {},
          entityTypeMapping: {},
          conversationIdMapping: {},
          messageIdMapping: {},
          canvasIdMapping: {},
          channelIdMapping: {},
          externalUrlMapping: {},
          isExternalMapping: {}
        };

    // Add new mappings with prefix
    for (const [index, entityId] of Object.entries(mappings.entityIdMapping)) {
      const prefixedKey = `${prefix}${index}`;
      existing.entityIdMapping[prefixedKey as unknown as number] = entityId;
    }

    for (const [index, entityType] of Object.entries(mappings.entityTypeMapping)) {
      const prefixedKey = `${prefix}${index}`;
      existing.entityTypeMapping[prefixedKey as unknown as number] = entityType;
    }

    for (const [index, convId] of Object.entries(mappings.conversationIdMapping)) {
      const prefixedKey = `${prefix}${index}`;
      existing.conversationIdMapping[prefixedKey as unknown as number] = convId;
    }

    for (const [index, msgId] of Object.entries(mappings.messageIdMapping)) {
      const prefixedKey = `${prefix}${index}`;
      existing.messageIdMapping[prefixedKey as unknown as number] = msgId;
    }

    for (const [index, canvasId] of Object.entries(mappings.canvasIdMapping)) {
      const prefixedKey = `${prefix}${index}`;
      existing.canvasIdMapping[prefixedKey as unknown as number] = canvasId;
    }

    for (const [index, chanId] of Object.entries(mappings.channelIdMapping)) {
      const prefixedKey = `${prefix}${index}`;
      existing.channelIdMapping[prefixedKey as unknown as number] = chanId;
    }

    for (const [index, externalUrl] of Object.entries(mappings.externalUrlMapping)) {
      const prefixedKey = `${prefix}${index}`;
      existing.externalUrlMapping[prefixedKey as unknown as number] = externalUrl;
    }

    for (const [index, isExternal] of Object.entries(mappings.isExternalMapping)) {
      const prefixedKey = `${prefix}${index}`;
      existing.isExternalMapping[prefixedKey as unknown as number] = isExternal;
    }

    await redis.setex(key, CITATION_TTL_SECONDS, JSON.stringify(existing));
  } catch (error) {
    logger.error(`[Tools] [${sessionId}] Failed to store enhanced citation mappings:`, error);
    throw error;
  }
}

/**
 * Format enhanced tool result for LLM context with entity grouping
 */
export function formatEnhancedToolResultForContext(
  result: EnhancedToolResult,
  prefix: string
): string {
  if (!result.success) {
    return `Error: ${result.error}`;
  }

  if (result.entities.length === 0) {
    return 'No content found.';
  }

  // Group entities by type
  const messages = result.entities.filter(e => e.entityType === 'message');
  const attachments = result.entities.filter(e => e.entityType === 'attachment');
  const calls = result.entities.filter(e => e.entityType === 'call');
  const canvases = result.entities.filter(e => e.entityType === 'canvas');
  const tickets = result.entities.filter(e => e.entityType === 'ticket');

  let output = '';

  // Format messages
  if (messages.length > 0) {
    const formattedMessages = messages.map(msg => {
      const attachmentNote = msg.hasAttachment ? ' [has attachment]' : '';
      const channelInfo = msg.channelName ? ` in **${msg.channelName}**` : '';
      return `[${prefix}${msg.entityIndex}] ${msg.authorName} (${msg.timestamp})${channelInfo}${attachmentNote}:\n${msg.content}`;
    }).join('\n\n');

    output += `MESSAGES (${messages.length}):\n${formattedMessages}\n\n`;
  }

  // Format attachments
  if (attachments.length > 0) {
    const formattedAttachments = attachments.map(att => {
      const channelInfo = att.channelName ? ` in **${att.channelName}**` : '';
      return `[${prefix}${att.entityIndex}] ${att.authorName} (${att.timestamp})${channelInfo}:\n${att.content}`;
    }).join('\n\n');

    output += `ATTACHMENTS (${attachments.length}):\n${formattedAttachments}\n\n`;
  }

  // Format calls
  if (calls.length > 0) {
    const formattedCalls = calls.map(call => {
      const channelInfo = call.channelName ? ` in **${call.channelName}**` : '';
      return `[${prefix}${call.entityIndex}] ${call.authorName} (${call.timestamp})${channelInfo}:\n${call.content}`;
    }).join('\n\n');

    output += `CALLS (${calls.length}):\n${formattedCalls}\n\n`;
  }

  // Format canvases
  if (canvases.length > 0) {
    const formattedCanvases = canvases.map(canvas => {
      const channelInfo = canvas.channelName ? ` in **${canvas.channelName}**` : '';
      return `[${prefix}${canvas.entityIndex}] ${canvas.authorName} (${canvas.timestamp})${channelInfo}:\n${canvas.content}`;
    }).join('\n\n');

    output += `CANVASES (${canvases.length}):\n${formattedCanvases}\n\n`;
  }

  // Format tickets
  if (tickets.length > 0) {
    const formattedTickets = tickets.map(ticket => {
      const channelInfo = ticket.channelName ? ` in **${ticket.channelName}**` : '';
      return `[${prefix}${ticket.entityIndex}] ${ticket.authorName} (${ticket.timestamp})${channelInfo}:\n${ticket.content}`;
    }).join('\n\n');

    output += `TICKETS (${tickets.length}):\n${formattedTickets}\n\n`;
  }

  return output.trim();
}

// ============================================================================
// Entity Transform Functions
// ============================================================================

/**
 * Transform Message to ToolEntity format
 */
export function transformMessageToEntity(
  message: any,
  index: number,
  channelId: string,
  channelName: string,
  userMap: Map<string, { name: string | null; email: string | null }>
): ToolEntity {
  const user = userMap.get(message.senderId);
  
  // Extract canvas viewAccessIds from message content
  const canvasViewIds = extractCanvasViewIds(message.content);
  
  return {
    entityType: 'message',
    entityId: message.messageId,
    entityIndex: index,
    content: stripHtml(message.content),
    authorName: user?.name || user?.email || 'Unknown User',
    authorId: message.senderId,
    timestamp: toIST(message.createdAt),
    channelId,
    channelName,
    conversationId: message.conversationId,
    messageId: message.messageId,
    hasAttachment: message.hasAttachment,
    ...(canvasViewIds.length > 0 && { canvasViewIds }),
  };
}

/**
 * Transform MessageAttachment to ToolEntity format
 */
export function transformAttachmentToEntity(
  attachment: any,
  index: number,
  channelId: string,
  channelName: string,
  userMap: Map<string, { name: string | null; email: string | null }>
): ToolEntity {
  const user = userMap.get(attachment.uploadedByUserId || attachment.createdBy);

  // Build content: metadata only
  let content = `Attachment: ${attachment.originalFilename} (${attachment.mimetype})`;

  // Add file size
  if (attachment.size) {
    const sizeMB = (attachment.size / 1024 / 1024).toFixed(2);
    content += `\nSize: ${sizeMB}MB`;
  }

  // Add dimensions for images/videos if available
  if (attachment.width && attachment.height) {
    content += `\nDimensions: ${attachment.width}x${attachment.height}`;
  }

  return {
    entityType: 'attachment',
    entityId: attachment.id,
    entityIndex: index,
    content,
    authorName: user?.name || user?.email || 'Unknown User',
    authorId: attachment.uploadedByUserId || attachment.createdBy,
    timestamp: toIST(attachment.createdAt),
    channelId,
    channelName,
    conversationId: attachment.conversationId,
    messageId: attachment.entityType === 'CHAT' ? attachment.entityId : undefined,
    attachmentMimetype: attachment.mimetype,
    base64Data: undefined,
  };
}

/**
 * Transform Call to ToolEntity format
 */
export function transformCallToEntity(
  call: EnrichedCall,
  index: number,
  channelName: string,
  userMap: Map<string, { name: string | null; email: string | null }>
): ToolEntity {
  const user = userMap.get(call.createdByUserId);

  // Build content with transcript if available
  let content = `Call: ${call.title || 'Untitled'}\nStatus: ${call.status}`;

  if (call.description) {
    content += `\nDescription: ${call.description}`;
  }

  if (call.transcript) {
    content += `\n\nTranscript:\n${call.transcript}`;
  } else {
    content += `\n\n[No transcript available]`;
  }

  if (call.aiSummary) {
    content += `\n\nAI Summary:\n${call.aiSummary}`;
  }

  return {
    entityType: 'call',
    entityId: call.id,
    entityIndex: index,
    content,
    authorName: user?.name || user?.email || 'Unknown User',
    authorId: call.createdByUserId,
    timestamp: toIST(call.startedAt),
    channelId: call.channelId,
    channelName,
    conversationId: call.conversationId || undefined,
    callId: call.id,
    callStatus: call.status,
    hasTranscript: !!call.transcript,
  };
}

/**
 * Transform Canvas to ToolEntity format
 */
export function transformCanvasToEntity(
  canvas: any,
  index: number,
  channelName: string,
  userMap: Map<string, { name: string | null; email: string | null }>
): ToolEntity {
  const user = userMap.get(canvas.createdBy);

  // Build content with full canvas data
  let content = `Canvas: ${canvas.title}\n`;

  // Include full BlockNote JSON content
  if (canvas.content) {
    content += `\nContent (BlockNote JSON):\n${JSON.stringify(canvas.content, null, 2)}`;
  }

  // Add metadata if available
  if (canvas.metadata) {
    content += `\n\nMetadata:\n${JSON.stringify(canvas.metadata, null, 2)}`;
  }

  // Add document type info for Quarto docs
  if (canvas.docType === 'Quarto' && canvas.quartoDocumentType) {
    content += `\n\nQuarto Document Type: ${canvas.quartoDocumentType}`;
    if (canvas.entryFile) {
      content += `\nEntry File: ${canvas.entryFile}`;
    }
  }

  return {
    entityType: 'canvas',
    entityId: canvas.id,
    entityIndex: index,
    content,
    authorName: user?.name || user?.email || 'Unknown User',
    authorId: canvas.createdBy,
    timestamp: toIST(canvas.updatedAt),
    channelId: canvas.channelId || '',
    channelName,
    canvasId: canvas.id,
  };
}

/**
 * Transform Ticket to ToolEntity format
 */
export function transformTicketToEntity(
  ticket: any,
  index: number,
  channelName: string,
  userMap: Map<string, { name: string | null; email: string | null }>
): ToolEntity {
  const user = userMap.get(ticket.createdBy);
  const assignee = ticket.assignedTo ? userMap.get(ticket.assignedTo) : null;

  // Build comprehensive ticket content
  let content = `Ticket [${ticket.xyneId}]: ${ticket.title}\n`;
  content += `Status: ${ticket.statusV2}\n`;
  content += `Priority: ${ticket.priority}\n`;

  if (assignee) {
    content += `Assigned To: ${assignee.name || assignee.email || 'Unknown'}\n`;
  }

  if (ticket.eta) {
    content += `ETA: ${toIST(ticket.eta)}\n`;
  }

  // Include full description
  if (ticket.description) {
    content += `\nDescription:\n${ticket.description}`;
  }

  // Add metadata if available
  if (ticket.metadata) {
    content += `\n\nMetadata:\n${JSON.stringify(ticket.metadata, null, 2)}`;
  }

  return {
    entityType: 'ticket',
    entityId: ticket.id,
    entityIndex: index,
    content,
    authorName: user?.name || user?.email || 'Unknown User',
    authorId: ticket.createdBy,
    timestamp: toIST(ticket.createdAt),
    channelId: ticket.channelId,
    channelName,
    conversationId: ticket.conversationId,
    ticketId: ticket.id,
    ticketStatus: ticket.statusV2,
  };
}
