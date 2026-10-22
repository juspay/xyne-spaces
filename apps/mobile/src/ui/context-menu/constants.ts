/**
 * Metrics from Telegram for Android's context menu.
 *
 * Source: `ActionBar/ActionBarMenuSubItem.java` and
 * `ActionBar/ActionBarPopupWindow.java`. Telegram's units are `dp`, which is
 * what React Native lays out in, so they transfer one for one.
 */

/** `itemHeight`. */
export const MENU_ITEM_HEIGHT = 48;
/** `setPadding(dp(18), 0, dp(18), 0)`. */
export const MENU_ITEM_PADDING_X = 18;
export const MENU_ITEM_TEXT_SIZE = 16;
export const MENU_ICON_SIZE = 24;
/** The disclosure chevron after an item's value. */
export const MENU_CHEVRON_SIZE = 18;
/** Text sits 43 past the padding, so the icon column is 24 wide plus this. */
export const MENU_ICON_GAP = 19;

/** Telegram's popups do not go narrower than this. */
export const MENU_MIN_WIDTH = 196;
export const MENU_MAX_WIDTH = 320;
export const MENU_CORNER_RADIUS = 20;

/** The label row above the items, as in the design. */
export const MENU_LABEL_HEIGHT = 36;
export const MENU_LABEL_TEXT_SIZE = 14;

/** Clear space between the anchor and the card. */
export const MENU_ANCHOR_GAP = 8;
/** Closest the card may come to any screen edge, inside the safe area. */
export const MENU_SCREEN_PADDING = 12;

/**
 * `startAnimation`: the card's `backScaleY` runs for `150 + 16 * count`, so a
 * longer menu takes slightly longer to unfurl.
 */
export const MENU_OPEN_BASE_MS = 150;
export const MENU_OPEN_PER_ITEM_MS = 16;
export const MENU_CLOSE_MS = 120;

/** `startChildAnimation`: alpha and a 6dp slide, decelerating. */
export const MENU_ITEM_FADE_MS = 180;
export const MENU_ITEM_SLIDE = 6;
/** Not Telegram's own — it starts each item as it is added. */
export const MENU_ITEM_STAGGER_MS = 20;
