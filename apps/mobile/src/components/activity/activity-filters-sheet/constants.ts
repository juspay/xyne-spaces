/**
 * The filters view is laid out from fixed heights so the sheet's snap point
 * can be computed rather than measured: a measured (`dynamic`) sheet can lose
 * the race between its first layout and its first snap (see
 * `channel-tickets-filter-drawer.tsx`).
 */

/** gorhom's drag handle: 10pt above and below `AppBottomSheet`'s 5pt indicator. */
const HANDLE_HEIGHT = 25;
export const HEADER_HEIGHT = 44;
export const ROW_HEIGHT = 52;
export const SECTION_LABEL_HEIGHT = 30;
/** The segmented control: a 40pt segment inside 4pt of padding. */
const SEGMENTED_HEIGHT = 48;
export const DIVIDER_MARGIN = 8;
const DIVIDER_HEIGHT = DIVIDER_MARGIN * 2 + 1;
export const CONTENT_BOTTOM_PADDING = 16;

/** The "Anyone" / chosen-person row, and the gap above it. */
export const PERSON_BLOCK_HEIGHT = ROW_HEIGHT + 8;

/**
 * How long the person row takes to open — `AppBottomSheet`'s own animation
 * length, so the row and the sheet resize together.
 */
export const RESIZE_MS = 320;
/** The cross-fade between the filters and the picker. */
export const FADE_IN_MS = 200;
export const FADE_OUT_MS = 140;

/** The picker's share of the screen; the filters view is never taller. */
const PEOPLE_VIEW_SCREEN_SHARE = 0.62;

/**
 * Header, Mark as read, Unread, From (label, control and the person row when a
 * kind is picked), Actionable, View — with a divider between each group.
 */
export function filtersViewHeight(showsPerson: boolean, bottomInset: number): number {
  return (
    HANDLE_HEIGHT +
    HEADER_HEIGHT +
    ROW_HEIGHT +
    DIVIDER_HEIGHT +
    ROW_HEIGHT +
    DIVIDER_HEIGHT +
    SECTION_LABEL_HEIGHT +
    SEGMENTED_HEIGHT +
    (showsPerson ? PERSON_BLOCK_HEIGHT : 0) +
    DIVIDER_HEIGHT +
    ROW_HEIGHT +
    DIVIDER_HEIGHT +
    SECTION_LABEL_HEIGHT +
    SEGMENTED_HEIGHT +
    CONTENT_BOTTOM_PADDING +
    bottomInset
  );
}

export function peopleViewHeight(windowHeight: number, filtersHeight: number): number {
  return Math.max(filtersHeight, Math.round(windowHeight * PEOPLE_VIEW_SCREEN_SHARE));
}
