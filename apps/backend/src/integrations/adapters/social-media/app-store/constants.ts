export const APP_STORE_API_BASE = 'https://api.appstoreconnect.apple.com';
export const APP_STORE_JWT_AUDIENCE = 'appstoreconnect-v1';

/** Apple rejects tokens with a lifetime over 20 minutes. */
export const APP_STORE_TOKEN_TTL_SECONDS = 15 * 60;
export const APP_STORE_TOKEN_REFRESH_MARGIN_SECONDS = 60;

export const APP_STORE_REQUEST_TIMEOUT_MS = 2 * 60 * 1000;
export const APP_STORE_PAGE_LIMIT = 200;

/**
 * How far back of already-seen createdDate we re-scan, to absorb Apple publishing reviews to the
 * API later than their createdDate. createdDate is immutable and there is no modification sort, so
 * a review first seen outside this window can never be picked up again. PLACEHOLDER — measure the
 * real lag before trusting it; APP_STORE_LAG_BREACH log lines report observed breaches.
 */
export const APP_STORE_PUBLICATION_LAG_MARGIN_MS = 72 * 60 * 60 * 1000;

export const APP_STORE_INITIAL_LOOKBACK_MS = 24 * 60 * 60 * 1000;

/** Page budget per run. Tripping it means the window was NOT fully covered — see flow.ts. */
export const APP_STORE_MAX_PAGES_PER_SYNC = 20;

/** Apple publishes responses asynchronously; past this a PENDING_PUBLISH reply is stuck. */
export const APP_STORE_RESPONSE_PUBLISH_SLA_MS = 24 * 60 * 60 * 1000;

/** Stop retrying an externalId after this many failed ingests, so the cursor can move on. */
export const APP_STORE_MAX_INGEST_ATTEMPTS = 5;

/** TTL on the Redis bookkeeping hashes, so abandoned state cannot accumulate forever. */
export const APP_STORE_STATE_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Pass B cadence. Bounded by the number of unpublished replies, which is normally tiny. */
export const APP_STORE_RECONCILE_INTERVAL_MS = 30 * 60 * 1000;
export const APP_STORE_MAX_RECONCILE_PER_RUN = 50;

export const APP_STORE_APP_FIELD = 'App Store App';
export const APP_STORE_BUNDLE_ID_FIELD = 'Bundle ID';
export const APP_STORE_TERRITORY_FIELD = 'Territory';
export const APP_STORE_RESPONSE_STATE_FIELD = 'App Store Response State';
