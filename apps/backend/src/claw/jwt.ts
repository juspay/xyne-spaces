/**
 * ES256 JWT helpers for the Spaces ⇄ Claw trust boundary (node:crypto, synchronous).
 *
 * One Spaces key pair signs everything Spaces vouches for (CLAW_DELEGATION_PRIVATE_KEY):
 *   - delegation tokens for claw-auth        aud "xyne-claw-auth"
 *   - agent access tokens for Spaces itself  aud "xyne-spaces-api", typ "claw-agent+jwt"
 *   - event tokens on outbound events        aud "xyne-claw-auth",  typ "claw-event+jwt"
 * claw-auth signs its own service assertions with a key Spaces never holds
 * (CLAW_SERVICE_PUBLIC_KEYS here, private half in claw-auth).
 */

import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from 'crypto';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';

export const SPACES_ISSUER = 'xyne-spaces';
export const CLAW_AUTH_AUDIENCE = 'xyne-claw-auth';
export const SPACES_API_AUDIENCE = 'xyne-spaces-api';
export const CLAW_AUTH_ISSUER = 'xyne-claw-auth';

export type JwtPayload = Record<string, unknown> & { iat?: number; exp?: number };

function b64url(input: Buffer | string): string {
  return (typeof input === 'string' ? Buffer.from(input, 'utf8') : input).toString('base64url');
}

let cachedSigner: { pem: string; key: KeyObject | null; publicKey: KeyObject | null } | null = null;

function loadSigner(): { key: KeyObject | null; publicKey: KeyObject | null } {
  const pem = (config.xyneClaw.delegationPrivateKey || '').replace(/\\n/g, '\n').trim();
  if (cachedSigner?.pem === pem) return cachedSigner;
  let key: KeyObject | null = null;
  let publicKey: KeyObject | null = null;
  if (pem) {
    try {
      const parsed = createPrivateKey(pem);
      if (parsed.asymmetricKeyType === 'ec' && parsed.asymmetricKeyDetails?.namedCurve === 'prime256v1') {
        key = parsed;
        publicKey = createPublicKey(parsed);
      } else {
        logger.error('[ClawJwt] CLAW_DELEGATION_PRIVATE_KEY must be an EC P-256 key; Spaces signing disabled');
      }
    } catch (error) {
      logger.error('[ClawJwt] CLAW_DELEGATION_PRIVATE_KEY could not be parsed; Spaces signing disabled', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  cachedSigner = { pem, key, publicKey };
  return cachedSigner;
}

/** Spaces' signing key id (kid header). */
export function spacesKeyId(): string {
  return config.xyneClaw.delegationKeyId || 'spaces-1';
}

/** True when Spaces can sign (CLAW_DELEGATION_PRIVATE_KEY is a valid P-256 key). */
export function spacesCanSign(): boolean {
  return loadSigner().key !== null;
}

/** Sign `payload` with Spaces' key. Returns undefined when no key is configured. */
export function signSpacesJwt(payload: JwtPayload, typ = 'JWT'): string | undefined {
  const { key } = loadSigner();
  if (!key) return undefined;
  return signEs256(payload, key, spacesKeyId(), typ);
}

export function signEs256(payload: JwtPayload, key: KeyObject, kid: string, typ = 'JWT'): string {
  const header = { alg: 'ES256', typ, kid };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  // JWS ES256 wants the raw r||s signature, not DER.
  const signature = sign('sha256', Buffer.from(signingInput), { key, dsaEncoding: 'ieee-p1363' });
  return `${signingInput}.${b64url(signature)}`;
}

export type VerifyFailure = 'malformed' | 'unknown-key' | 'bad-signature' | 'bad-claims' | 'expired' | 'lifetime-too-long';

export interface VerifyOptions {
  issuer: string;
  audience: string;
  typ?: string;
  /** Upper bound on exp - iat, in seconds. */
  maxLifetimeSeconds: number;
  clockToleranceSeconds?: number;
}

/**
 * Verify an ES256 JWT. `resolveKey` maps the header kid to a public key.
 * Requires iss, aud, iat, exp; rejects tokens whose lifetime exceeds the bound.
 */
export function verifyEs256(
  token: unknown,
  resolveKey: (kid: string) => KeyObject | undefined,
  opts: VerifyOptions
): { header: Record<string, unknown>; payload: JwtPayload } | VerifyFailure {
  if (typeof token !== 'string') return 'malformed';
  const parts = token.trim().split('.');
  if (parts.length !== 3 || parts.some((p) => !p)) return 'malformed';
  const [h, p, s] = parts as [string, string, string];
  let header: Record<string, unknown>;
  let payload: JwtPayload;
  try {
    header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
  } catch {
    return 'malformed';
  }
  if (header.alg !== 'ES256') return 'malformed';
  if (opts.typ && header.typ !== opts.typ) return 'bad-claims';
  const kid = typeof header.kid === 'string' ? header.kid : '';
  const key = kid ? resolveKey(kid) : undefined;
  if (!key) return 'unknown-key';
  const ok = verify('sha256', Buffer.from(`${h}.${p}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'));
  if (!ok) return 'bad-signature';

  const tolerance = opts.clockToleranceSeconds ?? 30;
  const now = Math.floor(Date.now() / 1000);
  if (payload.iss !== opts.issuer) return 'bad-claims';
  const aud = payload.aud;
  if (!(aud === opts.audience || (Array.isArray(aud) && aud.includes(opts.audience)))) return 'bad-claims';
  if (typeof payload.iat !== 'number' || typeof payload.exp !== 'number') return 'bad-claims';
  if (payload.exp + tolerance <= now) return 'expired';
  if (payload.iat - tolerance > now) return 'bad-claims';
  if (payload.exp - payload.iat > opts.maxLifetimeSeconds) return 'lifetime-too-long';
  return { header, payload };
}

/** Resolver for tokens Spaces signed itself (agent access tokens). */
export function spacesPublicKey(kid: string): KeyObject | undefined {
  const { publicKey } = loadSigner();
  return publicKey && kid === spacesKeyId() ? publicKey : undefined;
}

const keySetCache = new Map<string, { raw: string; keys: Map<string, KeyObject> }>();

/** Parse a {"<kid>":"<SPKI PEM>"} map of P-256 public keys (cached per env var). */
function keySet(name: string, raw: string): Map<string, KeyObject> {
  const hit = keySetCache.get(name);
  if (hit?.raw === raw) return hit.keys;
  const keys = new Map<string, KeyObject>();
  try {
    const parsed = raw.trim() ? (JSON.parse(raw) as Record<string, unknown>) : {};
    for (const [k, pem] of Object.entries(parsed)) {
      if (typeof pem !== 'string') continue;
      try {
        const pub = createPublicKey(pem.replace(/\\n/g, '\n'));
        if (pub.asymmetricKeyType === 'ec' && pub.asymmetricKeyDetails?.namedCurve === 'prime256v1') keys.set(k, pub);
      } catch {
        logger.error(`[ClawJwt] ${name} entry could not be parsed`, { kid: k });
      }
    }
  } catch {
    logger.error(`[ClawJwt] ${name} is not valid JSON`);
  }
  keySetCache.set(name, { raw, keys });
  return keys;
}

/** Resolver for claw-auth's service assertions: CLAW_SERVICE_PUBLIC_KEYS = {"<kid>":"<SPKI PEM>"}. */
export function clawServicePublicKey(kid: string): KeyObject | undefined {
  return keySet('CLAW_SERVICE_PUBLIC_KEYS', config.xyneClaw.servicePublicKeys || '').get(kid);
}

/** Resolver for the xyne-claw runtime's service assertions: CLAW_RUNTIME_PUBLIC_KEYS. */
export function clawRuntimePublicKey(kid: string): KeyObject | undefined {
  return keySet('CLAW_RUNTIME_PUBLIC_KEYS', config.xyneClaw.runtimePublicKeys || '').get(kid);
}
