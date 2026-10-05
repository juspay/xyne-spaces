/**
 * Opaque session credential format and lookup helpers. Pure: no DB, no config.
 *
 * Token = `xs1_` + payload.
 *   SESSION_TOKEN_MODE=legacy  payload = auth_sessions.id (uuid), tokenHash null
 *   SESSION_TOKEN_MODE=hashed  payload = 32 random bytes (base64url), row stores sha256(payload)
 * Lookup always tries both (`tokenHash` match OR `id` match) so flipping the flag never
 * invalidates live sessions. A value WITHOUT the prefix is a legacy `user_sessions.id`
 * (claw forges `xyne_session=<legacy id>` today).
 */
import { createHash, randomBytes, randomUUID } from 'crypto';
import type { Prisma } from '@prisma/client';
import type { Request } from 'express';
import type { SessionTokenMode } from './types';
import { LEGACY_SESSION_COOKIE, LEGACY_SESSION_HEADER, SESSION_COOKIE, SESSION_TOKEN_HEADER } from './constants';

export const SESSION_TOKEN_PREFIX = 'xs1_';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null | undefined): boolean {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function hashToken(payload: string): string {
  return createHash('sha256').update(payload).digest('hex');
}

export interface SessionCredential {
  /** auth_sessions.id */
  id: string;
  /** Client-facing opaque token (`xs1_...`). */
  token: string;
  /** Stored sha256 of the payload, or null in legacy mode (payload == id). */
  tokenHash: string | null;
}

export function mintSessionCredential(mode: SessionTokenMode): SessionCredential {
  const id = randomUUID();
  if (mode === 'hashed') {
    const payload = randomBytes(32).toString('base64url');
    return { id, token: `${SESSION_TOKEN_PREFIX}${payload}`, tokenHash: hashToken(payload) };
  }
  return { id, token: `${SESSION_TOKEN_PREFIX}${id}`, tokenHash: null };
}

export type ParsedSessionToken = { kind: 'v3'; payload: string } | { kind: 'legacy_id'; id: string };

export function parseSessionToken(value: string | null | undefined): ParsedSessionToken | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith(SESSION_TOKEN_PREFIX)) {
    const payload = trimmed.slice(SESSION_TOKEN_PREFIX.length);
    return payload ? { kind: 'v3', payload } : null;
  }
  return { kind: 'legacy_id', id: trimmed };
}

/** Where-clause matching a v3 payload in either token mode. */
export function sessionLookupWhere(payload: string): Prisma.AuthSessionWhereInput {
  const or: Prisma.AuthSessionWhereInput[] = [{ tokenHash: hashToken(payload) }];
  if (isUuid(payload)) or.push({ id: payload });
  return { OR: or };
}

type FingerprintSource = {
  cookies?: Record<string, unknown> | undefined;
  headers: Request['headers'];
};

function headerString(headers: Request['headers'], name: string): string | undefined {
  const v = headers[name];
  if (Array.isArray(v)) return v[0];
  return typeof v === 'string' && v ? v : undefined;
}

function cookieString(cookies: Record<string, unknown> | undefined, name: string): string | undefined {
  const v = cookies?.[name];
  return typeof v === 'string' && v ? v : undefined;
}

/**
 * Stable per-client id for the encryption key store, usable before auth runs.
 * `user_session_id` cookie > `x-session-id` header > sha256 of the opaque session token.
 * The dashboard echoes this value back as `x-session-id` on encrypted bodies (from /public-key).
 */
export function getClientSessionFingerprint(req: FingerprintSource): string | undefined {
  const legacy = cookieString(req.cookies, LEGACY_SESSION_COOKIE) ?? headerString(req.headers, LEGACY_SESSION_HEADER);
  if (legacy) return legacy;
  const opaque = cookieString(req.cookies, SESSION_COOKIE) ?? headerString(req.headers, SESSION_TOKEN_HEADER);
  if (!opaque) return undefined;
  const parsed = parseSessionToken(opaque);
  if (!parsed) return undefined;
  // A legacy-shaped xyne_session IS the legacy id (claw) — keep it as-is so the key store lines up.
  if (parsed.kind === 'legacy_id') return parsed.id;
  return hashToken(parsed.payload);
}
