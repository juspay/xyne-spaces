// ============================================================================
// FLOW ACTION ERROR CODES
// ============================================================================
//
// One contract for every failure a user can hit when they click a button on a
// Flow UI card (approval cards, forms, plan cards). Producers (xyne-claw-auth
// `/flow-action`, the Spaces backend `flowController`, third-party app
// backends) put one of these in `AppActionResponse.code`; the dashboard maps
// the code to what the user can do next (retry / reconnect / nothing).
//
// `code` stays an optional free-form string on the wire so older app backends
// keep validating — treat anything not in this list as `INTERNAL`.

export const FLOW_ACTION_ERROR_CODES = [
  /** Malformed card / missing flowJSON fields — a bug, not something the user did. */
  'INVALID_REQUEST',
  /** Not signed in, or the card's flow token is invalid / expired. */
  'SESSION_EXPIRED',
  /** The clicking user is not allowed to act on this card (wrong approver / workspace / org). */
  'NOT_AUTHORIZED',
  /** A downstream resource refused the write (e.g. read-only canvas access, private channel). */
  'PERMISSION_DENIED',
  /** The message, conversation or target resource no longer exists. */
  'NOT_FOUND',
  /** The card was already used. */
  'ALREADY_USED',
  /** The card is out of date (plan no longer active, suggestion expired, verification failed). */
  'STALE_ACTION',
  /** The tool / app rejected the input (400 / 422), or a required answer is missing. */
  'INVALID_INPUT',
  /** The write conflicts with the current state of the resource (409). */
  'CONFLICT',
  /** The user's connection to the integration is missing or revoked — reconnect fixes it. */
  'CONNECTION_REQUIRED',
  /** The agent / app is not configured correctly — an admin has to fix it. */
  'MISCONFIGURED',
  /** Too many requests (429). */
  'RATE_LIMITED',
  /** Upstream 5xx, network failure or timeout — safe to retry. */
  'UPSTREAM_UNAVAILABLE',
  /** HMAC / signature check failed — the card may have been tampered with. */
  'INTEGRITY_FAILED',
  /** Anything else. */
  'INTERNAL',
] as const;

export type FlowActionErrorCode = (typeof FLOW_ACTION_ERROR_CODES)[number];

const CODE_SET: ReadonlySet<string> = new Set(FLOW_ACTION_ERROR_CODES);

/** Codes where retrying the same click can succeed without anyone changing anything. */
export const RETRYABLE_FLOW_ACTION_ERROR_CODES: ReadonlySet<FlowActionErrorCode> = new Set<FlowActionErrorCode>([
  'UPSTREAM_UNAVAILABLE',
  'RATE_LIMITED',
]);

export function isFlowActionErrorCode(value: unknown): value is FlowActionErrorCode {
  return typeof value === 'string' && CODE_SET.has(value);
}

export function isRetryableFlowActionError(code: unknown): boolean {
  return isFlowActionErrorCode(code) && RETRYABLE_FLOW_ACTION_ERROR_CODES.has(code);
}

/**
 * Map an HTTP status (from a tool call, an app backend, or a Spaces API call)
 * to a stable error code. `0` / undefined means "no response" (network error).
 */
export function flowActionErrorCodeFromStatus(status: number | undefined | null): FlowActionErrorCode {
  if (status === undefined || status === null || status === 0) return 'UPSTREAM_UNAVAILABLE';
  if (status === 401 || status === 403) return 'PERMISSION_DENIED';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status === 400 || status === 422) return 'INVALID_INPUT';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 408 || status >= 500) return 'UPSTREAM_UNAVAILABLE';
  return 'INTERNAL';
}

/** Default user-facing copy per code. Producers may send a more specific message. */
export const FLOW_ACTION_ERROR_DEFAULT_MESSAGES: Record<FlowActionErrorCode, string> = {
  INVALID_REQUEST: 'This card is malformed and cannot be submitted.',
  SESSION_EXPIRED: 'This card has expired. Refresh the page and try again.',
  NOT_AUTHORIZED: "You're not allowed to act on this card.",
  PERMISSION_DENIED: "You don't have permission to make this change.",
  NOT_FOUND: 'The item this card refers to no longer exists.',
  ALREADY_USED: 'This card has already been used.',
  STALE_ACTION: 'This card is out of date. Ask the agent to create a new one.',
  INVALID_INPUT: 'The request was rejected because some input is invalid.',
  CONFLICT: 'This change conflicts with a newer update. Refresh and try again.',
  CONNECTION_REQUIRED: 'Your connection to this integration is missing or expired. Reconnect it and try again.',
  MISCONFIGURED: "This agent isn't set up correctly. Ask an admin to check its configuration.",
  RATE_LIMITED: 'Too many requests right now. Wait a moment and try again.',
  UPSTREAM_UNAVAILABLE: 'The service is temporarily unavailable. It is safe to try again.',
  INTEGRITY_FAILED: 'This card could not be verified. Ask the agent to create a new one.',
  INTERNAL: 'Something went wrong while running this action.',
};
