import { secretsVault } from '@/services/secretsVault/vaultInstance';
import { logger } from '@/utils/logger';

/**
 * Generic vault-backed secret resolver: prefers the secrets-vault's active
 * version for `name` (so rotation via the admin UI takes effect without a
 * redeploy), falling back to `envFallback` if the vault has no active version
 * for it or is unreachable. One function shared by every secret migrated to
 * the vault, rather than a bespoke getXToken() per secret.
 *
 * Lives in its own file (not config/env.ts) because vaultInstance.ts imports
 * `config` from env.ts — importing vaultInstance back into env.ts would be
 * circular.
 */
export async function resolveSecret(name: string, envFallback: string): Promise<string> {
  try {
    const fromVault = await secretsVault.getSecret(name);
    if (fromVault) {
      logger.info(`[secrets-vault] resolveSecret: "${name}" served from vault`);
      return fromVault;
    }
    logger.warn(`[secrets-vault] resolveSecret: "${name}" has no active version — falling back to env`);
  } catch (error) {
    logger.warn(`[secrets-vault] resolveSecret: "${name}" lookup failed — falling back to env: ${(error as Error).message}`);
  }
  return envFallback;
}
