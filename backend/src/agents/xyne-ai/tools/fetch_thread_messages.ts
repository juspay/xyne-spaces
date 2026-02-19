/**
 * Fetch Thread Messages Tool
 *
 * Retrieves multiple entity types (messages, attachments, tickets)
 * for a specific conversation/thread using AIContextService with citation tracking.
 *
 * NOTE: Only fetches entities that have conversationId:
 * - Messages (by conversationId)
 * - Attachments (by conversationId) - METADATA ONLY, no base64 data
 * - Tickets (by conversationId)
 *
 * Skipped entities (no conversationId support):
 * - Calls (channel-level)
 * - Canvas (channel-level)
 */

import { z } from 'zod';
import { type Tool } from '@xynehq/jaf';
import { db } from '../../../database/client.js';
import { logger } from '../../../utils/logger.js';
import { aiContextService } from '../../../services/aiContextService.js';
import type {
  XyneAIAgentContext,
  ToolEntity,
  EnhancedToolResult,
} from './types.js';
import {
  getDescription,
  getNextPrefix,
  buildEnhancedCitationMappings,
  appendEnhancedSessionMappings,
  formatEnhancedToolResultForContext,
  transformMessageToEntity,
  transformAttachmentToEntity,
  transformTicketToEntity,
} from './helpers.js';

// ============================================================================
// Implementation
// ============================================================================

/**
 * Fetch Thread Messages Implementation with Multi-Entity Support
 * Retrieves all content (messages, attachments, tickets) for a specific conversation/thread
 */
async function fetchThreadMessagesImpl(
  conversationId: string,
  sessionId: string
): Promise<EnhancedToolResult> {
  try {
    logger.info(`[Tool] [${sessionId}] fetch_thread_messages: conversationId=${conversationId}`);

    // Get conversation using aiContextService to extract channelId
    const conversation = await aiContextService.getById<{ conversationId: string; channelId: string }>('Conversation', conversationId);

    if (!conversation) {
      return {
        success: false,
        entities: [],
        error: 'Conversation not found',
      };
    }

    const channelId = conversation.channelId;

    // Get channel name for tool output formatting
    const channel = await db.channel.findUnique({
      where: { id: channelId },
      select: { name: true },
    });
    const channelName = channel?.name || '';

    // ============================================================================
    // Fetch all entity types in parallel using AIContextService
    // Only fetch entities that support conversationId: messages, attachments, tickets
    // Skipped: calls (channel-level), canvas (channel-level)
    // ============================================================================

    const [
      messagesResult,
      attachmentsResult,
      ticketsRaw
    ] = await Promise.all([
      // Fetch messages for the specific conversation
      aiContextService.getMessagesByConversation(conversationId, {}),
      // Fetch attachments for the specific conversation
      aiContextService.getAttachmentsByConversation(conversationId),
      // Fetch tickets for the specific conversation
      db.ticket.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'desc' },
        take: 100
      })
    ]);

    // Get messages
    const allMessages = messagesResult.data;

    // Get attachments
    const allAttachments = attachmentsResult.attachments;

    // Tickets are already filtered by conversationId
    const allTickets = ticketsRaw;

    // ============================================================================
    // Collect all unique user IDs
    // ============================================================================

    const allUserIds = new Set<string>();
    allMessages.forEach(m => allUserIds.add(m.senderId));
    allAttachments.forEach(a => allUserIds.add(a.uploadedByUserId || a.createdBy));
    allTickets.forEach(t => {
      allUserIds.add(t.createdBy);
      if (t.assignedTo) allUserIds.add(t.assignedTo);
    });

    const users = await db.user.findMany({
      where: { id: { in: Array.from(allUserIds) } },
      select: { id: true, name: true, email: true },
    });
    const userMap = new Map(users.map(u => [u.id, u]));

    // ============================================================================
    // Transform all entities to ToolEntity format
    // ============================================================================

    const messageEntities: ToolEntity[] = allMessages.map((msg, idx) =>
      transformMessageToEntity(
        msg,
        idx,
        channelId,
        channelName,
        userMap
      )
    );

    const attachmentEntities: ToolEntity[] = allAttachments.map((att, idx) =>
      transformAttachmentToEntity(
        att,
        idx,
        channelId,
        channelName,
        userMap
      )
    );

    const ticketEntities: ToolEntity[] = allTickets.map((ticket, idx) =>
      transformTicketToEntity(
        ticket,
        idx,
        channelName,
        userMap
      )
    );

    // ============================================================================
    // Merge and sort all entities chronologically
    // ============================================================================

    const allEntities: ToolEntity[] = [
      ...messageEntities,
      ...attachmentEntities,
      ...ticketEntities,
    ];

    // Sort chronologically by timestamp (newest first)
    allEntities.sort((a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    // Apply global limit of 500 items (newest 500)
    const limitedEntities = allEntities.slice(0, 500);

    // Re-index after sorting and limiting
    limitedEntities.forEach((entity, idx) => {
      entity.entityIndex = idx + 1;
    });

    logger.info(
      `[Tool] [${sessionId}] fetch_thread_messages: Found ${limitedEntities.length} total entities ` +
      `(${messageEntities.length} messages, ${attachmentEntities.length} attachments, ` +
      `${ticketEntities.length} tickets) for conversation ${conversationId}`
    );

    return {
      success: true,
      entities: limitedEntities,
      metadata: {
        totalCount: limitedEntities.length,
        messageCount: messageEntities.length,
        attachmentCount: attachmentEntities.length,
        callCount: 0,  // Calls are channel-level, not thread-level
        canvasCount: 0,  // Canvases are channel-level, not thread-level
        ticketCount: ticketEntities.length,
      },
    };
  } catch (error) {
    logger.error(`[Tool] [${sessionId}] fetch_thread_messages error:`, error);
    return {
      success: false,
      entities: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================================================
// Tool Factory
// ============================================================================

/**
 * Create fetch_thread_messages tool with description from Langfuse
 * This tool takes no arguments - it gets conversationId from the agent context
 */
export function createFetchThreadMessagesTool(): Tool<Record<string, never>, XyneAIAgentContext> {
  return {
    schema: {
      name: 'fetch_thread_messages',
      description: getDescription('fetch_thread_messages'),
      parameters: z.object({}),
    },
    execute: async (_args, context) => {
      // Get conversationId from context (PHASE-2: no arguments needed)
      if (!context.conversationId) {
        return 'Error: No conversation ID in context. This tool can only be used in thread context.';
      }

      // channelId is fetched from conversation table inside the implementation
      // No need to pass channelId from context

      const result = await fetchThreadMessagesImpl(
        context.conversationId,
        context.sessionId
      );

      const prefix = await getNextPrefix(context.sessionId);
      if (result.success && result.entities.length > 0) {
        await appendEnhancedSessionMappings(context.sessionId, buildEnhancedCitationMappings(result), prefix);
      }

      return formatEnhancedToolResultForContext(result, prefix);
    },
  };
}

/**
 * Get fetch_thread_messages tool
 * MUST call initializeTools() before using
 */
export function getFetchThreadMessagesTool() {
  return createFetchThreadMessagesTool();
}
