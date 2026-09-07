/**
 * API-key format for /api/sdk.
 *
 * The key *is* the credential and carries the caller's identity: it is minted
 * from the dashboard, presented as a bearer token, and accepted until it
 * expires. Keys are short-lived by design — a key grants everything its user
 * can do and there is no refresh step, so its lifetime is the only bound on
 * one that leaks. The dashboard offers `API_KEY_TTL_CHOICES` (30/60/90 days),
 * and a caller must name one — there is no configured default to fall back to.
 *
 * The Express middleware that verifies a presented key is
 * `middleware/sdkApiKeyAuth.ts`, not this file — this owns the format and how
 * one gets minted; that owns authenticating a request against it.
 *
 * ## What a key is
 *
 * `xyne_sk_` + a signed JWT, mirroring `services/jwtService.ts` — the same
 * `JWT_SECRET`, the same `sub`/`email`/`name`/`workspaceId`/`memberId` claim
 * shape session tokens carry, plus `orgId`, which session tokens have no need
 * of. A distinct `audience` claim (`xyne-sdk`, not `xyne-user`) keeps the two
 * token kinds from being interchangeable even though they share a secret: a
 * session token presented here, or vice versa, fails `jwt.verify`'s audience
 * check before anything else is looked at.
 *
 * `role` and `orgRole` are not claims — session JWTs never carried them either.
 * `apiKeyAuth` re-reads both from the database on every request, the same way
 * `extractAuthDataFromJWT` does for session callers, so a demoted or
 * deactivated user loses access on their very next request regardless of what
 * their key still says.
 *
 * `workspaceId` is not a per-request choice. A `User` row is itself scoped to
 * one workspace — somebody with access to two holds two user rows — so `sub`
 * already determines the workspace, and Zero's `Context` carries exactly one.
 * A key therefore acts in one workspace, and a second workspace needs its own.
 *
 * ## Where integrity comes from
 *
 * Two things, and both must hold.
 *
 * **The signature** proves the key is authentic. `jwt.verify` rejects anything
 * not signed with `JWT_SECRET` before a single claim is trusted, which is what
 * the AES scheme this replaced could not do — a cipher alone proved nothing
 * about who issued the key.
 *
 * **The `sdk_api_keys` row decides whether it is still allowed.** A signature
 * cannot be taken back once issued, so revocation has to live somewhere the
 * server can change after the fact. `apiKeyAuth` looks the row up by its
 * `token` on every request and rejects a key whose `status` is not `ACTIVE`,
 * or whose row is missing entirely. Deleting a key in the dashboard sets
 * `status = 'REVOKED'` rather than removing the row, so the key stops working
 * on its very next request and the row survives as the audit trail.
 *
 * A signature that verifies is therefore necessary but not sufficient. The
 * cost is one indexed read per request, alongside the two this already does
 * for `role` and `orgRole`; the benefit is that a leaked key can be killed
 * immediately instead of being live until its TTL runs out.
 */

import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import type { Context } from '@xyne/shared';
import type { AuthData } from '@/zero/mutators';
import { config } from '@/config/env';

/** Prefix that makes a leaked key greppable in logs and repositories. */
export const API_KEY_PREFIX = 'xyne_sk_';

/** Distinguishes an SDK key from a session token sharing the same `JWT_SECRET`. */
export const API_KEY_AUDIENCE = 'xyne-sdk';
const ISSUER = 'xyne';

/** The identity sealed into a key. Everything else is resolved per request. */
export interface KeyIdentity {
  readonly sub: string;
  readonly email: string;
  readonly name: string;
  readonly workspaceId: string;
  readonly orgId: string;
  readonly memberId: string;
}

export interface SdkAuth {
  readonly authData: AuthData;
  readonly ctx: Context;
  /** `sdk_api_keys.id` of the key that authenticated this request. */
  readonly keyId: string;
  /** When the presented key stops working, so a caller can rotate before it does. */
  readonly keyExpiresAt: Date;
}

/**
 * Lifecycle of a key's row. A plain string rather than a Postgres enum, per
 * the repo-wide enum freeze — see `scripts/validate-no-new-enums.sh`.
 *
 * There is no `EXPIRED`: expiry is a comparison against `expires_at`, not a
 * state anyone has to write, so deriving it keeps the two from disagreeing.
 */
export const SDK_API_KEY_STATUS = {
  ACTIVE: 'ACTIVE',
  REVOKED: 'REVOKED',
} as const;

export const SDK_API_KEY_STATUSES = [
  SDK_API_KEY_STATUS.ACTIVE,
  SDK_API_KEY_STATUS.REVOKED,
] as const;

export type SdkApiKeyStatus = (typeof SDK_API_KEY_STATUSES)[number];

// `Request.sdkAuth` is declared once, alongside `Request.user`, in
// `types/express.ts` — see that file for the augmentation.

/** The lifetimes a key can be minted with. There is no default — see `apiKeyExpiryFrom`. */
export const API_KEY_TTL_CHOICES = [30, 60, 90] as const;
export type ApiKeyTtlDays = (typeof API_KEY_TTL_CHOICES)[number];

/** When a key minted now, with the given lifetime, should stop working. */
export function apiKeyExpiryFrom(ttlDays: ApiKeyTtlDays, now: Date = new Date()): Date {
  return new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000);
}

function jwtSecret(): string {
  const secret = process.env['JWT_SECRET'];
  if (!secret) throw new Error('JWT_SECRET environment variable is required');
  return secret;
}

/**
 * Mint a key string for an identity, expiring at exactly `expiresAt`.
 *
 * Exported for the key-management routes; nothing else should call it.
 * `expiresAt` is set directly as the `exp` claim (in epoch seconds) rather
 * than handed to `jsonwebtoken` as a duration, so the token's real expiry and
 * the `sdk_api_keys.expires_at` row shown in the key list can never drift
 * apart — both come from the one `Date` the caller computed.
 *
 * `jwtid` is a fresh random id, not derived from the identity or the expiry.
 * Two keys minted for the same person with the same lifetime, in the same
 * second, would otherwise sign to the byte-identical token — HS256 has no
 * randomness of its own, unlike the AES scheme this replaced, whose random IV
 * made that impossible by construction. Without `jwtid`, the second insert
 * hits `sdk_api_keys.token`'s unique constraint and mint fails outright.
 */
export function mintApiKey(identity: KeyIdentity, expiresAt: Date): string {
  const token = jwt.sign(
    {
      sub: identity.sub,
      email: identity.email,
      name: identity.name,
      workspaceId: identity.workspaceId,
      orgId: identity.orgId,
      memberId: identity.memberId,
      exp: Math.floor(expiresAt.getTime() / 1000),
    },
    jwtSecret(),
    {
      issuer: ISSUER,
      audience: API_KEY_AUDIENCE,
      jwtid: randomUUID(),
    },
  );
  return `${API_KEY_PREFIX}${token}`;
}

export interface VerifiedApiKey {
  readonly identity: KeyIdentity;
  /** From the token's own `exp` claim — when it stops working. */
  readonly expiresAt: Date;
}

/**
 * Recover the identity from a key string. Throws `jwt.TokenExpiredError` or
 * `jwt.JsonWebTokenError` on anything invalid — callers map those, they do
 * not need to inspect this function's internals to know why it failed.
 *
 * Also honours `FORCE_LOGOUT_BEFORE` (`config.jwt.forceLogoutBefore`), the
 * same org-wide "sign everyone out" switch session tokens already respect —
 * see `extractAuthDataFromJWT` in `zero/server.ts`. A key issued before that
 * timestamp is treated as expired rather than merely rejected, since the
 * caller's fix is the same either way: mint a new one.
 */
export function verifyApiKey(key: string): VerifiedApiKey {
  const presented = key.startsWith(API_KEY_PREFIX) ? key.slice(API_KEY_PREFIX.length) : key;
  const decoded = jwt.verify(presented, jwtSecret(), {
    issuer: ISSUER,
    audience: API_KEY_AUDIENCE,
  }) as KeyIdentity & { iat?: number; exp: number };

  const forceLogoutBefore = config.jwt.forceLogoutBefore;
  if (forceLogoutBefore && decoded.iat && decoded.iat < forceLogoutBefore) {
    throw new jwt.TokenExpiredError('force logout', new Date(forceLogoutBefore * 1000));
  }

  return { identity: decoded, expiresAt: new Date(decoded.exp * 1000) };
}
