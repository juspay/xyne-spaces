/**
 * Access-token inspection.
 *
 * The SDK's access token is a signed JWT whose claims already identify the
 * caller — id, email, workspace, org membership, and granted scopes. Reading
 * them locally answers "who am I?" without a round trip, which matters because
 * there is no current-user query in the operation catalog to ask instead.
 *
 * These claims are NOT verified here, and must not be treated as a security
 * decision. Only the server's signature check is authoritative; this is the
 * caller reading its own credential for convenience.
 */

import { AuthError } from './errors.js';

/** The identity carried by an access token. */
export interface CurrentUser {
  /** The acting user's id, as used by every `userId` argument in the API. */
  id: string;
  email: string;
  name: string;
  workspaceId: string;
  /** Org membership id, required by some operations such as stage approvals. */
  memberId: string;
  /** The OAuth client the token was issued to. */
  clientId: string;
  /** Scopes granted to this token. */
  scopes: string[];
  /** When the token expires, as epoch milliseconds. */
  expiresAt: number;
}

interface AccessTokenClaims {
  sub?: string;
  email?: string;
  name?: string;
  workspace_id?: string;
  member_id?: string;
  client_id?: string;
  scope?: string;
  exp?: number;
}

function decodeSegment(segment: string): unknown {
  // Base64url → base64, then pad to a multiple of four.
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);

  // `atob` yields one byte per character, so names outside ASCII have to be
  // reassembled through TextDecoder rather than used directly. Both are global
  // in browsers and in Node 18+, which keeps this working either side.
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

/**
 * Read the identity out of an access token.
 *
 * @throws {AuthError} if the token is absent or not a readable JWT
 */
export function decodeAccessToken(token: string | undefined): CurrentUser {
  if (!token) {
    throw new AuthError('No access token is set. Pass one to createClient() or call setToken().');
  }

  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) {
    throw new AuthError('The access token is not a readable JWT.');
  }

  let claims: AccessTokenClaims;
  try {
    claims = decodeSegment(parts[1]) as AccessTokenClaims;
  } catch {
    throw new AuthError('The access token payload could not be decoded.');
  }

  if (!claims.sub || !claims.workspace_id || !claims.member_id) {
    throw new AuthError('The access token is missing the claims needed to identify you.');
  }

  return {
    id: claims.sub,
    email: claims.email ?? '',
    name: claims.name ?? '',
    workspaceId: claims.workspace_id,
    memberId: claims.member_id,
    clientId: claims.client_id ?? 'unknown',
    scopes: claims.scope ? claims.scope.split(' ').filter(Boolean) : [],
    // `exp` is in seconds; the rest of the SDK works in milliseconds.
    expiresAt: claims.exp ? claims.exp * 1000 : 0,
  };
}

/** Whether a token has expired, with a small clock-skew allowance. */
export function isTokenExpired(user: CurrentUser, skewMs = 30_000): boolean {
  return user.expiresAt > 0 && user.expiresAt - skewMs <= Date.now();
}
