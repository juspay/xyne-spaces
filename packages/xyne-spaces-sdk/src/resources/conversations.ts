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
  ConversationLabel,
  ConversationLabelMapping,
  ConversationParticipant,
  CreateConversationWithAttachmentsInput,
  MessageType,
} from '../types/index.js';

export class ConversationsResource extends Resource {
  /**
   * List threads in a channel, most recently active first.
   *
   * @param channelId - Channel to read.
   * @param options.limit - Page size.
   * @param options.start - Cursor from the last item of the previous page.
   * @param options.isMember - ACL hint; leave unset unless you know otherwise.
   * @param options.direction - Page forward or backward from the cursor.
   * @returns One page of threads.
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

  /**
   * List the most recent threads in a channel, without paging.
   *
   * @param channelId - Channel to read.
   * @param options.limit - How many threads to return.
   * @param options.isMember - ACL hint; leave unset unless you know otherwise.
   * @returns The most recently active threads.
   * @example
   * const latest = await sdk.conversations.listLatestByChannel('channel-1', { limit: 10 });
   */
  listLatestByChannel(
    channelId: string,
    options?: { limit?: number; isMember?: boolean }
  ): Promise<Conversation[]> {
    return this.call(conversationsOperations.listLatestByChannel, {
      channelId,
      ...options,
    });
  }

  /**
   * Get a single thread.
   *
   * @param conversationId - Id of the thread.
   * @returns The thread, or `null` if it does not exist or is not visible.
   * @example
   * const thread = await sdk.conversations.get('conv-1');
   */
  get(conversationId: string): Promise<Conversation | null> {
    return this.call(conversationsOperations.get, { conversationId });
  }

  /**
   * Get a thread together with its channel, for rendering a thread view cold.
   *
   * @param conversationId - Id of the thread.
   * @param channelId - Channel it belongs to.
   * @param options.isMember - ACL hint; leave unset unless you know otherwise.
   * @returns The thread with its channel attached, or `null`.
   * @example
   * const thread = await sdk.conversations.getWithChannel('conv-1', 'channel-1');
   */
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

  /**
   * Get a thread with its replies resolved.
   *
   * @param conversationId - Id of the thread.
   * @param options.channelId - Channel it belongs to, when known.
   * @param options.isMember - ACL hint; leave unset unless you know otherwise.
   * @returns The thread including its messages, or `null`.
   * @example
   * const thread = await sdk.conversations.getThread('conv-1');
   */
  getThread(
    conversationId: string,
    options?: { channelId?: string; isMember?: boolean }
  ): Promise<Conversation | null> {
    return this.call(conversationsOperations.getThread, { conversationId, ...options });
  }

  /**
   * Get the thread attached to a call.
   *
   * @param callId - Id of the call.
   * @returns The call's thread, or `null` if it has none.
   * @example
   * const thread = await sdk.conversations.getByCallId('call-1');
   */
  getByCallId(callId: string): Promise<Conversation | null> {
    return this.call(conversationsOperations.getByCallId, { callId });
  }

  /**
   * Get the single most recent thread in a channel.
   *
   * @param channelId - Channel to read.
   * @param options.isMember - ACL hint; leave unset unless you know otherwise.
   * @returns The latest thread, or `null` if the channel has none.
   * @example
   * const latest = await sdk.conversations.getLatest('channel-1');
   */
  getLatest(
    channelId: string,
    options?: { isMember?: boolean }
  ): Promise<Conversation | null> {
    return this.call(conversationsOperations.getLatest, { channelId, ...options });
  }

  /**
   * Get the caller's own participation in a thread — subscription state, last
   * read, and last reply.
   *
   * One row, not every participant: the query is scoped to the authenticated
   * caller. The catalog has no operation returning a thread's full participant
   * list.
   *
   * @param conversationId - Thread to read.
   * @returns The caller's participation, or `null` if they are not in the thread.
   * @example
   * const mine = await sdk.conversations.getMyParticipation('conv-1');
   */
  getMyParticipation(conversationId: string): Promise<ConversationParticipant | null> {
    return this.call(conversationsOperations.getMyParticipation, { conversationId });
  }

  /**
   * List pinned threads in a channel.
   *
   * @param channelId - Channel to read.
   * @param options.isMember - ACL hint; leave unset unless you know otherwise.
   * @returns The channel's pinned threads.
   * @example
   * const pinned = await sdk.conversations.listPinned('channel-1');
   */
  listPinned(
    channelId: string,
    options?: { isMember?: boolean }
  ): Promise<Conversation[]> {
    return this.call(conversationsOperations.listPinned, { channelId, ...options });
  }

  /**
   * List the labels defined for a channel.
   *
   * Labels belong to one channel and are not shared across channels.
   *
   * @param channelId - Channel to read.
   * @returns The labels available there.
   * @example
   * const labels = await sdk.conversations.listLabels('channel-1');
   */
  listLabels(channelId: string): Promise<ConversationLabel[]> {
    return this.call(conversationsOperations.listLabels, { channelId });
  }

  /**
   * List the labels applied to a thread.
   *
   * @param conversationId - Thread to read.
   * @param channelId - The thread's channel, required as an ACL hint.
   * `conversations.get(conversationId)` returns it if you only have the thread.
   * @returns The labels applied, each carrying its name.
   * @example
   * const labels = await sdk.conversations.listAppliedLabels('conv-1', 'channel-1');
   */
  listAppliedLabels(conversationId: string, channelId: string): Promise<ConversationLabelMapping[]> {
    return this.call(conversationsOperations.listAppliedLabels, { conversationId, channelId });
  }

  /**
   * Start a new thread in a channel by posting its first message.
   *
   * @param data - The thread to start.
   * @param data.channelId - Channel to post in.
   * @param data.content - The first message's body.
   * @param data.type - Message type. Defaults to a normal user message.
   * @param data.attachmentIds - Ids from `sdk.attachments.uploadDraft`.
   * @returns The ids of the new thread and its first message.
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
   *
   * Use {@link create} when every attachment has already been uploaded.
   *
   * @param data - The thread to start, with its files.
   * @param data.channelId - Channel to post in.
   * @param data.content - The first message's body.
   * @param data.msgType - Message type. Defaults to a normal user message.
   * @param data.visibleTo - Restrict the thread to these user ids.
   * @param data.files - Files to upload alongside it.
   * @returns The ids of the new thread and its first message.
   * @example
   * const { conversationId } = await sdk.conversations.createWithAttachments({
   *   channelId: 'channel-1',
   *   content: 'Trace attached',
   *   files: [{ file: blob, filename: 'trace.log' }],
   * });
   */
  createWithAttachments(
    data: CreateConversationWithAttachmentsInput
  ): Promise<{ conversationId: string; messageId: string }> {
    return this.call(conversationsOperations.createWithAttachments, data);
  }

  /**
   * Pin or unpin a thread.
   *
   * This flips the current value rather than setting it, so read
   * {@link listPinned} first if you need a specific end state.
   *
   * @param conversationId - Thread to pin or unpin.
   * @example
   * await sdk.conversations.togglePin('conv-1');
   */
  togglePin(conversationId: string): Promise<void> {
    return this.call(conversationsOperations.togglePin, { conversationId });
  }

  /**
   * Forward a message into another channel as a new thread.
   *
   * @param data - What to forward, and where.
   * @param data.targetChannelId - Channel to forward into.
   * @param data.originalMessageId - Message being forwarded.
   * @param data.optionalMessage - Note to post above the forwarded message.
   * @returns The ids of the thread and message created in the target channel.
   * @example
   * const { conversationId } = await sdk.conversations.forwardMessage({
   *   targetChannelId: 'channel-2',
   *   originalMessageId: 'message-1',
   *   optionalMessage: 'Relevant here too',
   * });
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

  /**
   * Subscribe to a thread so its replies appear in the caller's activity feed.
   *
   * @param conversationId - Thread to follow.
   * @example
   * await sdk.conversations.subscribe('conv-1');
   */
  subscribe(conversationId: string): Promise<void> {
    return this.call(conversationsOperations.subscribe, { conversationId });
  }

  /**
   * Stop following a thread.
   *
   * @param conversationId - Thread to unfollow.
   * @example
   * await sdk.conversations.unsubscribe('conv-1');
   */
  unsubscribe(conversationId: string): Promise<void> {
    return this.call(conversationsOperations.unsubscribe, { conversationId });
  }

  /**
   * Mark a thread unread from one message onwards.
   *
   * @param conversationId - Thread to mark.
   * @param messageId - First message to treat as unread.
   * @example
   * await sdk.conversations.markUnreadFrom('conv-1', 'message-5');
   */
  markUnreadFrom(conversationId: string, messageId: string): Promise<void> {
    return this.call(conversationsOperations.markUnreadFrom, { conversationId, messageId });
  }

  /**
   * Find the thread nearest a point in time, for jumping to a date.
   *
   * @param channelId - Channel to search.
   * @param timestamp - The moment to jump to, epoch milliseconds.
   * @param options.isMember - ACL hint; leave unset unless you know otherwise.
   * @returns The nearest thread, or `null` if the channel has none.
   * @example
   * const thread = await sdk.conversations.getByTimestamp('channel-1', Date.now());
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

  /**
   * List threads a user takes part in, across every channel.
   *
   * @param userId - Whose threads to list.
   * @param options.limit - Page size.
   * @param options.start - Cursor from the previous page.
   * @returns One page of threads, most recent reply first.
   * @example
   * const me = await sdk.users.me();
   * const threads = await sdk.conversations.listForUser(me.id, { limit: 20 });
   */
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
   * Replaces the thread's whole tag set; send every tag you want to keep.
   *
   * @param conversationId - Thread to tag.
   * @param types - The complete set of tags. Each up to 40 characters.
   * @param options.note - What a newly invented tag means. Stored against the
   * vocabulary candidate rather than on the thread.
   * @example
   * await sdk.conversations.setTagTypes('conv-1', ['incident', 'payments']);
   */
  setTagTypes(
    conversationId: string,
    types: string[],
    options?: { note?: string }
  ): Promise<void> {
    return this.call(conversationsOperations.setTagTypes, {
      conversationId,
      types,
      ...options,
    });
  }
}
