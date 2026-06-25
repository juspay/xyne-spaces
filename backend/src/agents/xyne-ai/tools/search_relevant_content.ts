/**
 * Search Relevant Content Tool — unified search for messages, tickets, canvas, calls, and recordings
 */

import { z } from 'zod';
import { type Tool } from '@juspay-jaf/jaf';
import { db } from '../../../database/client.js';
import { logger } from '../../../utils/logger.js';
import { vespaService } from '../../../services/vespaSearch/index.js';
import { transformVespaResults } from '../../../services/vespaSearch/resultTransform.js';
import { fetchCanvases } from '../utils/contextFetcher.js';
import type { SlackFilters, TicketFilters, FileFilters } from '../../../vespa/src/utils/YqlBuilder.js';
import type { XyneAIAgentContext, ToolResult, ToolMessage, EnhancedCitationMappings, EntityType } from './types.js';
import {
  getDescription,
  stripHtml,
  resolveChannelNames,
  resolveUserName,
  getNextPrefix,
  appendEnhancedSessionMappings,
  formatToolResultForContext,
} from './helpers.js';
import {
  enforceTokenBudget,
  formatOverflowNotice,
  renderMessageForBudget,
} from './utils/tokenBudget.js';

// ============================================================================
// Types
// ============================================================================

type ContentType = 'messages' | 'tickets' | 'canvas' | 'calls' | 'recordings';

// ============================================================================
// Citation Mapping Builder
// ============================================================================

/**
 * Build EnhancedCitationMappings from our ToolResult so the stream can
 * populate entityType, canvasId, etc. for proper citation URL construction.
 */
function buildSearchContentMappings(result: ToolResult): EnhancedCitationMappings {
  const entityIdMapping: Record<number, string> = {};
  const entityTypeMapping: Record<number, EntityType> = {};
  const conversationIdMapping: Record<number, string | undefined> = {};
  const messageIdMapping: Record<number, string | undefined> = {};
  const canvasIdMapping: Record<number, string | undefined> = {};
  const channelIdMapping: Record<number, string> = {};
  const externalUrlMapping: Record<number, string | undefined> = {};
  const isExternalMapping: Record<number, boolean> = {};
  const chunkTextMapping: Record<number, string | undefined> = {};
  const canvasTitleMapping: Record<number, string | undefined> = {};
  const channelNameMapping: Record<number, string | undefined> = {};

  for (const msg of result.messages) {
    const idx = msg.messageIndex;
    const contentType = msg.contentType || 'message';

    entityIdMapping[idx] = msg.messageId;
    channelIdMapping[idx] = msg.channelId;
    isExternalMapping[idx] = false;
    channelNameMapping[idx] = msg.channelName;
    if (msg.canvasTitle) canvasTitleMapping[idx] = msg.canvasTitle;
    if (msg.content && msg.content.trim().length > 0) {
      chunkTextMapping[idx] = msg.content;
    }

    switch (contentType) {
      case 'message':
        entityTypeMapping[idx] = 'message';
        messageIdMapping[idx] = msg.messageId;
        conversationIdMapping[idx] = msg.conversationId;
        break;
      case 'ticket':
        entityTypeMapping[idx] = 'ticket';
        conversationIdMapping[idx] = msg.conversationId || msg.messageId;
        break;
      case 'canvas':
        entityTypeMapping[idx] = 'canvas';
        canvasIdMapping[idx] = msg.messageId;
        break;
      case 'call':
        entityTypeMapping[idx] = 'call';
        conversationIdMapping[idx] = msg.conversationId;
        break;
      case 'recording':
        entityTypeMapping[idx] = 'recording';
        break;
    }
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
    chunkIndexMapping: {},
    chunkTextMapping,
    chunkPosMapping: {},
    fileNameMapping: {},
    mimeTypeMapping: {},
    canvasTitleMapping,
    channelNameMapping,
  };
}


async function fetchSubticketsForTickets(
  ticketIds: string[]
): Promise<Map<string, { id: string; title: string; description: string | null }[]>> {
  const subticketMap = new Map<string, { id: string; title: string; description: string | null }[]>();
  if (ticketIds.length === 0) return subticketMap;

  try {
    const mappings = await db.ticketSubTicketMapping.findMany({
      where: { ticketId: { in: ticketIds } },
      select: { ticketId: true, subTicketId: true },
    });
    if (mappings.length === 0) return subticketMap;

    const subTicketIds = mappings.map((m) => m.subTicketId);
    const subTickets = await db.subTicket.findMany({
      where: { id: { in: subTicketIds } },
      select: { id: true, title: true, description: true },
    });
    const subTicketById = new Map(subTickets.map((st) => [st.id, st]));

    for (const mapping of mappings) {
      const { ticketId, subTicketId } = mapping;
      const subTicket = subTicketById.get(subTicketId);
      if (!subTicket) continue;
      if (!subticketMap.has(ticketId)) subticketMap.set(ticketId, []);
      subticketMap.get(ticketId)!.push({ id: subTicket.id, title: subTicket.title, description: subTicket.description });
    }
    return subticketMap;
  } catch (error) {
    logger.error('[Tool] fetchSubticketsForTickets error:', error);
    return subticketMap;
  }
}

// ============================================================================
// Vespa Result Flattener
// ============================================================================

function flattenVespaChildren(children: any[]): any[] {
  const hits: any[] = [];

  function walk(items: any[]) {
    for (const item of items) {
      const isGroupNode = typeof item.id === 'string' && item.id.startsWith('group:');
      if (item.fields && !isGroupNode) {
        // Real document hit
        hits.push(item);
      } else if (item.children) {
        // Group container — recurse
        walk(item.children);
      }
    }
  }

  walk(children);
  return hits;
}

// ============================================================================
// Implementation
// ============================================================================

const CANVAS_CONTENT_MAX_CHARS = 1500;
const CALL_TRANSCRIPT_MAX_CHARS = 2000;

function truncateContent(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  return content.slice(0, maxChars) + `\n...[truncated, ${content.length - maxChars} more chars]`;
}

async function searchRelevantContentImpl(
  query: string,
  contentTypes: ContentType[],
  userId: string,
  sessionId: string,
  channelIds: string[],
  slackFilters: Partial<SlackFilters>,
  ticketFilters: Partial<TicketFilters>,
  tokenBudget: number,
  precomputedChannelNameMap?: Map<string, string>
): Promise<ToolResult & { truncated?: boolean; totalAvailable?: number }> {
  try {
    logger.info(`[Tool] search_relevant_content: query="${query}", contentTypes=${JSON.stringify(contentTypes)}, userId=${userId}`);

    // Build Vespa apps array (deduplicated)
    const appsSet = new Set<string>();
    if (contentTypes.includes('messages')) appsSet.add('chat');
    if (contentTypes.includes('tickets')) appsSet.add('ticket');
    if (contentTypes.includes('canvas') || contentTypes.includes('calls') || contentTypes.includes('recordings')) appsSet.add('file');
    const apps = Array.from(appsSet);

    // Build FileFilters based on requested file-type content types
    const fileFilters: Partial<FileFilters> = {};
    if (apps.includes('file')) {
      const subApps: string[] = [];
      if (contentTypes.includes('canvas')) subApps.push('CANVAS');
      if (contentTypes.includes('calls') || contentTypes.includes('recordings')) subApps.push('TRANSCRIPT');
      if (subApps.length > 0) fileFilters.subApp = subApps;

      // Recordings are TRANSCRIPT with callType=HEADLESS
      // If only recordings requested (no plain calls), add the callType filter
      if (contentTypes.includes('recordings') && !contentTypes.includes('calls')) {
        fileFilters.callType = ['HEADLESS'];
      }
    }

    // Attach channel/project filters for chat and ticket apps
    const builtSlackFilters: Partial<SlackFilters> = { ...slackFilters };
    if (apps.includes('chat') && channelIds.length > 0) {
      builtSlackFilters.channelId = channelIds;
    }

    const builtTicketFilters: Partial<TicketFilters> = { ...ticketFilters };
    if (apps.includes('ticket') && channelIds.length > 0) {
      builtTicketFilters.channelId = channelIds;
    }

    // Resolve channel name map
    let channelNameMap: Map<string, string>;
    if (precomputedChannelNameMap && precomputedChannelNameMap.size > 0) {
      channelNameMap = precomputedChannelNameMap;
    } else {
      const dbChannels = await db.channel.findMany({
        where: { id: { in: channelIds } },
        select: { id: true, name: true },
      });
      channelNameMap = new Map(dbChannels.map((c: { id: string; name: string }) => [c.id, c.name]));
    }

    const resultLimit = 50;

    const vespaOpts = {
      offset: 0,
      limit: resultLimit,
      rankProfile: 'default_native',
      slack: builtSlackFilters,
      ticket: builtTicketFilters,
      file: fileFilters,
    };

    // Run Vespa search with graceful degradation — if Vespa is unavailable (e.g. 503),
    // log the error and continue with 0 hits.
    let hits: any[] = [];
    try {
      const vespaResults = await vespaService.searchService.searchVespa(query, userId, apps, vespaOpts);
      hits = flattenVespaChildren(vespaResults.root.children || []);
    } catch (vespaError) {
      logger.warn(`[Tool] [${sessionId}] search_relevant_content: Vespa unavailable, falling back to DB-only results. Error: ${vespaError instanceof Error ? vespaError.message : vespaError}`);
    }

    logger.info(`[Tool] [${sessionId}] search_relevant_content: Vespa returned ${hits.length} raw hits (after flattening grouped response)`);

    const transformedResults = await transformVespaResults(hits, db);

    // For ticket results, batch-fetch subtickets
    const ticketResultIds = transformedResults
      .filter((r) => r.searchContext?.ticketId || r.type === 'ticket')
      .map((r) => r.id);
    const subticketMap = ticketResultIds.length > 0
      ? await fetchSubticketsForTickets(ticketResultIds)
      : new Map();

    // For recording results, batch-fetch externalId directly from the DB
    // (avoids parsing Vespa metadata JSON)
    const recordingResultIds = transformedResults
      .filter((r) => r.type === 'attachment' && r.searchContext?.subApp?.toUpperCase() === 'TRANSCRIPT' && r.searchContext?.callType === 'HEADLESS')
      .map((r) => r.id);
    const recordingExternalIdMap = new Map<string, string>();
    if (recordingResultIds.length > 0) {
      const calls = await db.call.findMany({
        where: { id: { in: recordingResultIds } },
        select: { id: true, externalId: true },
      });
      for (const call of calls) {
        if (call.externalId) recordingExternalIdMap.set(call.id, call.externalId);
      }
    }

    // For canvas results, batch-fetch full content from Y-Sweet / DB.
    // Vespa only indexes the canvas title so we must enrich each result here.
    // fetchCanvases (from contextFetcher) handles the Y-Sweet → DB fallback
    // strategy and auth checks in one place — no duplication needed.
    const canvasResultIds = transformedResults
      .filter((r) => r.type === 'attachment' && r.searchContext?.subApp?.toUpperCase() === 'CANVAS')
      .map((r) => r.id);
    const canvasContentMap = new Map<string, string>();
    if (canvasResultIds.length > 0) {
      const fetchedCanvases = await fetchCanvases(canvasResultIds, userId);
      for (const item of fetchedCanvases) {
        canvasContentMap.set(item.id, item.content);
      }
      logger.info(`[Tool] [${sessionId}] search_relevant_content: fetched full content for ${canvasContentMap.size}/${canvasResultIds.length} canvas(es)`);
    }

    // Convert to ToolMessage format, deriving contentType from docType/subApp.
    // messageIndex is assigned *after* budget enforcement so citation refs stay
    // dense — refs the LLM emits must resolve in the UI.
    const messages: ToolMessage[] = transformedResults.map((result) => {
      const subApp = result.searchContext?.subApp?.toUpperCase();

      // Determine content type from Vespa result type
      let contentType: ToolMessage['contentType'] = 'message';
      if (result.type === 'ticket') {
        contentType = 'ticket';
      } else if (result.type === 'attachment') {
        if (subApp === 'CANVAS') contentType = 'canvas';
        else if (subApp === 'TRANSCRIPT') {
          contentType = result.searchContext?.callType === 'HEADLESS' ? 'recording' : 'call';
        } else contentType = 'message'; // fallback for other file types
      }

      // Format content based on type
      let content: string;
      let authorName: string;
      let authorId: string;
      let channelId: string;
      let channelName: string;
      let conversationId: string;

      if (contentType === 'ticket') {
        const creatorName = result.searchContext?.creatorName || 'Unknown Creator';
        const assigneeName = result.searchContext?.assigneeName || 'Unassigned';
        const status = result.searchContext?.ticketStatus || 'Unknown Status';
        const description = stripHtml(result.context || result.title || '');

        const subtickets = (subticketMap as Map<string, { id: string; title: string; description: string | null }[]>).get(result.id) || [];
        const subticketContent = subtickets.length > 0
          ? `\n\nSubtickets:\n${subtickets.map((st, i) => `  ${i + 1}. ${st.title}${st.description ? ` - ${st.description}` : ''}`).join('\n')}`
          : '';

        content = `Title: ${result.title}\nStatus: ${status}\nCreated by: ${creatorName}\nAssigned to: ${assigneeName}\n\nDescription:\n${description}${subticketContent}`;
        authorName = creatorName;
        authorId = result.searchContext?.createdBy || '';
        channelId = result.searchContext?.channelId || channelIds[0] || '';
        channelName = channelNameMap.get(channelId) || result.metadata?.channelName || '';
        conversationId = result.searchContext?.conversationId || '';
      } else if (contentType === 'canvas') {
        // Prefer the full content fetched from Y-Sweet / DB; fall back to the
        // Vespa title-only snippet when neither source returned anything.
        const rawCanvas = canvasContentMap.get(result.id);
        const canvasBody = rawCanvas
          ? rawCanvas.replace(/^Canvas:[\s\S]*?\nContent Status:[^\n]*\n\n/, '')
          : stripHtml(result.subtitle || result.context || '');
        const bodyText = truncateContent(canvasBody, CANVAS_CONTENT_MAX_CHARS);
        content = `Title: ${result.title}\nCreated by: ${result.avatar || 'Unknown'}\n\nContent:\n${bodyText}`;
        authorName = result.avatar || 'Unknown';
        authorId = result.searchContext?.attachmentId ? '' : (result.avatar || '');
        channelId = result.searchContext?.channelId || channelIds[0] || '';
        channelName = channelNameMap.get(channelId) || result.metadata?.channelName || '';
        conversationId = result.searchContext?.conversationId || '';
      } else if (contentType === 'call') {
        content = truncateContent(`Title: ${result.title}\nTranscript:\n${stripHtml(result.subtitle || result.context || '')}`, CALL_TRANSCRIPT_MAX_CHARS);
        authorName = result.avatar || 'Unknown';
        authorId = result.avatar || '';
        channelId = result.searchContext?.channelId || channelIds[0] || '';
        channelName = channelNameMap.get(channelId) || result.metadata?.channelName || '';
        conversationId = result.searchContext?.conversationId || '';
      } else {
        // message
        content = stripHtml(result.context || result.title || '');
        authorName = result.subtitle?.replace(/^By /, '') || 'Unknown User';
        authorId = result.searchContext?.senderId || '';
        channelId = result.searchContext?.channelId || channelIds[0] || '';
        channelName = channelNameMap.get(channelId) || result.metadata?.channelName || '';
        conversationId = result.searchContext?.conversationId || '';
      }

      // For recordings the citation URL is /recordings/:externalId
      const entityId = contentType === 'recording'
        ? (recordingExternalIdMap.get(result.id) || result.id)
        : result.id;

      return {
        messageId: entityId,
        messageIndex: 0, // assigned below after budget enforcement
        content,
        authorName,
        authorId,
        timestamp: result.metadata?.timestamp || new Date().toISOString(),
        conversationId,
        channelId,
        channelName,
        hasAttachment: false,
        isTicket: contentType === 'ticket',
        contentType,
        ...(contentType === 'canvas' && { canvasTitle: stripHtml(result.title) }),
      };
    });

    // Apply token budget in Vespa relevance order (top hits win)
    const { kept, total: totalAvailable } = enforceTokenBudget(messages, tokenBudget, renderMessageForBudget);
    kept.forEach((msg, idx) => {
      msg.messageIndex = idx + 1;
    });
    const truncated = kept.length < totalAvailable;

    logger.info(
      `[Tool] [${sessionId}] search_relevant_content: Returned ${kept.length}/${totalAvailable} results after token budget (${tokenBudget})${truncated ? ' [TRUNCATED]' : ''}`
    );

    return {
      success: true,
      messages: kept,
      metadata: { totalCount: kept.length },
      truncated,
      totalAvailable,
    };
  } catch (error) {
    logger.error(`[Tool] [${sessionId}] search_relevant_content error:`, error);
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

export function createSearchRelevantContentTool(): Tool<{
  contentTypes: ContentType[];
  query: string;
  channels?: string[];
  sender?: string;
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
      name: 'search_relevant_content',
      description: getDescription('search_relevant_content'),
      parameters: z.object({
        contentTypes: z.array(z.enum(['messages', 'tickets', 'canvas', 'calls', 'recordings']))
          .describe('Types of content to search. Use "messages" for chat, "tickets" for project tickets, "canvas" for canvas documents, "calls" for call transcripts, "recordings" for HEADLESS recordings only.'),
        query: z.string().describe('The search query to find relevant content'),
        channels: z.array(z.string()).optional().describe('Optional list of channel names to scope the search (applies to messages and tickets only; canvas/calls/recordings use permission-based access)'),
        sender: z.string().optional().describe('Filter messages SENT BY this user. Use ONLY for "by/from" queries. Pass the USERNAME from field_value_discovery.'),
        status: z.string().optional().describe('Ticket status filter (comma-separated). Valid values: TODO, STARTED, PAUSED, CANCELLED, COMPLETED'),
        priority: z.string().optional().describe('Ticket priority filter (comma-separated). Valid values: LOW, MEDIUM, HIGH, CRITICAL'),
        ticketId: z.string().optional().describe('Filter by specific ticket IDs (comma-separated). Example: "TKT-001,TKT-002"'),
        createdBy: z.string().optional().describe('Filter tickets by creator username (from field_value_discovery). Example: "John Doe"'),
        assignedTo: z.string().optional().describe('Filter tickets by assignee usernames (comma-separated, from field_value_discovery). Example: "Jane Smith,Bob Wilson"'),
        boardId: z.string().optional().describe('Filter tickets by board IDs/names (comma-separated)'),
        tags: z.string().optional().describe('Filter tickets by tags (comma-separated). Example: "bug,urgent"'),
        stage: z.string().optional().describe('Filter tickets by stage names (comma-separated). Example: "Development,Testing"'),
        createdBefore: z.string().optional().describe('Filter content created before this date (ISO format or dd/mm/yyyy). Example: "2024-01-01"'),
        createdAfter: z.string().optional().describe('Filter content created after this date (ISO format or dd/mm/yyyy). Example: "2024-12-31"'),
        createdOn: z.string().optional().describe('Filter content created on this specific date (ISO format or dd/mm/yyyy). Example: "2024-06-15"'),
        createdRange: z.string().optional().describe('Filter by time keyword. Valid values: "today", "yesterday", "this week", "last week", "last 7 days", "this month", "last month", "last 30 days", "this morning", "this afternoon", "last hour", "last 24 hours", "recent", "recently", "new", "current", "currently", "last", "latest"'),
      }),
    },
    execute: async (args, context) => {
      const {
        contentTypes, query, channels, sender,
        status, priority, ticketId, createdBy, assignedTo, boardId, tags, stage,
        createdBefore, createdAfter, createdOn, createdRange,
      } = args;

      // ── Resolve sender (messages) ──────────────────────────────────────────
      let resolvedSenderId: string | undefined;
      if (sender) {
        const { userId, notFound } = resolveUserName(sender, context.requestMappings);
        if (notFound) {
          return `Error: The username "${sender}" was not found in the request mappings. Please call field_value_discovery with field="username" first to validate this username.`;
        }
        resolvedSenderId = userId || undefined;
      }

      // ── Resolve createdBy (tickets) ────────────────────────────────────────
      let resolvedCreatedByIds: string[] | undefined;
      if (createdBy) {
        const { userId, notFound } = resolveUserName(createdBy, context.requestMappings);
        if (notFound) {
          return `Error: The username "${createdBy}" was not found in the request mappings. Please call field_value_discovery with field="username" first to validate this username.`;
        }
        if (userId) resolvedCreatedByIds = [userId];
      }

      // ── Resolve assignedTo (tickets) ────────────────────────────────────────
      let resolvedAssignedToIds: string[] | undefined;
      if (assignedTo) {
        const assignedToNames = assignedTo.split(',').map((n) => n.trim()).filter((n) => n);
        const resolvedIds: string[] = [];
        const notFoundNames: string[] = [];
        for (const name of assignedToNames) {
          const { userId, notFound } = resolveUserName(name, context.requestMappings);
          if (notFound) notFoundNames.push(name);
          else if (userId) resolvedIds.push(userId);
        }
        if (notFoundNames.length > 0) {
          return `Error: The following usernames were not found in the request mappings: ${notFoundNames.join(', ')}. Please call field_value_discovery with field="username" first to validate these usernames.`;
        }
        if (resolvedIds.length > 0) resolvedAssignedToIds = resolvedIds;
      }

      // ── Build filter objects ──────────────────────────────────────────────
      const parseArray = (value: string | undefined): string[] | undefined =>
        value ? value.split(',').map((v) => v.trim()).filter((v) => v) : undefined;

      const slackFilters: Partial<SlackFilters> = {};
      if (resolvedSenderId) slackFilters.senderId = [resolvedSenderId];
      if (createdBefore) slackFilters.createdBefore = createdBefore;
      if (createdAfter) slackFilters.createdAfter = createdAfter;
      if (createdOn) slackFilters.createdOn = createdOn;
      if (createdRange) slackFilters.createdRange = createdRange;

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

      // ── Resolve channels (for messages/tickets scoping) ───────────────────
      // Default to empty — no channel scope restriction unless the user explicitly
      // specifies channels. Vespa's userId-based access control handles permissions,
      // so we don't need to validate channel access via DB here.
      let resolvedChannelIds: string[] = [];

      if (channels && channels.length > 0) {
        const { channelIds, notFound } = resolveChannelNames(channels, context.contextChannelMap, context.requestMappings);
        if (notFound.length > 0) {
          return `Error: The following channel names were not found in the session mappings: ${notFound.join(', ')}. Please call field_value_discovery first to validate these channel names.`;
        }
        resolvedChannelIds = channelIds;
      }

      logger.info(`[Tool] search_relevant_content: contentTypes=${JSON.stringify(contentTypes)}, channelIds=${JSON.stringify(resolvedChannelIds)}`);

      const tokenBudget = context.toolBudgets.searchRelevantContent;
      const result = await searchRelevantContentImpl(
        query,
        contentTypes,
        context.userId,
        context.sessionId,
        resolvedChannelIds,
        slackFilters,
        ticketFilters,
        tokenBudget,
        context.contextChannelIdToName,
      );

      const prefix = await getNextPrefix(context.sessionId);
      if (result.success && result.messages.length > 0) {
        await appendEnhancedSessionMappings(context.sessionId, buildSearchContentMappings(result), prefix);
      }

      const overflow = result.truncated
        ? formatOverflowNotice(result.messages.length, result.totalAvailable ?? result.messages.length, 'Narrow the query with more specific terms, a channel filter, or a date range to see more.')
        : '';

      return overflow + formatToolResultForContext(result, prefix);
    },
  };
}

export function getSearchRelevantContentTool() {
  return createSearchRelevantContentTool();
}
