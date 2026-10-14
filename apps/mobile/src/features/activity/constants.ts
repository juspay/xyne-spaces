/**
 * Row metrics.
 *
 * Unlike DMs and Channels the row is not a fixed height: a body runs one to
 * three lines. The estimate is the Figma row at three lines, which is the
 * common case for a message preview and keeps LegendList's first layout
 * pass close to the final one.
 */
export const ACTIVITY_ROW_ESTIMATED_HEIGHT = 140;

export const ACTIVITY_ROW_PADDING_X = 16;
export const ACTIVITY_ROW_PADDING_Y = 14;

export const ACTIVITY_AVATAR_SIZE = 30;
export const ACTIVITY_AVATAR_GAP = 14;

/** The action badge overlapping the avatar's bottom-right corner. */
export const ACTIVITY_BADGE_SIZE = 22;
export const ACTIVITY_BADGE_ICON_SIZE = 12;
export const ACTIVITY_BADGE_OFFSET = -6;

export const ACTIVITY_ACTOR_SIZE = 16;
export const ACTIVITY_ACTOR_LINE_HEIGHT = 22;
export const ACTIVITY_TIME_SIZE = 13;

export const ACTIVITY_SUMMARY_SIZE = 15;
export const ACTIVITY_SUMMARY_LINE_HEIGHT = 24;
export const ACTIVITY_CHIP_SIZE = 14;

export const ACTIVITY_BODY_SIZE = 16;
export const ACTIVITY_BODY_LINE_HEIGHT = 24;
export const ACTIVITY_BODY_LINES = 3;
export const ACTIVITY_BODY_GAP = 4;

/** Rows of lead time before `onEndReached`, in viewports. */
export const ACTIVITY_END_REACHED_THRESHOLD = 2;
export const ACTIVITY_DRAW_DISTANCE = 500;
export const ACTIVITY_SCROLL_WINDOW_TAG = 'scroll:activity';
export const ACTIVITY_SCROLL_SETTLE_FALLBACK_MS = 2_000;
export const ACTIVITY_SKELETON_ROW_HEIGHT = 112;

/** The most previews kept converted, so a long session does not grow without bound. */
export const ACTIVITY_PREVIEW_CACHE_SIZE = 300;
