import rateLimit, { ipKeyGenerator, RateLimitRequestHandler } from 'express-rate-limit';

/**
 * General rate limiter for all API endpoints
 * Applied to: /api/auth/*, /api/tickets/*, /api/public/users/*, and all other API routes
 * Combines API key, auth, and general API protection
 */
export const generalLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 100, // General limit for all API requests
  message: {
    success: false,
    error: 'Too many requests from this IP. Please try again later.',
    timestamp: new Date().toISOString(),
  },
  standardHeaders: true,
  legacyHeaders: false,
});

export const aiTitleLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 15,
  keyGenerator: (req): string => req.user?.id ?? ipKeyGenerator(req.ip ?? 'unknown'),
  message: {
    success: false,
    error: 'Too many title requests. Please slow down and try again shortly.',
    timestamp: new Date().toISOString(),
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/** Per-user limiter for the self-serve Slack migration API (~2 req/s/user): above polling, blocks refresh/script spam. */
export const slackMigrationLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120,
  keyGenerator: (req): string => req.user?.id ?? ipKeyGenerator(req.ip ?? 'unknown'),
  message: {
    success: false,
    error: 'Too many migration requests. Please slow down and try again shortly.',
    timestamp: new Date().toISOString(),
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limiter for webhook endpoints
 * Applied to: /api/webhooks/* and external source sync routes
 */
export const webhookLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 5000, // Allow more for legitimate webhook traffic but prevent abuse
  message: {
    success: false,
    error: 'Webhook rate limit exceeded. Please try again later.',
    timestamp: new Date().toISOString(),
  },
  standardHeaders: true,
  legacyHeaders: false,
});
