import { redisService } from './redisService';
import { logger } from '@/utils/logger';

export async function checkRateLimit(endpoint: string, identifier: string): Promise<boolean> {
  

  try {
    const maxRequests = parseInt(process.env.ZERO_MAX_REQUESTS || '100', 10);
    const windowSeconds = parseInt(process.env.ZERO_REQUEST_WINDOW || '60', 10);
    const redis = redisService.getClient();
    const key = `rate:${endpoint}:${identifier}`;

    // Atomic: Initialize key with TTL if it doesn't exist (SET NX EX)
    await redis.set(key, 0, 'EX', windowSeconds, 'NX');

    // Atomic: Increment and get count
    const count = await redis.incr(key);

    return count <= maxRequests;
  } catch (error) {
    // If Redis is unavailable, log the error and allow the request through
    // This ensures the service remains available even when Redis is down
    logger.warn('[RateLimiter] Redis unavailable, bypassing rate limit check', {
      endpoint,
      identifier,
      error: error instanceof Error ? error.message : String(error),
    });
    return true;
  }
}
