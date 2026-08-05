/**
 * Permanent (non-recoverable) auth-failure detection for external email sources.
 *
 * A "permanent" auth error means the stored OAuth credential can no longer be
 * used to talk to the provider and there is NO way to recover from a background
 * job — the user must re-consent (reconnect). When we see one of these we should
 * stop retrying, flip the source out of the "connected" state, and tell the
 * owner to reconnect.
 *
 * This used to be a bare `/invalid_grant|unauthorized_client|invalid_token/i`
 * regex copy-pasted across the watch-renewal queue, the Gmail watch provider,
 * the email-fetch worker, and the manual refetch route. That narrow set MISSED
 * the most common real-world failure — google-auth-library throwing
 * "No access, refresh token, API key or refresh handler callback is set."
 * (a mailbox whose refresh token is gone). Because that string didn't match,
 * the renewal job classified it as transient, never deactivated the source,
 * and the "Connected" badge stayed green while mail silently stopped.
 *
 * Centralize + widen it here so every call site agrees on what "reconnect
 * required" means.
 */

/**
 * Substrings/patterns that indicate the credential is dead and a reconnect
 * (re-consent) is required. Matched case-insensitively against the error
 * message. Keep this list conservative — only add a pattern when the ONLY
 * remedy is the user re-authorizing.
 */
const PERMANENT_AUTH_ERROR_PATTERNS: RegExp[] = [
  // Google/OAuth2 standard error codes (RFC 6749 + Google extensions)
  /invalid_grant/i,
  /unauthorized_client/i,
  /invalid_token/i,
  /invalid_client/i,
  // Google says the token was explicitly revoked or has fully expired
  /token has been expired or revoked/i,
  // google-auth-library throws this when the stored credential has no usable
  // refresh token — the dominant failure in the Aug-2026 desk mail incident.
  /no access,?\s*refresh token/i,
  /refresh handler callback/i,
];

/**
 * Returns true when the given error means the source's OAuth credential is
 * permanently unusable and the owner must reconnect. Accepts an Error, a
 * string, or anything stringifiable.
 */
export function isPermanentAuthError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : String(error ?? '');
  if (!message) return false;
  return PERMANENT_AUTH_ERROR_PATTERNS.some((re) => re.test(message));
}
