/**
 * Messages Operation Registry
 *
 * Individual messages within a thread, plus the two deferred-send surfaces:
 * drafts (saved, sent manually) and delayed messages (scheduled for a time).
 *
 * To start a *new* thread use `sdk.conversations.create` — `messages.send` here
 * replies into an existing one.
 */

import { op, api } from './types.js';
import type {
  DelayedMessage,
  DelayedMessageStatus,
  DraftMessage,
  Message,
  MessageAttachment,
  MessageType,
  Nudge,
  NudgeState,
} from '../types/index.js';

/** Page cursor for the user's sent-message history. */
export interface MessageCursor {
  messageId: string;
  createdAt: number;
}

export const messagesOperations = {
  // ----- Reads -----

  /**
   * All messages in a thread, oldest first.
   */
  listByConversation: op<{ conversationId: string }, Message[]>('messages.listByConversation', 'query'),

  /**
   * Messages by id.
   */
  getMany: op<{ messageIds: string[] }, Message[]>('messages.getMany', 'query'),

  /**
   * One message with the context an activity entry needs to render.
   */
  get: op<{ messageId: string }, Message | null>('messages.get', 'query'),

  /**
   * Top-level channel messages together with thread replies promoted into the
   * channel via "also send to channel".
   */
  listByChannel: op<{ channelId: string }, Message[]>('messages.listByChannel', 'query'),

  /**
   * The current user's own sent messages, newest first.
   */
  listMine: op<{ limit?: number; start?: MessageCursor }, Message[]>('messages.listMine', 'query'),

  /**
   * Messages authored by a given user, newest first (via Vespa search).
   *
   * Uses Vespa search under the hood, similar to cmd+k's `from:@xyz` filter.
   * Results are ordered by newest first. Uses offset-based pagination.
   */
  listByUser: api<
    {
      userId: string;
      limit?: number;
      offset?: number;
      /** Inclusive epoch-ms lower bound. */
      after?: number;
      /** Inclusive epoch-ms upper bound. */
      before?: number;
    },
    Message[]
  >('GET', '/api/sdk/v1/search', {
    mapArgs: (args) => ({
      q: '', // Empty query for filter-only search
      from: args.userId,
      type: 'messages',
      orderBy: 'newest',
      limit: args.limit ?? 50,
      offset: args.offset ?? 0,
      // Convert epoch-ms to ISO date format for search
      ...(args.after !== undefined
        ? { after: new Date(args.after).toISOString().split('T')[0] }
        : {}),
      ...(args.before !== undefined
        ? { before: new Date(args.before).toISOString().split('T')[0] }
        : {}),
    }),
    mapResult: (raw: unknown): Message[] => {
      // The SDK search endpoint returns a different format than the standard search
      const response = raw as {
        results: Array<{
          id: string;
          context: string;
          searchContext: {
            messageId: string;
            conversationId: string;
            channelId: string;
            senderId: string;
            msgType: string;
            createdAtTimestamp: number;
          };
        }>;
      };
      return response.results.map((r) => ({
        messageId: r.searchContext?.messageId ?? r.id,
        conversationId: r.searchContext?.conversationId ?? '',
        childConversationId: null,
        senderId: r.searchContext?.senderId ?? '',
        workspaceId: '',
        content: r.context ?? '',
        msgType: (r.searchContext?.msgType ?? 'USER') as Message['msgType'],
        hasAttachment: false,
        edited: false,
        isDeleted: false,
        showInChannel: false,
        visibleTo: null,
        isSent: true,
        nudgeCount: null,
        metadata: {},
        createdAt: r.searchContext?.createdAtTimestamp ?? 0,
      }));
    },
  }),

  /**
   * The latest message in a channel.
   */
  getLatestInChannel: op<{ channelId: string }, Message | null>('messages.getLatestInChannel', 'query'),

  /**
   * Nudges attached to a message.
   */
  listNudges: op<{ messageId: string; states?: NudgeState[] }, Nudge[]>('messages.listNudges', 'query'),

  // ----- Writes -----

  /**
   * Reply into an existing thread.
   *
   * `showInChannel` also surfaces the reply in the parent channel; when set, the
   * mutator needs a child conversation id, which is generated here.
   */
  send: op<{
      messageId: string;
      conversationId: string;
      content: string;
      type?: MessageType;
      showInChannel?: boolean;
      attachmentIds?: string[];
    }, void>('messages.send', 'mutator'),

  /**
   * Edit a message's content.
   */
  update: op<{ messageId: string; content: string }, void>('messages.update', 'mutator'),

  /**
   * Delete a message.
   */
  delete: op<{ messageId: string }, void>('messages.delete', 'mutator'),

  /**
   * Add or remove an emoji reaction.
   */
  react: op<{ messageId: string; emojiName: string; action: 'add' | 'remove' }, void>('messages.react', 'mutator'),

  /**
   * Show or hide a thread reply in its parent channel.
   */
  setShowInChannel: op<{ messageId: string; showInChannel: boolean }, void>('messages.setShowInChannel', 'mutator'),

  /**
   * Close the incident artifact attached to a slash-command message.
   *
   * Only the message's author may close it, and only while the artifact is
   * still ACTIVE — a second call is refused. `timestamp` is stamped here and
   * is what the closed artifact records as its close time.
   */
  closeSlashCommandArtifact: op<{ messageId: string }, void>('messages.closeSlashCommandArtifact', 'mutator'),

  /**
   * Remove an attachment from a message.
   */
  deleteAttachment: op<{ attachmentId: string }, void>('messages.deleteAttachment', 'mutator'),

  /**
   * Remove several attachments at once.
   */
  deleteAttachments: op<{ attachmentIds: string[] }, void>('messages.deleteAttachments', 'mutator'),

  // ----- Drafts -----

  /**
   * The current user's saved drafts.
   */
  listDrafts: op<{ limit?: number }, DraftMessage[]>('messages.listDrafts', 'query'),

  /**
   * Edit a draft's content.
   */
  editDraft: op<{ id: string; content: string }, void>('messages.editDraft', 'mutator'),

  /**
   * Send a saved draft now.
   */
  sendDraft: op<{ id: string }, void>('messages.sendDraft', 'mutator'),

  /**
   * Discard a draft.
   */
  deleteDraft: op<{ id: string }, void>('messages.deleteDraft', 'mutator'),

  // ----- Delayed (scheduled) messages -----

  /**
   * The current user's scheduled messages.
   */
  listScheduled: op<void, DelayedMessage[]>('messages.listScheduled', 'query'),

  /**
   * Schedule a message for a future time.
   */
  schedule: op<{
      id: string;
      channelId: string;
      content: string;
      scheduledFor: number;
      conversationId?: string;
    }, void>('messages.schedule', 'mutator'),

  /**
   * Cancel a scheduled message.
   */
  cancelScheduled: op<{ id: string }, void>('messages.cancelScheduled', 'mutator'),

  /**
   * Change when a scheduled message will send.
   */
  reschedule: op<{ id: string; scheduledFor: number }, void>('messages.reschedule', 'mutator'),

  /**
   * Edit a scheduled message's content.
   */
  editScheduled: op<{ id: string; content: string }, void>('messages.editScheduled', 'mutator'),

  /**
   * Send a scheduled message immediately.
   */
  sendScheduledNow: op<{ id: string }, void>('messages.sendScheduledNow', 'mutator'),

  /**
   * Turn a scheduled message back into an editable draft.
   */
  scheduledToDraft: op<{ id: string }, void>('messages.scheduledToDraft', 'mutator'),
  /**
   * Attachments by id.
   */
  getAttachments: op<{ attachmentIds: string[] }, MessageAttachment[]>('messages.getAttachments', 'query'),

  /**
   * Attachments on the message that started a thread.
   */
  listAttachmentsForThread: op<{ initialMessageId: string }, MessageAttachment[]>('messages.listAttachmentsForThread', 'query'),

  /**
   * Every attachment shared in a channel, newest first.
   *
   * V2 takes identical arguments; it moves channel-visibility gating out of the
   * query body and onto the table ACL, so this is a drop-in swap.
   *
   * `direction` is required server-side. It was previously never sent, which made
   * every call fail validation — the coverage gate only checks mutator arguments,
   * so nothing caught it.
   */
  listChannelAttachments: op<{
      channelId: string;
      limit?: number;
      start?: { attachementId: string; createdAt: number };
      direction?: 'forward' | 'backward';
    }, MessageAttachment[]>('messages.listChannelAttachments', 'query'),

  /**
   * Scheduled messages, a page at a time, optionally filtered by status.
   */
  listScheduledPaginated: op<{ limit?: number; statuses?: DelayedMessageStatus[]; start?: { id: string; scheduledFor: number } }, DelayedMessage[]>('messages.listScheduledPaginated', 'query'),

  /**
   * Attach files to a draft.
   */
  addDraftAttachments: op<{
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
    }, void>('messages.addDraftAttachments', 'mutator'),

  /**
   * Clear a channel or thread draft's content.
   */
  clearDraft: op<{ channelId: string; conversationId?: string }, void>('messages.clearDraft', 'mutator'),

  /**
   * Resolve a mention of someone who is not in the channel: add them, add
   * everyone mentioned, or ignore.
   */
  handleNonParticipants: op<{
      messageId: string;
      channelId: string;
      userIds: string[];
      action: 'add' | 'add_all' | 'ignore' | 'ignore_all';
    }, void>('messages.handleNonParticipants', 'mutator'),
} as const;
