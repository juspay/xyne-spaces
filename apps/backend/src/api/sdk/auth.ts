/**
 * API-key format for /api/sdk.
 *
 * The key *is* the credential and carries the caller's identity: it is minted
 * from the dashboard, presented as a bearer token, and accepted until it expires
 * or is revoked. Keys are short-lived by design — a key grants everything its
 * user can do and there is no refresh step, so its lifetime is the only bound on
 * one that leaks. The dashboard offers `API_KEY_TTL_CHOICES` (30/60/90 days), and
 * a caller must name one — there is no configured default to fall back to.
 *
 * The Express middleware that verifies a presented key is
 * `middleware/sdkApiKeyAuth.ts`, not this file — this owns the format and how
 * one gets minted; that owns authenticating a request against it.
 *
 * ## What a key contains
 *
 * `xyne_sk_` + base64url( AES-256-CBC( JSON of the stable identity ) ), where the
 * stable identity is the subset of `AuthData` that does not change:
 *
 *     { sub, email, name, workspaceId, orgId, memberId }
 *
 * `workspaceId` is not a per-request choice. A `User` row is itself scoped to one
 * workspace — somebody with access to two holds two user rows — so `sub` already
 * determines the workspace, and Zero's `Context` carries exactly one. A key
 * therefore acts in one workspace, and a second workspace needs its own key.
 *
 * `role` and `orgRole` are deliberately excluded. They drive the mutator ACL, so
 * they are re-read from the database on every request — a demoted or deactivated
 * user loses access immediately rather than when someone remembers to delete
 * their key. `extractAuthDataFromJWT` resolves them the same way for session
 * callers. Expiry lives on the row for the same reason: both are facts that can
 * change after the key was handed out.
 *
 * ## Where integrity comes from
 *
 * Not from the cipher. `encryptionService` is AES-CBC with no MAC, so ciphertext
 * is malleable and a decrypt "succeeding" proves nothing. Authentication is the
 * exact-match lookup of the presented key against `sdk_api_keys.token`, which is
 * `@unique`: a forged or tampered key matches no row and is rejected before any
 * field inside it is trusted. The same lookup is the revocation point.
 *
 * The result is an `AuthData` identical in shape to the one the app builds from a
 * session JWT, which is why the query, mutation, and direct-API paths can hand it
 * straight to `createMutators` / `wrapTransactionWithACL` with no adaptation.
 *
 * ## Why not a JWT
 *
 * A JWT's usual advantage — verify the signature, skip the database — does not
 * apply here: `role` and `orgRole` are re-read from the database on every
 * request regardless (see above), so the row lookup already happens on every
 * call. What a JWT would cost, and this avoids, is revocability: a signed token
 * is valid until it expires, full stop, so revoking one early needs a
 * denylist — itself a database check on every request, the exact cost a JWT is
 * chosen to avoid. Looking a key up directly gets revocation for free from the
 * same lookup that already has to happen.
 */

import type { Context } from '@xyne/shared';
import type { AuthData } from '@/zero/mutators';
import { encrypt } from '@/services/encryptionService';

/** Prefix that makes a leaked key greppable in logs and repositories. */
export const API_KEY_PREFIX = 'xyne_sk_';

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
  readonly keyId: string;
  /** When the presented key stops working, so a caller can rotate before it does. */
  readonly keyExpiresAt: Date;
}

// `Request.sdkAuth` is declared once, alongside `Request.user`, in
// `types/express.ts` — see that file for the augmentation.

/**
 * `sdk_api_keys.status`. A plain `String` column, not a DB enum — Postgres
 * enums are frozen in this repo (see `scripts/validate-no-new-enums.sh`), so
 * a fixed set of values is enforced here, app-side, instead.
 *
 * `REVOKED` is explicit user action (`DELETE /api/sdk-keys/:id`), distinct
 * from a key that has simply run past its `expiresAt` — that needs no status
 * change, since the expiry check already rejects it.
 */
export const SDK_API_KEY_STATUSES = ['ACTIVE', 'REVOKED'] as const;
export type SdkApiKeyStatus = (typeof SDK_API_KEY_STATUSES)[number];

/** The lifetimes a key can be minted with. There is no default — see `apiKeyExpiryFrom`. */
export const API_KEY_TTL_CHOICES = [30, 60, 90] as const;
export type ApiKeyTtlDays = (typeof API_KEY_TTL_CHOICES)[number];

/**
 * Mint a key string for an identity.
 *
 * Exported for the key-management routes; nothing else should call it. The
 * caller is responsible for persisting the returned string as `token`, because
 * it cannot be re-derived — `encrypt` uses a random IV, so encrypting the same
 * identity twice yields two different keys.
 */
export function mintApiKey(identity: KeyIdentity): string {
  const sealed = encrypt(JSON.stringify(identity));
  return `${API_KEY_PREFIX}${Buffer.from(sealed, 'utf8').toString('base64url')}`;
}

/**
 * When a key minted now, with the given lifetime, should stop working.
 *
 * `ttlDays` is required and typed to `ApiKeyTtlDays` — one of
 * `API_KEY_TTL_CHOICES` — rather than defaulting to a config value: the one
 * caller (`routes/sdk-keys.ts`) always has a chosen lifetime by the time it
 * gets here, so a silent fallback would exist to serve nobody.
 */
export function apiKeyExpiryFrom(ttlDays: ApiKeyTtlDays, now: Date = new Date()): Date {
  return new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000);
}
