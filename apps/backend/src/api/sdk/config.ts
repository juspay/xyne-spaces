/**
 * /api/sdk configuration.
 *
 * Read straight from the environment rather than threaded through the Joi
 * schema in `config/env.ts`, so enabling the SDK surface in a deployment is
 * additive and cannot break boot for deployments that do not run it.
 *
 */

export const sdkConfig = {
  /** Master switch. The router is not mounted at all when false. */
  get enabled(): boolean {
    return process.env['SDK_API_ENABLED'] === 'true';
  },

  /**
   * Development escape hatch: run reads against the primary pool when no read
   * replica is configured. Never enable in production — the replica exists to
   * keep SDK read traffic off the write path.
   */
  get allowPrimaryForReads(): boolean {
    return process.env['SDK_QUERIES_ALLOW_PRIMARY'] === 'true';
  },

  apiKey: {
    /**
     * How long a newly minted key stays valid. Keys are deliberately short-lived:
     * they carry a user's full identity and there is no refresh step, so the
     * lifetime is the only bound on a leaked one.
     */
    get ttlDays(): number {
      const raw = Number(process.env['SDK_API_KEY_TTL_DAYS'] ?? 30);
      return Number.isFinite(raw) && raw > 0 ? raw : 30;
    },
  },

  rateLimit: {
    /** Token bucket capacity per (user, client) for read endpoints. */
    get readPerMinute(): number {
      return Number(process.env['SDK_RATE_LIMIT_READ_PER_MIN'] ?? 300);
    },
    get writePerMinute(): number {
      return Number(process.env['SDK_RATE_LIMIT_WRITE_PER_MIN'] ?? 60);
    },
    get burstMultiplier(): number {
      return Number(process.env['SDK_RATE_LIMIT_BURST_MULTIPLIER'] ?? 2);
    },
  },
} as const;
