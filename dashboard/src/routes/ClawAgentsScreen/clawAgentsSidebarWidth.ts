/**
 * Claw agents sidebar width, in pixels.
 *
 * Pixels rather than percentages so the sidebar keeps the width the user picked when
 * the surrounding container shrinks (Ask AI opening, window resize) instead of scaling
 * with it. Paired with `groupResizeBehavior='preserve-pixel-size'` on the Panel.
 *
 * Converted from the previous 20% / 15% / 30% at a 1440px reference width.
 */
export const CLAW_AGENTS_SIDEBAR_DEFAULT_WIDTH = 280;
export const CLAW_AGENTS_SIDEBAR_MIN_WIDTH = 220;
export const CLAW_AGENTS_SIDEBAR_MAX_WIDTH = 420;
