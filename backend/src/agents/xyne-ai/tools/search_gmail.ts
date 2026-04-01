/**
 * Search Gmail Tool
 */

import { z } from 'zod';
import { type Tool } from '@xynehq/jaf';
import { logger } from '../../../utils/logger.js';
import { googleMailSearchService } from '../../../services/vespaSearch/providers/gmail.js';
import type {
  EnhancedCitationMappings,
  EntityType,
  ToolMessage,
  ToolResult,
  XyneAIAgentContext,
} from './types.js';
import {
  appendEnhancedSessionMappings,
  getDescription,
  getNextPrefix,
  stripHtml,
} from './helpers.js';

const participantsSchema = z.object({
  from: z
    .array(z.string())
    .optional()
    .describe('Sender identifiers. Email addresses are preferred, but names can also be used.'),
  to: z
    .array(z.string())
    .optional()
    .describe('Primary recipient identifiers. Email addresses are preferred, but names can also be used.'),
  cc: z
    .array(z.string())
    .optional()
    .describe('CC recipient identifiers. Email addresses are preferred, but names can also be used.'),
  bcc: z
    .array(z.string())
    .optional()
    .describe('BCC recipient identifiers. Email addresses are preferred, but names can also be used.'),
});

const timeRangeSchema = z.object({
  startTime: z
    .string()
    .describe('Inclusive start time as a string. Prefer ISO-8601 format.'),
  endTime: z
    .string()
    .describe('Inclusive end time as a string. Prefer ISO-8601 format.'),
});

type SearchGmailArgs = {
  query?: string;
  labels?: string[];
  participants?: z.infer<typeof participantsSchema>;
  limit?: number;
  offset?: number;
  sortBy?: 'asc' | 'desc';
  timeRange?: z.infer<typeof timeRangeSchema>;
};

const compactStringArray = (values?: string[]): string[] | undefined => {
  if (!values || values.length === 0) {
    return undefined;
  }

  const compactValues = values.map(value => value.trim()).filter(Boolean);
  return compactValues.length > 0 ? compactValues : undefined;
};

const compactParticipants = (
  participants?: SearchGmailArgs['participants']
): SearchGmailArgs['participants'] | undefined => {
  if (!participants) {
    return undefined;
  }

  const nextParticipants = {
    from: compactStringArray(participants.from),
    to: compactStringArray(participants.to),
    cc: compactStringArray(participants.cc),
    bcc: compactStringArray(participants.bcc),
  };

  if (!nextParticipants.from && !nextParticipants.to && !nextParticipants.cc && !nextParticipants.bcc) {
    return undefined;
  }

  return nextParticipants;
};

const buildGmailUrl = (threadId?: string, messageId?: string): string | undefined => {
  if (threadId) {
    return `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(threadId)}`;
  }

  if (messageId) {
    return `https://mail.google.com/mail/u/0/#search/rfc822msgid:${encodeURIComponent(messageId)}`;
  }

  return undefined;
};

const formatSearchGmailResult = (result: ToolResult, prefix: string): string => {
  if (!result.success) {
    return `Error: ${result.error}`;
  }

  if (result.messages.length === 0) {
    return 'No Gmail results found.';
  }

  const formatted = result.messages
    .map(message => {
      const attachmentNote = message.hasAttachment ? ' [attachment]' : '';
      return `[${prefix}${message.messageIndex}] ${message.authorName} (${message.timestamp}) in **Gmail**${attachmentNote}:\n${message.content}`;
    })
    .join('\n\n');

  return `Found ${result.messages.length} Gmail results:\n\n${formatted}`;
};

const buildMessageContent = (title: string, context?: string, isAttachment?: boolean): string => {
  const header = isAttachment ? `Attachment: ${title}` : `Subject: ${title}`;
  const cleanedContext = stripHtml(context || '');

  if (!cleanedContext || cleanedContext === title) {
    return header;
  }

  return `${header}\n${cleanedContext}`;
};

const parseTimeRange = (
  timeRange?: SearchGmailArgs['timeRange']
): { startTime: number; endTime: number } | undefined => {
  if (!timeRange) {
    return undefined;
  }

  const startTime = new Date(timeRange.startTime).getTime();
  const endTime = new Date(timeRange.endTime).getTime();

  if (Number.isNaN(startTime) || Number.isNaN(endTime)) {
    throw new Error('Invalid timeRange supplied. Provide valid startTime and endTime values.');
  }

  if (startTime > endTime) {
    throw new Error('Invalid timeRange supplied. startTime must be earlier than endTime.');
  }

  return { startTime, endTime };
};

const buildSearchResult = (
  results: Awaited<ReturnType<typeof googleMailSearchService.search>>['results']
): {
  toolResult: ToolResult;
  citationMappings: EnhancedCitationMappings;
} => {
  const messages: ToolMessage[] = results.map((result, index) => {
    const messageId = result.searchContext?.messageId || result.id;
    const threadId = result.searchContext?.conversationId || '';
    const senderName =
      result.type === 'attachment'
        ? 'Gmail Attachment'
        : result.searchContext?.senderName || result.subtitle || 'Gmail';

    return {
      messageId,
      messageIndex: index + 1,
      content: buildMessageContent(result.title, result.context, result.type === 'attachment'),
      authorName: senderName,
      authorId: '',
      timestamp: result.metadata?.timestamp || new Date().toISOString(),
      conversationId: threadId,
      channelId: '',
      channelName: 'Gmail',
      hasAttachment: result.type === 'attachment',
    };
  });

  const entityIdMapping: Record<number, string> = {};
  const entityTypeMapping: Record<number, EntityType> = {};
  const conversationIdMapping: Record<number, string | undefined> = {};
  const messageIdMapping: Record<number, string | undefined> = {};
  const canvasIdMapping: Record<number, string | undefined> = {};
  const channelIdMapping: Record<number, string> = {};
  const externalUrlMapping: Record<number, string | undefined> = {};
  const isExternalMapping: Record<number, boolean> = {};

  results.forEach((result, index) => {
    const messageId = result.searchContext?.messageId || result.id;
    const threadId = result.searchContext?.conversationId;
    const citationIndex = index + 1;

    entityIdMapping[citationIndex] = result.id;
    entityTypeMapping[citationIndex] =
      result.type === 'attachment' ? 'attachment' : 'email';
    conversationIdMapping[citationIndex] = threadId;
    messageIdMapping[citationIndex] = messageId;
    canvasIdMapping[citationIndex] = undefined;
    channelIdMapping[citationIndex] = '';
    externalUrlMapping[citationIndex] = buildGmailUrl(threadId, messageId);
    isExternalMapping[citationIndex] = true;
  });

  return {
    toolResult: {
      success: true,
      messages,
      metadata: {
        totalCount: messages.length,
      },
    },
    citationMappings: {
      entityIdMapping,
      entityTypeMapping,
      conversationIdMapping,
      messageIdMapping,
      canvasIdMapping,
      channelIdMapping,
      externalUrlMapping,
      isExternalMapping,
    },
  };
};

/**
 * Create search_gmail tool with description from Langfuse
 */
export function createSearchGmailTool(): Tool<SearchGmailArgs, XyneAIAgentContext> {
  return {
    schema: {
      name: 'search_gmail',
      description: getDescription('search_gmail'),
      parameters: z.object({
        query: z.string().optional().describe('Optional semantic search query for Gmail messages or attachments.'),
        labels: z
          .array(z.string())
          .optional()
          .describe('Optional Gmail labels used to narrow the search, for example INBOX, SENT, IMPORTANT, STARRED, or UNREAD.'),
        participants: participantsSchema
          .optional()
          .describe('Optional participant filter object with from, to, cc, and bcc arrays.'),
        limit: z
          .number()
          .min(1)
          .max(50)
          .optional()
          .describe('Maximum number of Gmail results to return. Default is 20.'),
        offset: z
          .number()
          .min(0)
          .optional()
          .describe('Pagination offset as a non-negative integer.'),
        sortBy: z
          .enum(['asc', 'desc'])
          .optional()
          .describe('Sort direction. Use desc for newest-first ordering.'),
        timeRange: timeRangeSchema
          .optional()
          .describe('Optional explicit time range object with startTime and endTime.'),
      }),
    },
    execute: async (args, context) => {
      const userEmail = context.userInfo?.userEmail?.trim().toLowerCase();

      if (!userEmail) {
        return 'Error: Authenticated user email is required for Gmail search.';
      }

      const participants = compactParticipants(args.participants);
      const labels = compactStringArray(args.labels);
      const query = args.query?.trim() || undefined;

      if (!query && !labels && !participants && !args.timeRange) {
        return 'Error: Provide at least one Gmail search constraint such as query, labels, participants, or timeRange.';
      }

      try {
        logger.info(`[Tool] search_gmail: query="${query || ''}", userEmail=${userEmail}, labels=${JSON.stringify(labels)}, participants=${JSON.stringify(participants)}`);

        const results = await googleMailSearchService.search({
          email: userEmail,
          query,
          offset: args.offset,
          limit: args.limit,
          sortBy: args.sortBy,
          labels,
          participants,
          timeRange: parseTimeRange(args.timeRange),
        });

        const { toolResult, citationMappings } = buildSearchResult(results.results);
        const prefix = await getNextPrefix(context.sessionId);

        if (toolResult.messages.length > 0) {
          await appendEnhancedSessionMappings(context.sessionId, citationMappings, prefix);
        }

        return formatSearchGmailResult(toolResult, prefix);
      } catch (error) {
        logger.error(`[Tool] [${context.sessionId}] search_gmail error:`, error);
        return `Error: ${error instanceof Error ? error.message : 'Unknown Gmail search error'}`;
      }
    },
  };
}

/**
 * Get search_gmail tool
 * MUST call initializeTools() before using
 */
export function getSearchGmailTool() {
  return createSearchGmailTool();
}
