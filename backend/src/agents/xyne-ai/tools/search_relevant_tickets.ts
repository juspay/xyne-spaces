/**
 * Search Relevant Tickets Tool
 */

import { z } from 'zod';
import { type Tool } from '@xynehq/jaf';
import { db } from '../../../database/client.js';
import { logger } from '../../../utils/logger.js';
import { vespaService } from '../../../services/vespaSearch/index.js';
import { transformVespaResults } from '../../../services/vespaSearch/resultTransform.js';
import type { TicketFilters } from '../../../vespa/src/utils/YqlBuilder.js';
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
// Helper Functions
// ============================================================================

/**
 * Fetch subticket details for given parent ticket IDs
 * Reuses the same pattern as subTicketsForTicket query
 */
async function fetchSubticketsForTickets(
  ticketIds: string[]
): Promise<Map<string, { id: string; title: string; description: string | null }[]>> {
  const subticketMap = new Map<string, { id: string; title: string; description: string | null }[]>();

  if (ticketIds.length === 0) {
    return subticketMap;
  }

  try {
    // Step 1: Get mappings from TicketSubTicketMapping
    const mappings = await db.ticketSubTicketMapping.findMany({
      where: { ticketId: { in: ticketIds } },
      select: { ticketId: true, subTicketId: true },
    });

    if (mappings.length === 0) {
      return subticketMap;
    }

    // Step 2: Get subTicket details
    const subTicketIds = mappings.map((m) => m.subTicketId);
    const subTickets = await db.subTicket.findMany({
      where: { id: { in: subTicketIds } },
      select: { id: true, title: true, description: true },
    });

    const subTicketById = new Map(subTickets.map((st) => [st.id, st]));

    // Step 3: Build the map
    for (const mapping of mappings) {
      const { ticketId, subTicketId } = mapping;
      const subTicket = subTicketById.get(subTicketId);

      if (!subTicket) continue;

      if (!subticketMap.has(ticketId)) {
        subticketMap.set(ticketId, []);
      }
      subticketMap.get(ticketId)!.push({
        id: subTicket.id,
        title: subTicket.title,
        description: subTicket.description,
      });
    }

    return subticketMap;
  } catch (error) {
    logger.error('[Tool] fetchSubticketsForTickets error:', error);
    return subticketMap;
  }
}

/**
 * Format subticket information for display in ticket content
 */
function formatSubticketsContent(
  subtickets: { id: string; title: string; description: string | null }[]
): string {
  if (subtickets.length === 0) {
    return '';
  }

  const lines = subtickets.map((st, idx) => {
    const desc = st.description ? ` - ${st.description}` : '';
    return `  ${idx + 1}. ${st.title}${desc}`;
  });

  return `\n\nSubtickets:\n${lines.join('\n')}`;
}

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
  precomputedChannelNameMap?: Map<string, string>,
  ticketFilters?: Partial<TicketFilters>
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
    const filters: Partial<TicketFilters> = { ...ticketFilters };
    if (projectIds.length > 0) {
      filters.projectId = projectIds as string[];
    }

    const vespaResults = await vespaService.searchService.searchVespa(
      query,
      userId,
      ['ticket'],
      {
        offset: 0,
        limit: 50,
        rankProfile: 'default_native',
        ticket: filters,
      }
    );

    const hits = vespaResults.root.children || [];
    const transformedResults = await transformVespaResults(hits, db);

    // Extract ticket IDs and fetch subticket information
    const ticketIds = transformedResults.map((result) => result.id);
    const subticketMap = await fetchSubticketsForTickets(ticketIds);

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

        // Get subticket information for this ticket
        const subtickets = subticketMap.get(result.id) || [];
        const subticketContent = formatSubticketsContent(subtickets);

        // Format ticket content with all required fields including subtickets
        const ticketContent = `Title: ${result.title}\nStatus: ${status}\nCreated by: ${creatorName}\nAssigned to: ${assigneeName}\n\nDescription:\n${description}${subticketContent}`;

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
export function createSearchRelevantTicketsTool(): Tool<{
  query: string;
  channels?: string[];
  status?: string;
  priority?: string;
  ticketId?: string;
  createdBy?: string;
  assignedTo?: string;
  boardId?: string;
  tags?: string;
  stage?: string;
  createdBefore?: string;
  createdAfter?: string;
  createdOn?: string;
        createdRange?: string;
      }, XyneAIAgentContext> {
  return {
    schema: {
      name: 'search_relevant_tickets',
      description: getDescription('search_relevant_tickets'),
      parameters: z.object({
        query: z.string().describe('The search query to find relevant tickets'),
        channels: z.array(z.string()).optional().describe('Optional list of channel names to search tickets in'),
        status: z.string().optional().describe('Filter by ticket status (comma-separated). Valid values: TODO, STARTED, PAUSED, CANCELLED, COMPLETED. Example: "TODO,STARTED"'),
        priority: z.string().optional().describe('Filter by ticket priority (comma-separated). Valid values: LOW, MEDIUM, HIGH, CRITICAL. Example: "HIGH,CRITICAL"'),
        ticketId: z.string().optional().describe('Filter by specific ticket IDs (comma-separated). Example: "TKT-001,TKT-002"'),
        createdBy: z.string().optional().describe('Filter by creator username (pass the USERNAME from field_value_discovery). Example: "John Doe"'),
        assignedTo: z.string().optional().describe('Filter by assignee usernames (comma-separated, pass the USERNAMES from field_value_discovery). Example: "Jane Smith,Bob Wilson"'),
        boardId: z.string().optional().describe('Filter by board IDs/names (comma-separated). Example: "board1,board2"'),
        tags: z.string().optional().describe('Filter by ticket tags (comma-separated). Example: "bug,urgent"'),
        stage: z.string().optional().describe('Filter by stage names (comma-separated). Example: "Development,Testing"'),
        createdBefore: z.string().optional().describe('Filter tickets created before this date (ISO format or dd/mm/yyyy). Example: "2024-01-01"'),
        createdAfter: z.string().optional().describe('Filter tickets created after this date (ISO format or dd/mm/yyyy). Example: "2024-12-31"'),
        createdOn: z.string().optional().describe('Filter tickets created on this specific date (ISO format or dd/mm/yyyy). Example: "2024-06-15"'),
        createdRange: z.string().optional().describe('Filter by time keyword. Valid values: "today", "yesterday", "this week", "last week", "last 7 days", "this month", "last month", "last 30 days", "this morning", "this afternoon", "last hour", "last 24 hours", "recent", "recently", "new", "current", "currently", "last", "latest"'),
      }),
    },
    execute: async (args, context) => {
      const { query, channels, status, priority, ticketId, createdBy, assignedTo, boardId, tags, stage, createdBefore, createdAfter, createdOn, createdRange } = args;

      // Resolve createdBy username to ID
      let resolvedCreatedByIds: string[] | undefined;
      if (createdBy) {
        const { userId, notFound } = resolveUserName(createdBy, context.requestMappings);
        if (notFound) {
          return `Error: The username "${createdBy}" was not found in the request mappings. Please call field_value_discovery with field="username" first to validate this username.`;
        }
        if (userId) {
          resolvedCreatedByIds = [userId];
        }
      }

      // Resolve assignedTo usernames to IDs
      let resolvedAssignedToIds: string[] | undefined;
      if (assignedTo) {
        const assignedToNames = assignedTo.split(',').map(n => n.trim()).filter(n => n);
        const resolvedIds: string[] = [];
        const notFoundNames: string[] = [];

        for (const name of assignedToNames) {
          const { userId, notFound } = resolveUserName(name, context.requestMappings);
          if (notFound) {
            notFoundNames.push(name);
          } else if (userId) {
            resolvedIds.push(userId);
          }
        }

        if (notFoundNames.length > 0) {
          return `Error: The following usernames were not found in the request mappings: ${notFoundNames.join(', ')}. Please call field_value_discovery with field="username" first to validate these usernames.`;
        }

        if (resolvedIds.length > 0) {
          resolvedAssignedToIds = resolvedIds;
        }
      }

      // Helper to parse comma-separated strings
      const parseArray = (value: string | undefined): string[] | undefined => {
        if (!value) return undefined;
        return value.split(',').map(v => v.trim()).filter(v => v);
      };

      // Build comprehensive filter object
      const ticketFilters: Partial<TicketFilters> = {};
      if (resolvedCreatedByIds) ticketFilters.createdBy = resolvedCreatedByIds;
      if (resolvedAssignedToIds) ticketFilters.assignedTo = resolvedAssignedToIds;
      if (status) ticketFilters.status = parseArray(status);
      if (priority) ticketFilters.priority = parseArray(priority);
      if (ticketId) ticketFilters.ticketId = parseArray(ticketId);
      if (boardId) ticketFilters.boardId = parseArray(boardId);
      if (tags) ticketFilters.tags = parseArray(tags);
      if (stage) ticketFilters.stage = parseArray(stage);
      if (createdBefore) ticketFilters.createdBefore = createdBefore;
      if (createdAfter) ticketFilters.createdAfter = createdAfter;
      if (createdOn) ticketFilters.createdOn = createdOn;
      if (createdRange) ticketFilters.createdRange = createdRange;

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

        const result = await searchRelevantTicketsImpl(query, accessibleChannelIds, context.userId, context.sessionId, context.contextChannelIdToName, ticketFilters);
        const prefix = await getNextPrefix(context.sessionId);
        if (result.success && result.messages.length > 0) {
          await appendSessionMappings(context.sessionId, buildMessageMappings(result), prefix);
        }
        return formatToolResultForContext(result, prefix);
      }
      
      // Default: search in all channels from context
      logger.info(`[Tool] search_relevant_tickets called with query="${query}", context.channelIds=${JSON.stringify(context.channelIds)}`);
      const result = await searchRelevantTicketsImpl(query, context.channelIds, context.userId, context.sessionId, context.contextChannelIdToName, ticketFilters);
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
