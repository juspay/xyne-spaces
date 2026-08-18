import { db } from '@/database/client';
import { encrypt, decrypt } from '@/services/encryptionService';
import { logger } from '@/utils/logger';
import { metaGraphClient } from '@/integrations/adapters/social-media/instagram/metaGraphClient';
import type { InstagramCredentials } from '@/integrations/adapters/social-media/instagram/types';
import { SOCIAL_MEDIA_SOURCE_TYPES } from '@/integrations/social-media/constants';

const TAG = '[InstagramTokenRefreshWorker]';

// Refresh tokens that expire within this many ms (7 days)
const REFRESH_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

class InstagramTokenRefreshWorker {
  async run(): Promise<void> {
    logger.info(`${TAG} Starting token refresh scan`);

    const sources = await db.externalSource.findMany({
      where: {
        sourceType: SOCIAL_MEDIA_SOURCE_TYPES.INSTAGRAM,
        isActive: true,
      },
      select: { id: true, credentials: true },
    });

    if (sources.length === 0) {
      logger.info(`${TAG} No active Instagram sources found`);
      return;
    }

    logger.info(`${TAG} Checking ${sources.length} Instagram source(s)`);

    let refreshed = 0;
    let skipped = 0;
    let failed = 0;

    for (const source of sources) {
      try {
        if (!source.credentials) {
          skipped++;
          continue;
        }

        let creds: InstagramCredentials;
        try {
          creds = JSON.parse(decrypt(source.credentials)) as InstagramCredentials;
        } catch {
          logger.warn(`${TAG} Could not decrypt credentials for source ${source.id}`);
          skipped++;
          continue;
        }

        if (typeof creds.expiresAt !== 'number') {
          logger.warn(`${TAG} Source ${source.id} has no expiresAt — skipping`);
          skipped++;
          continue;
        }
        const timeUntilExpiry = creds.expiresAt - Date.now();
        if (timeUntilExpiry > REFRESH_THRESHOLD_MS) {
          skipped++;
          continue;
        }

        logger.info(`${TAG} Refreshing token for source ${source.id}`, {
          expiresInDays: Math.round(timeUntilExpiry / 86400000),
        });

        const result = await metaGraphClient.refreshToken(creds.accessToken);
        const updatedCreds: InstagramCredentials = {
          ...creds,
          accessToken: result.access_token,
          expiresAt: Date.now() + result.expires_in * 1000,
        };

        await db.externalSource.update({
          where: { id: source.id },
          data: { credentials: encrypt(JSON.stringify(updatedCreds)) },
        });

        logger.info(`${TAG} Refreshed token for source ${source.id}`, {
          newExpiresInDays: Math.round(result.expires_in / 86400),
        });
        refreshed++;
      } catch (err) {
        logger.error(`${TAG} Failed to refresh token for source ${source.id}`, { error: err });
        failed++;
      }
    }

    logger.info(`${TAG} Token refresh scan complete`, { refreshed, skipped, failed });
  }
}

export const instagramTokenRefreshWorker = new InstagramTokenRefreshWorker();
