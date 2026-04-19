/**
 * Fetch Channel Messages Tool
 *
 * Enhanced tool that retrieves multiple entity types (messages, attachments, calls, canvas, tickets)
 * from channels using AIContextService with intelligent date range management and citation tracking.
 *
 * NOTE: Attachments include metadata only (filename, mimetype, size, dimensions) - no base64 data.
 */

import { z } from 'zod';
import { type Tool } from '@juspay-jaf/jaf';
import { db } from '../../../database/client.js';
import { logger } from '../../../utils/logger.js';
import { aiContextService } from '../../../services/aiContextService.js';
import type { EnrichedCall } from '../../../services/aiContextService.js';
import type {
  XyneAIAgentContext,
  ToolEntity,
  EnhancedToolResult,
} from './types.js';
import {
  getDescription,
  getDefaultDateRange,
  resolveChannelNames,
  getNextPrefix,
  buildEnhancedCitationMappings,
  appendEnhancedSessionMappings,
  formatEnhancedToolResultForContext,
  transformMessageToEntity,
  transformAttachmentToEntity,
  transformCallToEntity,
  transformCanvasToEntity,
  transformTicketToEntity,
} from './helpers.js';

// ============================================================================
// Implementation
// ============================================================================

/**
 * Fetch Channel Messages Multi-Channel Implementation with Multi-Entity Support
 */
async function fetchChannelMessagesMultiChannelImpl(
  channelIds: string[],
  sessionId: string,
  userId: string,
  dateFrom?: string,
  dateTo?: string,
  precomputedChannelNameMap?: Map<string, string>
): Promise<EnhancedToolResult> {
  try {
    const channelCount = channelIds.length;
    logger.info(`[Tool] [${sessionId}] fetch_channel_messages_multi: channelIds=${JSON.stringify(channelIds)}, channelCount=${channelCount}, dateFrom=${dateFrom}, dateTo=${dateTo}`);

    // Handle empty channelIds - ask user for clarification
    if (!channelIds || channelIds.length === 0) {
      return {
        success: false,
        entities: [],
        error: 'NO_CHANNEL_CONTEXT: No channels are currently in context. Ask the user to specify which channel they want to summarize. Use field_value_discovery to validate the channel name once provided.',
      };
    }

    // Validate max channels limit
    if (channelIds.length > 5) {
      return {
        success: false,
        entities: [],
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
        entities: [],
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
        entities: [],
        metadata: {
          totalCount: 0,
          messageCount: 0,
          attachmentCount: 0,
          callCount: 0,
          canvasCount: 0,
          ticketCount: 0,
          dateFrom: fromDate.toISOString(),
          dateTo: toDate.toISOString()
        },
      };
    }

    // Create a map of conversationId -> channelId for later use
    const conversationToChannelMap = new Map(conversations.map(c => [c.conversationId, c.channelId]));

    // ============================================================================
    // Fetch all entity types in parallel using AIContextService
    // ============================================================================

    const [
      messagesResults,
      attachmentsResults,
      callsResults,
      canvasesResults,
      ticketsRaw
    ] = await Promise.all([
      // Fetch messages for each conversation
      Promise.all(
        conversations.map(c =>
          aiContextService.getMessagesByConversation(c.conversationId, {
            timeRange: { start: fromDate, end: toDate }
          })
        )
      ),
      // Fetch attachments for each conversation
      Promise.all(
        conversations.map(c =>
          aiContextService.getAttachmentsByConversation(c.conversationId)
        )
      ),
      // Fetch calls for each channel
      Promise.all(
        channelIds.map(channelId =>
          aiContextService.getCallsByChannel(channelId, {
            timeRange: { start: fromDate, end: toDate }
          })
        )
      ),
      // Fetch canvases for each channel
      Promise.all(
        channelIds.map(channelId =>
          aiContextService.getCanvasesByChannel(channelId, {
            timeRange: { start: fromDate, end: toDate },
            dateField: 'updatedAt',
            userId
          })
        )
      ),
      // Fetch tickets (raw query for now)
      db.ticket.findMany({
        where: {
          channelId: { in: channelIds },
          createdAt: { gte: fromDate, lte: toDate }
        },
        orderBy: { createdAt: 'desc' },
        take: 500
      })
    ]);

    // Flatten results
    const allMessages = messagesResults.flatMap(r => r.data);
    const allAttachments = attachmentsResults
      .flatMap(r => r.attachments)
      .filter(a => new Date(a.createdAt) >= fromDate && new Date(a.createdAt) <= toDate);
    const allCalls = callsResults.flatMap(r => r.data) as EnrichedCall[];
    const allCanvases = canvasesResults.flatMap(r => r.data);
    const allTickets = ticketsRaw;

    // ============================================================================
    // Collect all unique user IDs
    // ============================================================================

    const allUserIds = new Set<string>();
    allMessages.forEach(m => allUserIds.add(m.senderId));
    allAttachments.forEach(a => allUserIds.add(a.uploadedByUserId || a.createdBy));
    allCalls.forEach(c => allUserIds.add(c.createdByUserId));
    allCanvases.forEach(c => allUserIds.add(c.createdBy));
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

    const messageEntities: ToolEntity[] = allMessages.map((msg, idx) => {
      const msgChannelId = conversationToChannelMap.get(msg.conversationId) || '';
      return transformMessageToEntity(
        msg,
        idx,
        msgChannelId,
        channelNameMap.get(msgChannelId) || '',
        userMap
      );
    });

    const attachmentEntities: ToolEntity[] = allAttachments.map((att, idx) => {
      const attChannelId = att?.conversationId && conversationToChannelMap.get(att.conversationId) || '';
      return transformAttachmentToEntity(
        att,
        idx,
        attChannelId,
        channelNameMap.get(attChannelId) || '',
        userMap
      );
    });

    const callEntities: ToolEntity[] = allCalls.map((call, idx) =>
      transformCallToEntity(
        call,
        idx,
        channelNameMap.get(call.channelId ?? '') || '',
        userMap
      )
    );

    const canvasEntities: ToolEntity[] = allCanvases.map((canvas, idx) =>
      transformCanvasToEntity(
        canvas,
        idx,
        channelNameMap.get(canvas.channelId || '') || '',
        userMap
      )
    );

    const ticketEntities: ToolEntity[] = allTickets.map((ticket, idx) =>
      transformTicketToEntity(
        ticket,
        idx,
        channelNameMap.get(ticket.channelId) || '',
        userMap
      )
    );

    // ============================================================================
    // Merge and sort all entities chronologically
    // ============================================================================

    const allEntities: ToolEntity[] = [
      ...messageEntities,
      ...attachmentEntities,
      ...callEntities,
      ...canvasEntities,
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
      `[Tool] [${sessionId}] fetch_channel_messages_multi: Found ${limitedEntities.length} total entities ` +
      `(${messageEntities.length} messages, ${attachmentEntities.length} attachments, ` +
      `${callEntities.length} calls, ${canvasEntities.length} canvases, ${ticketEntities.length} tickets) ` +
      `across ${channelCount} channels (${defaults.days} days range)`
    );

    return {
      success: true,
      entities: limitedEntities,
      metadata: {
        totalCount: limitedEntities.length,
        messageCount: messageEntities.length,
        attachmentCount: attachmentEntities.length,
        callCount: callEntities.length,
        canvasCount: canvasEntities.length,
        ticketCount: ticketEntities.length,
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
      entities: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================================================
// JAF Tool Factory
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
  
      // Validate channels parameter - must have 1-5 channel names
      if (!channels || channels.length === 0) {
        return `Error: NO_CHANNELS_PROVIDED - The 'channels' parameter is required and cannot be empty.

To fix this:
1. Extract the channel name from the user's query (e.g., "summarize genius-discussions" → channels: ["genius-discussions"])
2. If the channel name needs validation, call field_value_discovery first to get the exact channel name
3. If no specific channel is mentioned by the user, check the CHANNEL CONTEXT in the system prompt for available channels
4. If no channels are in context, ask the user to specify which channel they want to summarize

Example: fetch_channel_messages({ channels: ["genius-discussions"], date_from: "2025-01-01" })`;
      }

      if (channels.length > 5) {
        return `Error: TOO_MANY_CHANNELS - Maximum 5 channels allowed per summarization. You provided ${channels.length} channels. Please reduce the number of channels.`;
      }

      if (channels.length > 0) {
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
        const result = await fetchChannelMessagesMultiChannelImpl(accessibleChannelIds, context.sessionId, context.userId, date_from, date_to, context.contextChannelIdToName);
        const prefix = await getNextPrefix(context.sessionId);
        if (result.success && result.entities.length > 0) {
          await appendEnhancedSessionMappings(context.sessionId, buildEnhancedCitationMappings(result), prefix);
        }
        
        // Add info about date range used
        const dateRange = getDefaultDateRange(channelCount);
        let dateInfo = '';
        
        if (result.dateRangeCapped && result.requestedDays) {
          dateInfo = `\n\nNOTE: You requested ${result.requestedDays} days, but with ${channelCount} channel${channelCount > 1 ? 's' : ''} we can only summarize the last ${dateRange.days} days. Showing content from the last ${dateRange.days} days.`;
        } else if (!date_from) {
          dateInfo = `\n\nDate range: Last ${dateRange.days} days (based on ${channelCount} channel${channelCount > 1 ? 's' : ''})`;
        }

        return formatEnhancedToolResultForContext(result, prefix) + dateInfo;
      }

      // Default: use all channels from context with pre-computed channel name map
      const channelCount = context.channelIds.length;
      logger.info(`[Tool] fetch_channel_messages called with context.channelIds=${JSON.stringify(context.channelIds)}, channelCount=${channelCount}`);

      // Use multi-channel implementation for all cases
      const result = await fetchChannelMessagesMultiChannelImpl(context.channelIds, context.sessionId, context.userId, date_from, date_to, context.contextChannelIdToName);
      const prefix = await getNextPrefix(context.sessionId);
      if (result.success && result.entities.length > 0) {
        await appendEnhancedSessionMappings(context.sessionId, buildEnhancedCitationMappings(result), prefix);
      }

      // Add info about date range used
      const dateRange = getDefaultDateRange(channelCount);
      let dateInfo = '';

      // Check if date range was capped
      if (result.dateRangeCapped && result.requestedDays) {
        dateInfo = `\n\nNOTE: You requested ${result.requestedDays} days, but with ${channelCount} channel${channelCount > 1 ? 's' : ''} we can only summarize the last ${dateRange.days} days. Showing content from the last ${dateRange.days} days.`;
      } else if (!date_from) {
        dateInfo = `\n\nDate range: Last ${dateRange.days} days (based on ${channelCount} channel${channelCount > 1 ? 's' : ''})`;
      }

      return formatEnhancedToolResultForContext(result, prefix) + dateInfo;
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
