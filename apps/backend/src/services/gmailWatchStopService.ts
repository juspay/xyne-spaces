import { GoogleService } from '@/services/googleService';
import { logger } from '@/utils/logger';
import { ExternalSourcePlatform } from '@/integrations/core/types';

export type GmailWatchSource = {
  id: string;
  sourceType: string;
  credentials: unknown;
};

/**
 * Best-effort stop for Gmail Pub/Sub watches before a Google mailbox source is
 * deactivated or credentials are cleared. Reconnect/setup paths call
 * users.watch() again, so all reconnect-required deactivation paths should first
 * ask Gmail to stop publishing this mailbox's events to the shared topic.
 */
export async function stopGmailWatchBeforeDeactivation(
  source: GmailWatchSource | null | undefined,
  tag: string,
): Promise<void> {
  if (
    !source
    || source.sourceType !== ExternalSourcePlatform.GOOGLE
    || typeof source.credentials !== 'string'
    || !source.credentials
  ) {
    return;
  }

  try {
    const svc = GoogleService.fromEncryptedCredentials(source.credentials, source.id);
    await svc.stopGmailWatch();
  } catch (err) {
    logger.warn(`${tag} Best-effort Gmail watch stop failed`, {
      sourceId: source.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
