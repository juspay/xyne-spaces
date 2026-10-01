export interface OAuthReturn {
  /** The connector's server type, e.g. "github". */
  type: string;
  /** The URL keys the callback added, to take off again. */
  keys: string[];
  ok: boolean;
  /** Why it failed, as the callback put it (`access_denied`, `token_exchange_failed`, …). */
  reason?: string;
}

/** What an OAuth callback added to the URL it sent the browser back to, if anything. */
export function readOAuthReturn(params: URLSearchParams): OAuthReturn | null {
  for (const key of params.keys()) {
    const connected = /^(.+)_connected$/.exec(key);
    if (connected && params.get(key) === 'true') {
      return { type: connected[1]!, keys: [key], ok: true };
    }
    const failed = /^(.+)_error$/.exec(key);
    if (failed) {
      return { type: failed[1]!, keys: [key], ok: false, reason: params.get(key) ?? '' };
    }
  }
  return null;
}

export function oauthReturnMessage(result: OAuthReturn, label: string): string {
  if (result.ok) return `${label} connected`;
  if (result.reason === 'access_denied') return `${label} wasn't connected: the sign-in was cancelled`;
  if (result.reason === 'expired' || result.reason === 'invalid_state') {
    return `${label} wasn't connected: the sign-in took too long. Try again.`;
  }
  return `Couldn't connect ${label}. Try again.`;
}
