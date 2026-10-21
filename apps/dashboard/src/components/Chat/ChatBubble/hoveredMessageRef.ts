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

/** Which input the user acted with most recently. */
export type MessageInteractionModality = 'pointer' | 'keyboard';

/**
 * Module-level ref deciding who owns the message shortcuts when a hovered row
 * and a keyboard-selected row are both on screen: whichever input the user
 * touched last.
 *
 * Hover alone cannot decide it. The pointer usually rests wherever it was left,
 * and `scrollToIndex` slides fresh rows underneath a stationary cursor, firing
 * `pointerover` with no user intent behind it — so arrow navigation would keep
 * handing the shortcuts back to a message nobody is looking at. Only a real
 * `pointermove` (coordinates actually changed) flips this back to `'pointer'`.
 */
export const messageInteractionModality: { current: MessageInteractionModality } = {
  current: 'pointer',
};
