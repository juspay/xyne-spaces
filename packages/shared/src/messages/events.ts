import type { ConversationRef } from './conversationRef.js';

export type MessageSentEvent = {
  ref: ConversationRef;
  messageId: string;
  conversationId: string;
  /** true when the client-apply resolved; false when the server rejected. */
  isServerConfirmed: boolean;
  showInChannel?: boolean;
  childConversationId?: string;
};

type Listener = (event: MessageSentEvent) => void;

const listeners = new Set<Listener>();

/**
 * Subscribe to successful sends anywhere in the app. Dashboard's existing
 * `CHAT_MESSAGE_SENT_EVENT` on window/EventTarget is a legacy of before this
 * module existed; new listeners should attach here. Returns an unsubscribe.
 */
export function subscribeMessageSent(cb: Listener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Internal — invoked by `sendMessage`. */
export function emitMessageSent(event: MessageSentEvent): void {
  for (const cb of listeners) {
    try {
      cb(event);
    } catch {}
  }
}
