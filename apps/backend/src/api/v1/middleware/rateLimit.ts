import type { NextFunction, Request, Response } from 'express';
import { redisService } from '@/services/redisService';
import { logger } from '@/utils/logger';
import { ApiError } from '../errors';
import { v1Config } from '../config';

/**
 * Redis token bucket keyed on (user, client), with separate read and write
 * budgets.
 *
 * Deliberately not `services/zeroRateLimiter.ts`: that is a fixed-window
 * counter keyed on user id only, and its two buckets are shared with zero-cache
 * traffic. SDK callers need their own budget, per-client attribution, and a
 * smooth refill so a burst does not starve the rest of the minute.
 */
const LUA_TOKEN_BUCKET = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill_per_sec = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])

local bucket = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(bucket[1])
local ts = tonumber(bucket[2])
if tokens == nil then
  tokens = capacity
  ts = now
end

local elapsed = math.max(0, now - ts)
tokens = math.min(capacity, tokens + elapsed * refill_per_sec)

local allowed = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
end

redis.call('HMSET', key, 'tokens', tokens, 'ts', now)
redis.call('EXPIRE', key, math.ceil(capacity / refill_per_sec) + 60)

local retry_after = 0
if allowed == 0 then
  retry_after = math.ceil((cost - tokens) / refill_per_sec)
end
return { allowed, math.floor(tokens), retry_after }
`;

export function rateLimit(kind: 'read' | 'write') {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const auth = req.sdkAuth;
    if (!auth) {
      next(new ApiError('unauthenticated', 'Rate limiting requires an authenticated principal.'));
      return;
    }

    const perMinute =
      kind === 'read' ? v1Config.rateLimit.readPerMinute : v1Config.rateLimit.writePerMinute;
    const capacity = Math.max(1, Math.floor(perMinute * v1Config.rateLimit.burstMultiplier));
    const refillPerSec = perMinute / 60;
    const key = `sdk:rl:${kind}:${auth.authData.sub}:${auth.clientId}`;

    try {
      const client = redisService.getClient();
      const result = (await client.eval(
        LUA_TOKEN_BUCKET,
        1,
        key,
        String(capacity),
        String(refillPerSec),
        String(Date.now() / 1000),
        '1',
      )) as [number, number, number];

      const [allowed, remaining, retryAfter] = result;
      res.setHeader('RateLimit-Limit', String(perMinute));
      res.setHeader('RateLimit-Remaining', String(Math.max(0, remaining)));
      res.setHeader('RateLimit-Policy', `${perMinute};w=60`);

      if (!allowed) {
        next(
          new ApiError('rate_limited', `Rate limit exceeded for ${kind} requests.`, {
            retryAfterSeconds: Math.max(1, retryAfter),
          }),
        );
        return;
      }
      next();
    } catch (err) {
      // Fail open so a Redis outage cannot take the API down, but make it loud —
      // this is the one path where a dependency failure silently removes a control.
      logger.error('[v1] rate limiter unavailable, allowing request', {
        requestId: req.apiRequestId,
        err,
      });
      next();
    }
  };
}
