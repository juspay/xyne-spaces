/**
 * Search Relevant Messages Tool
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
  resolveUserName,
  getNextPrefix,
  appendSessionMappings,
  buildMessageMappings,
  formatToolResultForContext,
} from './helpers.js';

// ============================================================================
// Implementation
// ============================================================================

/**
 * Search Relevant Messages with Filters Implementation
 */
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
    const vespaOptions: {
      offset: number;
      limit: number;
      rankProfile: string;
      slack: {
        channelId: string[];
        senderId?: string[];
      };
    } = {
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
      channelNameMap = new Map(channels.map((c: { id: string; name: string }) => [c.id, c.name]));
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
// Tool Factory
// ============================================================================

/**
 * Create search_relevant_messages tool with description from Langfuse
 */
export function createSearchRelevantMessagesTool(): Tool<{ query: string; channels?: string[]; sender?: string }, XyneAIAgentContext> {
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
 * Get search_relevant_messages tool
 * MUST call initializeTools() before using
 */
export function getSearchRelevantMessagesTool() {
  return createSearchRelevantMessagesTool();
}
