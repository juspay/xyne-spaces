import { redisService } from './redisService';
import { logger } from '@/utils/logger';

export async function checkRateLimit(endpoint: string, identifier: string): Promise<boolean> {
  try {
    const maxRequests = parseInt(process.env.ZERO_MAX_REQUESTS || '100', 10);
    const windowSeconds = parseInt(process.env.ZERO_REQUEST_WINDOW || '60', 10);
    const redis = redisService.getClient();
    const key = `rate:${endpoint}:${identifier}`;

    // Execute INCR and EXPIRE in a single transaction
    const results = await redis.multi().incr(key).expire(key, windowSeconds, 'NX').exec();

    // results[0] contains [error, count] from INCR
    const count = results?.[0]?.[1] as number;

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
