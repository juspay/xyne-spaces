import {
  makeLiteLLMProvider,
  generateRunId,
  generateTraceId,
  run,
  type Agent,
  type RunConfig,
  type RunState,
} from '@xynehq/jaf';
import { db } from '@/database/client';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import {
  NudgeOutputSchemaLenient,
  type ProactiveNudgeOutputLenient,
} from '@/services/nudges/proactiveNudgeSchemas';
import { compileFallbackPrompt, getPromptFromLangfuse } from '@/agents/xyne-ai/langfuse/index.js';
import type {
  ExplicitNudgeAction,
  MessageNudgeEvaluationContext,
  MessageNudgePayload,
  NudgeCandidate,
  NudgeDefinition,
} from '../types';
import { isEligibleMessage, buildMessageNudgeContext } from './helpers';

const CREATE_TICKET_PROMPT_NAME = 'nudge_create_ticket_from_message';
const CREATE_TICKET_PROMPT_LABEL = 'production';
const DEFAULT_CREATE_TICKET_MODEL = 'glm-flash-experimental';

type CreateTicketNudgeLLMContext = {
  messageId: string;
  channelId: string;
  projectId: string;
};

type CreateTicketNudgeLLMInput = {
  current_message: {
    id: string;
    text: string;
    author_user_id: string;
    author_display_name: string;
    timestamp_iso: string;
    channel_id: string;
    channel_name: string;
    thread_id: string;
  };
  current_thread_messages: Array<{
    id: string;
    text: string;
    author_user_id: string;
    author_display_name: string;
    timestamp_iso: string;
  }>;
  existing_project_tags: string[];
};

async function resolveCreateTicketPrompt(): Promise<string> {
  const dedicatedPrompt = (
    await getPromptFromLangfuse(CREATE_TICKET_PROMPT_NAME, {
      label: CREATE_TICKET_PROMPT_LABEL,
    })
  )?.trim() || null;

  if (dedicatedPrompt) {
    return dedicatedPrompt;
  }

  const fallbackPrompt = compileFallbackPrompt('nudge_extractor')?.trim() || null;
  if (fallbackPrompt) {
    logger.warn('[CREATE_TICKET_FROM_MESSAGE] Dedicated prompt missing, using fallback prompt', {
      promptName: CREATE_TICKET_PROMPT_NAME,
    });
    return fallbackPrompt;
  }

  throw new Error(
    `[CREATE_TICKET_FROM_MESSAGE] No prompt available for ${CREATE_TICKET_PROMPT_NAME}`,
  );
}

async function runCreateTicketNudgeExtraction(
  input: CreateTicketNudgeLLMInput,
  context: CreateTicketNudgeLLMContext,
): Promise<ProactiveNudgeOutputLenient> {
  const systemPrompt = await resolveCreateTicketPrompt();
  const agent: Agent<CreateTicketNudgeLLMContext, ProactiveNudgeOutputLenient> = {
    name: 'CreateTicketFromMessageNudgeAgent',
    instructions: () => systemPrompt,
    modelConfig: { temperature: 0.1 },
  };

  const provider = makeLiteLLMProvider(config.litellm.baseUrl, config.litellm.apiKey);
  const initialState: RunState<CreateTicketNudgeLLMContext> = {
    runId: generateRunId(),
    traceId: generateTraceId(),
    messages: [{ role: 'user', content: JSON.stringify(input, null, 2) }],
    currentAgentName: 'CreateTicketFromMessageNudgeAgent',
    context,
    turnCount: 0,
  };

  const runConfig: RunConfig<CreateTicketNudgeLLMContext> = {
    agentRegistry: new Map([['CreateTicketFromMessageNudgeAgent', agent]]),
    modelProvider: provider as RunConfig<CreateTicketNudgeLLMContext>['modelProvider'],
    maxTurns: 2,
    modelOverride: DEFAULT_CREATE_TICKET_MODEL,
  };

  const result = await run(initialState, runConfig);

  if (result.outcome.status === 'completed') {
    const output = result.outcome.output;
    if (typeof output === 'string') {
      const cleaned = output.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      const jsonPayload = jsonMatch ? jsonMatch[0] : cleaned;
      return NudgeOutputSchemaLenient.parse(JSON.parse(jsonPayload));
    }
    return NudgeOutputSchemaLenient.parse(output);
  }

  if (result.outcome.status === 'error') {
    throw new Error(`Create-ticket nudge extraction failed: ${result.outcome.error._tag}`);
  }

  throw new Error('Create-ticket nudge extraction interrupted.');
}

export const createTicketFromMessage: NudgeDefinition<
  MessageNudgePayload,
  MessageNudgeEvaluationContext
> = {
  kind: 'CREATE_TICKET_FROM_MESSAGE',
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
    payload: MessageNudgePayload,
  ): Promise<NudgeCandidate[]> {
    const channel = await db.channel.findUnique({
      where: { id: context.message.channelId },
      select: { name: true },
    });

    const senderIds = new Set<string>([
      context.message.senderId,
      ...context.threadMessages.map((m) => m.senderId),
    ]);
    const users = await db.user.findMany({
      where: { id: { in: Array.from(senderIds) } },
      select: { id: true, name: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u.name ?? 'Unknown']));

    const input: CreateTicketNudgeLLMInput = {
      current_message: {
        id: context.message.messageId,
        text: context.message.messageText,
        author_user_id: context.message.senderId,
        author_display_name: userMap.get(context.message.senderId) ?? 'Unknown',
        timestamp_iso: payload.messageCreatedAt,
        channel_id: context.message.channelId,
        channel_name: channel?.name ?? 'Unknown Channel',
        thread_id: context.message.conversationId,
      },
      current_thread_messages: context.threadMessages.map((tm) => ({
        id: tm.messageId,
        text: tm.content,
        author_user_id: tm.senderId,
        author_display_name: userMap.get(tm.senderId) ?? 'Unknown',
        timestamp_iso: tm.createdAt.toISOString(),
      })),
      existing_project_tags: context.projectTags,
    };

    const output = await runCreateTicketNudgeExtraction(input, {
      messageId: context.message.messageId,
      channelId: context.message.channelId,
      projectId: context.message.projectId,
    });

    const createTicketNudges = (output.nudges ?? []).filter(
      (nudge) => nudge.type === 'CREATE_TICKET',
    );

    if (createTicketNudges.length === 0) return [];

    // Fetch conversation's initialMessageId so the frontend can skip an extra query
    const conversation = await db.conversation.findUnique({
      where: { conversationId: context.message.conversationId },
      select: { initialMessageId: true },
    });

    const primaryNudge = createTicketNudges[0];
    const title =
      (typeof primaryNudge.title === 'string' && primaryNudge.title.trim()) ||
      context.message.messageText.slice(0, 120) ||
      'Create a ticket';
    const description =
      (typeof primaryNudge.description === 'string' && primaryNudge.description.trim()) ||
      context.message.messageText ||
      'No description provided.';

    const createAction = primaryNudge.suggested_actions?.find(
      (a) => a.action_type === 'CREATE_TICKET_FROM_MESSAGE',
    );
    const subticketSuggestions = createAction?.payload?.subticket_suggestions ?? [];

    const actions: ExplicitNudgeAction = {
      actionType: 'CREATE_TICKET_FROM_MESSAGE',
      actionMode: 'write',
      onSuccess: 'acted_on',
      createSurfaceLink: true,
      evidence: primaryNudge.evidence_spans ?? undefined,
      title_suggestion: title,
      description_suggestion: description,
      subticket_suggestions: subticketSuggestions,
      conversationId: context.message.conversationId,
      initialMessageId: conversation?.initialMessageId ?? context.message.messageId,
    };

    return [
      {
        title,
        description,
        priority: primaryNudge.priority ?? undefined,
        visibleTo: payload.senderId,
        actions,
      },
    ];
  },
};
