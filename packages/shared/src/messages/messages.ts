import {
  queryCacheActor,
  type Conversation,
  type ThreadConversation,
} from '../machines/queryCacheMachine.js';
import type { ChannelRef, ConversationRef, ThreadRef } from './conversationRef.js';

/**
 * Sync cache snapshot for a channel. Returns [] when the channel has never
 * been cached (cold start on this device / evicted by LRU).
 */
export function getChannelSnapshot(ref: ChannelRef): Conversation[] {
  return (
    queryCacheActor.getSnapshot().context.channelConversations[ref.channelId] ??
    []
  );
}

/**
 * Sync cache snapshot for a thread. Returns null when the thread has never
 * been cached.
 */
export function getThreadSnapshot(ref: ThreadRef): ThreadConversation | null {
  return (
    queryCacheActor.getSnapshot().context.threadConversations[
      ref.conversationId
    ] ?? null
  );
}

export type MessagesSnapshot<Ref extends ConversationRef> = Ref extends ChannelRef
  ? Conversation[]
  : ThreadConversation | null;

// The runtime `getMessagesSnapshot` returns the right shape for either ref;
// callers get channel-precise typing via the overloads.
export function getMessagesSnapshot(ref: ChannelRef): Conversation[];
export function getMessagesSnapshot(ref: ThreadRef): ThreadConversation | null;
export function getMessagesSnapshot(
  ref: ConversationRef,
): Conversation[] | ThreadConversation | null {
  return ref.kind === 'channel'
    ? getChannelSnapshot(ref)
    : getThreadSnapshot(ref);
}

/**
 * Subscribe to changes in the cached messages for `ref`. Fires only when the
 * cached reference for this ref actually changes (queryCacheActor writes for
 * other refs don't wake this listener).
 */
export function subscribeMessages(
  ref: ConversationRef,
  cb: () => void,
): () => void {
  const readSlot = (): unknown =>
    ref.kind === 'channel'
      ? queryCacheActor.getSnapshot().context.channelConversations[ref.channelId]
      : queryCacheActor.getSnapshot().context.threadConversations[
          ref.conversationId
        ];

  let last = readSlot();
  const sub = queryCacheActor.subscribe(() => {
    const next = readSlot();
    if (next === last) return;
    last = next;
    cb();
  });
  return () => sub.unsubscribe();
}

/**
 * Push the current live channel query result into the warm-start cache. Used
 * by `useMessages` after `useQuery` yields fresh data. Callers outside the
 * hook rarely need this directly.
 */
export function primeChannelCache(
  ref: ChannelRef,
  conversations: Conversation[],
): void {
  queryCacheActor.send({
    type: 'SET_CONVERSATIONS',
    channelId: ref.channelId,
    conversations,
  });
}

/**
 * Push the current live thread query result into the warm-start cache.
 */
export function primeThreadCache(
  ref: ThreadRef,
  conversation: ThreadConversation,
): void {
  queryCacheActor.send({
    type: 'SET_THREAD_CONVERSATION',
    conversationId: ref.conversationId,
    conversation,
  });
}
