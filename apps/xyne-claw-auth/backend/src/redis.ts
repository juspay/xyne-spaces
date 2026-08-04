/**
 * Redis service for xyne-claw-auth.
 *
 * Follows the same pattern as the Spaces backend RedisService:
 * - Class-based singleton with getRedisConfig()
 * - Same env vars: REDIS_HOST, REDIS_PORT, REDIS_PASSWORD, REDIS_TLS
 * - Lazy connection with connect/disconnect lifecycle
 *
 * Only exposes a single connection (no pub/sub needed — BullMQ manages its own).
 */

import { Redis } from "ioredis";
import { CONFIG } from "./config.js";
import { retryForever } from "./retry.js";

import { createLogger } from "./logger.js";
const log = createLogger("redis");

class RedisService {
  private redis: Redis | null = null;

  getRedisConfig() {
    return {
      host: CONFIG.redisHost,
      port: CONFIG.redisPort,
      ...(CONFIG.redisPassword ? { password: CONFIG.redisPassword } : {}),
      ...(CONFIG.redisTls ? { tls: { rejectUnauthorized: false } } : {}),
      maxRetriesPerRequest: null as null, // required by BullMQ
      lazyConnect: true,
      retryStrategy: (times: number) => Math.min(times * 200, 5_000),
      enableOfflineQueue: true,
      reconnectOnError: (err: Error) => /READONLY/.test(err.message),
      connectTimeout: 10_000,
      keepAlive: 30_000,
    };
  }

  private attachHandlers(client: Redis): void {
    client.on("connect", () => {
      log.info("[redis] Connected successfully");
    });

    client.on("error", (err: Error) => {
      log.error("[redis] Connection error:", err.message);
    });

    client.on("reconnecting", (delayMs: number) => {
      log.warn(`[redis] reconnecting in ${delayMs}ms`);
    });
  }

  async connect(): Promise<void> {
    if (this.redis) return;

    this.redis = new Redis(this.getRedisConfig());
    this.attachHandlers(this.redis);

    const client = this.redis;
    await retryForever(() => client.connect(), "redis.connect");
  }

  async disconnect(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
      this.redis = null;
      log.info("[redis] Disconnected");
    }
  }

  /** Get the shared connection (creates lazily if needed). */
  getConnection(): Redis {
    if (!this.redis) {
      this.redis = new Redis(this.getRedisConfig());
      this.attachHandlers(this.redis);
    }
    return this.redis;
  }
}

export const redisService = new RedisService();
