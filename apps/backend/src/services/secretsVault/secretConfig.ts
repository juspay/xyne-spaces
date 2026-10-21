import { githubToken, type SecretHandler } from '@xyne/secrets-vault';

/**
 * Registry of every secret this backend's vault knows how to handle, keyed by
 * the `name` used when creating it via the admin UI. `name` must be present
 * here before a secret can be created (see routes/secretsVault.ts) — this is
 * the static per-secret config the design doc calls "secretConfig."
 *
 * Handlers with no dependency on this backend's internals (just `fetch` +
 * the candidate value) live in the package itself and get imported
 * ready-to-use here — see packages/secrets-vault/src/handlers/. Only a
 * handler that has to call something private to this backend (e.g. an
 * internal singleton, like the encryption provider glue in
 * services/secretsVault/genericEncryptionAdapter.ts) would need its own file
 * in this app instead — none of the current entries need that.
 */
export const secretConfig: Record<string, SecretHandler> = {
  'github-token': githubToken,
};
