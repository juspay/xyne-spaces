/**
 * Chat directory sidebar width, in pixels.
 *
 * Pixels rather than percentages so the sidebar keeps the width the user picked when
 * the surrounding container shrinks — opening the Ask AI panel drops the chat area to
 * 65% of the window, and a percentage-sized sidebar would shrink with it.
 *
 * Paired with `groupResizeBehavior='preserve-pixel-size'` on the Panel.
 */
export const CHAT_SIDEBAR_DEFAULT_WIDTH = 280;
export const CHAT_SIDEBAR_MIN_WIDTH = 220;
export const CHAT_SIDEBAR_MAX_WIDTH = 420;

/** Pixels the `[` / `]` shortcuts nudge the sidebar by. */
export const CHAT_SIDEBAR_KEYBOARD_STEP = 24;
