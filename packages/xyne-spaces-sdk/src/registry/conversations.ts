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

import { api, query, mutator } from './types.js';
import { newId, now } from '../core/ids.js';
import { appendFiles, appendOptional } from '../core/form-data.js';
import type {
  Conversation,
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
   * Maps to: POST /api/v1/channels/:channelId/conversations
   */
  createWithAttachments: api<
    CreateConversationWithAttachmentsInput,
    { conversationId: string; messageId: string }
  >(
    'POST',
    (args) => `/api/v1/channels/${encodeURIComponent(args.channelId)}/conversations`,
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
   * Maps to: Zero query 'channelConversationsPaginatedV3'
   */
  listByChannel: query<
    {
      channelId: string;
      limit?: number;
      start?: ConversationCursor;
      isMember?: boolean;
      /** Page direction relative to `start`. Required server-side. */
      direction?: 'forward' | 'backward';
    },
    Conversation[]
  >('channelConversationsPaginatedV3', {
    mapArgs: (args) => ({
      channelId: args.channelId,
      isMember: args.isMember ?? true,
      limit: args.limit ?? 50,
      start: args.start ?? null,
      direction: args.direction ?? 'forward',
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
  /**
   * The thread nearest a point in time — used to jump to a date in a channel.
   * Maps to: Zero query 'getConversationByTimestamp'
   */
  getByTimestamp: query<
    { channelId: string; timestamp: number; isMember?: boolean },
    Conversation | null
  >('getConversationByTimestamp', {
    mapArgs: (args) => ({
      channelId: args.channelId,
      timestamp: args.timestamp,
      isMember: args.isMember ?? true,
    }),
  }),

  /**
   * Threads a user takes part in across every channel, most recent reply first.
   * Maps to: Zero query 'userConversationsPaginatedV2'
   */
  listForUser: query<
    { userId: string; limit?: number; start?: { lastReplyAt: number; id: string } },
    Conversation[]
  >('userConversationsPaginatedV2', {
    mapArgs: (args) => ({
      userId: args.userId,
      limit: args.limit ?? 50,
      start: args.start ?? null,
    }),
  }),

  /**
   * Set the tag types on a thread. Free-form: projects define their own beyond
   * the built-in vocabulary.
   * Maps to: Zero mutator 'threadTag.setTypes'
   */
  setTagTypes: mutator<{ conversationId: string; types: string[] }, void>(
    'threadTag.setTypes'
  ),
} as const;

export type { Message };
