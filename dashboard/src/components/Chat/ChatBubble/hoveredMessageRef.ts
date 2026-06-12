/**
 * Module-level ref tracking which message the pointer is currently over.
 *
 * Written by the delegated `pointerover` listener in the shared
 * MessageHoverToolbar overlay (and by ChatBubble's own mouse enter/leave as a
 * fallback for containers without the overlay). Read at keypress time by the
 * per-message shortcut `when` predicates — hover never touches React state,
 * so sweeping the cursor across messages causes ZERO React renders.
 */
export const hoveredMessage: {
  current: { messageId: string; conversationId?: string } | null;
} = { current: null };
