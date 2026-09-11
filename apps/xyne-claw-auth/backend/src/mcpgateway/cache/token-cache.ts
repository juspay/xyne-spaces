/**
 * Token Cache
 * Redis-based cache for auth tokens with automatic TTL
 */

import { redisService } from "../../redis.js";
import { errMsg } from "../../lib/errors.js";
import { CACHE, TIMEOUTS } from "../config/index.js";
import type { FetchedToken } from "../types/index.js";

const REDIS_OP_TIMEOUT_MS = Number.parseInt(process.env.MCP_GATEWAY_REDIS_TIMEOUT_MS ?? "500", 10);

async function withRedisTimeout<T>(operation: Promise<T>, opName: string): Promise<T> {
  return await Promise.race([
    operation,
    new Promise<T>((_resolve, reject) => {
      setTimeout(() => reject(new Error(`Redis ${opName} timed out after ${REDIS_OP_TIMEOUT_MS}ms`)), REDIS_OP_TIMEOUT_MS);
    }),
  ]);
}

/**
 * Build Redis key for token cache
 */
function buildKey(tenantUniqueId: string, serviceName: string, userEmail: string): string {
  const sanitizedEmail = userEmail.replace(/:/g, "_");
  return `${CACHE.TOKEN_PREFIX}:${tenantUniqueId}:${serviceName}:${sanitizedEmail}`;
}

/**
 * Calculate TTL in seconds from expiresAt date
 * If expiry is less than 15 min, use actual expiry; otherwise cap at 15 min
 */
function calculateTTL(expiresAt: Date): number {
  const ttlMs = expiresAt.getTime() - Date.now();
  const ttlSeconds = Math.floor(ttlMs / 1000);

  // Guard against clock skew or bad data
  if (ttlSeconds <= 0 || !Number.isFinite(ttlSeconds)) {
    return 60; // Minimum 60s fallback
  }

  // Cap at MAX_TOKEN_CACHE_TTL (15 min), but use actual expiry if sooner
  return Math.min(ttlSeconds, TIMEOUTS.MAX_TOKEN_CACHE_TTL);
}

/**
 * Store auth token in cache with TTL
 */
export async function setToken(
  tenantUniqueId: string,
  serviceName: string,
  userEmail: string,
  token: string,
  expiresAt: Date
): Promise<void> {
  const key = buildKey(tenantUniqueId, serviceName, userEmail);
  const ttlSeconds = calculateTTL(expiresAt);
  const redis = redisService.getConnection();
  try {
    await withRedisTimeout(redis.setex(key, ttlSeconds, token), "SETEX");
  } catch (err) {
    console.warn(`[auth-cache] setToken skipped for ${serviceName}: ${errMsg(err)}`);
  }
}

/**
 * Get cached auth token
 * Returns null if expired or not found
 */
export async function getToken(
  tenantUniqueId: string,
  serviceName: string,
  userEmail: string
): Promise<FetchedToken | null> {
  const key = buildKey(tenantUniqueId, serviceName, userEmail);
  const redis = redisService.getConnection();
  let token: string | null = null;
  try {
    token = await withRedisTimeout(redis.get(key), "GET");
  } catch (err) {
    console.warn(`[auth-cache] getToken fallback miss for ${serviceName}: ${errMsg(err)}`);
    return null;
  }

  if (!token) {
    return null;
  }

  return { authToken: token, fromCache: true };
}

/**
 * Delete cached token
 */
export async function deleteToken(
  tenantUniqueId: string,
  serviceName: string,
  userEmail: string
): Promise<void> {
  const key = buildKey(tenantUniqueId, serviceName, userEmail);
  const redis = redisService.getConnection();
  try {
    await withRedisTimeout(redis.del(key), "DEL");
  } catch {
    // Best-effort cache invalidation.
  }
}

/**
 * Invalidate all tokens for a service using SCAN (non-blocking)
 */
export async function invalidateServiceTokens(
  tenantUniqueId: string,
  serviceName: string
): Promise<void> {
  const pattern = `${CACHE.TOKEN_PREFIX}:${tenantUniqueId}:${serviceName}:*`;
  const redis = redisService.getConnection();

  let cursor = "0";
  do {
    let result: [string, string[]];
    try {
      result = await withRedisTimeout(redis.scan(cursor, "MATCH", pattern, "COUNT", 100), "SCAN");
    } catch {
      break;
    }

    cursor = result[0];
    const keys = result[1];

    if (keys.length > 0) {
      try {
        await withRedisTimeout(redis.del(...keys), "DEL");
      } catch {
        // Best-effort cache invalidation.
      }
    }
  } while (cursor !== "0");
}
