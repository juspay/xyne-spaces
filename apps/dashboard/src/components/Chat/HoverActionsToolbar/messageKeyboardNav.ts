import { hoveredMessage } from '../ChatBubble/hoveredMessageRef';

/**
 * Keyboard (arrow-key) navigation across the message list — the "roving focus"
 * that lets a user walk messages with ↑/↓ and then act on the current one with
 * the existing per-message shortcuts (e / delete / p / a / l / ⌘⇧C).
 *
 * Design: instead of introducing a second, parallel "focused message" concept,
 * arrow navigation drives the SAME pipeline a real mouse hover drives. Moving
 * focus dispatches a real `mouseover` on the target row, so the shared
 * MessageHoverToolbar sets `hoveredMessage.current`, stamps `data-hovered`, and
 * positions the floating toolbar — exactly as if the pointer had entered the
 * row. Every message-action shortcut already reads `hoveredMessage.current`, so
 * they work on the keyboard-selected row with zero changes.
 */

/**
 * scrollIntoView() fires an async `scroll` on the list container, and the
 * MessageHoverToolbar clears the highlight on scroll. This short window tells
 * that scroll handler to ignore the programmatic scroll we just caused, so the
 * row we just selected is not immediately cleared.
 */
let programmaticScrollUntil = 0;

export const isProgrammaticScrollActive = (): boolean => Date.now() < programmaticScrollUntil;

/**
 * Move the keyboard selection one row within `container`.
 *
 * Rows render oldest→newest top→bottom, so `prev` (↑) moves to the OLDER
 * message (up the list) and `next` (↓) to the NEWER one. With nothing selected
 * yet, ↑ selects the newest (bottom) message and ↓ is a no-op (already at the
 * bottom). Movement clamps at both ends — it never wraps.
 */
export const navigateMessageFocus = (container: HTMLElement, direction: 'prev' | 'next'): void => {
  const rows = Array.from(container.querySelectorAll<HTMLElement>('[data-message-id]'));
  if (rows.length === 0) return;

  const currentId = hoveredMessage.current?.messageId ?? null;
  const index = currentId
    ? rows.findIndex(row => row.getAttribute('data-message-id') === currentId)
    : -1;

  let target: HTMLElement | undefined;
  if (index === -1) {
    // Nothing selected yet: ↑ starts at the newest message; ↓ does nothing.
    if (direction === 'prev') target = rows[rows.length - 1];
    else return;
  } else {
    const nextIndex = direction === 'prev' ? index - 1 : index + 1;
    if (nextIndex < 0 || nextIndex >= rows.length) return; // clamp at both ends
    target = rows[nextIndex];
  }
  if (!target) return;

  // Suppress the container's scroll-clear for the programmatic scroll below.
  programmaticScrollUntil = Date.now() + 300;
  target.scrollIntoView({ block: 'nearest' });

  // Move DOM focus OUT of the composer onto the row so the message-action
  // shortcuts (allowInInputs:false) fire instead of typing into the composer.
  if (target.tabIndex < 0) target.tabIndex = -1;
  target.focus({ preventScroll: true });

  // Drive the shared hover pipeline exactly like a real pointer hover: sets
  // hoveredMessage.current, stamps data-hovered, positions the toolbar.
  target.dispatchEvent(
    new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }),
  );
};
