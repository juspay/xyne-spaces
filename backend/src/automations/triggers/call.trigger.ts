import { z } from 'zod';
import { CallType } from '@prisma/client';
import { BaseTrigger } from './base-trigger';
import { TriggerCategory } from '../types/categories';
import { eventRouter } from '../engine/event-router';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';

// Unified Call Event Types
export const CALL_EVENT = 'CALL_EVENT';
export const CALL_STARTED = 'CALL_STARTED';
export const CALL_ENDED = 'CALL_ENDED';

const CallEventConfigSchema = z.object({
  callEventType: z.enum([CALL_STARTED, CALL_ENDED]).describe('When to fire: when a call starts or when a call ends.'),
  channelIds: z
    .array(z.string())
    .optional()
    .describe('Limit to calls in these channels. Empty matches every channel.'),
  participantUserIds: z
    .array(z.string())
    .optional()
    .describe('Limit to calls where any of these users participated. Empty matches every call.'),
});

const ParticipantUserSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
});

export const CallEventOutputSchema = z.object({
  callEventType: z.enum([CALL_STARTED, CALL_ENDED]),
  callId: z.string(),
  externalId: z.string(),
  channelId: z.string().nullable(),
  title: z.string().nullable(),
  callType: z.nativeEnum(CallType),
  startedAt: z.coerce.date(),
  endedAt: z.coerce.date().nullable(),
  durationSeconds: z.number().nullable(),
  aiSummary: z.string().nullable(),
  transcript: z.string().nullable(),
  conversationId: z.string().nullable(),
  participantUsers: z.array(ParticipantUserSchema),
});

type CallEventConfig = z.infer<typeof CallEventConfigSchema>;

export class CallTrigger extends BaseTrigger<typeof CallEventConfigSchema> {
  readonly type = CALL_EVENT;
  readonly configSchema = CallEventConfigSchema;
  readonly outputSchema = CallEventOutputSchema;
  readonly name = 'When a call event occurs';
  readonly description =
    "Fires when a call starts or ends. aiSummary and transcript are generated asynchronously after the call ends — if you need them in downstream steps, add a 'Scheduled' delay (e.g. 60–90s) so the AI pipeline has time to populate the fields. Filter by channel.";
  readonly category = TriggerCategory.EVENT;
  readonly icon = 'Phone';
  readonly scopeFilterFields = ['channelIds'] as const;

  async hydratePayload(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return hydrateCallEventPayload(payload);
  }

  override matchFilters(
    filter: Record<string, unknown>,
    payload: Record<string, unknown>,
  ): boolean {
    const cfg = filter as CallEventConfig;
    const p = payload as z.infer<typeof CallEventOutputSchema>;

    // Check event type condition
    if (cfg.callEventType !== p.callEventType) {
      return false;
    }

    const channelIds = (cfg.channelIds ?? []).map(id => id?.trim()).filter((id): id is string => !!id);
    if (channelIds.length > 0) {
      if (!p.channelId || !channelIds.includes(p.channelId)) return false;
    }

    const explicitParticipantUserIds = (cfg.participantUserIds ?? [])
      .map(id => id?.trim())
      .filter((id): id is string => !!id);
    // An empty participant list is intentionally a no-op: the schema promises
    // "Empty matches every call". Only a non-empty list restricts the trigger.
    if (explicitParticipantUserIds.length > 0) {
      const participantIds = p.participantUsers?.map(u => u.id) ?? [];
      const hasMatch = explicitParticipantUserIds.some(id => participantIds.includes(id));
      if (!hasMatch) return false;
    }

    return true;
  }
}

export const callTrigger = new CallTrigger();

/**
 * Emit a call event (started or ended) to the automation engine.
 */
export async function emitCallEvent(
  callEventType: typeof CALL_STARTED | typeof CALL_ENDED,
  call: {
    id: string;
    externalId: string;
    channelId: string | null;
    title: string | null;
    callType: CallType;
    startedAt: Date;
    endedAt?: Date;
    aiSummary?: string | null;
    transcript?: string | null;
    conversationId?: string | null;
  }
): Promise<void> {
  try {
    if (!call.channelId) return;

    const channel = await db.channel.findUnique({
      where: { id: call.channelId },
      select: { workspaceId: true },
    });
    if (!channel?.workspaceId) {
      logger.warn('[automations] Cannot emit call event: no workspace found', {
        callId: call.id,
        channelId: call.channelId,
      });
      return;
    }

    const durationSeconds = call.endedAt
      ? Math.round((call.endedAt.getTime() - call.startedAt.getTime()) / 1000)
      : null;

    await eventRouter.emit(
      {
        type: CALL_EVENT,
        payload: {
          callEventType,
          callId: call.id,
          externalId: call.externalId,
          channelId: call.channelId,
          title: call.title,
          callType: call.callType,
          startedAt: call.startedAt,
          endedAt: call.endedAt ?? null,
          durationSeconds,
          aiSummary: call.aiSummary ?? null,
          transcript: call.transcript ?? null,
          conversationId: call.conversationId ?? null,
        },
      },
      channel.workspaceId,
    );
  } catch (err) {
    logger.error('[automations] emitCallEvent failed', {
      callEventType,
      callId: call.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Emit CALL_STARTED event when a call begins (first participant joins).
 */
export async function emitCallStarted(call: {
  id: string;
  externalId: string;
  channelId: string | null;
  title: string | null;
  callType: CallType;
  startedAt: Date;
}): Promise<void> {
  return emitCallEvent(CALL_STARTED, call);
}

/**
 * Emit CALL_ENDED event when a call ends (room finished).
 */
export async function emitCallEnded(call: {
  id: string;
  externalId: string;
  channelId: string | null;
  title: string | null;
  callType: CallType;
  startedAt: Date;
  endedAt: Date;
  aiSummary?: string | null;
  transcript?: string | null;
  conversationId?: string | null;
}): Promise<void> {
  return emitCallEvent(CALL_ENDED, call);
}

async function hydrateCallEventPayload(
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const callId = payload.callId as string;

  try {
    // Fetch fresh aiSummary/transcript for CALL_ENDED events
    const [fresh, participantRows] = await Promise.all([
      db.call.findUnique({
        where: { id: callId },
        select: { aiSummary: true, transcript: true },
      }),
      db.callParticipant.findMany({
        where: { callId },
        select: { userId: true },
      }),
    ]);

    const userIds = participantRows.map(p => p.userId).filter(Boolean);
    let participantUsers: Array<{ id: string; name: string | null; email: string | null }> = [];
    if (userIds.length > 0) {
      const users = await db.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, email: true },
      });
      participantUsers = users.map(u => ({ id: u.id, name: u.name ?? null, email: u.email ?? null }));
    }

    return {
      ...payload,
      aiSummary: fresh?.aiSummary ?? payload.aiSummary,
      transcript: fresh?.transcript ?? payload.transcript,
      participantUsers,
    };
  } catch (err) {
    logger.error('[automations] hydrateCallEventPayload failed', {
      callId,
      error: err instanceof Error ? err.message : String(err),
    });
    // Return the original payload with an empty participant list so the automation
    // event can still be processed rather than failing the whole run.
    return {
      ...payload,
      participantUsers: [],
    };
  }
}