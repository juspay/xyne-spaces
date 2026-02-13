/**
 * Search Relevant Tickets Tool
 */

import { z } from 'zod';
import { type Tool } from '@xynehq/jaf';
import { db } from '../../../database/client.js';
import { logger } from '../../../utils/logger.js';
import { vespaService } from '../../../services/vespaSearch/index.js';
import { transformVespaResults } from '../../../services/vespaSearch/resultTransform.js';
import type { XyneAIAgentContext, ToolResult, ToolMessage } from './types.js';
import {
  getDescription,
  stripHtml,
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
 * Search Relevant Tickets implementation using Vespa service directly
 */
async function searchRelevantTicketsImpl(
  query: string,
  channelIds: string[],
  userId: string,
  sessionId: string,
  precomputedChannelNameMap?: Map<string, string>
): Promise<ToolResult> {
  try {
    logger.info(`[Tool] search_relevant_tickets: query="${query}", channelIds=${JSON.stringify(channelIds)}, userId=${userId}`);

    // Validate max channels limit
    if (channelIds.length > 5) {
      return {
        success: false,
        messages: [],
        error: 'Too many channels specified. Maximum 5 channels allowed per ticket search.',
      };
    }

    // Get all channels' projectIds to use as filter
    // Note: We use projectId instead of channelId because YqlBuilder's ticket filtering
    // has issues with channelId (tickets use channelRef field, not channelId)
    const channels = await db.channel.findMany({
      where: { id: { in: channelIds } },
      select: { id: true, projectId: true, name: true },
    });

    // Build channel name map if not provided
    let channelNameMap: Map<string, string>;
    if (precomputedChannelNameMap && precomputedChannelNameMap.size > 0) {
      channelNameMap = precomputedChannelNameMap;
      logger.debug('[Tool] search_relevant_tickets: Using pre-computed channel name map');
    } else {
      channelNameMap = new Map(channels.map(c => [c.id, c.name]));
    }

    // Collect unique projectIds
    const projectIds = [...new Set(channels.map(c => c.projectId).filter(Boolean))];
    const ticketFilters: Record<string, string[]> = {};
    if (projectIds.length > 0) {
      ticketFilters.projectId = projectIds as string[];
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
    const transformedResults = await transformVespaResults(hits, db);
    
    // Convert results to ToolMessage format (tickets from ticket app)
    const messages: ToolMessage[] = transformedResults
      .map((result, idx) => {
        const creatorName = result.searchContext?.creatorName || 'Unknown Creator';
        const assigneeName = result.searchContext?.assigneeName || 'Unassigned';
        const status = result.searchContext?.ticketStatus || 'Unknown Status';
        const description = stripHtml(result.context || result.title || '');
        
        // Use the first channel as default for ticket citations
        // Tickets are filtered by projectId in Vespa search, so they belong to one of the searched channels
        const ticketChannelId = channelIds[0] || '';
        const ticketChannelName = channelNameMap.get(ticketChannelId) || '';
        
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
          channelId: ticketChannelId,
          channelName: ticketChannelName,
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

// ============================================================================
// Tool Factory
// ============================================================================

/**
 * Create search_relevant_tickets tool with description from Langfuse
 */
export function createSearchRelevantTicketsTool(): Tool<{ query: string; channels?: string[] }, XyneAIAgentContext> {
  return {
    schema: {
      name: 'search_relevant_tickets',
      description: getDescription('search_relevant_tickets'),
      parameters: z.object({
        query: z.string().describe('The search query to find relevant tickets'),
        channels: z.array(z.string()).optional().describe('Optional list of channel names to search tickets in'),
      }),
    },
    execute: async (args, context) => {
      const { query, channels } = args;
      
      // If channels are provided, resolve names to IDs and use multi-channel search
      if (channels && channels.length > 0) {
        logger.info(`[Tool] search_relevant_tickets called with query="${query}", channel names=${JSON.stringify(channels)}`);
        
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
          const inaccessibleChannelNames = existingChannels
            .filter(c => inaccessibleChannelIds.includes(c.id))
            .map(c => c.name);
          
          return `Error: You do not have access to the following channels: ${inaccessibleChannelNames.join(', ')}. Please use field_value_discovery to get a list of channels you have access to.`;
        }

        const result = await searchRelevantTicketsImpl(query, accessibleChannelIds, context.userId, context.sessionId, context.contextChannelIdToName);
        const prefix = await getNextPrefix(context.sessionId);
        if (result.success && result.messages.length > 0) {
          await appendSessionMappings(context.sessionId, buildMessageMappings(result), prefix);
        }
        return formatToolResultForContext(result, prefix);
      }
      
      // Default: search in all channels from context
      logger.info(`[Tool] search_relevant_tickets called with query="${query}", context.channelIds=${JSON.stringify(context.channelIds)}`);
      const result = await searchRelevantTicketsImpl(query, context.channelIds, context.userId, context.sessionId, context.contextChannelIdToName);
      const prefix = await getNextPrefix(context.sessionId);
      if (result.success && result.messages.length > 0) {
        await appendSessionMappings(context.sessionId, buildMessageMappings(result), prefix);
      }
      return formatToolResultForContext(result, prefix);
    },
  };
}

/**
 * Get search_relevant_tickets tool
 * MUST call initializeTools() before using
 */
export function getSearchRelevantTicketsTool() {
  return createSearchRelevantTicketsTool();
}
