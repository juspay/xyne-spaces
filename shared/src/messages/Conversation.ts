import type {
  Conversation as ChannelConversation,
  ThreadConversation,
} from '../machines/queryCacheMachine.js';
import type { ChannelRef, ConversationRef, ThreadRef } from './conversationRef.js';
import { refKey } from './conversationRef.js';
import {
  clearDraft,
  getDraft,
  setDraft,
  subscribeDraft,
  type Draft,
  type DraftInput,
} from './draft.js';
import {
  getChannelSnapshot,
  getThreadSnapshot,
  subscribeMessages,
} from './messages.js';
import {
  sendMessage,
  type SendPayload,
  type SendResult,
} from './send.js';

/**
 * OO facade over the messages module. All methods delegate to the underlying
 * functions — the class exists to hide the `ref` parameter for consumers who
 * hold a `Conversation` for a while (composer instance, thread screen).
 *
 * Instances are memoized by refKey via `conversationFor`, so identity is
 * stable across renders — you can pass a `Conversation` into a `useEffect`
 * dep list without re-subscribing on every render.
 */
export class Conversation<Ref extends ConversationRef = ConversationRef> {
  constructor(readonly ref: Ref) {}

  send(
    zero: Parameters<typeof sendMessage>[0],
    payload: SendPayload,
  ): SendResult {
    return sendMessage(zero, this.ref, payload);
  }

  getDraft(): Draft | null {
    return getDraft(this.ref);
  }

  setDraft(draft: DraftInput): void {
    setDraft(this.ref, draft);
  }

  clearDraft(): void {
    clearDraft(this.ref);
  }

  subscribeDraft(cb: (draft: Draft | null) => void): () => void {
    return subscribeDraft(this.ref, cb);
  }

  /**
   * Sync snapshot from the warm-start cache. Return shape depends on ref kind:
   * channel → `Conversation[]`; thread → `ThreadConversation | null`.
   */
  getMessagesSnapshot(): Ref extends ChannelRef
    ? ChannelConversation[]
    : ThreadConversation | null {
    if (this.ref.kind === 'channel') {
      return getChannelSnapshot(this.ref as ChannelRef) as Ref extends ChannelRef
        ? ChannelConversation[]
        : ThreadConversation | null;
    }
    return getThreadSnapshot(this.ref as ThreadRef) as Ref extends ChannelRef
      ? ChannelConversation[]
      : ThreadConversation | null;
  }

  subscribeMessages(cb: () => void): () => void {
    return subscribeMessages(this.ref, cb);
  }
}

const registry = new Map<string, Conversation<ConversationRef>>();

/**
 * Memoized factory. Two calls with the same `refKey(ref)` return the same
 * `Conversation` — cheap to call in render, safe to use as a dep.
 *
 * Instances live for the lifetime of the app. Threads exceed the cache LRU
 * quickly enough that keeping their `Conversation` shells around is a rounding
 * error next to the cached data itself.
 */
export function conversationFor(ref: ChannelRef): Conversation<ChannelRef>;
export function conversationFor(ref: ThreadRef): Conversation<ThreadRef>;
export function conversationFor(ref: ConversationRef): Conversation<ConversationRef>;
export function conversationFor(ref: ConversationRef): Conversation<ConversationRef> {
  const key = refKey(ref);
  const existing = registry.get(key);
  if (existing) return existing;
  const created = new Conversation(ref);
  registry.set(key, created);
  return created;
}
