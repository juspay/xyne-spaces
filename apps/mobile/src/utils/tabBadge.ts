/**
 * Reserves enough width for Android's single-line navigation badge label. iOS
 * uses the system UITabBar badge and sizes the same label independently.
 */
const TAB_BADGE_DIAMETER = 18;
const TAB_BADGE_HORIZONTAL_PADDING = 4;
const TAB_BADGE_CHARACTER_WIDTH = 8;

export const getTabBadgeMinWidth = (label: string | undefined): number =>
  Math.max(
    TAB_BADGE_DIAMETER,
    (label?.length ?? 0) * TAB_BADGE_CHARACTER_WIDTH + TAB_BADGE_HORIZONTAL_PADDING * 2,
  );
