import { createHash } from 'node:crypto';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';

const CACHE_VERSION = 'v1';

export interface QueryCacheKeyInputs {
  workspaceId: string;
  dataSourceId: string;
  componentType: string | undefined;
  sql: string;
  params: ReadonlyArray<unknown>;
}

export interface QueryCacheValue {
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  data: unknown | null;
  cachedAt: string;
}

class QueryCache {
  static buildKey(inputs: QueryCacheKeyInputs): string {
    const hash = createHash('sha256');
    hash.update(inputs.workspaceId);
    hash.update('|');
    hash.update(inputs.dataSourceId);
    hash.update('|');
    hash.update(inputs.componentType ?? '');
    hash.update('|');
    hash.update(inputs.sql);
    hash.update('|');
    hash.update(JSON.stringify(inputs.params));
    return `dq:${CACHE_VERSION}:${inputs.workspaceId}:${hash.digest('hex')}`;
  }

  async get(inputs: QueryCacheKeyInputs): Promise<QueryCacheValue | null> {
    try {
      const client = redisService.getClient();
      const raw = await client.get(QueryCache.buildKey(inputs));
      if (!raw) return null;
      return JSON.parse(raw) as QueryCacheValue;
    } catch (err) {
      logger.warn('[QueryCache] get failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  async set(
    inputs: QueryCacheKeyInputs,
    value: QueryCacheValue,
    ttlSec: number = config.dashboard.queryCacheTtlSec,
  ): Promise<void> {
    let serialized: string;
    try {
      serialized = JSON.stringify(value);
    } catch {
      return;
    }
    if (serialized.length > config.dashboard.queryCacheMaxValueBytes) return;
    try {
      const client = redisService.getClient();
      await client.set(QueryCache.buildKey(inputs), serialized, 'EX', ttlSec);
    } catch (err) {
      logger.warn('[QueryCache] set failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Uses SCAN (not KEYS) to avoid blocking Redis.
  async invalidateWorkspace(workspaceId: string): Promise<void> {
    const pattern = `dq:${CACHE_VERSION}:${workspaceId}:*`;
    try {
      const client = redisService.getClient();
      let cursor = '0';
      let total = 0;
      do {
        const [next, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', '200');
        cursor = next;
        if (keys.length > 0) {
          await client.del(...keys);
          total += keys.length;
        }
      } while (cursor !== '0');
      if (total > 0) {
        logger.info('[QueryCache] invalidated workspace', { workspaceId, keys: total });
      }
    } catch (err) {
      logger.warn('[QueryCache] invalidate failed', {
        workspaceId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export const queryCache = new QueryCache();
