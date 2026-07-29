/**
 * DM list sidebar width, in pixels.
 *
 * Pixels rather than percentages so the sidebar keeps the width the user picked when
 * the surrounding container shrinks (Ask AI opening, window resize) instead of scaling
 * with it. Paired with `groupResizeBehavior='preserve-pixel-size'` on the Panel.
 *
 * Converted from the previous 20% / 15% / 40% at a 1440px reference width.
 */
export const DM_SIDEBAR_DEFAULT_WIDTH = 280;
export const DM_SIDEBAR_MIN_WIDTH = 220;
export const DM_SIDEBAR_MAX_WIDTH = 560;
