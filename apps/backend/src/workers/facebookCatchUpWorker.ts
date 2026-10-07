import '@/integrations/adapters/social-media';
import { db } from '@/database/client';
import { socialMediaService } from '@/integrations/social-media/socialMediaService';
import { ExternalSourcePlatform } from '@/integrations/core/types';
import { logger } from '@/utils/logger';

const TAG = '[FacebookCatchUpWorker]';

/**
 * Facebook Pages are webhook-driven. This pass pulls what a webhook failed to deliver (an
 * outage, a dropped delivery) since the previous run; FacebookFlow works out the window from
 * each source's lastSyncCursor and skips anything already on the desk. It also doubles as the
 * token check: FacebookFlow marks a Page disconnected when Meta rejects its token.
 */
class FacebookCatchUpWorker {
  async run(): Promise<void> {
    const sources = await db.externalSource.findMany({
      where: { sourceType: ExternalSourcePlatform.FACEBOOK, isActive: true },
      select: { id: true },
    });
    logger.info(`${TAG} Catching up ${sources.length} Facebook Page(s)`);

    let added = 0;
    let failed = 0;
    for (const source of sources) {
      try {
        added += (await socialMediaService.syncSource(source.id)).synced;
      } catch (error) {
        failed++;
        logger.error(`${TAG} Catch-up failed for source ${source.id}`, { error });
      }
    }
    logger.info(`${TAG} Catch-up complete`, { pages: sources.length, added, failed });
  }
}

export const facebookCatchUpWorker = new FacebookCatchUpWorker();
