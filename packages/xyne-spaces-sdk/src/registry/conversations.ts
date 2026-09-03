/**
 * Conversations Operation Registry
 *
 * A conversation is a thread: it owns an initial message and its replies. Most
 * channel reads go through this registry rather than the channel one, because
 * the channel surface is a list of threads.
 *
 * Note the `isMember` argument on several queries. It is not a filter — it is a
 * hint that selects a cheaper ACL path when the caller is known to be a channel
 * member. Passing `true` when you are not a member is safe (the row-level ACL
 * still applies and you get nothing back), so it defaults to `true`.
 */

import { op, api } from './types.js';
import { appendFiles, appendOptional } from '../core/form-data.js';
import type {
  Conversation,
  ConversationLabel,
  ConversationLabelMapping,
  ConversationParticipant,
  CreateConversationWithAttachmentsInput,
  Message,
  MessageType,
} from '../types/index.js';

/** Page cursor for the paginated thread listings. */
export interface ConversationCursor {
  conversationId: string;
  lastActivityAt: number;
}

export const conversationsOperations = {
  // ----- Direct API operations -----

  /**
   * Start a thread while uploading file bytes in the same request.
   */
  createWithAttachments: api<
    CreateConversationWithAttachmentsInput,
    { conversationId: string; messageId: string }
  >(
    'POST',
    (args) => `/api/sdk/v1/channels/${encodeURIComponent(args.channelId)}/conversations`,
    {
      mapArgs: (args) => {
        const form = new FormData();
        appendOptional(form, 'content', args.content);
        appendOptional(form, 'msgType', args.msgType);
        appendOptional(form, 'visibleTo', args.visibleTo);
        appendFiles(form, args.files, { includeThumbnails: true });
        return form;
      },
      mapResult: (raw) => {
        const result = raw as {
          conversationId: string;
          messageId?: string;
          initialMessage?: { messageId: string };
        };
        const messageId = result.initialMessage?.messageId ?? result.messageId;
        if (!messageId) throw new Error('Conversation response did not include a message id');
        return {
          conversationId: result.conversationId,
          messageId,
        };
      },
    }
  ),

  // ----- Reads -----

  /**
   * Threads in a channel, newest activity first, paginated.
   */
  listByChannel: op<{
      channelId: string;
      limit?: number;
      start?: ConversationCursor;
      isMember?: boolean;
      /** Page direction relative to `start`. Required server-side. */
      direction?: 'forward' | 'backward';
    }, Conversation[]>('conversations.listByChannel', 'query'),

  /**
   * The most recent threads in a channel, without paging.
   */
  listLatestByChannel: op<{ channelId: string; limit?: number; isMember?: boolean }, Conversation[]>('conversations.listLatestByChannel', 'query'),

  /**
   * One thread by id.
   */
  get: op<{ conversationId: string }, Conversation | null>('conversations.get', 'query'),

  /**
   * A thread plus its channel, for rendering a thread view cold.
   */
  getWithChannel: op<{ conversationId: string; channelId: string; isMember?: boolean }, Conversation | null>('conversations.getWithChannel', 'query'),

  /**
   * A thread with its replies resolved.
   */
  getThread: op<{ conversationId: string; channelId?: string; isMember?: boolean }, Conversation | null>('conversations.getThread', 'query'),

  /**
   * The thread attached to a call.
   */
  getByCallId: op<{ callId: string }, Conversation | null>('conversations.getByCallId', 'query'),

  /**
   * The **caller's own** participation in a thread, including subscription state.
   *
   * Despite the query's name, this is one row, not a list: it filters on
   * `ctx.userID` and ends in `.one()`. The catalog has no query that returns every
   * participant of a thread. This was declared `ConversationParticipant[]`, so a
   * caller iterating the result got a `TypeError` on a plain object.
   */
  getMyParticipation: op<{ conversationId: string }, ConversationParticipant | null>('conversations.getMyParticipation', 'query'),

  /**
   * Pinned threads in a channel.
   */
  listPinned: op<{ channelId: string; isMember?: boolean }, Conversation[]>('conversations.listPinned', 'query'),

  /**
   * The single most recent thread in a channel.
   */
  getLatest: op<{ channelId: string; isMember?: boolean }, Conversation | null>('conversations.getLatest', 'query'),

  /**
   * Labels defined for a channel.
   *
   * `isMember` is required by the schema but unread by the query body — it is
   * a hint to Zero's ACL layer, and is supplied here so a caller does not have
   * to know that.
   */
  listLabels: op<{ channelId: string }, ConversationLabel[]>('conversations.listLabels', 'query'),

  /**
   * Labels applied to a thread.
   *
   * The V2 query takes the owning `channelId` as well, for the same ACL reason
   * as {@link listLabels}, so callers must now pass it.
   */
  listAppliedLabels: op<{ conversationId: string; channelId: string }, ConversationLabelMapping[]>('conversations.listAppliedLabels', 'query'),

  // ----- Writes -----

  /**
   * Start a new thread in a channel by posting its first message.
   *
   * Both the thread id and the message id are supplied by the caller so the
   * resource method can return them.
   */
  create: op<{
      conversationId: string;
      messageId: string;
      channelId: string;
      content: string;
      type?: MessageType;
      attachmentIds?: string[];
    }, void>('conversations.create', 'mutator'),

  /**
   * Pin or unpin a thread. Toggles; there is no explicit target state.
   */
  togglePin: op<{ conversationId: string }, void>('conversations.togglePin', 'mutator'),

  /**
   * Forward a message into another channel as a new thread.
   */
  forwardMessage: op<{
      conversationId: string;
      messageId: string;
      targetChannelId: string;
      originalMessageId: string;
      optionalMessage?: string;
    }, void>('conversations.forwardMessage', 'mutator'),

  /**
   * Subscribe to a thread's replies.
   */
  subscribe: op<{ conversationId: string }, void>('conversations.subscribe', 'mutator'),

  /**
   * Unsubscribe from a thread.
   */
  unsubscribe: op<{ conversationId: string }, void>('conversations.unsubscribe', 'mutator'),

  /**
   * Mark a thread unread starting at a given message.
   */
  markUnreadFrom: op<{ conversationId: string; messageId: string }, void>('conversations.markUnreadFrom', 'mutator'),
  /**
   * The thread nearest a point in time — used to jump to a date in a channel.
   */
  getByTimestamp: op<{ channelId: string; timestamp: number; isMember?: boolean }, Conversation | null>('conversations.getByTimestamp', 'query'),

  /**
   * Threads a user takes part in across every channel, most recent reply first.
   */
  listForUser: op<{ userId: string; limit?: number; start?: { lastReplyAt: number; id: string } }, Conversation[]>('conversations.listForUser', 'query'),

  /**
   * Set the tag types on a thread. Free-form: projects define their own beyond
   * the built-in vocabulary.
   */
  setTagTypes: op<{ conversationId: string; types: string[]; note?: string }, void>('conversations.setTagTypes', 'mutator'),
} as const;

export type { Message };
