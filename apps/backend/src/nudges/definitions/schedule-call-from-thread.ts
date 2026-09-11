import { db } from '@/database/client';
import { CallStatus, MessageType, NudgeKind, SurfaceAreaType, NudgeState, ChannelScopeType } from '@xyne/shared';
import { logger } from '@/utils/logger';
import { getPromptFromLangfuse } from '@/agents/xyne-ai/langfuse/index.js';
import { z } from 'zod';
import type {
  ExplicitNudgeAction,
  MessageNudgeEvaluationContext,
  MessageNudgePayload,
  NudgeCandidate,
  NudgeDefinition,
} from '../types';
import { buildMessageNudgeContext, runNudgeAgent } from './helpers';

const SCHEDULE_CALL_PROMPT_NAME = 'nudge_schedule_call_from_thread';
const SCHEDULE_CALL_PROMPT_LABEL = 'production';

const SCHEDULE_CALL_FALLBACK_PROMPT = `
You are an assistant that decides if a thread conversation warrants scheduling a call.

Analyze the thread messages and determine if there are signs that the participants would benefit
from a synchronous discussion (a call/meeting).

Return STRICT JSON only (no markdown, no code fences):
{
  "shouldScheduleCall": boolean,
  "reason": string,
  "suggestedTitle": string | null
}

Signals that a call would be helpful (set shouldScheduleCall=true):
- Back-and-forth discussion without resolution after several messages
- Complex technical discussion that would be faster to discuss verbally
- Explicit mention of wanting to discuss synchronously ("let's hop on a call", "can we discuss this?", "let's sync")
- Decision-making that is stalled due to asynchronous communication
- Urgent issues requiring immediate coordination
- Planning activities that require collaboration from multiple parties

Do NOT suggest a call when (set shouldScheduleCall=false):
- The conversation is purely informational with no need for discussion
- Short messages, greetings, or social chat
- The thread has fewer than 3 meaningful messages
- The topic has already been resolved
- Simple question-answer exchanges with clear answers
- Status updates only

If shouldScheduleCall=true, provide a concise suggestedTitle for the call (e.g. "Discuss payment gateway issue", "Sync on deployment plan").
If shouldScheduleCall=false, suggestedTitle should be null.
`.trim();

const ScheduleCallResultSchema = z.object({
  shouldScheduleCall: z.boolean(),
  reason: z.string(),
  suggestedTitle: z.string().nullable().optional(),
});

async function resolveScheduleCallPrompt(): Promise<string> {
  const dedicatedPrompt = (
    await getPromptFromLangfuse(SCHEDULE_CALL_PROMPT_NAME, {
      label: SCHEDULE_CALL_PROMPT_LABEL,
    })
  )?.trim() || null;

  return dedicatedPrompt ?? SCHEDULE_CALL_FALLBACK_PROMPT;
}

async function isEligibleThreadMessage(params: {
  messageId: string;
  channelId: string;
  conversationId: string;
}): Promise<boolean> {
  const { messageId, channelId, conversationId } = params;

  const channel = await db.channel.findUnique({
    where: { id: channelId },
    select: { scopeType: true },
  });

  if (!channel) return false;
  if (channel.scopeType === ChannelScopeType.DM || channel.scopeType === ChannelScopeType.GROUP_DM) return false;

  const conversation = await db.conversation.findUnique({
    where: { conversationId },
    select: { initialMessageId: true },
  });
  if (!conversation) return false;

  const message = await db.message.findUnique({
    where: { messageId },
    select: { msgType: true, content: true, hasAttachment: true },
  });
  if (!message) return false;
  if (message.msgType === MessageType.SYSTEM || message.msgType === MessageType.BOT) return false;

  return true;
}

/**
 * Check if there is already a scheduled or active Xyne call in the channel
 * within the next 12 hours. Returns true if a call already exists.
 */
async function hasExistingXyneCall(channelId: string): Promise<boolean> {
  const now = new Date();
  const futureWindow = new Date(now.getTime() + 12 * 60 * 60 * 1000); // next 12 hours

  const existingCall = await db.call.findFirst({
    where: {
      channelId,
      status: { in: [CallStatus.SCHEDULED, CallStatus.ACTIVE] },
      startsAt: {
        lte: futureWindow,
        gte: now,
      },
    },
    select: { id: true },
  });

  return existingCall !== null;
}

/**
 * Check if there is already an ACTIVE or ACTED_ON nudge for this conversation
 * regardless of who it is visible to. Prevents duplicate nudges across all
 * participants of the same thread.
 */
async function hasExistingNudgeForConversation(conversationId: string): Promise<boolean> {
  const existingNudge = await db.surfaceNudge.findFirst({
    where: {
      nudgeKind: NudgeKind.SCHEDULE_CALL_FROM_THREAD,
      state: { in: [NudgeState.ACTIVE, NudgeState.ACTED_ON] },
      actions: {
        path: ['conversationId'],
        equals: conversationId,
      },
    },
    select: { id: true },
  });

  return existingNudge !== null;
}

export const scheduleCallFromThread: NudgeDefinition<
  MessageNudgePayload,
  MessageNudgeEvaluationContext
> = {
  kind: NudgeKind.SCHEDULE_CALL_FROM_THREAD,
  mode: 'explicit',
  priority: 'low',
  trigger: {
    subscribesTo: ['MESSAGE.SENT'],
    async lookbackHandler(event, history) {
      const meta = event.contextMetadata ?? {};
      const messageId = typeof meta.messageId === 'string' ? meta.messageId : undefined;
      const channelId = typeof meta.channelId === 'string' ? meta.channelId : undefined;
      const conversationId =
        typeof meta.conversationId === 'string' ? meta.conversationId : undefined;

      if (!messageId || !channelId || !conversationId) return false;

      const eligible = await isEligibleThreadMessage({ messageId, channelId, conversationId });
      if (!eligible) return false;

      const threadEvents = history.events.filter(
        (e) =>
          e.eventCategory === 'MESSAGE' &&
          e.eventName === 'SENT' &&
          (e.contextMetadata as Record<string, unknown> | undefined)?.conversationId ===
            conversationId,
      );

      return threadEvents.length >= 2;
    },
  },
  direction: { from: SurfaceAreaType.MESSAGE, to: SurfaceAreaType.CALL },

  async buildContext(payload, activityContext, runtime) {
    return buildMessageNudgeContext(payload, activityContext, runtime);
  },

  async evaluate(
    context: MessageNudgeEvaluationContext,
    payload: MessageNudgePayload,
  ): Promise<NudgeCandidate[]> {
    // Skip if there's already a scheduled/active call in this channel within 12 hours
    if (await hasExistingXyneCall(context.message.channelId)) return [];

    // Skip if there's already an ACTIVE or ACTED_ON nudge for this conversation
    if (await hasExistingNudgeForConversation(context.message.conversationId)) {
      return [];
    }

    const userMessages = context.threadMessages
      .filter((m) => m.senderId !== 'system')
      .slice(-10)
      .map((m) => ({ text: m.content }));

    const allMessages = [
      ...userMessages,
      { text: context.message.messageText },
    ];

    let result: z.infer<typeof ScheduleCallResultSchema>;
    try {
      const systemPrompt = await resolveScheduleCallPrompt();
      result = await runNudgeAgent<z.infer<typeof ScheduleCallResultSchema>>({
        agentName: 'ScheduleCallFromThreadAgent',
        projectId: context.message.projectId,
        systemPrompt,
        input: {
          thread_messages: allMessages,
          message_count: allMessages.length,
        },
        schema: ScheduleCallResultSchema,
      });
    } catch (agentError) {
      logger.error('[SCHEDULE_CALL_FROM_THREAD] Agent execution failed', {
        conversationId: context.message.conversationId,
        error: agentError,
      });
      return [];
    }

    if (!result.shouldScheduleCall) return [];

    const suggestedTitle =
      result.suggestedTitle?.trim() || 'Schedule a call to discuss this thread';

    const actions: ExplicitNudgeAction = {
      actionType: 'SCHEDULE_CALL_FROM_THREAD',
      actionMode: 'write',
      onSuccess: 'acted_on',
      createSurfaceLink: false,
      conversationId: context.message.conversationId,
      channelId: context.message.channelId,
      suggestedTitle,
    };

    const candidate: NudgeCandidate = {
      title: suggestedTitle,
      description:
        'Schedule a Xyne call or Google Meet to continue this discussion synchronously.',
      priority: 'low',
      visibleTo: payload.senderId,
      actions,
    };

    logger.info('[SCHEDULE_CALL_FROM_THREAD] Nudge created', {
      conversationId: context.message.conversationId,
      suggestedTitle,
    });

    return [candidate];
  },
};
