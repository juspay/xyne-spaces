/**
 * /api/sdk configuration.
 *
 * Read straight from the environment rather than threaded through the Joi
 * schema in `config/env.ts`, so enabling the SDK surface in a deployment is
 * additive and cannot break boot for deployments that do not run it.
 */

export const sdkConfig = {
  /** Master switch. The router is not mounted at all when false. */
  get enabled(): boolean {
    return process.env['SDK_API_ENABLED'] === 'true';
  },

  /**
   * Development escape hatch: run reads against the primary pool when no read
   * replica is configured. Tied to `NODE_ENV` rather than its own flag — the
   * replica exists to keep SDK read traffic off the write path, and that
   * matters precisely in production, so there is nothing a separate switch
   * would let a deployment opt out of that `NODE_ENV` does not already decide.
   */
  get allowPrimaryForReads(): boolean {
    return process.env['NODE_ENV'] !== 'production';
  },
} as const;
