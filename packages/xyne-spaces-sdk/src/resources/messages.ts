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
import type { Message, MessageType } from '../types/index.js';

export class MessagesResource extends Resource {
  /**
   * List the messages in a thread, oldest first.
   *
   * @example
   * const messages = await sdk.messages.listByConversation('conv-123');
   */
  listByConversation(conversationId: string): Promise<Message[]> {
    return this.call(messagesOperations.listByConversation, { conversationId });
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
   * the channel.
   */
  listByChannel(channelId: string): Promise<Message[]> {
    return this.call(messagesOperations.listByChannel, { channelId });
  }

  /** List the current user's own sent messages, newest first. */
  listMine(options?: { limit?: number; start?: MessageCursor }): Promise<Message[]> {
    return this.call(messagesOperations.listMine, options ?? {});
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
}
