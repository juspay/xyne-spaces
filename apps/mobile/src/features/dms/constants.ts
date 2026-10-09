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
