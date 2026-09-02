import type { FeatureAnnouncement } from '@prisma/client';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';

const CACHE_VERSION = 'v1';
const KEY_PREFIX = `fa:${CACHE_VERSION}:published`;
const DEFAULT_TTL_SEC = 300;

type CachedAnnouncement = Omit<
  FeatureAnnouncement,
  'publishedAt' | 'expiresAt' | 'createdAt' | 'updatedAt'
> & {
  publishedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
};

function serialize(rows: FeatureAnnouncement[]): string {
  return JSON.stringify(rows);
}

function deserialize(raw: string): FeatureAnnouncement[] {
  const rows = JSON.parse(raw) as CachedAnnouncement[];
  return rows.map((row) => ({
    ...row,
    publishedAt: row.publishedAt ? new Date(row.publishedAt) : null,
    expiresAt: row.expiresAt ? new Date(row.expiresAt) : null,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  })) as FeatureAnnouncement[];
}

/**
 * Published announcement content is identical for every member of a workspace and changes
 * a few times a month, while `/pending` is called by every user at app open. Caching the
 * content collapses that fan-in to one query per pod per TTL; per-user state is never
 * cached because it differs per caller by definition.
 *
 * Redis rather than an in-process map: limits and invalidation have to hold across pods.
 * Every path degrades to a direct database read when Redis is unavailable.
 */
class FeatureAnnouncementContentCache {
  private key(workspaceId: string): string {
    return `${KEY_PREFIX}:${workspaceId}`;
  }

  async get(workspaceId: string): Promise<FeatureAnnouncement[] | null> {
    try {
      const raw = await redisService.getClient().get(this.key(workspaceId));
      return raw ? deserialize(raw) : null;
    } catch (error) {
      logger.warn('[FeatureAnnouncementContentCache] get failed', {
        workspaceId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  async set(
    workspaceId: string,
    rows: FeatureAnnouncement[],
    ttlSec: number = DEFAULT_TTL_SEC
  ): Promise<void> {
    try {
      await redisService.getClient().set(this.key(workspaceId), serialize(rows), 'EX', ttlSec);
    } catch (error) {
      logger.warn('[FeatureAnnouncementContentCache] set failed', {
        workspaceId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Called on every admin write. A product-wide announcement is visible to every
   * workspace, so a single publish has to clear every workspace's entry — SCAN rather
   * than KEYS so Redis is never blocked.
   */
  async invalidateAll(): Promise<void> {
    try {
      const client = redisService.getClient();
      let cursor = '0';
      let cleared = 0;
      do {
        const [next, keys] = await client.scan(cursor, 'MATCH', `${KEY_PREFIX}:*`, 'COUNT', '200');
        cursor = next;
        if (keys.length > 0) {
          await client.del(...keys);
          cleared += keys.length;
        }
      } while (cursor !== '0');
      if (cleared > 0) {
        logger.info('[FeatureAnnouncementContentCache] invalidated', { keys: cleared });
      }
    } catch (error) {
      logger.warn('[FeatureAnnouncementContentCache] invalidate failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export const featureAnnouncementContentCache = new FeatureAnnouncementContentCache();
