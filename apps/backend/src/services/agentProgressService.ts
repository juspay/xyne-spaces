import { MessageType } from '@xyne/shared';
import { config } from '@/config/env';
import { redisService } from './redisService';

/**
 * Clear every in-flight agent-progress signal for a conversation and broadcast
 * `done` to all subscribers, so the "agent working" pill / Stop button disappears
 * immediately and in sync across every open view of the thread.
 *
 * Keyed by agentUserId (the Redis hash field), reusing each stored payload so the
 * client computes the same key and drops the matching entry.
 */
export async function clearConversationAgentProgress(
  conversationId: string,
  channelId: string,
  /** Limit the clear to these agents (hash fields); every agent when omitted. */
  onlyAgentUserIds?: readonly string[],
): Promise<void> {
  const key = `agent_progress:conversation:${conversationId}`;
  const raw = await redisService.getAllHashFields(key);
  const fields = Object.keys(raw).filter(field => !onlyAgentUserIds || onlyAgentUserIds.includes(field));
  if (fields.length === 0) return;

  for (const agentUserId of fields) {
    let stored: Record<string, unknown> = {};
    try {
      stored = JSON.parse(raw[agentUserId]) as Record<string, unknown>;
    } catch {
      /* malformed field — still broadcast a best-effort done below */
    }
    // Write the session-scoped tombstone so any straggler `working` events from
    // this cancelled run are suppressed by the agentProgress endpoint and never
    // repopulate the hash (which would cause a ghost spinner on the next rehydrate).
    const storedSessionId = typeof stored.sessionId === 'string' ? stored.sessionId : null;
    if (storedSessionId) {
      await redisService.set(`agent_progress_done_session:${storedSessionId}`, new Date().toISOString(), 120);
    }
    const payload = { ...stored, conversationId, channelId, agentUserId, status: 'done', timestamp: new Date().toISOString() };
    await redisService.broadcastMessageToSession(channelId, {
      messageId: `agent_progress_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      conversationId,
      senderId: agentUserId,
      senderName: String(stored.agentSlug ?? ''),
      content: JSON.stringify({ type: 'agent_progress', data: payload }),
      msgType: MessageType.SYSTEM,
      createdAt: new Date(),
    });
  }
  await redisService.deleteHashField(key, fields);
}

/** The runs currently showing a "working" pill on a conversation, one per agent. */
export async function listConversationAgentProgress(
  conversationId: string,
): Promise<Array<{ agentUserId: string; agentSlug: string | null; sessionId: string | null }>> {
  const raw = await redisService.getAllHashFields(`agent_progress:conversation:${conversationId}`);
  return Object.entries(raw).map(([agentUserId, value]) => {
    let stored: Record<string, unknown> = {};
    try {
      stored = JSON.parse(value) as Record<string, unknown>;
    } catch {
      /* malformed field — reported with no slug or session */
    }
    return {
      agentUserId,
      agentSlug: typeof stored.agentSlug === 'string' ? stored.agentSlug : null,
      sessionId: typeof stored.sessionId === 'string' ? stored.sessionId : null,
    };
  });
}

/** Ask xyne-claw-auth to cancel an agent's in-flight run, as `userId`. */
export function requestClawAgentCancel(params: {
  conversationId: string;
  agentSlug: string;
  userId: string;
  /** The run to cancel, when the caller knows it. */
  sessionId?: string;
}): Promise<globalThis.Response> {
  return fetch(
    `${config.xyneClaw.authUrl}/claw/api/v1/agent-chat/${encodeURIComponent(params.agentSlug)}/chat/cancel`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': params.userId,
        ...(config.xyneClaw.s2sKey ? { 'x-s2s-key': config.xyneClaw.s2sKey } : {}),
      },
      body: JSON.stringify({
        conversationId: params.conversationId,
        ...(params.sessionId ? { sessionId: params.sessionId } : {}),
      }),
    },
  );
}
