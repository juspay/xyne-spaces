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
    };
  }

  async connect(): Promise<void> {
    if (this.redis) return;
    try {
      this.redis = new Redis(this.getRedisConfig());

      this.redis.on("connect", () => {
        console.log("[redis] Connected successfully");
      });

      this.redis.on("error", (err: Error) => {
        console.error("[redis] Connection error:", err.message);
      });

      await this.redis.connect();
    } catch (err) {
      console.error("[redis] Failed to initialize:", err);
    }
  }

  async disconnect(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
      this.redis = null;
      console.log("[redis] Disconnected");
    }
  }

  /** Get the shared connection (creates lazily if needed). */
  getConnection(): Redis {
    if (!this.redis) {
      this.redis = new Redis(this.getRedisConfig());
      this.redis.on("error", (err: Error) => {
        console.error("[redis] Connection error:", err.message);
      });
    }
    return this.redis;
  }
}

export const redisService = new RedisService();
