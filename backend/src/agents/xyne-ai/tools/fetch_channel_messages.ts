/**
 * Fetch Channel Messages Tool
 */

import { z } from 'zod';
import { type Tool } from '@xynehq/jaf';
import { db } from '../../../database/client.js';
import { logger } from '../../../utils/logger.js';
import type { XyneAIAgentContext, ToolMessage, ToolResultWithCapping } from './types.js';
import {
  getDescription,
  toIST,
  stripHtml,
  getDefaultDateRange,
  resolveChannelNames,
  getNextPrefix,
  appendSessionMappings,
  buildMessageMappings,
  formatToolResultForContext,
} from './helpers.js';

// ============================================================================
// Implementation
// ============================================================================

/**
 * Fetch Channel Messages Multi-Channel Implementation
 */
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

// ============================================================================
// Tool Factory
// ============================================================================

/**
 * Create fetch_channel_messages tool with description from Langfuse
 */
export function createFetchChannelMessagesTool(): Tool<{ date_from?: string; date_to?: string; channels?: string[] }, XyneAIAgentContext> {
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
 * Get fetch_channel_messages tool
 * MUST call initializeTools() before using
 */
export function getFetchChannelMessagesTool() {
  return createFetchChannelMessagesTool();
}
