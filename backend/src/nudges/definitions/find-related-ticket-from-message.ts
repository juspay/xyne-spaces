import { TicketStatus, TicketStatusV2 } from '@prisma/client';
import { z } from 'zod';
import {
  makeLiteLLMProvider,
  generateRunId,
  generateTraceId,
  run,
  type Agent,
  type RunConfig,
  type RunState,
  type Tool,
} from '@xynehq/jaf';
import { DatabaseClient, db } from '@/database/client';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { getPromptFromLangfuse } from '@/agents/xyne-ai/langfuse/index.js';
import { vespaService } from '@/services/vespaSearch';
import { transformVespaResults } from '@/services/vespaSearch/resultTransform';
import { parseAgentOutput } from '@/services/agents/utils';
import type {
  ExplicitNudgeAction,
  MessageNudgeEvaluationContext,
  MessageNudgePayload,
  NudgeCandidate,
  NudgeDefinition,
} from '../types';
import { isEligibleMessage, buildMessageNudgeContext } from './helpers';

const prisma = DatabaseClient.getInstance();

const VESPA_CANDIDATE_LIMIT = 10;
const RELATED_TICKET_PROMPT_NAME = 'nudge_find_related_ticket_from_message';
const RELATED_TICKET_PROMPT_LABEL = 'production';
const RELATED_TICKET_MODEL = 'glm-flash-experimental';

// --- Output schema for the agent's final answer ---

const RelatedTicketResultSchema = z.object({
  hasRelatedTicket: z.boolean(),
  ticketId: z.string().optional().nullable(),
  title: z.string().optional().nullable(),
  reason: z.string(),
  matchingEvidence: z.string().optional().nullable(),
});

type RelatedTicketResultOutput = z.infer<typeof RelatedTicketResultSchema>;

// --- Ticket search tool ---

type SearchTicketsArgs = {
  query: string;
};

type NudgeToolContext = {
  senderId: string;
};

function createSearchTicketsTool(): Tool<SearchTicketsArgs, NudgeToolContext> {
  return {
    schema: {
      name: 'search_tickets',
      description:
        'Search for existing tickets that might be related to the current message. ' +
        'Pass a concise search query capturing the core issue (e.g. "mobile login failure"). ' +
        'Returns a list of tickets with their ID, title, status, and description.',
      parameters: z.object({
        query: z.string().describe('Concise search query to find related tickets'),
      }),
    },
    execute: async (args, context) => {
      try {
        const vespaResults = await vespaService.searchService.searchVespa(
          args.query,
          context.senderId,
          ['ticket'],
          { offset: 0, limit: VESPA_CANDIDATE_LIMIT },
        );

        const hits = vespaResults.root.children || [];
        const transformedResults = await transformVespaResults(hits, prisma);

        const tickets = transformedResults
          .filter((r) => r.type === 'ticket')
          .map((r) => ({
            ticketId: r.id,
            title: r.title,
            status: r.searchContext?.ticketStatus || r.metadata.status || 'UNKNOWN',
            description: (r.context || '').slice(0, 200),
            relevance: r.relevanceScore,
            channelId: r.searchContext?.channelId || '',
          }));

        logger.info('[FIND_RELATED_TICKET] search_tickets tool result', {
          query: args.query,
          hitCount: tickets.length,
        });

        if (tickets.length === 0) {
          return 'No tickets found matching the query.';
        }

        return JSON.stringify(tickets, null, 2);
      } catch (error) {
        logger.warn('[FIND_RELATED_TICKET] search_tickets tool error', {
          error: error instanceof Error ? error.message : String(error),
        });
        return `Error searching tickets: ${error instanceof Error ? error.message : 'Unknown error'}`;
      }
    },
  };
}

// --- Prompt ---

const RELATED_TICKET_FALLBACK_PROMPT = `
You are an agent that finds existing tickets related to a user's message.

You have a tool called "search_tickets" that searches the ticket database.

Steps:
1) Read the message and decide if it describes a problem, bug, feature request, or task that could have an existing ticket.
2) If yes, call search_tickets with a concise query capturing the core issue.
3) Examine the returned tickets. Determine if any are genuinely related to the message (same topic/issue, not just shared keywords).
4) Return your final answer as STRICT JSON (no markdown, no code fences):

{
  "hasRelatedTicket": boolean,
  "ticketId": string | null,
  "title": string | null,
  "reason": string,
  "matchingEvidence": string | null
}

Rules:
- If the message is purely social/conversational, skip the tool call and return hasRelatedTicket=false.
- You may call search_tickets multiple times with different queries if the first search is not specific enough.
- Only set hasRelatedTicket=true if a ticket clearly matches the same topic or issue.
- matchingEvidence should be a SHORT quote or paraphrase from the ticket that shows why it's related (under 100 chars).
- Do NOT pick tickets that are merely about the same general area but address a different specific issue.
- No markdown, no code fences, no extra keys.
`.trim();

async function resolveRelatedTicketPrompt(): Promise<string> {
  const dedicatedPrompt = (
    await getPromptFromLangfuse(RELATED_TICKET_PROMPT_NAME, {
      label: RELATED_TICKET_PROMPT_LABEL,
    })
  )?.trim() || null;

  if (dedicatedPrompt) {
    return dedicatedPrompt;
  }

  logger.warn('[FIND_RELATED_TICKET_FROM_MESSAGE] Dedicated prompt missing, using local fallback', {
    promptName: RELATED_TICKET_PROMPT_NAME,
  });
  return RELATED_TICKET_FALLBACK_PROMPT;
}

// --- Agent runner ---

function extractLastAssistantText(finalState: RunState<unknown>): string | null {
  for (let i = finalState.messages.length - 1; i >= 0; i--) {
    const msg = finalState.messages[i];
    if (msg && typeof msg === 'object' && 'role' in msg && msg.role === 'assistant') {
      const content = 'content' in msg ? msg.content : undefined;
      if (typeof content === 'string' && !('tool_calls' in msg && (msg as any).tool_calls?.length)) {
        return content;
      }
    }
  }
  return null;
}

async function runRelatedTicketAgent(
  context: MessageNudgeEvaluationContext,
): Promise<RelatedTicketResultOutput> {
  const systemPrompt = await resolveRelatedTicketPrompt();
  const provider = makeLiteLLMProvider(config.litellm.baseUrl, config.litellm.apiKey);

  const userInput = {
    message: {
      id: context.message.messageId,
      text: context.message.messageText,
      channel_id: context.message.channelId,
    },
    recent_thread_messages: context.threadMessages.slice(-5).map((m) => ({
      text: m.content,
    })),
  };

  const tools = [createSearchTicketsTool()];

  const agent: Agent<NudgeToolContext, RelatedTicketResultOutput> = {
    name: 'FindRelatedTicketAgent',
    instructions: () => systemPrompt,
    tools,
    modelConfig: { temperature: 0.1 },
  };

  const initialState: RunState<NudgeToolContext> = {
    runId: generateRunId(),
    traceId: generateTraceId(),
    messages: [{ role: 'user', content: JSON.stringify(userInput, null, 2) }],
    currentAgentName: 'FindRelatedTicketAgent',
    context: { senderId: context.message.senderId },
    turnCount: 0,
  };

  const runConfig: RunConfig<NudgeToolContext> = {
    agentRegistry: new Map([['FindRelatedTicketAgent', agent]]),
    modelProvider: provider as RunConfig<NudgeToolContext>['modelProvider'],
    maxTurns: 6,
    modelOverride: RELATED_TICKET_MODEL,
  };

  const result = await run(initialState, runConfig);

  if (result.outcome.status === 'completed') {
    const output = result.outcome.output;
    if (typeof output === 'string') {
      return parseAgentOutput(output, RelatedTicketResultSchema);
    }
    return RelatedTicketResultSchema.parse(output);
  }

  // Fallback: try to extract from last assistant message
  const rawText = extractLastAssistantText(result.finalState);
  if (rawText) {
    try {
      return parseAgentOutput(rawText, RelatedTicketResultSchema);
    } catch {
      // fall through
    }
  }

  logger.warn('[FIND_RELATED_TICKET] Agent did not produce valid output', {
    status: result.outcome.status,
  });
  return { hasRelatedTicket: false, reason: 'Agent failed to produce output' };
}

// --- Status helpers ---

function normalizeStatus(status?: string): string | null {
  if (!status) return null;
  const normalized = status.trim().toUpperCase();
  return normalized.length > 0 ? normalized : null;
}

function isClosedLikeStatus(status?: string | null): boolean {
  const normalized = normalizeStatus(status ?? undefined);
  if (!normalized) return false;
  return (
    normalized === TicketStatusV2.COMPLETED ||
    normalized === TicketStatusV2.CANCELLED ||
    normalized === TicketStatus.RESOLVED ||
    normalized === TicketStatus.REJECTED ||
    normalized === 'CLOSED'
  );
}

// --- Nudge definition ---

export const findRelatedTicketFromMessage: NudgeDefinition<
  MessageNudgePayload,
  MessageNudgeEvaluationContext
> = {
  kind: 'FIND_RELATED_TICKET_FROM_MESSAGE',
  mode: 'explicit',
  priority: 'medium',
  trigger: {
    subscribesTo: ['MESSAGE.SENT'],
    async lookbackHandler(event) {
      const meta = event.contextMetadata ?? {};
      const messageId = typeof meta.messageId === 'string' ? meta.messageId : undefined;
      const channelId = typeof meta.channelId === 'string' ? meta.channelId : undefined;
      const conversationId = typeof meta.conversationId === 'string' ? meta.conversationId : undefined;
      if (!messageId || !channelId || !conversationId) return false;
      return isEligibleMessage({ messageId, channelId, conversationId });
    },
  },
  direction: { from: 'MESSAGE', to: 'TICKET' },

  async buildContext(payload, activityContext, runtime) {
    return buildMessageNudgeContext(payload, activityContext, runtime);
  },

  async evaluate(
    context: MessageNudgeEvaluationContext,
    _payload: MessageNudgePayload,
  ): Promise<NudgeCandidate[]> {
    const agentResult = await runRelatedTicketAgent(context);

    logger.info('[FIND_RELATED_TICKET_FROM_MESSAGE] Agent result', {
      hasRelatedTicket: agentResult.hasRelatedTicket,
      ticketId: agentResult.ticketId,
      reason: agentResult.reason,
    });

    if (!agentResult.hasRelatedTicket || !agentResult.ticketId) return [];

    // Look up the ticket to get channelId and status
    const ticket = await db.ticket.findUnique({
      where: { id: agentResult.ticketId },
      select: {
        id: true,
        title: true,
        description: true,
        status: true,
        statusV2: true,
        channelId: true,
        conversationId: true,
      },
    });

    if (!ticket) {
      logger.warn('[FIND_RELATED_TICKET] Ticket not found in DB', { ticketId: agentResult.ticketId });
      return [];
    }

    const ticketChannel = await db.channel.findUnique({
      where: { id: ticket.channelId },
      select: { visibility: true },
    });

    const shouldRestrictVisibility = ticketChannel?.visibility === 'PRIVATE';

    const actions: ExplicitNudgeAction = {
      actionType: 'OPEN_TICKET',
      actionMode: 'read',
      onSuccess: 'none',
      createSurfaceLink: false,
      entityId: ticket.id,
      channelId: ticket.channelId,
      conversationId: ticket.conversationId,
      ticketStatus: ticket.statusV2 || ticket.status,
      evidence: agentResult.matchingEvidence || agentResult.reason,
    };

    return [
      {
        title: `Related ticket: ${agentResult.title || ticket.title || 'Existing ticket found'}`,
        description: agentResult.reason || 'A related ticket was found for this message.',
        ...(shouldRestrictVisibility ? { visibleTo: context.message.senderId } : {}),
        actions,
      },
    ];
  },

  async postProcess(
    candidates: NudgeCandidate[],
    payload: MessageNudgePayload,
  ): Promise<NudgeCandidate[]> {
    const survivors: NudgeCandidate[] = [];

    for (const candidate of candidates) {
      const actions =
        candidate.actions && typeof candidate.actions === 'object' && !Array.isArray(candidate.actions)
          ? (candidate.actions as Record<string, unknown>)
          : undefined;
      if (!actions) continue;

      const entityId = typeof actions.entityId === 'string' ? actions.entityId : undefined;
      if (!entityId) continue;

      const actionStatus = typeof actions.ticketStatus === 'string' ? actions.ticketStatus : undefined;
      if (isClosedLikeStatus(actionStatus)) {
        continue;
      }

      const ticket = await db.ticket.findUnique({
        where: { id: entityId },
        select: { id: true, status: true, statusV2: true },
      });
      if (!ticket) continue;
      if (isClosedLikeStatus(ticket.status) || isClosedLikeStatus(ticket.statusV2)) {
        continue;
      }

      const existingLink = await db.surfaceLink.findFirst({
        where: {
          sourceType: 'MESSAGE',
          sourceId: payload.messageId,
          targetType: 'TICKET',
          targetId: entityId,
          linkKind: 'RELATES_TO',
        },
        select: { id: true },
      });
      if (existingLink) {
        continue;
      }

      survivors.push(candidate);
    }

    return survivors;
  },
};
