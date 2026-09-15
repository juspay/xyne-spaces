import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ZERO_RATE_LIMIT,
  minimumIdentities,
  resolveZeroRequestBudget,
} from '../config/rate-limit.mjs';
import { buildExecutionProfile, peakVus } from '../k6/profiles.mjs';

test('mirrors the backend Zero rate-limit defaults', () => {
  // apps/backend/src/services/zeroRateLimiter.ts: ZERO_MAX_REQUESTS / ZERO_REQUEST_WINDOW,
  // counted per authenticated user (authData.sub).
  assert.deepEqual(ZERO_RATE_LIMIT, { maxRequests: 300, windowSeconds: 60 });
});

test('derives peak virtual users from a built execution profile', () => {
  assert.equal(peakVus(buildExecutionProfile('smoke')), 1);
  assert.equal(peakVus(buildExecutionProfile('release')), 25);
  assert.equal(peakVus(buildExecutionProfile('load')), 100);
  assert.equal(peakVus(buildExecutionProfile('stress')), 300);
  assert.equal(peakVus(buildExecutionProfile('load', { vus: 40 })), 40);
});

test('sizes the fixture so the limiter never becomes the bottleneck', () => {
  // 300 requests / 60s = 5 requests per second per identity.
  assert.equal(minimumIdentities({ peakVus: 25, thinkTimeSeconds: 1 }), 5);
  assert.equal(minimumIdentities({ peakVus: 100, thinkTimeSeconds: 1 }), 20);
  assert.equal(minimumIdentities({ peakVus: 300, thinkTimeSeconds: 1 }), 60);
  assert.equal(minimumIdentities({ peakVus: 1, thinkTimeSeconds: 1 }), 1);
});

test('a longer think time lowers the identity requirement', () => {
  assert.equal(minimumIdentities({ peakVus: 100, thinkTimeSeconds: 4 }), 5);
});

test('always requires at least one identity', () => {
  assert.equal(minimumIdentities({ peakVus: 1, thinkTimeSeconds: 60 }), 1);
});

test('honours a target that has been configured with a higher limit', () => {
  assert.deepEqual(resolveZeroRequestBudget({}), ZERO_RATE_LIMIT);
  assert.deepEqual(
    resolveZeroRequestBudget({ PERF_ZERO_MAX_REQUESTS: '3000' }),
    { maxRequests: 3000, windowSeconds: 60 },
  );
  assert.equal(
    minimumIdentities({ peakVus: 300, thinkTimeSeconds: 1, maxRequests: 3000 }),
    6,
  );
});

test('rejects a non-numeric or non-positive configured limit', () => {
  assert.throws(
    () => resolveZeroRequestBudget({ PERF_ZERO_MAX_REQUESTS: 'lots' }),
    /PERF_ZERO_MAX_REQUESTS/,
  );
  assert.throws(
    () => resolveZeroRequestBudget({ PERF_ZERO_MAX_REQUESTS: '0' }),
    /PERF_ZERO_MAX_REQUESTS/,
  );
});
