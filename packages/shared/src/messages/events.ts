import type { ConversationRef } from './conversationRef.js';

export type MessageSentEvent = {
  ref: ConversationRef;
  messageId: string;
  conversationId: string;
  /**
   * The optimistic client apply landed. This is NOT a delivery confirmation —
   * the server can still reject or retry the mutation. Whether a message has
   * actually been persisted is answered by its `isSent` row, not by this.
   */
  isClientApplied: boolean;
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
