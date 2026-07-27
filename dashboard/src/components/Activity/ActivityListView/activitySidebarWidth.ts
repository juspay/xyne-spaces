/**
 * Activity list sidebar width, in pixels.
 *
 * Pixels rather than percentages so the sidebar keeps the width the user picked when
 * the surrounding container shrinks (Ask AI opening, window resize) instead of scaling
 * with it. Paired with `groupResizeBehavior='preserve-pixel-size'` on the Panel.
 *
 * Converted from the previous 25% / 25% / 45% at a 1440px reference width. The old min
 * equalled the default, which left the panel unshrinkable; 300px keeps it adjustable
 * while staying wider than the other sidebars, as the activity rows need.
 */
export const ACTIVITY_SIDEBAR_DEFAULT_WIDTH = 360;
export const ACTIVITY_SIDEBAR_MIN_WIDTH = 300;
export const ACTIVITY_SIDEBAR_MAX_WIDTH = 640;
