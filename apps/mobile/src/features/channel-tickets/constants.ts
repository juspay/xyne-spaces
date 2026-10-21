/** Rows fetched per window step. Matches the desk list page size. */
export const CHANNEL_TICKETS_PAGE_SIZE = 50;
/** Hard cap on the growing window (PAGE_SIZE * MAX_PAGES rows). */
export const CHANNEL_TICKETS_MAX_PAGES = 10;

export const CHANNEL_TICKETS_ROW_HEIGHT = 56;
export const CHANNEL_TICKETS_HEADER_ROW_HEIGHT = 40;
export const CHANNEL_TICKETS_CELL_PADDING_X = 12;
export const CHANNEL_TICKETS_DRAW_DISTANCE = 360;
export const CHANNEL_TICKETS_SKELETON_ROWS = 8;

/** Chrome above the table: back header. Filters bar height is measured live. */
export const CHANNEL_TICKETS_HEADER_HEIGHT = 44;

export const CHANNEL_TICKETS_FILTER_OVERLAY_MS = 280;

/** Gap under the header and inset on all four sides of the table card. */
export const CHANNEL_TICKETS_TABLE_INSET = 12;
export const CHANNEL_TICKETS_TABLE_RADIUS = 14;

/** Search: debounce before the Vespa round trip, and how many hits to ask for. */
export const CHANNEL_TICKETS_SEARCH_DEBOUNCE_MS = 300;
export const CHANNEL_TICKETS_SEARCH_LIMIT = 50;
export const CHANNEL_TICKETS_SEARCH_BAR_HEIGHT = 44;
