/**
 * Fetch Link Content Tool
 *
 * Fetches content from Xyne Spaces internal links (messages, conversations, tickets, canvases).
 * Supports links from: spaces.xyne.juspay.net, app.spaces.xyne.juspay.net, spaces.sandbox.xyne.juspay.net
 */

import { z } from 'zod';
import { type Tool } from '@juspay-jaf/jaf';
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
  transformCanvasToEntity,
  transformTicketToEntity,
} from './helpers.js';
import {
  enforceTokenBudget,
  formatOverflowNotice,
  renderEntityForBudget,
} from './utils/tokenBudget.js';
import {
  parseXyneLink,
  extractXyneLinksFromText,
  ALLOWED_DOMAINS,
  type ParsedXyneLink,
} from './utils/linkParser.js';

// ============================================================================
// Types
// ============================================================================

interface FetchLinkContentResult extends EnhancedToolResult {
  /** The parsed link information */
  parsedLink?: ParsedXyneLink;
  /** Source URL that was fetched */
  sourceUrl?: string;
}

// ============================================================================
// Authorization Helper
// ============================================================================

/**
 * Check if user has access to a channel
 */
async function checkChannelAccess(userId: string, channelId: string): Promise<boolean> {
  const participation = await db.channelParticipant.findUnique({
    where: {
      channelId_userId: {
        channelId,
        userId,
      },
    },
  });
  return !!participation;
}

// ============================================================================
// Content Fetchers
// ============================================================================

/**
 * Fetch a single message by ID with context
 */
async function fetchMessageContent(
  messageId: string,
  channelId: string | undefined,
  userId: string,
  sessionId: string
): Promise<FetchLinkContentResult> {
  try {
    // Fetch the message
    const message = await db.message.findUnique({
      where: { messageId },
      include: {
        conversation: {
          select: { channelId: true, conversationId: true }
        }
      }
    });

    if (!message) {
      return {
        success: false,
        entities: [],
        error: `Message not found with ID: ${messageId}`,
      };
    }

    // Get channel ID from message if not provided
    const resolvedChannelId = channelId || message.conversation?.channelId;
    if (!resolvedChannelId) {
      return {
        success: false,
        entities: [],
        error: 'Could not determine channel for this message',
      };
    }

    // Check access
    const hasAccess = await checkChannelAccess(userId, resolvedChannelId);
    if (!hasAccess) {
      return {
        success: false,
        entities: [],
        error: 'You do not have access to the channel containing this message',
      };
    }

    // Get channel and user info
    const [channel, sender] = await Promise.all([
      db.channel.findUnique({ where: { id: resolvedChannelId }, select: { name: true } }),
      db.user.findUnique({ where: { id: message.senderId }, select: { id: true, name: true, email: true } }),
    ]);

    const userMap = new Map([[message.senderId, sender || { id: message.senderId, name: null, email: null }]]);
    const entity = transformMessageToEntity(
      message,
      1,
      resolvedChannelId,
      channel?.name || '',
      userMap
    );

    logger.info(`[Tool] [${sessionId}] fetch_link_content: Fetched message ${messageId}`);

    return {
      success: true,
      entities: [entity],
      metadata: {
        totalCount: 1,
        messageCount: 1,
        attachmentCount: 0,
        callCount: 0,
        canvasCount: 0,
        ticketCount: 0,
      },
    };
  } catch (error) {
    logger.error(`[Tool] [${sessionId}] fetch_link_content (message) error:`, error);
    return {
      success: false,
      entities: [],
      error: error instanceof Error ? error.message : 'Unknown error fetching message',
    };
  }
}

/**
 * Fetch conversation/thread messages
 */
async function fetchConversationContent(
  conversationId: string,
  channelId: string | undefined,
  userId: string,
  sessionId: string
): Promise<FetchLinkContentResult> {
  try {
    // Fetch conversation to get channel ID
    const conversation = await db.conversation.findUnique({
      where: { conversationId },
      select: { channelId: true, conversationId: true }
    });

    if (!conversation) {
      return {
        success: false,
        entities: [],
        error: `Conversation not found with ID: ${conversationId}`,
      };
    }

    const resolvedChannelId = channelId || conversation.channelId;

    // Check access
    const hasAccess = await checkChannelAccess(userId, resolvedChannelId);
    if (!hasAccess) {
      return {
        success: false,
        entities: [],
        error: 'You do not have access to the channel containing this conversation',
      };
    }

    // Fetch messages in conversation
    const messagesResult = await aiContextService.getMessagesByConversation(conversationId, {
      limit: 100,
      orderBy: { field: 'createdAt', direction: 'asc' }
    });

    if (messagesResult.data.length === 0) {
      return {
        success: true,
        entities: [],
        metadata: {
          totalCount: 0,
          messageCount: 0,
          attachmentCount: 0,
          callCount: 0,
          canvasCount: 0,
          ticketCount: 0,
        },
      };
    }

    // Get channel and user info
    const channel = await db.channel.findUnique({
      where: { id: resolvedChannelId },
      select: { name: true }
    });

    const senderIds = [...new Set(messagesResult.data.map(m => m.senderId))];
    const users = await db.user.findMany({
      where: { id: { in: senderIds } },
      select: { id: true, name: true, email: true }
    });
    const userMap = new Map(users.map(u => [u.id, u]));

    const entities = messagesResult.data.map((msg, idx) =>
      transformMessageToEntity(
        msg,
        idx + 1,
        resolvedChannelId,
        channel?.name || '',
        userMap
      )
    );

    logger.info(`[Tool] [${sessionId}] fetch_link_content: Fetched ${entities.length} messages from conversation ${conversationId}`);

    return {
      success: true,
      entities,
      metadata: {
        totalCount: entities.length,
        messageCount: entities.length,
        attachmentCount: 0,
        callCount: 0,
        canvasCount: 0,
        ticketCount: 0,
      },
    };
  } catch (error) {
    logger.error(`[Tool] [${sessionId}] fetch_link_content (conversation) error:`, error);
    return {
      success: false,
      entities: [],
      error: error instanceof Error ? error.message : 'Unknown error fetching conversation',
    };
  }
}

/**
 * Fetch ticket content with thread messages
 */
async function fetchTicketContent(
  ticketId: string,
  userId: string,
  sessionId: string
): Promise<FetchLinkContentResult> {
  try {
    // Fetch ticket
    const ticket = await db.ticket.findUnique({
      where: { id: ticketId },
    });

    if (!ticket) {
      return {
        success: false,
        entities: [],
        error: `Ticket not found with ID: ${ticketId}`,
      };
    }

    // Check access to channel
    const hasAccess = await checkChannelAccess(userId, ticket.channelId);
    if (!hasAccess) {
      return {
        success: false,
        entities: [],
        error: 'You do not have access to the channel containing this ticket',
      };
    }

    // Get channel info
    const channel = await db.channel.findUnique({
      where: { id: ticket.channelId },
      select: { name: true }
    });

    // Get user info
    const userIds = [ticket.createdBy];
    if (ticket.assignedTo) userIds.push(ticket.assignedTo);
    
    const users = await db.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, email: true }
    });
    const userMap = new Map(users.map(u => [u.id, u]));

    const entities: ToolEntity[] = [];

    // Transform ticket to entity
    const ticketEntity = transformTicketToEntity(
      ticket,
      1,
      channel?.name || '',
      userMap
    );
    entities.push(ticketEntity);

    // Also fetch conversation messages if available
    if (ticket.conversationId) {
      const messagesResult = await aiContextService.getMessagesByConversation(ticket.conversationId, {
        limit: 50,
        orderBy: { field: 'createdAt', direction: 'asc' }
      });

      // Get additional user info for messages
      const messageSenderIds = [...new Set(messagesResult.data.map(m => m.senderId))];
      const messageUsers = await db.user.findMany({
        where: { id: { in: messageSenderIds } },
        select: { id: true, name: true, email: true }
      });
      messageUsers.forEach(u => userMap.set(u.id, u));

      messagesResult.data.forEach((msg, idx) => {
        entities.push(transformMessageToEntity(
          msg,
          idx + 2, // Start from 2 since ticket is 1
          ticket.channelId,
          channel?.name || '',
          userMap
        ));
      });
    }

    logger.info(`[Tool] [${sessionId}] fetch_link_content: Fetched ticket ${ticketId} with ${entities.length - 1} messages`);

    return {
      success: true,
      entities,
      metadata: {
        totalCount: entities.length,
        messageCount: entities.length - 1,
        attachmentCount: 0,
        callCount: 0,
        canvasCount: 0,
        ticketCount: 1,
      },
    };
  } catch (error) {
    logger.error(`[Tool] [${sessionId}] fetch_link_content (ticket) error:`, error);
    return {
      success: false,
      entities: [],
      error: error instanceof Error ? error.message : 'Unknown error fetching ticket',
    };
  }
}

/**
 * Fetch canvas content
 */
async function fetchCanvasContent(
  canvasId: string,
  userId: string,
  sessionId: string
): Promise<FetchLinkContentResult> {
  try {
    // Try to find canvas by ID or viewAccessId
    let canvas = await db.canvas.findUnique({
      where: { id: canvasId }
    });

    // If not found by ID, try viewAccessId
    if (!canvas) {
      canvas = await db.canvas.findFirst({
        where: { viewAccessId: canvasId }
      });
    }

    if (!canvas) {
      return {
        success: false,
        entities: [],
        error: `Canvas not found with ID or viewAccessId: ${canvasId}`,
      };
    }

    // Check access - either channel participant or canvas participant
    let hasAccess = false;
    
    if (canvas.channelId) {
      hasAccess = await checkChannelAccess(userId, canvas.channelId);
    }

    if (!hasAccess) {
      // Check if user is a canvas participant
      const canvasParticipant = await db.canvasParticipant.findUnique({
        where: {
          canvasId_userId: {
            canvasId: canvas.id,
            userId,
          }
        }
      });
      hasAccess = !!canvasParticipant;
    }

    if (!hasAccess && canvas.createdBy !== userId) {
      return {
        success: false,
        entities: [],
        error: 'You do not have access to this canvas',
      };
    }

    // Get channel name if available
    let channelName = '';
    if (canvas.channelId) {
      const channel = await db.channel.findUnique({
        where: { id: canvas.channelId },
        select: { name: true }
      });
      channelName = channel?.name || '';
    }

    // Get creator info
    const creator = await db.user.findUnique({
      where: { id: canvas.createdBy },
      select: { id: true, name: true, email: true }
    });
    const userMap = new Map([[canvas.createdBy, creator || { id: canvas.createdBy, name: null, email: null }]]);

    const entity = transformCanvasToEntity(
      canvas,
      1,
      channelName,
      userMap
    );

    logger.info(`[Tool] [${sessionId}] fetch_link_content: Fetched canvas ${canvas.id}`);

    return {
      success: true,
      entities: [entity],
      metadata: {
        totalCount: 1,
        messageCount: 0,
        attachmentCount: 0,
        callCount: 0,
        canvasCount: 1,
        ticketCount: 0,
      },
    };
  } catch (error) {
    logger.error(`[Tool] [${sessionId}] fetch_link_content (canvas) error:`, error);
    return {
      success: false,
      entities: [],
      error: error instanceof Error ? error.message : 'Unknown error fetching canvas',
    };
  }
}

// ============================================================================
// Main Implementation
// ============================================================================

/**
 * Fetch content from a Xyne Spaces link
 */
async function fetchLinkContentImpl(
  url: string,
  userId: string,
  sessionId: string
): Promise<FetchLinkContentResult> {
  // Parse the URL
  const parsed = parseXyneLink(url);

  if (!parsed.isValid) {
    return {
      success: false,
      entities: [],
      error: parsed.error || 'Invalid Xyne Spaces link',
      parsedLink: parsed,
      sourceUrl: url,
    };
  }

  let result: FetchLinkContentResult;

  switch (parsed.entityType) {
    case 'message':
      result = await fetchMessageContent(
        parsed.ids.messageId!,
        parsed.ids.channelId,
        userId,
        sessionId
      );
      break;

    case 'conversation':
      if (!parsed.ids.conversationId) {
        return {
          success: false,
          entities: [],
          error: 'Conversation ID not found in link',
          parsedLink: parsed,
          sourceUrl: url,
        };
      }
      result = await fetchConversationContent(
        parsed.ids.conversationId,
        parsed.ids.channelId,
        userId,
        sessionId
      );
      break;

    case 'ticket':
      if (!parsed.ids.ticketId) {
        return {
          success: false,
          entities: [],
          error: 'Ticket ID not found in link',
          parsedLink: parsed,
          sourceUrl: url,
        };
      }
      result = await fetchTicketContent(
        parsed.ids.ticketId,
        userId,
        sessionId
      );
      break;

    case 'canvas':
      if (!parsed.ids.canvasId) {
        return {
          success: false,
          entities: [],
          error: 'Canvas ID not found in link',
          parsedLink: parsed,
          sourceUrl: url,
        };
      }
      result = await fetchCanvasContent(
        parsed.ids.canvasId,
        userId,
        sessionId
      );
      break;

    default:
      return {
        success: false,
        entities: [],
        error: `Unknown entity type: ${parsed.entityType}`,
        parsedLink: parsed,
        sourceUrl: url,
      };
  }

  result.parsedLink = parsed;
  result.sourceUrl = url;
  return result;
}

// ============================================================================
// JAF Tool Factory
// ============================================================================

/**
 * Create fetch_link_content tool
 */
export function createFetchLinkContentTool(): Tool<{ url: string }, XyneAIAgentContext> {
  return {
    schema: {
      name: 'fetch_link_content',
      description: getDescription('fetch_link_content'),
      parameters: z.object({
        url: z.string().describe('The Xyne Spaces link to fetch content from. Supported domains: ' + ALLOWED_DOMAINS.join(', ')),
      }),
    },
    execute: async (args, context) => {
      const { url } = args;

      logger.info(`[Tool] [${context.sessionId}] fetch_link_content: url=${url}`);

      const result = await fetchLinkContentImpl(url, context.userId, context.sessionId);

      if (!result.success) {
        return `Error: ${result.error}`;
      }

      if (result.entities.length === 0) {
        return 'No content found at the specified link.';
      }

      // Apply token budget before citation refs are assigned, so refs stay dense.
      // For link content the natural order is already "most relevant first"
      // (ticket/canvas/message at index 1, then its thread messages).
      const tokenBudget = context.toolBudgets.fetchLinkContent;
      const { kept, total: totalAvailable } = enforceTokenBudget(
        result.entities,
        tokenBudget,
        renderEntityForBudget,
      );
      kept.forEach((entity, idx) => {
        entity.entityIndex = idx + 1;
      });
      const truncated = kept.length < totalAvailable;
      result.entities = kept;

      // Store citation mappings
      const prefix = await getNextPrefix(context.sessionId);
      if (result.entities.length > 0) {
        await appendEnhancedSessionMappings(
          context.sessionId,
          buildEnhancedCitationMappings(result),
          prefix
        );
      }

      const overflow = truncated
        ? formatOverflowNotice(kept.length, totalAvailable, 'The linked thread is long — ask about a specific message or subtopic for more detail.')
        : '';

      // Format output
      let output = overflow + formatEnhancedToolResultForContext(result, prefix);

      // Add source link info
      output += `\n\nSource: ${url}`;
      if (result.parsedLink) {
        output += ` (${result.parsedLink.entityType})`;
      }

      return output;
    },
  };
}

/**
 * Get fetch_link_content tool
 * MUST call initializeTools() before using
 */
export function getFetchLinkContentTool() {
  return createFetchLinkContentTool();
}

// Export utility functions for use by other tools
export { extractXyneLinksFromText, parseXyneLink };
