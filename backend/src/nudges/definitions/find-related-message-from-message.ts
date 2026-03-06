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
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { getPromptFromLangfuse } from '@/agents/xyne-ai/langfuse/index.js';
import { vespaService } from '@/services/vespaSearch';
import { parseAgentOutput } from '@/services/agents/utils';
import type {
  NudgeDefinition,
  MessageNudgePayload,
  MessageNudgeEvaluationContext,
  NudgeCandidate,
} from '../types';
import type { VespaChatMessageDocument } from '@/vespa/src/types';
import {
  isEligibleMessage,
  buildMessageNudgeContext,
  resolveChannelIdForMessage,
} from './helpers';

const VESPA_MESSAGE_LIMIT = 10;
const RELATED_MESSAGE_PROMPT_NAME = 'nudge_find_related_message_from_message_agentic';
const RELATED_MESSAGE_PROMPT_LABEL = 'production';
const RELATED_MESSAGE_MODEL = 'glm-flash-experimental';

// --- Output schema for the agent's final answer ---

const RelatedMessageResultSchema = z.object({
  hasRelatedMessage: z.boolean(),
  messageId: z.string().optional().nullable(),
  conversationId: z.string().optional().nullable(),
  channelId: z.string().optional().nullable(),
  reason: z.string(),
  summary: z.string().optional().nullable(),
  matchingEvidence: z.string().optional().nullable(),
});

type RelatedMessageResultOutput = z.infer<typeof RelatedMessageResultSchema>;

// --- Message search tool ---

type SearchMessagesArgs = {
  query: string;
};

type NudgeToolContext = {
  senderId: string;
  sourceMessageId: string;
  sourceConversationId: string;
};

function createSearchMessagesTool(): Tool<SearchMessagesArgs, NudgeToolContext> {
  return {
    schema: {
      name: 'search_messages',
      description:
        'Search for existing messages in other conversations that might be related to the current message. ' +
        'Pass a concise search query capturing the core topic (e.g. "payment gateway timeout"). ' +
        'Returns a list of messages with their ID, conversationId, channelId, text, and relevance score. ' +
        'Messages from the same thread as the source are automatically excluded.',
      parameters: z.object({
        query: z.string().describe('Concise search query to find related messages'),
      }),
    },
    execute: async (args, context) => {
      try {
        const vespaResults = await vespaService.searchService.searchVespa(
          args.query,
          context.senderId,
          ['chat'],
          { offset: 0, limit: VESPA_MESSAGE_LIMIT, slack: {} },
        );

        const hits = (vespaResults.root.children || []) as Array<{
          fields: VespaChatMessageDocument;
          relevance: number;
        }>;

        const messages = hits
          .filter((hit) => {
            const doc = hit.fields;
            if (!doc || doc.docType !== 'message') return false;
            // Exclude the source message itself
            if (doc.docId === context.sourceMessageId) return false;
            // Exclude messages from the same thread
            if (doc.threadId === context.sourceConversationId) return false;
            return true;
          })
          .map((hit) => ({
            messageId: hit.fields.docId,
            conversationId: hit.fields.threadId,
            channelId: hit.fields.channelRef || '',
            text: (hit.fields.text ?? '').slice(0, 300),
            relevance: hit.relevance,
          }));

        logger.info('[FIND_RELATED_MESSAGE] search_messages tool result', {
          query: args.query,
          hitCount: messages.length,
        });

        if (messages.length === 0) {
          return 'No related messages found matching the query.';
        }

        return JSON.stringify(messages, null, 2);
      } catch (error) {
        logger.warn('[FIND_RELATED_MESSAGE] search_messages tool error', {
          error: error instanceof Error ? error.message : String(error),
        });
        return `Error searching messages: ${error instanceof Error ? error.message : 'Unknown error'}`;
      }
    },
  };
}

// --- Prompt ---

const RELATED_MESSAGE_FALLBACK_PROMPT = `
You are an agent that finds existing messages in other conversations related to a user's message.

You have a tool called "search_messages" that searches the message database. It automatically excludes messages from the same thread as the source message.

Steps:
1) Read the source message and decide if it discusses a specific topic, problem, question, or concern that could have been discussed elsewhere.
2) If yes, call search_messages with a concise query capturing the core topic.
3) Examine the returned messages. Determine if any are genuinely about the same topic or issue (not just shared keywords).
4) Return your final answer as STRICT JSON (no markdown, no code fences):

{
  "hasRelatedMessage": boolean,
  "messageId": string | null,
  "conversationId": string | null,
  "channelId": string | null,
  "reason": string,
  "summary": string | null,
  "matchingEvidence": string | null
}

Rules:
- If the message is purely social/conversational (greetings, thanks, etc.), skip the tool call and return hasRelatedMessage=false.
- You may call search_messages multiple times with different queries if the first search is not specific enough.
- Only set hasRelatedMessage=true if a message clearly discusses the same specific topic or issue.
- summary should be a brief (1 sentence) description of the shared topic.
- matchingEvidence should be a SHORT quote from the related message that shows why it's related (under 100 chars).
- Do NOT pick messages that merely share common words but discuss different things.
- Prefer messages with higher relevance scores when multiple candidates match.
- No markdown, no code fences, no extra keys.
`.trim();

async function resolveRelatedMessagePrompt(): Promise<string> {
  const dedicatedPrompt = (
    await getPromptFromLangfuse(RELATED_MESSAGE_PROMPT_NAME, {
      label: RELATED_MESSAGE_PROMPT_LABEL,
    })
  )?.trim() || null;

  if (dedicatedPrompt) {
    return dedicatedPrompt;
  }

  logger.warn('[FIND_RELATED_MESSAGE_FROM_MESSAGE] Dedicated prompt missing, using local fallback', {
    promptName: RELATED_MESSAGE_PROMPT_NAME,
  });
  return RELATED_MESSAGE_FALLBACK_PROMPT;
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

async function runRelatedMessageAgent(
  context: MessageNudgeEvaluationContext,
): Promise<RelatedMessageResultOutput> {
  const systemPrompt = await resolveRelatedMessagePrompt();
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

  const tools = [createSearchMessagesTool()];

  const agent: Agent<NudgeToolContext, RelatedMessageResultOutput> = {
    name: 'FindRelatedMessageAgent',
    instructions: () => systemPrompt,
    tools,
    modelConfig: { temperature: 0.1 },
  };

  const initialState: RunState<NudgeToolContext> = {
    runId: generateRunId(),
    traceId: generateTraceId(),
    messages: [{ role: 'user', content: JSON.stringify(userInput, null, 2) }],
    currentAgentName: 'FindRelatedMessageAgent',
    context: {
      senderId: context.message.senderId,
      sourceMessageId: context.message.messageId,
      sourceConversationId: context.message.conversationId,
    },
    turnCount: 0,
  };

  const runConfig: RunConfig<NudgeToolContext> = {
    agentRegistry: new Map([['FindRelatedMessageAgent', agent]]),
    modelProvider: provider as RunConfig<NudgeToolContext>['modelProvider'],
    maxTurns: 6,
    modelOverride: RELATED_MESSAGE_MODEL,
  };

  const result = await run(initialState, runConfig);

  if (result.outcome.status === 'completed') {
    const output = result.outcome.output;
    if (typeof output === 'string') {
      return parseAgentOutput(output, RelatedMessageResultSchema);
    }
    return RelatedMessageResultSchema.parse(output);
  }

  // Fallback: try to extract from last assistant message
  const rawText = extractLastAssistantText(result.finalState);
  if (rawText) {
    try {
      return parseAgentOutput(rawText, RelatedMessageResultSchema);
    } catch {
      // fall through
    }
  }

  logger.warn('[FIND_RELATED_MESSAGE] Agent did not produce valid output', {
    status: result.outcome.status,
  });
  return { hasRelatedMessage: false, reason: 'Agent failed to produce output' };
}

// --- Nudge definition ---

export const findRelatedMessageFromMessage: NudgeDefinition<
  MessageNudgePayload,
  MessageNudgeEvaluationContext
> = {
  kind: 'FIND_RELATED_MESSAGE_FROM_MESSAGE',
  mode: 'explicit',
  priority: 'high',
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
  direction: { from: 'MESSAGE', to: 'MESSAGE' },

  async buildContext(payload, activityContext, runtime) {
    return buildMessageNudgeContext(payload, activityContext, runtime);
  },

  async evaluate(
    context: MessageNudgeEvaluationContext,
    _payload: MessageNudgePayload,
  ): Promise<NudgeCandidate[]> {
    const agentResult = await runRelatedMessageAgent(context);

    logger.info('[FIND_RELATED_MESSAGE_FROM_MESSAGE] Agent result', {
      hasRelatedMessage: agentResult.hasRelatedMessage,
      messageId: agentResult.messageId,
      reason: agentResult.reason,
    });

    if (!agentResult.hasRelatedMessage || !agentResult.messageId) return [];

    // Resolve channelId: prefer agent's result, fall back to DB lookup
    const resolvedChannelId =
      agentResult.channelId || (await resolveChannelIdForMessage(agentResult.messageId));

    if (!resolvedChannelId) {
      logger.warn('[FIND_RELATED_MESSAGE] Skipping: could not resolve channelId', {
        messageId: agentResult.messageId,
        conversationId: agentResult.conversationId,
      });
      return [];
    }

    const description =
      agentResult.summary?.trim() || agentResult.reason || 'A related discussion was found in another thread.';
    const evidence =
      agentResult.matchingEvidence?.trim() || description;

    return [
      {
        title: 'Related conversation found',
        description,
        actions: {
          actionType: 'OPEN_RELATED_MESSAGE',
          entityId: agentResult.messageId,
          evidence,
          conversationId: agentResult.conversationId || '',
          channelId: resolvedChannelId,
        },
      },
    ];
  },

  async postProcess(
    candidates: NudgeCandidate[],
    _payload: MessageNudgePayload,
  ): Promise<NudgeCandidate[]> {
    return candidates.filter((c) => {
      const actions = c.actions as Record<string, unknown> | undefined;
      return actions?.entityId;
    });
  },
};
