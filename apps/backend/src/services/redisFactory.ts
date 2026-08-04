import Redis, { RedisOptions } from 'ioredis';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';
import { retryForever } from '@/utils/retry';

export function getBaseRedisOptions(role: 'default' | 'bullmq' = 'default'): RedisOptions {
  return {
    host: config.redis.host,
    port: config.redis.port,
    ...(config.redis.password && { password: config.redis.password }),
    ...(config.redis.tls && { tls: { rejectUnauthorized: false } }),
    lazyConnect: true,
    // BullMQ requires null and manages its own retries.
    maxRetriesPerRequest: role === 'bullmq' ? null : 3,
    retryStrategy: (times: number) => Math.min(times * 200, 5_000),
    enableOfflineQueue: true,
  };
}

export function createRedisClient(name: string, overrides: RedisOptions = {}): Redis {
  const client = new Redis({ ...getBaseRedisOptions(), ...overrides });

  client.on('connect', () => logger.info(`[redis:${name}] connected`));
  client.on('error', (error: Error) =>
    logger.error(`[redis:${name}] connection error`, { message: error.message })
  );
  client.on('reconnecting', (delayMs: number) =>
    logger.warn(`[redis:${name}] reconnecting`, { delayMs })
  );

  return client;
}

export async function connectWithRetryForever(client: Redis, name: string): Promise<void> {
  if (client.status === 'ready' || client.status === 'connecting' || client.status === 'connect') {
    return;
  }
  await retryForever(() => client.connect(), `redis.${name}.connect`);
}
