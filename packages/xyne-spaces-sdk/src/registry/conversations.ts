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

import { query, mutator } from './types.js';
import { newId, now } from '../core/ids.js';
import type {
  Conversation,
  ConversationParticipant,
  Message,
  MessageType,
} from '../types/index.js';

/** Page cursor for the paginated thread listings. */
export interface ConversationCursor {
  conversationId: string;
  lastActivityAt: number;
}

export const conversationsOperations = {
  // ----- Reads -----

  /**
   * Threads in a channel, newest activity first, paginated.
   * Maps to: Zero query 'channelConversationsPaginatedV3'
   */
  listByChannel: query<
    { channelId: string; limit?: number; start?: ConversationCursor; isMember?: boolean },
    Conversation[]
  >('channelConversationsPaginatedV3', {
    mapArgs: (args) => ({
      channelId: args.channelId,
      isMember: args.isMember ?? true,
      limit: args.limit ?? 50,
      start: args.start ?? null,
    }),
  }),

  /**
   * The most recent threads in a channel, without paging.
   * Maps to: Zero query 'channelLatestMultipleConversationsV3'
   */
  listLatestByChannel: query<
    { channelId: string; limit?: number; isMember?: boolean },
    Conversation[]
  >('channelLatestMultipleConversationsV3', {
    mapArgs: (args) => ({
      channelId: args.channelId,
      isMember: args.isMember ?? true,
      limit: args.limit ?? 20,
    }),
  }),

  /**
   * One thread by id.
   * Maps to: Zero query 'getConversationById'
   */
  get: query<{ conversationId: string }, Conversation | null>('getConversationById'),

  /**
   * A thread plus its channel, for rendering a thread view cold.
   * Maps to: Zero query 'getConversationByIdWithChannel'
   */
  getWithChannel: query<
    { conversationId: string; channelId: string; isMember?: boolean },
    Conversation | null
  >('getConversationByIdWithChannel', {
    mapArgs: (args) => ({
      conversationId: args.conversationId,
      channelId: args.channelId,
      isMember: args.isMember ?? true,
    }),
  }),

  /**
   * A thread with its replies resolved.
   * Maps to: Zero query 'threadConversationV2'
   */
  getThread: query<
    { conversationId: string; channelId?: string; isMember?: boolean },
    Conversation | null
  >('threadConversationV2', {
    mapArgs: (args) => ({
      conversationId: args.conversationId,
      ...(args.channelId ? { channelId: args.channelId } : {}),
      isMember: args.isMember ?? true,
    }),
  }),

  /**
   * The thread attached to a call.
   * Maps to: Zero query 'getConversationByCallId'
   */
  getByCallId: query<{ callId: string }, Conversation | null>('getConversationByCallId'),

  /**
   * Participants of a thread, including their subscription state.
   * Maps to: Zero query 'conversationParticipantByConversationId'
   */
  listParticipants: query<{ conversationId: string }, ConversationParticipant[]>(
    'conversationParticipantByConversationId'
  ),

  /**
   * Pinned threads in a channel.
   * Maps to: Zero query 'getPinnedMessegesV2'
   */
  listPinned: query<{ channelId: string; isMember?: boolean }, Conversation[]>(
    'getPinnedMessegesV2',
    {
      mapArgs: (args) => ({
        channelId: args.channelId,
        isMember: args.isMember ?? true,
      }),
    }
  ),

  /**
   * The single most recent thread in a channel.
   * Maps to: Zero query 'channelLatestConversation'
   */
  getLatest: query<{ channelId: string; isMember?: boolean }, Conversation | null>(
    'channelLatestConversation',
    {
      mapArgs: (args) => ({
        channelId: args.channelId,
        isMember: args.isMember ?? true,
      }),
    }
  ),

  /**
   * Labels defined for a channel.
   * Maps to: Zero query 'conversationLabelsByChannelId'
   */
  listLabels: query<{ channelId: string }, unknown[]>('conversationLabelsByChannelId'),

  /**
   * Labels applied to a thread.
   * Maps to: Zero query 'conversationLabelMappingsByConversationId'
   */
  listAppliedLabels: query<{ conversationId: string }, unknown[]>(
    'conversationLabelMappingsByConversationId'
  ),

  // ----- Writes -----

  /**
   * Start a new thread in a channel by posting its first message.
   *
   * Both the thread id and the message id are supplied by the caller so the
   * resource method can return them.
   * Maps to: Zero mutator 'conversations.send'
   */
  create: mutator<
    {
      conversationId: string;
      messageId: string;
      channelId: string;
      content: string;
      type?: MessageType;
      attachmentIds?: string[];
    },
    void
  >('conversations.send', {
    mapArgs: (args) => ({
      channelId: args.channelId,
      content: args.content,
      type: args.type ?? 'USER',
      conversationId: args.conversationId,
      messageId: args.messageId,
      timestamp: now(),
      ...(args.attachmentIds ? { attachmentIds: args.attachmentIds } : {}),
    }),
  }),

  /**
   * Pin or unpin a thread. Toggles; there is no explicit target state.
   * Maps to: Zero mutator 'conversations.togglePin'
   */
  togglePin: mutator<{ conversationId: string }, void>('conversations.togglePin'),

  /**
   * Forward a message into another channel as a new thread.
   * Maps to: Zero mutator 'conversations.forwardMessage'
   */
  forwardMessage: mutator<
    {
      conversationId: string;
      messageId: string;
      targetChannelId: string;
      originalMessageId: string;
      optionalMessage?: string;
    },
    void
  >('conversations.forwardMessage', {
    mapArgs: (args) => ({
      targetChannelId: args.targetChannelId,
      originalMessageId: args.originalMessageId,
      ...(args.optionalMessage ? { optionalMessage: args.optionalMessage } : {}),
      conversationId: args.conversationId,
      messageId: args.messageId,
      timestamp: now(),
      conversationParticipantId: newId(),
    }),
  }),

  /**
   * Subscribe to a thread's replies.
   * Maps to: Zero mutator 'conversations.subscribeToConversation'
   */
  subscribe: mutator<{ conversationId: string }, void>(
    'conversations.subscribeToConversation',
    {
      mapArgs: (args) => ({
        conversationId: args.conversationId,
        timestamp: now(),
        participantId: newId(),
      }),
    }
  ),

  /**
   * Unsubscribe from a thread.
   * Maps to: Zero mutator 'conversations.unsubscribeFromConversation'
   */
  unsubscribe: mutator<{ conversationId: string }, void>(
    'conversations.unsubscribeFromConversation'
  ),

  /**
   * Mark a thread unread starting at a given message.
   * Maps to: Zero mutator 'conversation.markThreadUnreadFrom'
   */
  markUnreadFrom: mutator<{ conversationId: string; messageId: string }, void>(
    'conversation.markThreadUnreadFrom',
    {
      mapArgs: (args) => ({
        conversationId: args.conversationId,
        messageId: args.messageId,
        participantId: newId(),
        timestamp: now(),
      }),
    }
  ),
} as const;

export type { Message };
