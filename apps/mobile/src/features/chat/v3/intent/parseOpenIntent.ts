import { isColdStartFromParams, parseEntryPoint } from './entryPoint';
import {
  err,
  intentKeyFor,
  ok,
  type OpenHint,
  type OpenIntent,
  type OpenSurface,
  type Result,
} from './openIntent.types';
import { openIntentParamsSchema } from './openIntentSchema';
import type { OpenFailure } from '../types/openFailure';

const provisionalSurface = (hint: OpenHint): OpenSurface => {
  if (hint.ticketId && hint.threadId) {
    return {
      kind: 'ticket-thread',
      channelId: hint.channelId,
      threadId: hint.threadId,
      ticketId: hint.ticketId,
    };
  }
  if (hint.threadId) {
    return { kind: 'thread', channelId: hint.channelId, threadId: hint.threadId };
  }
  return { kind: 'channel', channelId: hint.channelId };
};

/**
 * Validate untrusted route params into a typed intent, or `invalid-intent`.
 * `intentKey` is surface identity only — the landing message is not in the key.
 */
export const parseOpenIntent = (raw: Record<string, unknown>): Result<OpenIntent, OpenFailure> => {
  const parsed = openIntentParamsSchema.safeParse(raw);
  if (!parsed.success) {
    return err({ reason: 'invalid-intent', raw });
  }

  const channelId = parsed.data.channelId;
  if (!channelId) {
    return err({ reason: 'invalid-intent', raw });
  }

  if (parsed.data.resolving === 'unavailable') {
    return err({ reason: 'not-found' });
  }

  const entry = parseEntryPoint(parsed.data.source, parsed.data.from);
  const conversationId = parsed.data.conversationId ?? parsed.data.origin ?? parsed.data.threadId;
  // Unread is a list-tap flag. Live lastViewedAt must not create an unread open.
  const isUnreadOpen = parsed.data.unreadOpen === '1';
  const hint: OpenHint = {
    channelId,
    ...(parsed.data.threadId ? { threadId: parsed.data.threadId } : {}),
    ...(parsed.data.ticketId ? { ticketId: parsed.data.ticketId } : {}),
    ...(conversationId ? { conversationId } : {}),
    ...(parsed.data.messageId ? { messageId: parsed.data.messageId } : {}),
    ...(parsed.data.createdAt !== undefined ? { createdAt: parsed.data.createdAt } : {}),
    ...(parsed.data.surface ? { listSurface: parsed.data.surface } : {}),
    ...(parsed.data.scopeType ? { scopeType: parsed.data.scopeType } : {}),
    ...(isUnreadOpen && parsed.data.unreadCount !== undefined
      ? { unreadCount: parsed.data.unreadCount }
      : {}),
    ...(isUnreadOpen && parsed.data.unreadLastViewedAt !== undefined
      ? { unreadBoundaryAt: parsed.data.unreadLastViewedAt }
      : {}),
    ...(isUnreadOpen && parsed.data.unreadLastViewedConversationId
      ? { unreadBoundaryConversationId: parsed.data.unreadLastViewedConversationId }
      : {}),
  };

  const surface = provisionalSurface(hint);

  return ok({
    intentKey: intentKeyFor(surface),
    surface,
    entry,
    isColdStart: isColdStartFromParams(entry, parsed.data.isColdStart),
    raw,
    hint,
  });
};
