import { createSecretHandler, type SecretHandler } from '@xyne/secrets-vault';

/**
 * Registry of every secret this backend's vault knows how to handle, keyed by
 * the `name` used when creating it via the admin UI. `name` must be present
 * here before a secret can be created (see routes/secretsVault.ts) — this is
 * the static per-secret config the design doc calls "secretConfig."
 *
 * `github-token` uses createSecretHandler()'s defaults as-is: no self-service
 * rotation API for a classic/fine-grained PAT (a human must generate a new
 * one), and no automated verify yet — no overrides needed.
 */
export const secretConfig: Record<string, SecretHandler> = {
  'github-token': createSecretHandler(),
};
