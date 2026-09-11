/**
 * Automations sidebar width, in pixels — mirrors clawAgentsSidebarWidth.ts.
 * Pixels rather than percentages so the sidebar keeps the width the user picked
 * when the surrounding container shrinks (Ask AI opening, window resize) instead
 * of scaling with it. Paired with `groupResizeBehavior='preserve-pixel-size'`.
 */
export const AUTOMATIONS_SIDEBAR_DEFAULT_WIDTH = 280;
export const AUTOMATIONS_SIDEBAR_MIN_WIDTH = 220;
export const AUTOMATIONS_SIDEBAR_MAX_WIDTH = 420;
