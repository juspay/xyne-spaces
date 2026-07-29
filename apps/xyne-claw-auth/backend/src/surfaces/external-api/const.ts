/** Tunables and policy constants for external result-callback delivery. */

/** Backoff schedule between delivery attempts; attempts = length + 1. */
export const RETRY_DELAYS_MS = [1_000, 3_000] as const;
export const MAX_DELIVERY_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

/** HTTP statuses worth retrying: transient server-side or throttling failures. */
export const RETRYABLE_STATUSES = new Set([408, 429]);
export const RETRYABLE_STATUS_MIN = 500;

/** Per-attempt ceiling for a callback POST. An integrator that never responds
 *  must not pin the attempt open indefinitely (attempts are bounded by
 *  MAX_DELIVERY_ATTEMPTS, so worst case is this × attempts plus backoff). */
export const CALLBACK_TIMEOUT_MS = 15_000;

/** SSRF policy: outbound callbacks may only target plain http(s)… */
export const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
/** …and never cloud metadata or link-local addresses. */
export const BLOCKED_HOSTNAMES = new Set(["metadata.google.internal"]);
export const LINK_LOCAL_IPV4_RE = /^169\.254\.\d{1,3}\.\d{1,3}$/;

/** Hostnames treated as internal in development only. */
export const DEV_LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);
