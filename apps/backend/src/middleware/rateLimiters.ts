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

/** Per-user limiter for office-document-to-PDF conversion: each request can spawn a LibreOffice process, so this caps request rate on top of the in-process concurrency cap in officeConversionService. */
export const officeConversionLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  keyGenerator: (req): string => req.user?.id ?? ipKeyGenerator(req.ip ?? 'unknown'),
  message: {
    success: false,
    error: 'Too many conversion requests. Please slow down and try again shortly.',
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

/** Per-user limiter for the composer's related-context lookup: each call runs up to two Jev calls and four searches. The client sends one per pause in typing — a request it cancels still counts — so this sits well above steady typing and only stops a stuck loop or a script. */
export const relatedContextLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120,
  keyGenerator: (req): string => req.user?.id ?? ipKeyGenerator(req.ip ?? 'unknown'),
  // A function, so the timestamp is when the limit was hit rather than server start.
  message: () => ({
    success: false,
    error: 'Too many related-context requests. Please slow down.',
    timestamp: new Date().toISOString(),
  }),
  standardHeaders: true,
  legacyHeaders: false,
});

/** Per-IP limiter for starting an SDK SSO sign-in: unauthenticated, and each call writes two Redis keys. */
export const sdkSsoInitLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 20,
  keyGenerator: (req): string => ipKeyGenerator(req.ip ?? 'unknown'),
  message: () => ({
    error: 'rate_limited',
    message: 'Too many sign-in requests. Please try again later.',
  }),
  standardHeaders: true,
  legacyHeaders: false,
});

/** Per-IP limiter for SDK SSO polling: the SDK polls every 2s, so this allows a few flows at once and stops a loop. */
export const sdkSsoPollLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120,
  keyGenerator: (req): string => ipKeyGenerator(req.ip ?? 'unknown'),
  message: () => ({
    error: 'slow_down',
    message: 'Polling too fast. Please slow down.',
  }),
  standardHeaders: true,
  legacyHeaders: false,
});

/** Per-user limiter for "take me to X" navigation (one Jev call per click step). */
export const assistantNavigateLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120,
  keyGenerator: (req): string => req.user?.id ?? ipKeyGenerator(req.ip ?? 'unknown'),
  message: () => ({
    success: false,
    error: 'Too many navigation requests. Please slow down.',
    timestamp: new Date().toISOString(),
  }),
  standardHeaders: true,
  legacyHeaders: false,
});

/** Per-user limiter for Ask AI routing (one Jev call per typed message). */
export const assistantRouteLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120,
  keyGenerator: (req): string => req.user?.id ?? ipKeyGenerator(req.ip ?? 'unknown'),
  message: () => ({
    success: false,
    error: 'Too many assistant routing requests. Please slow down.',
    timestamp: new Date().toISOString(),
  }),
  standardHeaders: true,
  legacyHeaders: false,
});

/** Per-user limiter for search feedback. Each post @-mentions the whole search group, so a script or a stuck key must not be able to flood them. */
export const searchFeedbackLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5,
  keyGenerator: (req): string => req.user?.id ?? ipKeyGenerator(req.ip ?? 'unknown'),
  message: {
    success: false,
    error: 'Too many feedback posts. Please wait a minute and try again.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});
