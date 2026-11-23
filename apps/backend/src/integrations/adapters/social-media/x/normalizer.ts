import { logger } from '@/utils/logger';
import type { XActivityEvent, XChatPayload, XInboundItem, XLegacyDmPayload, XPost, XUser, XV2DmEvent } from './types';

const TAG = '[XNormalizer]';

/**
 * X's DM conversation id for a one-to-one conversation: both user ids, ascending, joined by "-"
 * (matches `dm_conversation_id` from GET /2/dm_events). Ids are compared as integers — they are
 * too large for Number.
 */
export function oneToOneDmConversationId(a: string, b: string): string {
  return BigInt(a) < BigInt(b) ? `${a}-${b}` : `${b}-${a}`;
}

/** The other participant of a one-to-one DM conversation id, or undefined for groups. */
export function dmCounterparty(conversationId: string, brandUserId: string): string | undefined {
  const parts = conversationId.split('-');
  if (parts.length !== 2) return undefined;
  return parts[0] === brandUserId ? parts[1] : parts[1] === brandUserId ? parts[0] : undefined;
}

function legacyUser(users: XLegacyDmPayload['users'], id: string): XUser | undefined {
  const entry = users?.[id];
  const u = entry?.data ?? entry;
  return u?.username ? { id, username: u.username, name: u.name } : undefined;
}

/** Unwraps `{"data": event}` (stream line / webhook body) or accepts a bare event. */
export function unwrapActivityEvent(message: unknown): XActivityEvent | undefined {
  const m = message as { data?: unknown } | undefined;
  const event = (m && typeof m === 'object' && 'data' in m ? m.data : m) as XActivityEvent | undefined;
  return event && typeof event.event_type === 'string' ? event : undefined;
}

/**
 * Activity event → inbound items for one brand account. Skips anything the brand authored itself.
 *
 * - post.mention.create / post.reply.create carry a v2 Post. One Post can raise both events (a
 *   Post starting with @brand); both map to the same externalId, so ingest dedups the second.
 * - dm.received carries the legacy v1.1 DM shape.
 * - chat.received (XChat) is end-to-end encrypted; it is passed on still encrypted and the
 *   transformer decrypts it with the source's keys.
 */
export function fromActivityEvent(event: XActivityEvent, brandUserId: string): XInboundItem[] {
  switch (event.event_type) {
    case 'post.mention.create':
    case 'post.reply.create': {
      const post = event.payload as XPost;
      if (!post?.id || !post.author_id || post.author_id === brandUserId) return [];
      const author = event.includes?.users?.find((u) => u.id === post.author_id);
      return [{ kind: 'post', post, author, eventType: event.event_type }];
    }
    case 'dm.received': {
      const payload = event.payload as XLegacyDmPayload;
      return (payload?.direct_message_events ?? [])
        .filter((dm) => dm.type === 'message_create' && dm.message_create?.sender_id !== brandUserId)
        .map((dm) => {
          const senderId = dm.message_create.sender_id;
          return {
            kind: 'dm' as const,
            id: dm.id,
            conversationId: oneToOneDmConversationId(senderId, dm.message_create.target.recipient_id),
            senderId,
            text: dm.message_create.message_data?.text ?? '',
            createdAt: new Date(Number(dm.created_timestamp)),
            sender: legacyUser(payload.users, senderId),
          };
        });
    }
    case 'chat.received': {
      const payload = event.payload as XChatPayload;
      if (!payload?.id || !payload.encoded_event || payload.sender_id === brandUserId) return [];
      return [{ kind: 'xchat', payload }];
    }
    default:
      logger.info(`${TAG} Unhandled X event type`, { eventType: event.event_type, eventUuid: event.event_uuid });
      return [];
  }
}

/** Polled mentions (GET /2/users/:id/mentions) → inbound items. */
export function fromPolledPosts(posts: XPost[], users: XUser[] | undefined, brandUserId: string): XInboundItem[] {
  return posts
    .filter((p) => p.author_id && p.author_id !== brandUserId)
    .map((post) => ({
      kind: 'post' as const,
      post,
      author: users?.find((u) => u.id === post.author_id),
      eventType: 'poll.mentions',
    }));
}

/** Polled DMs (GET /2/dm_events, v2 shape) → inbound items. Same ids as the stream's legacy events. */
export function fromPolledDms(events: XV2DmEvent[], users: XUser[] | undefined, brandUserId: string): XInboundItem[] {
  return events
    .filter((e) => e.event_type === 'MessageCreate' && e.sender_id && e.sender_id !== brandUserId && e.dm_conversation_id)
    .map((e) => ({
      kind: 'dm' as const,
      id: e.id,
      conversationId: e.dm_conversation_id!,
      senderId: e.sender_id!,
      text: e.text ?? '',
      createdAt: e.created_at ? new Date(e.created_at) : new Date(),
      sender: users?.find((u) => u.id === e.sender_id),
    }));
}
