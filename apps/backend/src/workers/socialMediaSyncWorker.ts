import '@/integrations/adapters/social-media';
import { db } from '@/database/client';
import { socialMediaService } from '@/integrations/social-media/socialMediaService';
import { adapterRegistry } from '@/integrations/core/adapterRegistry';
import { logger } from '@/utils/logger';

const SYNC_INTERVAL_MS = 5 * 60 * 1000;

class SocialMediaSyncWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const sources = await db.externalSource.findMany({
        where: {
          sourceType: { in: adapterRegistry.getPollingPlatforms() },
          isActive: true,
        },
        select: { id: true },
      });
      for (const source of sources) {
        try {
          await socialMediaService.syncSource(source.id);
        } catch (error) {
          logger.error('[SocialMediaSyncWorker] Source sync failed', {
            sourceId: source.id,
            error,
          });
        }
      }
    } finally {
      this.running = false;
    }
  }

  start(): void {
    if (this.timer) return;
    void this.runOnce();
    this.timer = setInterval(() => void this.runOnce(), SYNC_INTERVAL_MS);
    this.timer.unref();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }
}

export const socialMediaSyncWorker = new SocialMediaSyncWorker();
