/** Tunables for loading and rendering. */
export const SPACES_WEB_URL = 'https://spaces.xyne.juspay.net';
export const PAGE_SIZE = 100;
export const ID_BATCH = 100;
export const PROJECT_CONCURRENCY = 4;
export const DESK_CONCURRENCY = 4;
export const PARENT_CONCURRENCY = 6;
/** How many sub-ticket levels to follow below (and above) a merchant ticket. */
export const LINK_DEPTH = 3;
export const CHAIN_PAGE = 100;
export const TABLE_PAGE = 200;
export const RETRY_DELAY_MS = 500;
/** Per-request SDK timeout; some pages (projects crawled with custom fields attached) are slow. */
export const REQUEST_TIMEOUT_MS = 180_000;
/** Channel types that feed Xyne Desk — mirrors DESK_CHANNEL_TYPES in packages/shared. */
export const DESK_CHANNEL_TYPES: ReadonlySet<string> = new Set(['EMAIL', 'SLACK', 'APP', 'CALL', 'SOCIAL_MEDIA']);
/** A sync re-reads from this long before the last sync, to absorb clock skew and in-flight writes. */
export const SYNC_OVERLAP_MS = 5 * 60_000;
/** Opening the app does a full reload instead of a sync when the last full load is older than this. */
export const FULL_RELOAD_AFTER_MS = 24 * 60 * 60_000;
/** Date windows fetched in parallel when a project is crawled whole. */
export const WINDOW_CONCURRENCY = 4;
/** Flag thresholds, in days (the redesign's defaults). */
export const FLAG_CFG = {
  ageing: 14,
  stale: 7,
  escalate: 3,
  longHold: 10,
  placeholder: 2,
};
