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
import type { Message, MessageType } from '../types/index.js';

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
   * @example
   * const page = await sdk.messages.listByConversation('conv-123');
   * console.log(page.items.length, page.hasMore);
   * const next = await sdk.messages.listByConversation('conv-123', { offset: page.nextOffset });
   */
  async listByConversation(conversationId: string, options?: PageOptions): Promise<Page<Message>> {
    const all = await this.call(messagesOperations.listByConversation, { conversationId });
    return paginate(all, options);
  }

  /** Get several messages by id. */
  getMany(messageIds: string[]): Promise<Message[]> {
    return this.call(messagesOperations.getMany, { messageIds });
  }

  /** Get a single message. */
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
   */
  async listByChannel(channelId: string, options?: PageOptions): Promise<Page<Message>> {
    const all = await this.call(messagesOperations.listByChannel, { channelId });
    return paginate(all, options);
  }

  /** List the current user's own sent messages, newest first. */
  listMine(options?: { limit?: number; start?: MessageCursor }): Promise<Message[]> {
    return this.call(messagesOperations.listMine, options ?? {});
  }

  /**
   * List messages authored by a given user, newest first.
   *
   * Uses Vespa search under the hood, similar to cmd+k's `from:@xyz` filter.
   * Results are ordered by newest first and use offset-based pagination.
   *
   * Read ACL still applies — you see only messages in conversations you can read.
   *
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

  /** Get the latest message in a channel. */
  getLatestInChannel(channelId: string): Promise<Message | null> {
    return this.call(messagesOperations.getLatestInChannel, { channelId });
  }

  /** List nudges attached to a message. */
  listNudges(messageId: string, states?: string[]): Promise<unknown[]> {
    return this.call(messagesOperations.listNudges, { messageId, ...(states ? { states } : {}) });
  }

  /**
   * Reply into an existing thread.
   *
   * @param data.showInChannel - Also surface this reply in the parent channel
   * @returns The id of the new message
   *
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

  /** Edit a message's content. */
  update(messageId: string, content: string): Promise<void> {
    return this.call(messagesOperations.update, { messageId, content });
  }

  /** Delete a message. */
  delete(messageId: string): Promise<void> {
    return this.call(messagesOperations.delete, { messageId });
  }

  /**
   * Add an emoji reaction.
   *
   * @param emojiName - The emoji's name, without colons (e.g. `thumbsup`)
   */
  addReaction(messageId: string, emojiName: string): Promise<void> {
    return this.call(messagesOperations.react, { messageId, emojiName, action: 'add' });
  }

  /** Remove your emoji reaction. */
  removeReaction(messageId: string, emojiName: string): Promise<void> {
    return this.call(messagesOperations.react, { messageId, emojiName, action: 'remove' });
  }

  /** Show or hide a thread reply in its parent channel. */
  setShowInChannel(messageId: string, showInChannel: boolean): Promise<void> {
    return this.call(messagesOperations.setShowInChannel, { messageId, showInChannel });
  }

  /** Remove an attachment from a message. */
  deleteAttachment(attachmentId: string): Promise<void> {
    return this.call(messagesOperations.deleteAttachment, { attachmentId });
  }

  /** Remove several attachments at once. */
  deleteAttachments(attachmentIds: string[]): Promise<void> {
    return this.call(messagesOperations.deleteAttachments, { attachmentIds });
  }

  // ----- Drafts -----

  /** List the current user's saved drafts. */
  listDrafts(options?: { limit?: number }): Promise<unknown[]> {
    return this.call(messagesOperations.listDrafts, options ?? {});
  }

  /** Edit a draft's content. */
  editDraft(id: string, content: string): Promise<void> {
    return this.call(messagesOperations.editDraft, { id, content });
  }

  /** Send a saved draft now. */
  sendDraft(id: string): Promise<void> {
    return this.call(messagesOperations.sendDraft, { id });
  }

  /** Discard a draft. */
  deleteDraft(id: string): Promise<void> {
    return this.call(messagesOperations.deleteDraft, { id });
  }

  // ----- Scheduled messages -----

  /** List the current user's scheduled messages. */
  listScheduled(): Promise<unknown[]> {
    return this.call(messagesOperations.listScheduled, undefined);
  }

  /**
   * Schedule a message to send later.
   *
   * @param data.scheduledFor - When to send, as epoch milliseconds
   * @returns The id of the scheduled message
   *
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

  /** Cancel a scheduled message. */
  cancelScheduled(id: string): Promise<void> {
    return this.call(messagesOperations.cancelScheduled, { id });
  }

  /** Change when a scheduled message will send. */
  reschedule(id: string, scheduledFor: number): Promise<void> {
    return this.call(messagesOperations.reschedule, { id, scheduledFor });
  }

  /** Edit a scheduled message's content. */
  editScheduled(id: string, content: string): Promise<void> {
    return this.call(messagesOperations.editScheduled, { id, content });
  }

  /** Send a scheduled message immediately. */
  sendScheduledNow(id: string): Promise<void> {
    return this.call(messagesOperations.sendScheduledNow, { id });
  }

  /** Convert a scheduled message back into an editable draft. */
  scheduledToDraft(id: string): Promise<void> {
    return this.call(messagesOperations.scheduledToDraft, { id });
  }

  /** Get attachments by id. */
  getAttachments(attachmentIds: string[]): Promise<unknown[]> {
    return this.call(messagesOperations.getAttachments, { attachmentIds });
  }

  /** List attachments on the message that started a thread. */
  listAttachmentsForThread(initialMessageId: string): Promise<unknown[]> {
    return this.call(messagesOperations.listAttachmentsForThread, { initialMessageId });
  }

  /** List every attachment shared in a channel, newest first. */
  listChannelAttachments(
    channelId: string,
    options?: {
      limit?: number;
      start?: { attachementId: string; createdAt: number };
      direction?: 'forward' | 'backward';
    }
  ): Promise<unknown[]> {
    return this.call(messagesOperations.listChannelAttachments, { channelId, ...options });
  }

  /** List scheduled messages a page at a time, optionally filtered by status. */
  listScheduledPaginated(options?: {
    limit?: number;
    statuses?: string[];
    start?: { id: string; scheduledFor: number };
  }): Promise<unknown[]> {
    return this.call(messagesOperations.listScheduledPaginated, options ?? {});
  }

  /** Attach files to a draft. */
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

  /** Clear a channel or thread draft's content. */
  clearDraft(channelId: string, options?: { conversationId?: string }): Promise<void> {
    return this.call(messagesOperations.clearDraft, { channelId, ...options });
  }

  /**
   * Resolve a mention of someone who is not in the channel.
   *
   * @param action - `add` or `add_all` to admit them, `ignore` or `ignore_all` to dismiss
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
