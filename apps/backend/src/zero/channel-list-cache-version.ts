import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';

/**
 * Version counters for the userAllChannels cache (see channel-list-cache.ts).
 * Kept separate and dependency-light so the Prisma client extension can import it
 * without pulling in the Zero query graph.
 */

const VERSION_KEY_PREFIX = 'channel-list-cache:v:';
const GLOBAL_VERSION_KEY = `${VERSION_KEY_PREFIX}global`;
const VERSION_KEY_TTL_SEC = 24 * 60 * 60;

/** Current version for a workspace (workspace counter + global counter). Throws if Redis is down. */
export async function readChannelListVersion(workspaceId: string): Promise<string> {
  const [ws, global] = await redisService.getClient().mget(VERSION_KEY_PREFIX + workspaceId, GLOBAL_VERSION_KEY);
  return `${ws ?? '0'}:${global ?? '0'}`;
}

/**
 * Invalidate cached channel lists after a write to `channels`. Pass the workspace
 * when known; without one every workspace is invalidated. Never throws.
 */
export function bumpChannelListVersion(workspaceId?: string | null): void {
  if (!config.channelListCache.enabled) return;
  const key = workspaceId ? VERSION_KEY_PREFIX + workspaceId : GLOBAL_VERSION_KEY;
  const bump = () => {
    try {
      redisService
        .getClient()
        .multi()
        .incr(key)
        .expire(key, VERSION_KEY_TTL_SEC)
        .exec()
        .catch((error: unknown) => logger.warn('channel_list_cache_bump_failed', { key, error: error instanceof Error ? error.message : error }));
    } catch (error) {
      logger.warn('channel_list_cache_bump_failed', { key, error: error instanceof Error ? error.message : error });
    }
  };
  bump();
  // Second bump: discards an entry rebuilt from the read replica before it caught up
  // with this write (or, for writes inside a transaction, before the commit).
  setTimeout(bump, config.channelListCache.rebumpMs).unref();
}
