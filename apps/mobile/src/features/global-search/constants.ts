/**
 * Layout metrics for the search toolbar. They have to agree with each other: the
 * list's top inset derives from the toolbar's expanded height, and a badge row must
 * never be shorter than its badges. `search-motion.test.ts` pins the row metrics.
 */

export const SEARCH_SIDE_MARGIN = 16;
export const SEARCH_BAR_HEIGHT = 44;
export const SEARCH_BAR_ICON_SIZE = 18;
export const SEARCH_BAR_TEXT_FONT_SIZE = 16;
export const SEARCH_BAR_TEXT_LINE_HEIGHT = 22;

/**
 * Both toolbar rows — the category tags and the dropdown filters — are built
 * from the same Badge the DM / Channels / Activity lists use, so they share one
 * intrinsic height. py-1.5 + 16px text + hairline borders.
 *
 * Each row is given an explicit height and its badges are never sized against
 * it: content taller than a horizontal ScrollView's frame becomes grabbable on
 * the vertical axis (the same trap the search pill hit), so this must stay <=
 * both row heights below.
 */
export const SEARCH_BADGE_INTRINSIC_HEIGHT = 36;

/** Category tag strip, between the search pill and the filter row. */
export const SEARCH_CATEGORY_ROW_TOP_GAP = 10;
export const SEARCH_CATEGORY_ROW_HEIGHT = 40;
export const SEARCH_CATEGORY_ROW_GAP = 8;

/** Dropdown filter row — From / In / Only my channels. */
export const SEARCH_FILTER_ROW_TOP_GAP = 10;
export const SEARCH_FILTER_ROW_HEIGHT = 40;
export const SEARCH_FILTER_ROW_GAP = 8;

/**
 * How far the results scroll before the dropdown filter row is fully collapsed.
 * Short on purpose — one chip row is a small thing to hide, and a long runway
 * leaves it half-faded for most of a flick.
 */
export const SEARCH_FILTER_ROW_COLLAPSE_DISTANCE = 72;

/** Equal gap above and below the dummy search bar in TabsScreenHeader. */
export const TABS_SEARCH_BAR_VERTICAL_GAP = 12;

/** Scroll collapse of dummy bar in TabsScreenHeader */
export const TABS_SEARCH_COLLAPSE_DISTANCE = 200;
