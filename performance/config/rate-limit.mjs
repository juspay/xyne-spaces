// The Zero endpoints are rate limited per authenticated user, not per connection:
// apps/backend/src/services/zeroRateLimiter.ts counts requests against
// `authData.sub` in a fixed window (ZERO_MAX_REQUESTS / ZERO_REQUEST_WINDOW).
//
// A load test that shares one identity across many virtual users therefore measures
// the limiter rather than the application, and reports the limiter working correctly
// as a product failure. These helpers size the identity fixture so that cannot happen.
export const ZERO_RATE_LIMIT = Object.freeze({ maxRequests: 300, windowSeconds: 60 });

/**
 * The per-identity request budget in force on the target.
 *
 * Defaults to the backend's own defaults. An operator who has raised the limit for
 * a test window states the configured value via PERF_ZERO_MAX_REQUESTS so the
 * fixture requirement relaxes to match the environment rather than the source default.
 */
export function resolveZeroRequestBudget(env = {}) {
  const configured = env.PERF_ZERO_MAX_REQUESTS;
  if (configured === undefined || configured === '') return ZERO_RATE_LIMIT;

  const parsed = Number(configured);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error('PERF_ZERO_MAX_REQUESTS must be a positive integer');
  }
  return Object.freeze({ maxRequests: parsed, windowSeconds: ZERO_RATE_LIMIT.windowSeconds });
}

/**
 * How many distinct test identities a run needs so the limiter stays out of the way.
 *
 * Each virtual user issues roughly one request per think-time interval, and each
 * identity absorbs maxRequests/windowSeconds of them. Response time is ignored, which
 * overestimates demand slightly — the safe direction for a guard.
 */
export function minimumIdentities({
  peakVus,
  thinkTimeSeconds,
  maxRequests = ZERO_RATE_LIMIT.maxRequests,
  windowSeconds = ZERO_RATE_LIMIT.windowSeconds,
}) {
  const requestsPerSecond = peakVus / thinkTimeSeconds;
  const budgetPerIdentity = maxRequests / windowSeconds;
  return Math.max(1, Math.ceil(requestsPerSecond / budgetPerIdentity));
}
