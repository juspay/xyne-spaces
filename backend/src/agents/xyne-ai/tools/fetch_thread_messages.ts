/**
 * Fetch Thread Messages Tool
 *
 * Retrieves multiple entity types (messages, attachments, tickets, emails)
 * for a specific conversation/thread using AIContextService with citation tracking.
 *
 * NOTE: Only fetches entities that have conversationId:
 * - Messages (by conversationId)
 * - Attachments (by conversationId) - METADATA ONLY, no base64 data
 * - Tickets (by conversationId)
 * - Emails (desk/support mails, by conversationId)
 *
 * Skipped entities (no conversationId support):
 * - Calls (channel-level)
 * - Canvas (channel-level)
 */

import { z } from 'zod';
import { type Tool } from '@juspay-jaf/jaf';
import { db } from '../../../database/client.js';
import { logger } from '../../../utils/logger.js';
import { aiContextService } from '../../../services/aiContextService.js';
import { getCanvasById } from '../../../services/canvasService.js';
import { readFromYSweet } from '../../../utils/ysweetUtils.js';
import { convertBlockNoteToMarkdown } from '../../../services/canvasService.js';
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
  transformEmailToEntity,
  toIST,
} from './helpers.js';
import {
  enforceTokenBudget,
  formatOverflowNotice,
  renderEntityForBudget,
} from './utils/tokenBudget.js';

// ============================================================================
// Implementation
// ============================================================================

/**
 * Fetch Thread Messages Implementation with Multi-Entity Support
 * Retrieves all content (messages, attachments, tickets) for a specific conversation/thread
 */
async function fetchThreadMessagesImpl(
  conversationId: string,
  sessionId: string,
  tokenBudget: number,
): Promise<EnhancedToolResult & { truncated?: boolean; totalAvailable?: number }> {
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
      ticketsRaw,
      emailsRaw
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
      }),
      // Fetch desk/support emails for the specific conversation
      db.email.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'asc' },
        take: 100
      })
    ]);

    // Get messages
    const allMessages = messagesResult.data;

    // Get attachments
    const allAttachments = attachmentsResult.attachments;

    // Tickets are already filtered by conversationId
    const allTickets = ticketsRaw;

    // Emails are already filtered by conversationId
    const allEmails = emailsRaw;

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

    const emailEntities: ToolEntity[] = allEmails.map((email, idx) =>
      transformEmailToEntity(email, idx, channelId, channelName)
    );

    // ============================================================================
    // Fetch canvases from canvasIds found in message content
    // ============================================================================

    // Collect all unique canvasIds from message entities
    const allCanvasIds = new Set<string>();
    messageEntities.forEach(msg => {
      if (msg.canvasIds && msg.canvasIds.length > 0) {
        msg.canvasIds.forEach(id => allCanvasIds.add(id));
      }
    });

    // Fetch canvases by canonical id and convert to markdown
    const canvasEntities: ToolEntity[] = [];
    if (allCanvasIds.size > 0) {
      logger.info(`[Tool] [${sessionId}] fetch_thread_messages: Fetching ${allCanvasIds.size} canvases from message content`);

      const canvasIdArray = Array.from(allCanvasIds);
      const canvasResults = await Promise.all(
        canvasIdArray.map(canvasId => getCanvasById(canvasId))
      );

      for (let i = 0; i < canvasResults.length; i++) {
        const canvas = canvasResults[i];
        if (!canvas) continue;

        try {
          // Read content from Y-Sweet (not postgres)
          const blocks = await readFromYSweet(canvas.id);
          // Convert BlockNote blocks to Markdown
          const markdownContent = await convertBlockNoteToMarkdown(blocks);
          // i need only first 1000 characters of markdown content to avoid hitting token limits in the agent
          const truncatedContent = markdownContent.slice(0, 1000);

          // Get canvas creator info
          const canvasCreator = userMap.get(canvas.createdBy);

          canvasEntities.push({
            entityType: 'canvas',
            entityId: canvas.id,
            entityIndex: 0, // Will be re-indexed later
            content: `Canvas: ${canvas.title}\n\n${truncatedContent}`,
            authorName: canvasCreator?.name || canvasCreator?.email || 'Unknown User',
            authorId: canvas.createdBy,
            timestamp: toIST(canvas.createdAt),
            channelId,
            channelName,
            canvasId: canvas.id,
          });
        } catch (error) {
          logger.warn(`[Tool] [${sessionId}] Failed to convert canvas ${canvas.id} to markdown:`, error);
        }
      }

      logger.info(`[Tool] [${sessionId}] fetch_thread_messages: Converted ${canvasEntities.length} canvases to markdown`);
    }

    // ============================================================================
    // Merge and sort all entities chronologically
    // ============================================================================

    const allEntities: ToolEntity[] = [
      ...messageEntities,
      ...attachmentEntities,
      ...ticketEntities,
      ...canvasEntities,
      ...emailEntities,
    ];

    // Sort chronologically by timestamp (newest first)
    allEntities.sort((a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    // Apply token budget — newest entities win; drop tail until we fit.
    const { kept: keptEntities, total: totalAvailable } = enforceTokenBudget(
      allEntities,
      tokenBudget,
      renderEntityForBudget,
    );

    // Re-index after budgeting so citation refs stay dense
    keptEntities.forEach((entity, idx) => {
      entity.entityIndex = idx + 1;
    });

    const truncated = keptEntities.length < totalAvailable;

    logger.info(
      `[Tool] [${sessionId}] fetch_thread_messages: Returned ${keptEntities.length}/${totalAvailable} entities after token budget (${tokenBudget}) ` +
      `(${messageEntities.length} messages, ${attachmentEntities.length} attachments, ` +
      `${ticketEntities.length} tickets, ${canvasEntities.length} canvases, ` +
      `${emailEntities.length} emails) for conversation ${conversationId}${truncated ? ' [TRUNCATED]' : ''}`
    );

    return {
      success: true,
      entities: keptEntities,
      metadata: {
        totalCount: keptEntities.length,
        messageCount: messageEntities.length,
        attachmentCount: attachmentEntities.length,
        callCount: 0,  // Calls are channel-level, not thread-level
        canvasCount: canvasEntities.length,
        ticketCount: ticketEntities.length,
        emailCount: emailEntities.length,
      },
      truncated,
      totalAvailable,
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

      const tokenBudget = context.toolBudgets.fetchThreadMessages;
      const result = await fetchThreadMessagesImpl(
        context.conversationId,
        context.sessionId,
        tokenBudget,
      );

      const prefix = await getNextPrefix(context.sessionId);
      if (result.success && result.entities.length > 0) {
        await appendEnhancedSessionMappings(context.sessionId, buildEnhancedCitationMappings(result), prefix);
      }

      const overflow = result.truncated
        ? formatOverflowNotice(result.entities.length, result.totalAvailable ?? result.entities.length, 'This thread is long — ask about a specific message or topic to see more.')
        : '';

      return overflow + formatEnhancedToolResultForContext(result, prefix);
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
