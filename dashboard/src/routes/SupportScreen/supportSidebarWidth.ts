/**
 * Support desks sidebar width, in pixels.
 *
 * Pixels rather than percentages so the sidebar keeps the width the user picked when
 * the surrounding container shrinks (Ask AI opening, window resize) instead of scaling
 * with it. Paired with `groupResizeBehavior='preserve-pixel-size'` on the Panel.
 *
 * Converted from the previous 16% / 12% / 25% at a 1440px reference width.
 */
export const SUPPORT_SIDEBAR_DEFAULT_WIDTH = 230;
export const SUPPORT_SIDEBAR_MIN_WIDTH = 176;
export const SUPPORT_SIDEBAR_MAX_WIDTH = 360;
