/**
 * Fetch Thread Messages Tool
 */

import { z } from 'zod';
import { type Tool } from '@xynehq/jaf';
import { db } from '../../../database/client.js';
import { logger } from '../../../utils/logger.js';
import type { XyneAIAgentContext, ToolResult } from './types.js';
import {
  getDescription,
  formatMessages,
  getNextPrefix,
  appendSessionMappings,
  buildMessageMappings,
  formatToolResultForContext,
} from './helpers.js';

// ============================================================================
// Implementation
// ============================================================================

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

// ============================================================================
// Tool Factory
// ============================================================================

/**
 * Create fetch_thread_messages tool with description from Langfuse
 */
export function createFetchThreadMessagesTool(): Tool<Record<string, never>, XyneAIAgentContext> {
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
 * Get fetch_thread_messages tool
 * MUST call initializeTools() before using
 */
export function getFetchThreadMessagesTool() {
  return createFetchThreadMessagesTool();
}
