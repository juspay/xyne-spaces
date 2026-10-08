/**
 * Redis-backed invalidation for the two things an access JWT freezes that the signature cannot
 * protect: the session behind it, and the authorization it carries.
 *
 *   tombstone (`auth:revoked_sid:<sid>`)       — the session was revoked; every JWT minted from it
 *                                                stops working immediately.
 *   claims watermark (`auth:claims_stale:<accountId>`) — the account's role / org role / workspace
 *                                                membership changed; a JWT minted before that
 *                                                moment carries authorization that no longer holds.
 *
 * Both are read in ONE round trip on the stateless path (`checkClaims`), so instant revocation
 * costs one Redis MGET and no DB read. TTL on both keys = the longest JWT TTL a session can mint,
 * since nothing minted before the write can outlive that.
 *
 * Fail-open on Redis errors: a Redis outage must not log every user out, and must not force every
 * request onto the DB refresh path either. The DB row is still REVOKED / the role is still changed,
 * and wins as soon as the JWT expires. Fail-open volume is counted
 * (`auth_revocation_fail_open_total`) so a sustained outage is alertable rather than silent.
 */
import { redisService } from '@/services/redisService';
import { logger } from '@/utils/logger';
import { recordRevocationFailOpen } from '@/services/otel/authMetrics';
import { claimsStaleKey, revokedSidKey } from './constants';
import type { ClaimsVerdict, RevocationStore } from './types';

const TOMBSTONE_VALUE = '1';

function failOpen(operation: 'tombstone_read' | 'claims_read', error: unknown, context: Record<string, unknown>): void {
  recordRevocationFailOpen({ operation });
  logger.warn('[AUTH] [Revocation] Redis read failed, failing open', {
    operation,
    ...context,
    error: error instanceof Error ? error.message : String(error),
  });
}

export const redisRevocationStore: RevocationStore = {
  async isRevoked(sid: string): Promise<boolean> {
    try {
      return (await redisService.get(revokedSidKey(sid))) !== null;
    } catch (error) {
      failOpen('tombstone_read', error, { sid });
      return false;
    }
  },

  /**
   * One MGET for both signals. `iat` is the JWT's issue time in epoch seconds; a token without one
   * (hand-rolled or pre-deploy) cannot be compared against the watermark, so it is treated as
   * stale whenever a watermark exists — the re-mint is cheap and the alternative is trusting a
   * role that may have been taken away.
   */
  async checkClaims(input: { sid: string; accountId: string; iat?: number }): Promise<ClaimsVerdict> {
    let values: (string | null)[];
    try {
      values = await redisService.mget([revokedSidKey(input.sid), claimsStaleKey(input.accountId)]);
    } catch (error) {
      failOpen('claims_read', error, { sid: input.sid, accountId: input.accountId });
      return 'ok';
    }
    if (values[0] !== null && values[0] !== undefined) return 'revoked';
    const watermark = Number(values[1]);
    if (!Number.isFinite(watermark) || watermark <= 0) return 'ok';
    if (input.iat === undefined) return 'stale';
    return input.iat < watermark ? 'stale' : 'ok';
  },

  async markRevoked(sid: string, ttlSeconds: number): Promise<void> {
    try {
      await redisService.set(revokedSidKey(sid), TOMBSTONE_VALUE, Math.max(1, Math.ceil(ttlSeconds)));
    } catch (error) {
      logger.warn('[AUTH] [Revocation] tombstone write failed', {
        sid,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  /**
   * Stamp the account's claims watermark. Called by every writer that changes what the JWT
   * freezes (workspace role, org role, membership removal, deactivation) so outstanding tokens
   * are re-minted on their next request instead of carrying the old authorization for up to a
   * full JWT TTL. One second is added so a token minted in the SAME second as the change — whose
   * `iat` is truncated to that second — is also treated as stale.
   */
  async markClaimsStale(accountId: string, ttlSeconds: number, at: Date = new Date()): Promise<void> {
    const watermark = Math.floor(at.getTime() / 1000) + 1;
    try {
      await redisService.set(claimsStaleKey(accountId), String(watermark), Math.max(1, Math.ceil(ttlSeconds)));
    } catch (error) {
      logger.warn('[AUTH] [Revocation] claims watermark write failed', {
        accountId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
};
