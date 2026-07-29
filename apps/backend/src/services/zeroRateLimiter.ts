import { redisService } from './redisService';
import { logger } from '@/utils/logger';

export async function checkRateLimit(endpoint: string, identifier: string, count = 1): Promise<boolean> {
  try {
    const maxRequests = parseInt(process.env.ZERO_MAX_REQUESTS || '300', 10);
    const windowSeconds = parseInt(process.env.ZERO_REQUEST_WINDOW || '60', 10);
    const redis = redisService.getClient();
    const key = `rate:${endpoint}:${identifier}`;

    // Increment by the batch size (count) instead of 1
    const results = await redis.multi().incrby(key, count).expire(key, windowSeconds, 'NX').exec();

    // results[0] contains [error, currentCount] from INCRBY
    const currentCount = results?.[0]?.[1] as number;

    return currentCount <= maxRequests;
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
