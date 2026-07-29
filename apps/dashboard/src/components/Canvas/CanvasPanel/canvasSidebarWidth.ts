/**
 * Canvas list sidebar width, in pixels.
 *
 * Pixels rather than percentages so the sidebar keeps the width the user picked when
 * the surrounding container shrinks (Ask AI opening, window resize) instead of scaling
 * with it. Paired with `groupResizeBehavior='preserve-pixel-size'` on the Panel.
 *
 * Converted from the previous 30% / 25% / 45% at a 1440px reference width.
 */
export const CANVAS_SIDEBAR_DEFAULT_WIDTH = 420;
export const CANVAS_SIDEBAR_MIN_WIDTH = 360;
export const CANVAS_SIDEBAR_MAX_WIDTH = 640;
