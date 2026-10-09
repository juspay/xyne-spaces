/**
 * Every row is exactly this tall.
 *
 * Handed to LegendList as a fixed size, so it never measures a row to place
 * it and never corrects a scroll position after the fact. The row enforces it
 * rather than growing to fit — content that would exceed it must truncate.
 */
export const DM_ROW_HEIGHT = 64;

/**
 * The square the row reserves for the avatar.
 *
 * A group draws two 32px faces inside it rather than growing, so a row with a
 * group DM is laid out identically to one with a person — which is what keeps
 * `DM_ROW_HEIGHT` honest.
 */
export const DM_AVATAR_SIZE = 48;

/**
 * Clear space between the floating button and the top of the bottom bar.
 *
 * The button sits in the screen, the bar sits in the shell, so nothing lays
 * these two out together — this is the only thing keeping them apart.
 */
export const DMS_FAB_GAP = 12;

/** Clear space between the lowest action pill and the button. */
export const DMS_FAB_ACTIONS_GAP = 12;

/** Between pills. */
export const DMS_FAB_ACTION_SPACING = 12;

/**
 * Grok's spring, unchanged.
 *
 * The comment in the reference says damping 40 / stiffness 300; the code says
 * 120 / 1000, and the code is what produces the motion. Kept as written.
 */
export const DMS_FAB_SPRING = { damping: 120, stiffness: 1000 } as const;

/** How far a pill sits to the right of its resting place while closed. */
export const DMS_FAB_SLIDE_X = 20;
