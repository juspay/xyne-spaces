import { REDACT_CONFIG_KEY, syncRedactConfig } from '@xyne/logger';
import { config } from '@/config/env';
import { CacConfigService } from '@/services/cacConfigService';
import { superpositionClient } from '@/services/superpositionClient';
import { logger } from '@/utils/logger';

/** Raw log redaction config from Superposition; throws while the client cannot initialise. */
export async function fetchLogRedactConfig(): Promise<unknown> {
  if (!superpositionClient.isReady()) await superpositionClient.initialize();
  return CacConfigService.fetch(REDACT_CONFIG_KEY);
}

/** Keep this process's log redaction config in sync with Superposition. */
export function startLogRedactConfigSync(): () => void {
  return syncRedactConfig(fetchLogRedactConfig, {
    intervalMs: config.superposition.pollingInterval,
    // redactCanary prints [REDACTED] while `canary` is in secretWords (end-to-end check).
    onChange: ({ accepted, rejected }) =>
      logger.info('Log redaction config updated', { module: 'logger', accepted, rejected, redactCanary: 'visible' }),
  });
}
