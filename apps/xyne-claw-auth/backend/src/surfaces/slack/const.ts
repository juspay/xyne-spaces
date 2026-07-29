/**
 * Slack surface tunables. Magic numbers/strings extracted from adapter.ts,
 * delivery.ts, and mrkdwn.ts so the surface's constants live in one place.
 */

/** Reject Slack request signatures whose timestamp drifts beyond this (replay guard). */
export const MAX_TIMESTAMP_SKEW_SECONDS = 300;

/** Slack's external-upload hard cap for a single file. */
export const MAX_SLACK_FILE_BYTES = 50 * 1024 * 1024;

/** Per-request ceiling for a Slack Web API call. */
export const SLACK_API_TIMEOUT_MS = 15_000;

/** Retries for transient failures. WebClient honours Retry-After on 429s —
 *  behaviour the previous hand-rolled fetch did not have at all. */
export const SLACK_API_MAX_RETRIES = 3;

/** Slack renders at most ~40k chars per message; stay just under. */
export const SLACK_TEXT_LIMIT = 39_000;

/** Appended when result text is clipped to SLACK_TEXT_LIMIT. */
export const TRUNCATED_SUFFIX = "… (truncated)";

/** Slack error codes proving an app is gone or unreachable for our token —
 *  anything else is treated as transient (fail-open, never mint duplicates). */
export const TERMINAL_APP_ACCESS_CODES = new Set([
  "app_not_found",
  "invalid_app_id",
  "app_not_installed",
  "not_authorized",
]);


/** How often stored Slack app-configuration tokens are rotated. */
export const CONFIG_TOKEN_ROTATION_INTERVAL_MS = 4 * 60 * 60 * 1000;

/** Slack auth errors proving the stored refresh token is dead. Anything else is
 *  transient: mark the connection expired rather than retrying a dead token. */
export const TERMINAL_SLACK_AUTH_ERRORS = new Set([
  "invalid_refresh_token",
  "token_revoked",
  "token_expired",
  "invalid_auth",
  "account_inactive",
]);

/**
 * Canonical slash-command name: "/" + 1-32 of [a-z0-9_-], first char alphanumeric.
 *
 * Mirrors Slack's own rule, but the reason it is enforced HERE is that the same
 * string is the key for three separate things: the manifest entry sent to
 * Slack, the exact-match filter that replaces an existing command, and the
 * inbound dispatch lookup (findSurfaceAgentByCommand). Slack delivers commands
 * lowercased, so accepting "/Deploy" would store a row that no inbound command
 * ever matches — a silently dead command.
 */
export const SLACK_COMMAND_RE = /^\/[a-z0-9][a-z0-9_-]{0,31}$/;

/** Redis key namespace for pending Slack OAuth installs. */
export const OAUTH_STATE_PREFIX = "slack-oauth-state:";

/** How long a pending OAuth install stays resumable. Bounds the window in which
 *  a leaked state value is usable; the state is single-use regardless. */
export const OAUTH_STATE_TTL_SECONDS = 10 * 60;

/** Slack retries an event until it gets a 200, so the same event_id can arrive
 *  several times. Suppress replays seen inside this window.
 *  NOTE: in-process only — with >1 replica each pod dedups independently
 *  (moving this to Redis is Phase 2's multi-replica item). */
export const EVENT_DEDUP_TTL_MS = 10 * 60 * 1000;

/** Ceiling on the in-process dedup map so a busy workspace cannot grow it
 *  without bound; oldest entries are evicted first. */
export const MAX_EVENT_DEDUP_ENTRIES = 10_000;

/** Linear backoff between response_url attempts (multiplied by attempt number).
 *  The URL stays valid ~30 min, so a few seconds of retry costs nothing. */
export const RESPONSE_URL_RETRY_DELAY_MS = 500;

