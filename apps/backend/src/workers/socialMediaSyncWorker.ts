import '@/integrations/adapters/social-media';
import { db } from '@/database/client';
import { socialMediaService } from '@/integrations/social-media/socialMediaService';
import { adapterRegistry } from '@/integrations/core/adapterRegistry';
import { ExternalSourcePlatform } from '@/integrations/core/types';
import { reconcilePendingResponses } from '@/integrations/adapters/social-media/app-store';
import { APP_STORE_RECONCILE_INTERVAL_MS } from '@/integrations/adapters/social-media/app-store/constants';
import { logger } from '@/utils/logger';

const SYNC_INTERVAL_MS = 5 * 60 * 1000;

class SocialMediaSyncWorker {
  private timer: NodeJS.Timeout | null = null;
  private reconcileTimer: NodeJS.Timeout | null = null;
  private running = false;
  private reconciling = false;

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

  /**
   * Pass B. Separate from the 5-minute poll because it is driven by which replies are awaiting
   * publication, not by the review window — Apple publishes responses asynchronously and the poll
   * pages on an immutable createdDate, so a replied-to review is usually outside it entirely.
   */
  async reconcileOnce(): Promise<void> {
    if (this.reconciling) return;
    this.reconciling = true;
    try {
      const sources = await db.externalSource.findMany({
        where: { sourceType: ExternalSourcePlatform.APP_STORE, isActive: true },
      });
      for (const source of sources) {
        try {
          await reconcilePendingResponses(source);
        } catch (error) {
          logger.error('[SocialMediaSyncWorker] Pending-response reconciliation failed', {
            sourceId: source.id,
            error,
          });
        }
      }
    } finally {
      this.reconciling = false;
    }
  }

  start(): void {
    if (this.timer) return;
    void this.runOnce();
    this.timer = setInterval(() => void this.runOnce(), SYNC_INTERVAL_MS);
    this.timer.unref();

    void this.reconcileOnce();
    this.reconcileTimer = setInterval(
      () => void this.reconcileOnce(),
      APP_STORE_RECONCILE_INTERVAL_MS,
    );
    this.reconcileTimer.unref();
  }

  stop(): void {
    if (this.reconcileTimer) {
      clearInterval(this.reconcileTimer);
      this.reconcileTimer = null;
    }
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }
}

export const socialMediaSyncWorker = new SocialMediaSyncWorker();
