/**
 * /api/v1 configuration.
 *
 * Read straight from the environment rather than threaded through the Joi
 * schema in `config/env.ts`, so enabling the SDK surface in a deployment is
 * additive and cannot break boot for deployments that do not run it.
 */

export const v1Config = {
  /** Master switch. The router is not mounted at all when false. */
  get enabled(): boolean {
    return process.env['SDK_API_ENABLED'] === 'true';
  },

  /** JWKS endpoint of the authorization server (xyne-claw-auth). */
  get jwksUrl(): string | undefined {
    return process.env['SDK_JWKS_URL'];
  },

  get issuer(): string {
    return process.env['SDK_TOKEN_ISSUER'] ?? 'xyne-claw-auth';
  },

  get audience(): string {
    return process.env['SDK_TOKEN_AUDIENCE'] ?? 'xyne-spaces-api';
  },

  /**
   * Development escape hatch: run reads against the primary pool when no read
   * replica is configured. Never enable in production — the replica exists to
   * keep SDK read traffic off the write path.
   */
  get allowPrimaryForReads(): boolean {
    return process.env['SDK_QUERIES_ALLOW_PRIMARY'] === 'true';
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

  idempotency: {
    /** How long a completed idempotency record is replayable. */
    get ttlHours(): number {
      return Number(process.env['SDK_IDEMPOTENCY_TTL_HOURS'] ?? 24);
    },
  },
} as const;
