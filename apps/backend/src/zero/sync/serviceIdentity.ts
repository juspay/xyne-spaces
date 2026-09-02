import jwt from 'jsonwebtoken';
import type { Context } from '@xyne/shared';

/**
 * The sync engine authenticates as a cross-tenant SYSTEM principal — not a user,
 * not a (tenant-scoped) bot. Its get-queries token is signed with JWT_SECRET but
 * carries audience 'sync-service' instead of the user audience 'xyne-user'. That
 * audience split isolates it: user-auth (which requires 'xyne-user') rejects this
 * token, and it verifies ONLY in the get-queries base branch — where it can serve
 * an allowlisted `.base` and nothing else (no fused data, no mutations).
 */
export const SYNC_SERVICE_SUB = 'sync-service';
const SYNC_SERVICE_AUDIENCE = 'sync-service';
const SYNC_ISSUER = 'xyne';
/** Pseudo-workspace — only names the forwarded cookie; the base is workspace-agnostic. */
const SYNC_WORKSPACE = 'sync-service';
const TOKEN_TTL_SECONDS = 60 * 60;

function jwtSecret(): string {
  const secret = process.env['JWT_SECRET'];
  if (!secret) throw new Error('JWT_SECRET is required for the sync engine');
  return secret;
}

/** The (inert) execution context for the sync-service principal; allowlisted bases never read it. */
export function syncContext(workspaceId: string = SYNC_WORKSPACE): Context {
  return {
    userID: SYNC_SERVICE_SUB,
    workspaceId,
    role: SYNC_SERVICE_SUB,
    orgRole: SYNC_SERVICE_SUB,
    memberId: SYNC_SERVICE_SUB,
  };
}

/** Token zero-cache validates off the Sec-WebSocket-Protocol header (ZERO_AUTH_SECRET). */
export function mintSecProtocolToken(): string {
  const secret = process.env['ZERO_AUTH_SECRET'];
  if (!secret) throw new Error('ZERO_AUTH_SECRET is required for the sync engine');
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign({ sub: SYNC_SERVICE_SUB, iat: now, exp: now + TOKEN_TTL_SECONDS }, secret, {
    algorithm: 'HS256',
  });
}

/** Service token for the get-queries transform: JWT_SECRET, issuer 'xyne', audience 'sync-service'. */
export function mintServiceToken(): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    { sub: SYNC_SERVICE_SUB, workspaceId: SYNC_WORKSPACE, iat: now, exp: now + TOKEN_TTL_SECONDS },
    jwtSecret(),
    { algorithm: 'HS256', issuer: SYNC_ISSUER, audience: SYNC_SERVICE_AUDIENCE },
  );
}

/** Cookie header for the WS upgrade — zero-cache forwards it to get-queries, which lifts it to a Bearer token. */
export function buildCookieHeader(): string {
  return `xyne_last_workspace=${SYNC_WORKSPACE}; xyne_ws_${SYNC_WORKSPACE}_token=${mintServiceToken()}`;
}

/**
 * Verify a request's bearer token as the sync-service principal and return its
 * Context, or null if absent/invalid. Audience isolation guarantees a user token
 * (aud 'xyne-user') never verifies here, and this token never verifies as a user.
 */
export function verifySyncServiceToken(authHeader: string | null | undefined): Context | null {
  if (!authHeader?.startsWith('Bearer ')) return null;
  try {
    const decoded = jwt.verify(authHeader.slice(7), jwtSecret(), {
      issuer: SYNC_ISSUER,
      audience: SYNC_SERVICE_AUDIENCE,
    }) as { sub?: string; workspaceId?: string };
    if (decoded.sub !== SYNC_SERVICE_SUB) return null;
    return syncContext(decoded.workspaceId ?? SYNC_WORKSPACE);
  } catch {
    return null;
  }
}
