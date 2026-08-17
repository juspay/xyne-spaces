/**
 * Messages Operation Registry
 *
 * Individual messages within a thread, plus the two deferred-send surfaces:
 * drafts (saved, sent manually) and delayed messages (scheduled for a time).
 *
 * To start a *new* thread use `sdk.conversations.create` — `messages.send` here
 * replies into an existing one.
 */

import { query, mutator } from './types.js';
import { newId, now } from '../core/ids.js';
import type { Message, MessageType } from '../types/index.js';

/** Page cursor for the user's sent-message history. */
export interface MessageCursor {
  messageId: string;
  createdAt: number;
}

export const messagesOperations = {
  // ----- Reads -----

  /**
   * All messages in a thread, oldest first.
   * Maps to: Zero query 'conversationMessagesV2'
   */
  listByConversation: query<{ conversationId: string }, Message[]>('conversationMessagesV2'),

  /**
   * Messages by id.
   * Maps to: Zero query 'messagesByIds'
   */
  getMany: query<{ messageIds: string[] }, Message[]>('messagesByIds'),

  /**
   * One message with the context an activity entry needs to render.
   * Maps to: Zero query 'getMessageForActivityV2'
   */
  get: query<{ messageId: string }, Message | null>('getMessageForActivityV2'),

  /**
   * Top-level channel messages together with thread replies promoted into the
   * channel via "also send to channel".
   * Maps to: Zero query 'channelAndThreadMessagesV2'
   */
  listByChannel: query<{ channelId: string }, Message[]>('channelAndThreadMessagesV2'),

  /**
   * The current user's own sent messages, newest first.
   * Maps to: Zero query 'userSentMessagesPaginated'
   */
  listMine: query<{ limit?: number; start?: MessageCursor }, Message[]>(
    'userSentMessagesPaginated',
    {
      mapArgs: (args) => ({
        limit: args.limit ?? 50,
        start: args.start ?? null,
      }),
    }
  ),

  /**
   * Messages authored by a given user, newest first.
   * Maps to: Zero query 'messagesBySenderPaginated'
   *
   * Use this rather than searching with `from=<userId>` when building someone's
   * authored history: search is relevance-ranked with a practical offset ceiling, so
   * a thin page cannot be distinguished from a truncated one. This is ordered by
   * `createdAt` and cursors cleanly.
   */
  listByUser: query<
    {
      userId: string;
      limit?: number;
      start?: MessageCursor;
      /** Inclusive epoch-ms lower bound. */
      after?: number;
      /** Inclusive epoch-ms upper bound. */
      before?: number;
    },
    Message[]
  >('messagesBySenderPaginated', {
    mapArgs: (args) => ({
      userId: args.userId,
      limit: args.limit ?? 50,
      start: args.start ?? null,
      ...(args.after !== undefined ? { after: args.after } : {}),
      ...(args.before !== undefined ? { before: args.before } : {}),
    }),
  }),

  /**
   * The latest message in a channel.
   * Maps to: Zero query 'channelLatestMessageV2'
   */
  getLatestInChannel: query<{ channelId: string }, Message | null>('channelLatestMessageV2'),

  /**
   * Nudges attached to a message.
   * Maps to: Zero query 'messageNudges'
   */
  listNudges: query<{ messageId: string; states?: string[] }, unknown[]>('messageNudges'),

  // ----- Writes -----

  /**
   * Reply into an existing thread.
   *
   * `showInChannel` also surfaces the reply in the parent channel; when set, the
   * mutator needs a child conversation id, which is generated here.
   * Maps to: Zero mutator 'messages.send'
   */
  send: mutator<
    {
      messageId: string;
      conversationId: string;
      content: string;
      type?: MessageType;
      showInChannel?: boolean;
      attachmentIds?: string[];
    },
    void
  >('messages.send', {
    mapArgs: (args) => ({
      conversationId: args.conversationId,
      content: args.content,
      type: args.type ?? 'USER',
      messageId: args.messageId,
      timestamp: now(),
      ...(args.showInChannel !== undefined
        ? { showInChannel: args.showInChannel, childConversationId: newId() }
        : {}),
      ...(args.attachmentIds ? { attachmentIds: args.attachmentIds } : {}),
    }),
  }),

  /**
   * Edit a message's content.
   * Maps to: Zero mutator 'messages.update'
   */
  update: mutator<{ messageId: string; content: string }, void>('messages.update'),

  /**
   * Delete a message.
   * Maps to: Zero mutator 'messages.delete'
   */
  delete: mutator<{ messageId: string }, void>('messages.delete'),

  /**
   * Add or remove an emoji reaction.
   * Maps to: Zero mutator 'messages.react'
   */
  react: mutator<
    { messageId: string; emojiName: string; action: 'add' | 'remove' },
    void
  >('messages.react', {
    mapArgs: (args) => ({
      messageId: args.messageId,
      emojiName: args.emojiName,
      action: args.action,
      timestamp: now(),
      // Only meaningful when adding; harmless on remove, where the server
      // resolves the existing rows by (message, user, emoji).
      reactionId: newId(),
      countId: newId(),
    }),
  }),

  /**
   * Show or hide a thread reply in its parent channel.
   * Maps to: Zero mutator 'messages.updateShowInChannel'
   */
  setShowInChannel: mutator<{ messageId: string; showInChannel: boolean }, void>(
    'messages.updateShowInChannel',
    {
      mapArgs: (args) => ({
        messageId: args.messageId,
        showInChannel: args.showInChannel,
        childConversationId: newId(),
        timestamp: now(),
      }),
    }
  ),

  /**
   * Remove an attachment from a message.
   * Maps to: Zero mutator 'messageAttachment.delete'
   */
  deleteAttachment: mutator<{ attachmentId: string }, void>('messageAttachment.delete'),

  /**
   * Remove several attachments at once.
   * Maps to: Zero mutator 'messageAttachment.deleteMany'
   */
  deleteAttachments: mutator<{ attachmentIds: string[] }, void>(
    'messageAttachment.deleteMany'
  ),

  // ----- Drafts -----

  /**
   * The current user's saved drafts.
   * Maps to: Zero query 'userDrafts'
   */
  listDrafts: query<{ limit?: number }, unknown[]>('userDrafts', {
    mapArgs: (args) => ({ limit: args?.limit ?? 50 }),
  }),

  /**
   * Edit a draft's content.
   * Maps to: Zero mutator 'draftMessages.edit'
   */
  editDraft: mutator<{ id: string; content: string }, void>('draftMessages.edit', {
    mapArgs: (args) => ({ id: args.id, content: args.content, timestamp: now() }),
  }),

  /**
   * Send a saved draft now.
   * Maps to: Zero mutator 'draftMessages.send'
   */
  sendDraft: mutator<{ id: string }, void>('draftMessages.send', {
    mapArgs: (args) => ({ id: args.id, timestamp: now() }),
  }),

  /**
   * Discard a draft.
   * Maps to: Zero mutator 'draftMessages.delete'
   */
  deleteDraft: mutator<{ id: string }, void>('draftMessages.delete'),

  // ----- Delayed (scheduled) messages -----

  /**
   * The current user's scheduled messages.
   * Maps to: Zero query 'userDelayedMessages'
   */
  listScheduled: query<void, unknown[]>('userDelayedMessages'),

  /**
   * Schedule a message for a future time.
   * Maps to: Zero mutator 'delayedMessages.create'
   */
  schedule: mutator<
    {
      id: string;
      channelId: string;
      content: string;
      scheduledFor: number;
      conversationId?: string;
    },
    void
  >('delayedMessages.create', {
    mapArgs: (args) => ({
      id: args.id,
      channelId: args.channelId,
      content: args.content,
      scheduledFor: args.scheduledFor,
      ...(args.conversationId ? { conversationId: args.conversationId } : {}),
      timestamp: now(),
    }),
  }),

  /**
   * Cancel a scheduled message.
   * Maps to: Zero mutator 'delayedMessages.cancel'
   */
  cancelScheduled: mutator<{ id: string }, void>('delayedMessages.cancel', {
    mapArgs: (args) => ({ id: args.id, timestamp: now() }),
  }),

  /**
   * Change when a scheduled message will send.
   * Maps to: Zero mutator 'delayedMessages.reschedule'
   */
  reschedule: mutator<{ id: string; scheduledFor: number }, void>(
    'delayedMessages.reschedule',
    {
      mapArgs: (args) => ({
        id: args.id,
        scheduledFor: args.scheduledFor,
        timestamp: now(),
      }),
    }
  ),

  /**
   * Edit a scheduled message's content.
   * Maps to: Zero mutator 'delayedMessages.edit'
   */
  editScheduled: mutator<{ id: string; content: string }, void>('delayedMessages.edit', {
    mapArgs: (args) => ({ id: args.id, content: args.content, updatedAt: now() }),
  }),

  /**
   * Send a scheduled message immediately.
   * Maps to: Zero mutator 'delayedMessages.sendNow'
   */
  sendScheduledNow: mutator<{ id: string }, void>('delayedMessages.sendNow', {
    mapArgs: (args) => ({ id: args.id, timestamp: now() }),
  }),

  /**
   * Turn a scheduled message back into an editable draft.
   * Maps to: Zero mutator 'delayedMessages.convertToDraft'
   */
  scheduledToDraft: mutator<{ id: string }, void>('delayedMessages.convertToDraft', {
    mapArgs: (args) => ({ id: args.id, timestamp: now() }),
  }),
  /**
   * Attachments by id.
   * Maps to: Zero query 'attachmentsByIds'
   */
  getAttachments: query<{ attachmentIds: string[] }, unknown[]>('attachmentsByIds'),

  /**
   * Attachments on the message that started a thread.
   * Maps to: Zero query 'attachmentsByInitialMessage'
   */
  listAttachmentsForThread: query<{ initialMessageId: string }, unknown[]>(
    'attachmentsByInitialMessage'
  ),

  /**
   * Every attachment shared in a channel, newest first.
   * Maps to: Zero query 'getConversationAttachementsV2'
   *
   * V2 takes identical arguments; it moves channel-visibility gating out of the
   * query body and onto the table ACL, so this is a drop-in swap.
   *
   * `direction` is required server-side. It was previously never sent, which made
   * every call fail validation — the coverage gate only checks mutator arguments,
   * so nothing caught it.
   */
  listChannelAttachments: query<
    {
      channelId: string;
      limit?: number;
      start?: { attachementId: string; createdAt: number };
      direction?: 'forward' | 'backward';
    },
    unknown[]
  >('getConversationAttachementsV2', {
    mapArgs: (args) => ({
      channelId: args.channelId,
      limit: args.limit ?? 50,
      start: args.start ?? null,
      direction: args.direction ?? 'forward',
    }),
  }),

  /**
   * Scheduled messages, a page at a time, optionally filtered by status.
   * Maps to: Zero query 'userDelayedMessagesPaginated'
   */
  listScheduledPaginated: query<
    { limit?: number; statuses?: string[]; start?: { id: string; scheduledFor: number } },
    unknown[]
  >('userDelayedMessagesPaginated', {
    mapArgs: (args) => ({
      limit: args.limit ?? 50,
      ...(args.statuses ? { statuses: args.statuses } : {}),
      start: args.start ?? null,
    }),
  }),

  /**
   * Attach files to a draft.
   * Maps to: Zero mutator 'draft.createAttachments'
   */
  addDraftAttachments: mutator<
    {
      draftMessageId: string;
      channelId: string;
      attachments: Array<{
        attachmentId: string;
        originalFilename: string;
        mimetype: string;
        size: number;
        width?: number;
        height?: number;
      }>;
      conversationId?: string;
    },
    void
  >('draft.createAttachments', {
    // timestamp is required and was never sent.
    mapArgs: (args) => ({ ...args, timestamp: now() }),
  }),

  /**
   * Clear a channel or thread draft's content.
   * Maps to: Zero mutator 'draft.clearContent'
   */
  clearDraft: mutator<{ channelId: string; conversationId?: string }, void>(
    'draft.clearContent',
    {
      mapArgs: (args) => ({ ...args, timestamp: now() }),
    }
  ),

  /**
   * Resolve a mention of someone who is not in the channel: add them, add
   * everyone mentioned, or ignore.
   * Maps to: Zero mutator 'messages.handleNonParticipantAction'
   */
  handleNonParticipants: mutator<
    {
      messageId: string;
      channelId: string;
      userIds: string[];
      action: 'add' | 'add_all' | 'ignore' | 'ignore_all';
    },
    void
  >('messages.handleNonParticipantAction'),
} as const;
