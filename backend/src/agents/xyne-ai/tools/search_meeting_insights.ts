/**
 * Search Meeting Insights Tool
 */

import { z } from 'zod';
import { type Tool } from '@xynehq/jaf';
import { logger } from '../../../utils/logger.js';
import { vespaService } from '../../../services/vespaSearch/index.js';
import type { MeetingFilters } from '../../../vespa/src/utils/YqlBuilder.js';
import type { VespaSamTranscriptDocument } from '../../../vespa/src/types.js';
import type { XyneAIAgentContext, ToolResult, ToolMessage } from './types.js';
import {
  getDescription,
  stripHtml,
  getNextPrefix,
  appendSessionMappings,
  buildMessageMappings,
  formatToolResultForContext,
} from './helpers.js';

// ============================================================================
// Implementation
// ============================================================================

async function searchMeetingInsightsImpl(
  query: string,
  userId: string,
  sessionId: string,
  meetingFilters?: Partial<MeetingFilters>
): Promise<ToolResult> {
  try {
    logger.info(`[Tool] search_meeting_insights: query="${query}", userId=${userId}`);

    const vespaResults = await vespaService.searchService.searchVespa(
      query,
      userId,
      ['transcript'],
      {
        offset: 0,
        limit: 10,
        rankProfile: 'default_native',
        nativeRankThreshold: 0, // sam_transcript uses hybrid scoring, not nativeRank
        meeting: meetingFilters,
      }
    );

    const hits = vespaResults.root.children || [];

    const messages: ToolMessage[] = hits.map((hit, idx) => {
      const doc = hit.fields as VespaSamTranscriptDocument;
      
      const meetCode = doc.meetCode || hit.id;
      const participants = doc.participants || [];
      const platform = doc.platform || 'Unknown Platform';
      const type = doc.type || 'meeting';
      const meetingSummary = doc.meetingSummary || '';
      const chapters = doc.chapters || '';
      const actionItems = doc.actionItems || '';
      const others = doc.others || '';
      const qna = doc.qna || '';
      const dateTime = doc.dateTime ? new Date(doc.dateTime).toISOString() : new Date().toISOString();

      const participantsList = Array.isArray(participants)
        ? participants.join(', ')
        : String(participants);

      let transcriptContent = `Meeting Code: ${meetCode}\n`;
      transcriptContent += `Platform: ${platform}\n`;
      transcriptContent += `Type: ${type}\n`;
      transcriptContent += `Participants: ${participantsList}\n`;
      transcriptContent += `Date: ${dateTime}\n`;

      if (meetingSummary) {
        transcriptContent += `\nMeeting Summary:\n${stripHtml(meetingSummary)}`;
      }

      if (chapters) {
        try {
          const parsed = JSON.parse(chapters);
          if (Array.isArray(parsed) && parsed.length > 0) {
            transcriptContent += `\n\nChapters:\n${parsed.map((item: any, i: number) =>
              `${i + 1}. [${item.timestamp || ''}] ${item.topic || ''}: ${item.content || ''}`
            ).join('\n')}`;
          }
        } catch {
          transcriptContent += `\n\nChapters:\n${stripHtml(chapters)}`;
        }
      }

      if (actionItems) {
        try {
          const parsed = JSON.parse(actionItems);
          if (Array.isArray(parsed) && parsed.length > 0) {
            transcriptContent += `\n\nAction Items:\n${parsed.map((item: any, i: number) =>
              `${i + 1}. ${item.content}${item.assignee ? ` (Assigned to: ${item.assignee})` : ''}${item.deadLine ? ` - Due: ${item.deadLine}` : ''}`
            ).join('\n')}`;
          }
        } catch {
          transcriptContent += `\n\nAction Items:\n${stripHtml(actionItems)}`;
        }
      }

      if (qna) {
        try {
          const parsed = JSON.parse(qna);
          if (Array.isArray(parsed) && parsed.length > 0) {
            transcriptContent += `\n\nQ&A:\n${parsed.map((item: any, i: number) =>
              `${i + 1}. Q (${item.questioner || 'Unknown'}): ${item.question}\n   A (${item.answerer || 'Unknown'}): ${item.answer}`
            ).join('\n')}`;
          }
        } catch {
          transcriptContent += `\n\nQ&A:\n${stripHtml(qna)}`;
        }
      }

      if (others) {
        try {
          const parsed = JSON.parse(others);
          if (Array.isArray(parsed) && parsed.length > 0) {
            transcriptContent += `\n\nOther Insights:\n${parsed.map((item: any, i: number) =>
              `${i + 1}. ${item.content}${item.speaker ? ` (${item.speaker})` : ''}${item.tags?.length ? ` [${item.tags.join(', ')}]` : ''}`
            ).join('\n')}`;
          }
        } catch {
          transcriptContent += `\n\nOther Insights:\n${stripHtml(others)}`;
        }
      }

      return {
        messageId: hit.id,
        messageIndex: idx + 1,
        content: transcriptContent,
        authorName: participantsList || 'Unknown',
        authorId: '',
        timestamp: dateTime,
        conversationId: hit.id,
        channelId: '',
        channelName: '',
        hasAttachment: false,
        isTicket: false,
      };
    });

    logger.info(`[Tool] [${sessionId}] search_meeting_insights: ${messages.length} results`);

    return {
      success: true,
      messages,
      metadata: { totalCount: messages.length },
    };
  } catch (error) {
    logger.error(`[Tool] [${sessionId}] search_meeting_insights error:`, error);
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
 * Create search_meeting_insights tool
 */
export function createSearchMeetingInsightsTool(): Tool<{
  query: string;
  platform?: string[];
  merchants?: string[];
  participants?: string[];
  type?: string[];
  createdBefore?: string;
  createdAfter?: string;
  createdOn?: string;
  createdRange?: string;
}, XyneAIAgentContext> {
  return {
    schema: {
      name: 'search_meeting_insights',
      description: getDescription('search_meeting_insights'),
      parameters: z.object({
        query: z.string().describe('The topic or question to search for in meeting insights — e.g. "sales targets", "action items", "pain points", "merchant feedback"'),
        platform: z.array(z.string()).optional().describe('Filter by meeting platform (e.g., ["google-meet", "zoom"])'),
        merchants: z.array(z.string()).optional().describe('Filter by merchant ID(s) associated with the meeting (e.g., ["merchant-123"])'),
        participants: z.array(z.string()).optional().describe('Filter by participant email(s) (e.g., ["user@example.com"])'),
        type: z.array(z.string()).optional().describe('Filter by meeting type (e.g., ["sales-call", "onboarding"])'),
        createdBefore: z.string().optional().describe('Filter meetings before this date (ISO format or dd/mm/yyyy). Example: "2024-01-01"'),
        createdAfter: z.string().optional().describe('Filter meetings after this date (ISO format or dd/mm/yyyy). Example: "2024-12-31"'),
        createdOn: z.string().optional().describe('Filter meetings on this specific date (ISO format or dd/mm/yyyy). Example: "2024-06-15"'),
        createdRange: z.string().optional().describe('Filter by time keyword. Valid values: "today", "yesterday", "this week", "last week", "last 7 days", "this month", "last month", "last 30 days", "recent", "recently", "new", "current", "currently", "last", "latest"'),
      }),
    },
    execute: async (args, context) => {
      const { query, platform, merchants, participants, type, createdBefore, createdAfter, createdOn, createdRange } = args;

      const trimmedQuery = query?.trim() || '';
      const hasFilters = platform || merchants || participants || type || createdBefore || createdAfter || createdOn || createdRange;

      // If no query and no filters, return helpful message (not an error)
      if (!trimmedQuery && !hasFilters) {
        const prefix = await getNextPrefix(context.sessionId);
        return formatToolResultForContext({
          success: true,
          messages: [],
          metadata: { totalCount: 0 },
        }, prefix);
      }

      // Build filter object
      const meetingFilters: Partial<MeetingFilters> = {};
      if (platform) meetingFilters.platform = platform;
      if (merchants) meetingFilters.merchants = merchants;
      if (participants) meetingFilters.participants = participants;
      if (type) meetingFilters.type = type;
      if (createdBefore) meetingFilters.createdBefore = createdBefore;
      if (createdAfter) meetingFilters.createdAfter = createdAfter;
      if (createdOn) meetingFilters.createdOn = createdOn;
      if (createdRange) meetingFilters.createdRange = createdRange;

      logger.info(`[Tool] search_meeting_insights called with query="${trimmedQuery}", filters=${JSON.stringify(meetingFilters)}`);

      const result = await searchMeetingInsightsImpl(trimmedQuery, context.userId, context.sessionId, meetingFilters);
      const prefix = await getNextPrefix(context.sessionId);
      if (result.success && result.messages.length > 0) {
        await appendSessionMappings(context.sessionId, buildMessageMappings(result), prefix);
      }
      return formatToolResultForContext(result, prefix);
    },
  };
}

/**
 * Get search_meeting_insights tool
 * MUST call initializeTools() before using
 */
export function getSearchMeetingInsightsTool() {
  return createSearchMeetingInsightsTool();
}
