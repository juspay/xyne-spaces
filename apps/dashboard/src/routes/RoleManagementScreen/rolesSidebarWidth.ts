/**
 * Roles sidebar width, in pixels.
 *
 * Pixels rather than percentages so the sidebar keeps the width the user picked when
 * the surrounding container shrinks (Ask AI opening, window resize) instead of scaling
 * with it. Paired with `groupResizeBehavior='preserve-pixel-size'` on the Panel.
 *
 * Matches the chat directory sidebar so the two read as the same chrome.
 */
export const ROLES_SIDEBAR_DEFAULT_WIDTH = 280;
export const ROLES_SIDEBAR_MIN_WIDTH = 220;
export const ROLES_SIDEBAR_MAX_WIDTH = 420;
