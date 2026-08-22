/**
 * Conversations Resource
 *
 * Threads: listing them in a channel, reading one, and the membership and
 * pinning operations that act on a whole thread. Individual messages live on
 * `sdk.messages`.
 */

import { Resource } from './base.js';
import {
  conversationsOperations,
  type ConversationCursor,
} from '../registry/conversations.js';
import { newId } from '../core/ids.js';
import type {
  Conversation,
  ConversationParticipant,
  CreateConversationWithAttachmentsInput,
  MessageType,
} from '../types/index.js';

export class ConversationsResource extends Resource {
  /**
   * List threads in a channel, most recently active first.
   *
   * @param options.start - Cursor from the last item of the previous page
   *
   * @example
   * const threads = await sdk.conversations.listByChannel('channel-123', { limit: 20 });
   */
  listByChannel(
    channelId: string,
    options?: {
      limit?: number;
      start?: ConversationCursor;
      isMember?: boolean;
      direction?: 'forward' | 'backward';
    }
  ): Promise<Conversation[]> {
    return this.call(conversationsOperations.listByChannel, { channelId, ...options });
  }

  /** List the most recent threads in a channel without paging. */
  listLatestByChannel(
    channelId: string,
    options?: { limit?: number; isMember?: boolean }
  ): Promise<Conversation[]> {
    return this.call(conversationsOperations.listLatestByChannel, {
      channelId,
      ...options,
    });
  }

  /** Get a single thread. */
  get(conversationId: string): Promise<Conversation | null> {
    return this.call(conversationsOperations.get, { conversationId });
  }

  /** Get a thread together with its channel. */
  getWithChannel(
    conversationId: string,
    channelId: string,
    options?: { isMember?: boolean }
  ): Promise<Conversation | null> {
    return this.call(conversationsOperations.getWithChannel, {
      conversationId,
      channelId,
      ...options,
    });
  }

  /** Get a thread with its replies resolved. */
  getThread(
    conversationId: string,
    options?: { channelId?: string; isMember?: boolean }
  ): Promise<Conversation | null> {
    return this.call(conversationsOperations.getThread, { conversationId, ...options });
  }

  /** Get the thread attached to a call. */
  getByCallId(callId: string): Promise<Conversation | null> {
    return this.call(conversationsOperations.getByCallId, { callId });
  }

  /** Get the most recent thread in a channel. */
  getLatest(
    channelId: string,
    options?: { isMember?: boolean }
  ): Promise<Conversation | null> {
    return this.call(conversationsOperations.getLatest, { channelId, ...options });
  }

  /**
   * Get your own participation in a thread — subscription state, last read, and
   * last reply.
   *
   * Not every participant: the underlying query is scoped to the authenticated
   * caller and returns a single row. This was `listParticipants(): Promise<[]>`,
   * which typed one object as an array.
   */
  getMyParticipation(conversationId: string): Promise<ConversationParticipant | null> {
    return this.call(conversationsOperations.getMyParticipation, { conversationId });
  }

  /** List pinned threads in a channel. */
  listPinned(
    channelId: string,
    options?: { isMember?: boolean }
  ): Promise<Conversation[]> {
    return this.call(conversationsOperations.listPinned, { channelId, ...options });
  }

  /** List the labels defined for a channel. */
  listLabels(channelId: string): Promise<unknown[]> {
    return this.call(conversationsOperations.listLabels, { channelId });
  }

  /** List the labels applied to a thread. */
  listAppliedLabels(conversationId: string): Promise<unknown[]> {
    return this.call(conversationsOperations.listAppliedLabels, { conversationId });
  }

  /**
   * Start a new thread in a channel.
   *
   * @returns The ids of the new thread and its first message
   *
   * @example
   * const { conversationId } = await sdk.conversations.create({
   *   channelId: 'channel-123',
   *   content: 'Deploy is green.',
   * });
   */
  async create(data: {
    channelId: string;
    content: string;
    type?: MessageType;
    attachmentIds?: string[];
  }): Promise<{ conversationId: string; messageId: string }> {
    const conversationId = newId();
    const messageId = newId();
    await this.call(conversationsOperations.create, {
      conversationId,
      messageId,
      ...data,
    });
    return { conversationId, messageId };
  }

  /**
   * Start a thread and upload its attachment bytes in one multipart request.
   * Use `create` when every attachment has already been uploaded.
   */
  createWithAttachments(
    data: CreateConversationWithAttachmentsInput
  ): Promise<{ conversationId: string; messageId: string }> {
    return this.call(conversationsOperations.createWithAttachments, data);
  }

  /**
   * Pin or unpin a thread.
   *
   * This flips the current value rather than setting it.
   */
  togglePin(conversationId: string): Promise<void> {
    return this.call(conversationsOperations.togglePin, { conversationId });
  }

  /**
   * Forward a message into another channel as a new thread.
   *
   * @returns The ids of the thread and message created in the target channel
   */
  async forwardMessage(data: {
    targetChannelId: string;
    originalMessageId: string;
    optionalMessage?: string;
  }): Promise<{ conversationId: string; messageId: string }> {
    const conversationId = newId();
    const messageId = newId();
    await this.call(conversationsOperations.forwardMessage, {
      conversationId,
      messageId,
      ...data,
    });
    return { conversationId, messageId };
  }

  /** Subscribe to a thread so its replies appear in your activity feed. */
  subscribe(conversationId: string): Promise<void> {
    return this.call(conversationsOperations.subscribe, { conversationId });
  }

  /** Unsubscribe from a thread. */
  unsubscribe(conversationId: string): Promise<void> {
    return this.call(conversationsOperations.unsubscribe, { conversationId });
  }

  /** Mark a thread unread starting from a specific message. */
  markUnreadFrom(conversationId: string, messageId: string): Promise<void> {
    return this.call(conversationsOperations.markUnreadFrom, { conversationId, messageId });
  }

  /**
   * Find the thread nearest a point in time — used to jump to a date.
   *
   * @param timestamp - Epoch milliseconds
   */
  getByTimestamp(
    channelId: string,
    timestamp: number,
    options?: { isMember?: boolean }
  ): Promise<Conversation | null> {
    return this.call(conversationsOperations.getByTimestamp, {
      channelId,
      timestamp,
      ...options,
    });
  }

  /** List threads a user takes part in across every channel. */
  listForUser(
    userId: string,
    options?: { limit?: number; start?: { lastReplyAt: number; id: string } }
  ): Promise<Conversation[]> {
    return this.call(conversationsOperations.listForUser, { userId, ...options });
  }

  /**
   * Set the tag types on a thread.
   *
   * Free-form — projects define their own vocabulary beyond the built-in one.
   */
  setTagTypes(conversationId: string, types: string[]): Promise<void> {
    return this.call(conversationsOperations.setTagTypes, { conversationId, types });
  }
}
