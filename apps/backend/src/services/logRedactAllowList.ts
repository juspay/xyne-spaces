import { REDACT_ALLOW_CONFIG_KEY, syncRedactAllowList } from '@xyne/logger';
import { config } from '@/config/env';
import { CacConfigService } from '@/services/cacConfigService';
import { superpositionClient } from '@/services/superpositionClient';
import { logger } from '@/utils/logger';

/** Raw allow-list value from Superposition; throws while the client cannot initialise. */
export async function fetchLogRedactAllowList(): Promise<unknown> {
  if (!superpositionClient.isReady()) await superpositionClient.initialize();
  return CacConfigService.fetch(REDACT_ALLOW_CONFIG_KEY);
}

/** Keep this process's log redaction allow-list in sync with Superposition. */
export function startLogRedactAllowListSync(): () => void {
  return syncRedactAllowList(fetchLogRedactAllowList, {
    intervalMs: config.superposition.pollingInterval,
    onChange: ({ accepted, rejected }) =>
      logger.info('Log redaction allow-list updated', { module: 'logger', accepted, rejected }),
  });
}
