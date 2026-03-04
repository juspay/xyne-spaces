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
} from '@xynehq/jaf';
import { DatabaseClient, db } from '@/database/client';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { parseAgentOutput } from '@/services/agents/utils';
import { getPromptFromLangfuse } from '@/agents/xyne-ai/langfuse/index.js';
import { vespaService } from '@/services/vespaSearch';
import { transformVespaResults } from '@/services/vespaSearch/resultTransform';
import type {
  NudgeDefinition,
  MessageNudgePayload,
  MessageNudgeEvaluationContext,
  NudgeCandidate,
} from '../types';
import { isEligibleMessage, buildMessageNudgeContext } from './helpers';

const prisma = DatabaseClient.getInstance();

const VESPA_CANDIDATE_LIMIT = 10;
const MIN_LLM_CONFIDENCE = 0.45;
const MIN_TICKET_RELEVANCE = 0.3;
const RELATED_TICKET_PROMPT_NAME = 'nudge_find_related_ticket_from_message';
const RELATED_TICKET_PROMPT_LABEL = 'production';
const RELATED_TICKET_MODEL = 'glm-flash-experimental';

const RelatedTicketLookupSchema = z.object({
  shouldSuggest: z.boolean(),
  lookupQuery: z.string().optional().nullable(),
  confidence: z.number().min(0).max(1).optional(),
  reason: z.string().optional(),
});

type RelatedTicketLookupOutput = z.infer<typeof RelatedTicketLookupSchema>;

type RelatedTicketLookupContext = {
  messageId: string;
  channelId: string;
  projectId: string;
};

type RelatedTicketCandidate = {
  id: string;
  title: string;
  description: string;
  relevance: number;
  channelId?: string;
  status?: string;
};

const RELATED_TICKET_FALLBACK_PROMPT = `
You are a nudge planner for FIND_RELATED_TICKET_FROM_MESSAGE.

Task:
Given a message, thread context, project tags, and recent user activity context:
1) Decide if we should suggest opening an existing related ticket.
2) If yes, produce a short dynamic lookup query optimized for ticket search.

Return STRICT JSON only:
{
  "shouldSuggest": boolean,
  "lookupQuery": string | null,
  "confidence": number,
  "reason": string
}

Rules:
- If uncertain, return shouldSuggest=false.
- lookupQuery must be concise, plain text, and specific to the issue.
- confidence must be between 0 and 1.
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

async function runRelatedTicketPlanner(
  input: Record<string, unknown>,
  context: RelatedTicketLookupContext,
): Promise<RelatedTicketLookupOutput> {
  const systemPrompt = await resolveRelatedTicketPrompt();
  const agent: Agent<RelatedTicketLookupContext, RelatedTicketLookupOutput> = {
    name: 'FindRelatedTicketFromMessagePlanner',
    instructions: () => systemPrompt,
    modelConfig: { temperature: 0.1 },
  };

  const provider = makeLiteLLMProvider(config.litellm.baseUrl, config.litellm.apiKey);
  const initialState: RunState<RelatedTicketLookupContext> = {
    runId: generateRunId(),
    traceId: generateTraceId(),
    messages: [{ role: 'user', content: JSON.stringify(input, null, 2) }],
    currentAgentName: 'FindRelatedTicketFromMessagePlanner',
    context,
    turnCount: 0,
  };

  const runConfig: RunConfig<RelatedTicketLookupContext> = {
    agentRegistry: new Map([['FindRelatedTicketFromMessagePlanner', agent]]),
    modelProvider: provider as RunConfig<RelatedTicketLookupContext>['modelProvider'],
    maxTurns: 2,
    modelOverride: RELATED_TICKET_MODEL,
  };

  const result = await run(initialState, runConfig);

  if (result.outcome.status === 'completed') {
    const output = result.outcome.output;
    if (typeof output === 'string') {
      return parseAgentOutput(output, RelatedTicketLookupSchema);
    }
    return RelatedTicketLookupSchema.parse(output);
  }

  if (result.outcome.status === 'error') {
    throw new Error(`Related ticket planner failed: ${result.outcome.error._tag}`);
  }

  throw new Error('Related ticket planner interrupted.');
}

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
    const planningInput = {
      current_message: {
        id: context.message.messageId,
        text: context.message.messageText,
        channel_id: context.message.channelId,
        conversation_id: context.message.conversationId,
      },
      recent_thread_messages: context.threadMessages.slice(-8).map((m) => ({
        id: m.messageId,
        text: m.content,
      })),
      existing_project_tags: context.projectTags.slice(0, 40),
      activity_context: {
        prompt_hints: context.activityContext.promptHints,
        top_entities: context.activityContext.topEntities.slice(0, 10),
      },
    };

    const plan = await runRelatedTicketPlanner(planningInput, {
      messageId: context.message.messageId,
      channelId: context.message.channelId,
      projectId: context.message.projectId,
    });

    if (!plan.shouldSuggest) return [];
    if ((plan.confidence ?? 0) < MIN_LLM_CONFIDENCE) return [];

    const lookupQuery = (plan.lookupQuery ?? '').trim();
    if (!lookupQuery) return [];

    const vespaResults = await vespaService.searchService.searchVespa(
      lookupQuery,
      context.message.senderId,
      ['ticket'],
      {
        offset: 0,
        limit: VESPA_CANDIDATE_LIMIT,
        ticket: {
          projectId: [context.message.projectId],
        },
      },
    );

    const transformedResults = await transformVespaResults(vespaResults.root.children || [], prisma);

    const ticketCandidates: RelatedTicketCandidate[] = transformedResults
      .filter((result) => result.type === 'ticket')
      .map((result) => ({
        id: result.id,
        title: result.title,
        description: result.context || '',
        relevance: result.relevanceScore,
        channelId: result.searchContext?.channelId,
        status: result.searchContext?.ticketStatus || result.metadata.status,
      }));

    if (ticketCandidates.length === 0) return [];

    ticketCandidates.sort((a, b) => b.relevance - a.relevance);
    const topCandidate = ticketCandidates[0];
    if (!topCandidate) return [];

    return [
      {
        title: `Related ticket: ${topCandidate.title || 'Existing ticket found'}`,
        description:
          plan.reason ||
          topCandidate.description ||
          'A related ticket was found for this message context.',
        actions: {
          actionType: 'OPEN_TICKET',
          entityId: topCandidate.id,
          channelId: topCandidate.channelId,
          ticketStatus: topCandidate.status,
          lookupQuery,
          llmConfidence: plan.confidence,
          relevance: topCandidate.relevance,
          evidence: `Match confidence ${Math.round((topCandidate.relevance ?? 0) * 100)}%`,
        },
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

      const relevance = typeof actions.relevance === 'number' ? actions.relevance : 0;
      if (relevance < MIN_TICKET_RELEVANCE) {
        continue;
      }

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
