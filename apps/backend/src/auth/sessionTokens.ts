/**
 * Opaque session credential format and lookup helpers. Pure: no DB, no config.
 *
 * Token = `xs1_` + 32 random bytes (base64url); the row stores sha256(token). A value WITHOUT the
 * prefix is a legacy `workflow.user_sessions.id` (cuid), converted on first read.
 */
import { createHash, randomBytes } from 'crypto';
import type { Request } from 'express';
import {
  LEGACY_SESSION_COOKIE,
  LEGACY_SESSION_HEADER,
  OLD_SESSION_COOKIE,
  SESSION_COOKIE,
  SESSION_TOKEN_HEADER,
} from './constants';

export const SESSION_TOKEN_PREFIX = 'xs1_';

export function hashToken(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export interface MintedSessionToken {
  /** Client-facing opaque token (`xs1_...`). */
  token: string;
  /** sha256(token), the stored lookup key. */
  tokenHash: string;
}

export function mintSessionToken(): MintedSessionToken {
  const token = `${SESSION_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
  return { token, tokenHash: hashToken(token) };
}

/** A legacy `user_sessions.id` (cuid) or anything else that is not an `xs1_` token. */
export function isLegacyShaped(value: string): boolean {
  return !value.startsWith(SESSION_TOKEN_PREFIX);
}

export type CredentialSource = 'xs' | 'user_session_id' | 'xyne_session' | 'x-session-token' | 'x-session-id';

export interface SessionCredentialValue {
  value: string;
  source: CredentialSource;
}

type CredentialSourceInput = {
  cookies?: Record<string, unknown> | undefined;
  headers: Request['headers'];
};

function headerString(headers: Request['headers'], name: string): string | undefined {
  const v = headers[name];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && s.trim() ? s.trim() : undefined;
}

function cookieString(cookies: Record<string, unknown> | undefined, name: string): string | undefined {
  const v = cookies?.[name];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/**
 * The session credential a request presents. Cookies before headers: `x-session-id` is read LAST
 * because the dashboard echoes the encryption fingerprint (a hash) in it on encrypted bodies.
 */
export function readSessionCredential(input: CredentialSourceInput): SessionCredentialValue | null {
  const tries: Array<[CredentialSource, string | undefined]> = [
    ['xs', cookieString(input.cookies, SESSION_COOKIE)],
    ['user_session_id', cookieString(input.cookies, LEGACY_SESSION_COOKIE)],
    ['xyne_session', cookieString(input.cookies, OLD_SESSION_COOKIE)],
    ['x-session-token', headerString(input.headers, SESSION_TOKEN_HEADER)],
    ['x-session-id', headerString(input.headers, LEGACY_SESSION_HEADER)],
  ];
  for (const [source, value] of tries) if (value) return { value, source };
  return null;
}

/**
 * Stable per-client id for the encryption key store, usable before auth runs. Never the raw
 * token: `xs1_` ⇒ sha256(token) (= `tokenHash`); a legacy id stays itself so sessions converted
 * from `user_sessions` keep the key they registered before the deploy. The dashboard echoes this
 * value back as `x-session-id` on encrypted bodies, so that header is accepted as a last resort.
 */
export function getClientSessionFingerprint(req: CredentialSourceInput): string | undefined {
  const cred = readSessionCredential(req);
  if (!cred) return undefined;
  if (cred.source === 'x-session-id') return cred.value; // already a fingerprint
  return isLegacyShaped(cred.value) ? cred.value : hashToken(cred.value);
}
