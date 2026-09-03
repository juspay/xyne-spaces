/**
 * Messages Resource
 *
 * Reading and writing individual messages, plus drafts and scheduled sends.
 *
 * To start a new thread, use `sdk.conversations.create`. `send` here posts a
 * reply into a thread that already exists.
 */

import { Resource } from './base.js';
import { messagesOperations, type MessageCursor } from '../registry/messages.js';
import { newId } from '../core/ids.js';
import { paginate, type Page, type PageOptions } from '../core/paginate.js';
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

export class MessagesResource extends Resource {
  /**
   * List the messages in a thread, oldest first, one page at a time.
   *
   * `conversationMessagesV2` has no server-side cursor — it returns the whole
   * thread in one response — so this fetches that full result and windows it
   * before returning. The fetch itself is not cheaper for a long thread; what
   * this buys is that a caller processes one page rather than holding an
   * unbounded array. Defaults to the first 100 messages, which is also the cap.
   *
   * @param conversationId - Thread to read.
   * @param options.limit - Page size. Defaults to 100, which is also the maximum.
   * @param options.offset - Where the page starts.
   * @returns One page of messages, with `hasMore` and `nextOffset`.
   * @example
   * const page = await sdk.messages.listByConversation('conv-123');
   * console.log(page.items.length, page.hasMore);
   * const next = await sdk.messages.listByConversation('conv-123', { offset: page.nextOffset });
   */
  async listByConversation(conversationId: string, options?: PageOptions): Promise<Page<Message>> {
    const all = await this.call(messagesOperations.listByConversation, { conversationId });
    return paginate(all, options);
  }

  /**
   * Get several messages by id in one call.
   *
   * @param messageIds - Ids to fetch. Unknown ids are skipped.
   * @returns The messages that exist and are visible.
   * @example
   * const messages = await sdk.messages.getMany(['message-1', 'message-2']);
   */
  getMany(messageIds: string[]): Promise<Message[]> {
    return this.call(messagesOperations.getMany, { messageIds });
  }

  /**
   * Get a single message.
   *
   * @param messageId - Id of the message.
   * @returns The message, or `null` if it does not exist or is not visible.
   * @example
   * const message = await sdk.messages.get('message-1');
   */
  get(messageId: string): Promise<Message | null> {
    return this.call(messagesOperations.get, { messageId });
  }

  /**
   * List a channel's messages, including thread replies that were also sent to
   * the channel, one page at a time.
   *
   * Same shape as {@link listByConversation} and for the same reason:
   * `channelAndThreadMessagesV2` has no server-side cursor, so a busy channel's
   * full history comes back in one response and is windowed here.
   *
   * @param channelId - Channel to read.
   * @param options.limit - Page size. Defaults to 100, which is also the maximum.
   * @param options.offset - Where the page starts.
   * @returns One page of messages.
   * @example
   * const page = await sdk.messages.listByChannel('channel-1');
   */
  async listByChannel(channelId: string, options?: PageOptions): Promise<Page<Message>> {
    const all = await this.call(messagesOperations.listByChannel, { channelId });
    return paginate(all, options);
  }

  /**
   * List the caller's own sent messages, newest first.
   *
   * @param options.limit - Page size.
   * @param options.start - Cursor from the previous page.
   * @returns One page of their messages.
   * @example
   * const mine = await sdk.messages.listMine({ limit: 20 });
   */
  listMine(options?: { limit?: number; start?: MessageCursor }): Promise<Message[]> {
    return this.call(messagesOperations.listMine, options ?? {});
  }

  /**
   * List messages authored by a given user, newest first.
   *
   * Uses Vespa search under the hood, similar to cmd+k's `from:@xyz` filter.
   * Results are ordered by newest first and use offset-based pagination.
   *
   * Read ACL still applies — only messages in readable conversations come back.
   *
   * @param options.userId - Whose messages to list.
   * @param options.limit - Page size.
   * @param options.offset - Where the page starts.
   * @param options.after - Inclusive epoch-ms lower bound.
   * @param options.before - Inclusive epoch-ms upper bound.
   * @returns Their messages, newest first.
   * @example
   * const messages = await sdk.messages.listByUser({ userId: 'cms5x8t0t...' });
   *
   * // Pagination
   * const page1 = await sdk.messages.listByUser({ userId, limit: 50, offset: 0 });
   * const page2 = await sdk.messages.listByUser({ userId, limit: 50, offset: 50 });
   */
  listByUser(options: {
    userId: string;
    limit?: number;
    offset?: number;
    /** Inclusive epoch-ms lower bound. */
    after?: number;
    /** Inclusive epoch-ms upper bound. */
    before?: number;
  }): Promise<Message[]> {
    return this.call(messagesOperations.listByUser, options);
  }

  /**
   * Get the most recent message in a channel.
   *
   * @param channelId - Channel to read.
   * @returns The latest message, or `null` if the channel is empty.
   * @example
   * const latest = await sdk.messages.getLatestInChannel('channel-1');
   */
  getLatestInChannel(channelId: string): Promise<Message | null> {
    return this.call(messagesOperations.getLatestInChannel, { channelId });
  }

  /**
   * List nudges attached to a message.
   *
   * @param messageId - Message to read.
   * @param states - Restrict to these states. Defaults to active nudges only.
   * @returns Nudges surfaced against that message.
   * @example
   * const nudges = await sdk.messages.listNudges('message-1', ['ACTIVE']);
   */
  listNudges(messageId: string, states?: NudgeState[]): Promise<Nudge[]> {
    return this.call(messagesOperations.listNudges, { messageId, ...(states ? { states } : {}) });
  }

  /**
   * Reply into an existing thread.
   *
   * @param data.conversationId - Thread to reply in.
   * @param data.content - The message body.
   * @param data.type - Message type. Defaults to a normal user message.
   * @param data.showInChannel - Also surface this reply in the parent channel.
   * @param data.attachmentIds - Ids from `sdk.attachments.uploadDraft`.
   * @returns The new message's id.
   * @example
   * const { messageId } = await sdk.messages.send({
   *   conversationId: 'conv-123',
   *   content: 'On it.',
   * });
   */
  async send(data: {
    conversationId: string;
    content: string;
    type?: MessageType;
    showInChannel?: boolean;
    attachmentIds?: string[];
  }): Promise<{ messageId: string }> {
    const messageId = newId();
    await this.call(messagesOperations.send, { messageId, ...data });
    return { messageId };
  }

  /**
   * Edit a message's content.
   *
   * @param messageId - Message to edit.
   * @param content - The replacement body.
   * @example
   * await sdk.messages.update('message-1', 'Corrected.');
   */
  update(messageId: string, content: string): Promise<void> {
    return this.call(messagesOperations.update, { messageId, content });
  }

  /**
   * Delete a message.
   *
   * @param messageId - Message to delete.
   * @example
   * await sdk.messages.delete('message-1');
   */
  delete(messageId: string): Promise<void> {
    return this.call(messagesOperations.delete, { messageId });
  }

  /**
   * Add an emoji reaction to a message.
   *
   * @param messageId - Message to react to.
   * @param emojiName - The emoji's name, without colons, e.g. `thumbsup`.
   * @example
   * await sdk.messages.addReaction('message-1', 'thumbsup');
   */
  addReaction(messageId: string, emojiName: string): Promise<void> {
    return this.call(messagesOperations.react, { messageId, emojiName, action: 'add' });
  }

  /**
   * Remove the caller's emoji reaction.
   *
   * @param messageId - Message to unreact to.
   * @param emojiName - Short name of the emoji, without colons.
   * @example
   * await sdk.messages.removeReaction('message-1', 'thumbsup');
   */
  removeReaction(messageId: string, emojiName: string): Promise<void> {
    return this.call(messagesOperations.react, { messageId, emojiName, action: 'remove' });
  }

  /**
   * Show or hide a thread reply in its parent channel.
   *
   * @param messageId - Reply to change.
   * @param showInChannel - Whether it appears in the channel as well.
   * @example
   * await sdk.messages.setShowInChannel('message-1', true);
   */
  setShowInChannel(messageId: string, showInChannel: boolean): Promise<void> {
    return this.call(messagesOperations.setShowInChannel, { messageId, showInChannel });
  }

  /**
   * Close the incident artifact on a slash-command message.
   *
   * Author-only, and only once — closing an already-closed artifact is
   * refused by the server.
   *
   * @param messageId - Message carrying the artifact.
   * @example
   * await sdk.messages.closeSlashCommandArtifact('message-1');
   */
  closeSlashCommandArtifact(messageId: string): Promise<void> {
    return this.call(messagesOperations.closeSlashCommandArtifact, { messageId });
  }

  /**
   * Remove one attachment from a message.
   *
   * @param attachmentId - Attachment to remove.
   * @example
   * await sdk.messages.deleteAttachment('attachment-1');
   */
  deleteAttachment(attachmentId: string): Promise<void> {
    return this.call(messagesOperations.deleteAttachment, { attachmentId });
  }

  /**
   * Remove several attachments at once.
   *
   * @param attachmentIds - Attachments to remove.
   * @example
   * await sdk.messages.deleteAttachments(['attachment-1', 'attachment-2']);
   */
  deleteAttachments(attachmentIds: string[]): Promise<void> {
    return this.call(messagesOperations.deleteAttachments, { attachmentIds });
  }

  // ----- Drafts -----

  /**
   * List the caller's saved chat drafts.
   *
   * @param options.limit - Maximum drafts to return.
   * @returns Their unsent drafts.
   * @example
   * const drafts = await sdk.messages.listDrafts({ limit: 20 });
   */
  listDrafts(options?: { limit?: number }): Promise<DraftMessage[]> {
    return this.call(messagesOperations.listDrafts, options ?? {});
  }

  /**
   * Edit a draft's content.
   *
   * @param id - Id of the draft.
   * @param content - The replacement body.
   * @example
   * await sdk.messages.editDraft('draft-1', 'Updated.');
   */
  editDraft(id: string, content: string): Promise<void> {
    return this.call(messagesOperations.editDraft, { id, content });
  }

  /**
   * Send a saved draft immediately.
   *
   * @param id - Id of the draft.
   * @example
   * await sdk.messages.sendDraft('draft-1');
   */
  sendDraft(id: string): Promise<void> {
    return this.call(messagesOperations.sendDraft, { id });
  }

  /**
   * Discard a draft without sending it.
   *
   * @param id - Id of the draft.
   * @example
   * await sdk.messages.deleteDraft('draft-1');
   */
  deleteDraft(id: string): Promise<void> {
    return this.call(messagesOperations.deleteDraft, { id });
  }

  // ----- Scheduled messages -----

  /**
   * List the caller's scheduled messages.
   *
   * @returns Messages queued to send later.
   * @example
   * const scheduled = await sdk.messages.listScheduled();
   */
  listScheduled(): Promise<DelayedMessage[]> {
    return this.call(messagesOperations.listScheduled, undefined);
  }

  /**
   * Schedule a message to send later.
   *
   * @param data.channelId - Channel to post in.
   * @param data.content - The message body.
   * @param data.scheduledFor - When to send, as epoch milliseconds.
   * @param data.conversationId - Thread to reply in, when it is a reply.
   * @returns The scheduled message's id.
   * @example
   * const { id } = await sdk.messages.schedule({
   *   channelId: 'channel-123',
   *   content: 'Standup in 5.',
   *   scheduledFor: Date.now() + 60_000,
   * });
   */
  async schedule(data: {
    channelId: string;
    content: string;
    scheduledFor: number;
    conversationId?: string;
  }): Promise<{ id: string }> {
    const id = newId();
    await this.call(messagesOperations.schedule, { id, ...data });
    return { id };
  }

  /**
   * Cancel a scheduled message.
   *
   * @param id - Id of the scheduled message.
   * @example
   * await sdk.messages.cancelScheduled('scheduled-1');
   */
  cancelScheduled(id: string): Promise<void> {
    return this.call(messagesOperations.cancelScheduled, { id });
  }

  /**
   * Change when a scheduled message will send.
   *
   * @param id - Id of the scheduled message.
   * @param scheduledFor - New send time, epoch milliseconds.
   * @example
   * await sdk.messages.reschedule('scheduled-1', Date.now() + 3_600_000);
   */
  reschedule(id: string, scheduledFor: number): Promise<void> {
    return this.call(messagesOperations.reschedule, { id, scheduledFor });
  }

  /**
   * Edit a scheduled message's content.
   *
   * @param id - Id of the scheduled message.
   * @param content - The replacement body.
   * @example
   * await sdk.messages.editScheduled('scheduled-1', 'Standup in 10.');
   */
  editScheduled(id: string, content: string): Promise<void> {
    return this.call(messagesOperations.editScheduled, { id, content });
  }

  /**
   * Send a scheduled message now rather than waiting.
   *
   * @param id - Id of the scheduled message.
   * @example
   * await sdk.messages.sendScheduledNow('scheduled-1');
   */
  sendScheduledNow(id: string): Promise<void> {
    return this.call(messagesOperations.sendScheduledNow, { id });
  }

  /**
   * Convert a scheduled message back into an editable draft.
   *
   * @param id - Id of the scheduled message.
   * @example
   * await sdk.messages.scheduledToDraft('scheduled-1');
   */
  scheduledToDraft(id: string): Promise<void> {
    return this.call(messagesOperations.scheduledToDraft, { id });
  }

  /**
   * Get attachments by id.
   *
   * @param attachmentIds - Ids to fetch.
   * @returns The attachments that exist.
   * @example
   * const files = await sdk.messages.getAttachments(['attachment-1']);
   */
  getAttachments(attachmentIds: string[]): Promise<MessageAttachment[]> {
    return this.call(messagesOperations.getAttachments, { attachmentIds });
  }

  /**
   * List attachments on the message that started a thread.
   *
   * @param initialMessageId - The thread's first message.
   * @returns Files attached to it.
   * @example
   * const files = await sdk.messages.listAttachmentsForThread('message-1');
   */
  listAttachmentsForThread(initialMessageId: string): Promise<MessageAttachment[]> {
    return this.call(messagesOperations.listAttachmentsForThread, { initialMessageId });
  }

  /**
   * List every attachment shared in a channel, newest first.
   *
   * @param channelId - Channel to read.
   * @param options.limit - Page size.
   * @param options.start - Cursor from the previous page.
   * @param options.isMember - ACL hint; leave unset unless you know otherwise.
   * @returns One page of attachments.
   * @example
   * const files = await sdk.messages.listChannelAttachments('channel-1', { limit: 20 });
   */
  listChannelAttachments(
    channelId: string,
    options?: {
      limit?: number;
      start?: { attachementId: string; createdAt: number };
      direction?: 'forward' | 'backward';
    }
  ): Promise<MessageAttachment[]> {
    return this.call(messagesOperations.listChannelAttachments, { channelId, ...options });
  }

  /**
   * List scheduled messages a page at a time, optionally filtered by status.
   *
   * @param options.limit - Page size.
   * @param options.statuses - Restrict to these statuses.
   * @param options.start - Cursor from the previous page.
   * @returns One page of scheduled messages.
   * @example
   * const page = await sdk.messages.listScheduledPaginated({ statuses: ['PENDING'] });
   */
  listScheduledPaginated(options?: {
    limit?: number;
    statuses?: DelayedMessageStatus[];
    start?: { id: string; scheduledFor: number };
  }): Promise<DelayedMessage[]> {
    return this.call(messagesOperations.listScheduledPaginated, options ?? {});
  }

  /**
   * Attach already-uploaded files to a draft.
   *
   * @param data.draftMessageId - Draft to attach to.
   * @param data.channelId - Channel the draft belongs to.
   * @param data.attachments - The uploaded files, with their metadata.
   * @param data.conversationId - Thread the draft replies to, when it does.
   * @example
   * await sdk.messages.addDraftAttachments({
   *   draftMessageId: 'draft-1',
   *   channelId: 'channel-1',
   *   attachments: [{ attachmentId: 'a1', originalFilename: 'log.txt', mimetype: 'text/plain', size: 120 }],
   * });
   */
  addDraftAttachments(data: {
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
  }): Promise<void> {
    return this.call(messagesOperations.addDraftAttachments, data);
  }

  /**
   * Clear a channel or thread draft's content.
   *
   * @param channelId - Channel the draft belongs to.
   * @param options.conversationId - Thread the draft replies to, when it does.
   * @example
   * await sdk.messages.clearDraft('channel-1');
   */
  clearDraft(channelId: string, options?: { conversationId?: string }): Promise<void> {
    return this.call(messagesOperations.clearDraft, { channelId, ...options });
  }

  /**
   * Resolve a mention of someone who is not in the channel.
   *
   * @param data.messageId - Message carrying the mention.
   * @param data.channelId - Channel they were mentioned in.
   * @param data.userIds - The mentioned people.
   * @param data.action - `add` or `add_all` to admit them; `ignore` or
   * `ignore_all` to dismiss the prompt.
   * @example
   * await sdk.messages.handleNonParticipants({
   *   messageId: 'message-1',
   *   channelId: 'channel-1',
   *   userIds: ['user-1'],
   *   action: 'add',
   * });
   */
  handleNonParticipants(data: {
    messageId: string;
    channelId: string;
    userIds: string[];
    action: 'add' | 'add_all' | 'ignore' | 'ignore_all';
  }): Promise<void> {
    return this.call(messagesOperations.handleNonParticipants, data);
  }
}
