/**
 * The account claims watermark, on its own, importing nothing but Redis, config and the key name.
 *
 * `role`, `orgRole`, `orgId`, `status` and `leftAt` are frozen into every access JWT for its whole
 * lifetime and are never re-read on the stateless path, so the writers of those fields have to
 * stamp this watermark or the change does not take effect until the tokens expire. Those writers
 * are `database/repositories/*`, which sit UNDER the auth stack: importing `bypassAcl/
 * authSessionServices` from a repository closes a cycle
 * (`repositories/users` → auth sessions → … → `services/userActivityService` → `repositories/index`
 * → `repositories/users`) through a module with top-level side effects, which is a boot-order
 * hazard for the sake of one Redis write. Hence this leaf: its whole import closure is
 * `redisService`, `logger`, `config` and `constants`.
 *
 * Best-effort by design — failing a role write because a metrics-grade Redis key could not be
 * written would be the wrong trade. A missed stamp degrades to the old behaviour (the change lands
 * when the token expires), it does not corrupt anything.
 */
import { config } from '@/config/env';
import { redisService } from '@/services/redisService';
import { logger } from '@/utils/logger';
import { claimsStaleKey } from './constants';

/** Ceiling for both the watermark and a session tombstone: the longest-lived JWT anything can mint. */
export function maxJwtTtlSeconds(): number {
  return Math.max(config.jwt.expirationSeconds, config.session.workspaceTokenTtlSeconds, config.sdkSso.tokenTtlSeconds);
}

/**
 * Stamp the watermark for an account (`org_members.memberId`). One second is added so a token
 * minted in the SAME second as the change — whose `iat` is truncated to that second — is also
 * treated as stale.
 */
export async function writeClaimsWatermark(accountId: string, ttlSeconds: number, at: Date = new Date()): Promise<void> {
  const watermark = Math.floor(at.getTime() / 1000) + 1;
  try {
    await redisService.set(claimsStaleKey(accountId), String(watermark), Math.max(1, Math.ceil(ttlSeconds)));
  } catch (error) {
    logger.warn('[AUTH] [Revocation] claims watermark write failed', {
      accountId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * What every writer of a frozen claim calls: stamp the account so outstanding access tokens are
 * re-minted (cookie clients) or resolved against the DB (Bearer clients) on their next request.
 */
export async function markAccountClaimsStale(accountId: string, at: Date = new Date()): Promise<void> {
  if (!accountId) return;
  await writeClaimsWatermark(accountId, maxJwtTtlSeconds(), at);
  logger.info('[AUTH] claims watermark stamped', { accountId, at: at.toISOString() });
}
