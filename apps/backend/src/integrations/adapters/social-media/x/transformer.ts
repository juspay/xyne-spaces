import type { ExternalSource } from '@prisma/client';
import { EmailType, FormFieldType } from '@xyne/shared';
import { BaseTransformer } from '@/integrations/core/baseTransformer';
import type { NormalizedData, ParseResult } from '@/integrations/core/types';
import { SOCIAL_MEDIA_INTERACTION_TYPES } from '@/integrations/social-media/constants';
import { logger } from '@/utils/logger';
import { xApiClient } from './client';
import { X_AUTHOR_ID_FIELD, X_DM_THREAD_PREFIX, X_POST_LINK_FIELD, X_POST_THREAD_PREFIX } from './constants';
import { xchatAccountFor, xTokenService } from './tokenService';
import type { XChatPayload, XInboundItem, XUser } from './types';
import { dmConversationIdFromChat, xchatService } from './xchat';

const TAG = '[XTransformer]';

/** Inbound items ready to map: posts and plaintext DMs (XChat already decrypted). */
export type XReadyItem = Exclude<XInboundItem, { kind: 'xchat' }>;

/** Shown when an XChat message cannot be read here; the agent still sees who wrote and when. */
export const XCHAT_LOCKED_TEXT =
  '🔒 Encrypted XChat message. Enable XChat in this desk\'s X settings to read it here, or open X to read and reply.';
export const XCHAT_UNREADABLE_TEXT = '🔒 Encrypted XChat message that could not be decrypted. Open X to read and reply.';

/**
 * Dedup key: the resource id (Post id / DM event id), scoped to the source. `event_uuid` is not
 * usable — live tests showed it differs per transport for DMs and is shared by the mention and
 * reply events of one Post.
 */
export const xPostExternalId = (sourceId: string, postId: string) => `${sourceId}:post:${postId}`;
export const xDmExternalId = (sourceId: string, dmEventId: string) => `${sourceId}:dm:${dmEventId}`;

/**
 * One ticket per customer per public conversation. Keying on conversation_id alone would merge
 * every customer who replies under the same brand Post into one ticket.
 */
export const xPostThreadId = (conversationId: string, authorId: string) =>
  `${X_POST_THREAD_PREFIX}${conversationId}:${authorId}`;
export const xDmThreadId = (dmConversationId: string) => `${X_DM_THREAD_PREFIX}${dmConversationId}`;

export const xPostUrl = (postId: string, username?: string) =>
  `https://x.com/${username ?? 'i/web'}/status/${postId}`;

export function transformXInbound(item: XReadyItem, source: Pick<ExternalSource, 'id' | 'displayName'>): NormalizedData {
  const brand = source.displayName ? [`@${source.displayName}`] : [];

  if (item.kind === 'post') {
    const { post, author } = item;
    const handle = author?.username ? `@${author.username}` : post.author_id;
    const link = xPostUrl(post.id, author?.username);
    const isReplyToBrand = item.eventType === 'post.reply.create' || post.referenced_tweets?.some((r) => r.type === 'replied_to');
    return {
      externalId: xPostExternalId(source.id, post.id),
      externalThreadId: xPostThreadId(post.conversation_id ?? post.id, post.author_id),
      author: { name: handle, externalId: post.author_id },
      content: post.text,
      emailData: {
        subject: `X ${isReplyToBrand ? 'reply' : 'mention'} from ${handle}`,
        from: handle,
        to: brand,
        type: EmailType.DEFAULT,
        skipBlockingCheck: true,
      },
      metadata: {
        eventType: SOCIAL_MEDIA_INTERACTION_TYPES.MENTION,
        timestamp: post.created_at ? new Date(post.created_at) : new Date(),
        source: 'social-media',
        fromEmailAddress: author?.username ?? post.author_id,
        webUrl: link,
        postId: post.id,
        ...(post.conversation_id && { conversationId: post.conversation_id }),
      },
      ticketCustomFields: [
        { fieldName: X_AUTHOR_ID_FIELD, fieldType: FormFieldType.STRING, value: post.author_id },
        { fieldName: X_POST_LINK_FIELD, fieldType: FormFieldType.STRING, value: link },
      ],
    };
  }

  const handle = item.sender?.username ? `@${item.sender.username}` : item.senderId;
  const isXChat = item.channel === 'xchat';
  // A readable XChat message replaces a locked/unreadable placeholder stored earlier under the same
  // id (the decrypted id equals the event's payload.id, live-verified); otherwise ingest would see a
  // duplicate and keep the placeholder forever. Placeholders themselves never overwrite anything.
  const replacesPlaceholder = isXChat && item.text !== XCHAT_LOCKED_TEXT && item.text !== XCHAT_UNREADABLE_TEXT;
  return {
    externalId: xDmExternalId(source.id, item.id),
    externalThreadId: xDmThreadId(item.conversationId),
    author: { name: handle, externalId: item.senderId },
    content: item.text,
    emailData: {
      subject: `X ${isXChat ? 'chat' : 'DM'} from ${handle}`,
      from: handle,
      to: brand,
      type: EmailType.DEFAULT,
      skipBlockingCheck: true,
      ...(replacesPlaceholder && { updateExisting: true }),
    },
    metadata: {
      eventType: SOCIAL_MEDIA_INTERACTION_TYPES.DM,
      timestamp: item.createdAt,
      source: 'social-media',
      fromEmailAddress: item.sender?.username ?? item.senderId,
      dmEventId: item.id,
      ...(isXChat && { xchat: true }),
    },
    ticketCustomFields: [{ fieldName: X_AUTHOR_ID_FIELD, fieldType: FormFieldType.STRING, value: item.senderId }],
  };
}

/** Sender handles for XChat (its payload carries ids only). Small, process-wide. */
const senderCache = new Map<string, XUser>();
const SENDER_CACHE_MAX = 5_000;

async function lookupSender(source: ExternalSource, userId: string): Promise<XUser | undefined> {
  const hit = senderCache.get(userId);
  if (hit) return hit;
  try {
    const user = await xTokenService.withUserToken(source, (token) => xApiClient.getUser(token, userId));
    if (senderCache.size >= SENDER_CACHE_MAX) senderCache.delete(senderCache.keys().next().value!);
    senderCache.set(userId, user);
    return user;
  } catch (error) {
    logger.warn(`${TAG} Sender lookup failed`, { userId, error: String(error) });
    return undefined;
  }
}

/**
 * Decrypts a `chat.received` payload with the source's XChat keys. A message that cannot be read
 * (XChat not enabled, or decryption failed) still becomes a ticket entry with a placeholder, so
 * nothing a customer sends is silently dropped. Group chats are skipped for now.
 */
export async function decryptXChatPayload(payload: XChatPayload, source: ExternalSource): Promise<XReadyItem[]> {
  const conversationId = dmConversationIdFromChat(payload.conversation_id);
  if (!conversationId) {
    logger.info(`${TAG} Skipping XChat group message`, { sourceId: source.id });
    return [];
  }
  const sender = await lookupSender(source, payload.sender_id);
  const placeholder = (text: string): XReadyItem => ({
    kind: 'dm',
    id: payload.id,
    conversationId,
    senderId: payload.sender_id,
    text,
    createdAt: new Date(Number(payload.created_at_msec) || Date.now()),
    sender,
    channel: 'xchat',
  });

  const account = xchatAccountFor(source);
  if (!account) {
    xchatService.forget(source.id); // keys were removed; drop any copy this process still holds
    return [placeholder(XCHAT_LOCKED_TEXT)];
  }
  try {
    const { messages, failed } = await xchatService.decrypt(account, [
      payload.conversation_key_change_event ?? '',
      payload.encoded_event,
    ]);
    // Decrypted fine but not a text message (reaction, edit, delete, key change): nothing to show.
    if (messages.length === 0) return failed > 0 ? [placeholder(XCHAT_UNREADABLE_TEXT)] : [];
    return messages.map((m) => ({
      kind: 'dm' as const,
      id: m.id,
      conversationId: m.conversationId,
      senderId: m.senderId,
      text: m.text,
      createdAt: m.createdAt,
      sender: m.senderId === payload.sender_id ? sender : undefined,
      channel: 'xchat' as const,
    }));
  } catch (error) {
    logger.error(`${TAG} XChat decrypt failed`, { sourceId: source.id, error: String(error) });
    return [placeholder(XCHAT_UNREADABLE_TEXT)];
  }
}

export class XTransformer extends BaseTransformer<XInboundItem, NormalizedData[]> {
  async transform(item: XInboundItem, source?: ExternalSource): Promise<ParseResult<NormalizedData[]>> {
    if (!source) return { success: false, error: 'Missing source for X transform' };
    if (item?.kind === 'xchat') {
      const items = await decryptXChatPayload(item.payload, source);
      return { success: true, data: items.map((i) => transformXInbound(i, source)) };
    }
    if (item?.kind !== 'post' && item?.kind !== 'dm') return { success: false, error: 'Invalid X inbound item' };
    // Polled XChat messages carry ids only; resolve the handle so the ticket shows @customer.
    if (item.kind === 'dm' && !item.sender) item = { ...item, sender: await lookupSender(source, item.senderId) };
    return { success: true, data: [transformXInbound(item, source)] };
  }
}
