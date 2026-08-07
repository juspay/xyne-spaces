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
} as const;
