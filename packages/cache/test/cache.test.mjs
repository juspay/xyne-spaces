import test from 'node:test';
import assert from 'node:assert/strict';

// Imports the BUILT output on purpose: this is exactly what consumers resolve.
import { createCache } from '../dist/index.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('miss fetches once, hit is served from cache', async () => {
  let calls = 0;
  const cache = createCache({ max: 10, ttlMs: 60_000, fetch: async (key) => { calls += 1; return `${key}:${calls}`; } });
  assert.equal(await cache.get('a'), 'a:1');
  assert.equal(await cache.get('a'), 'a:1');
  assert.equal(calls, 1);
});

test('concurrent misses share one fetch', async () => {
  let calls = 0;
  const cache = createCache({ max: 10, ttlMs: 60_000, fetch: async () => { calls += 1; await sleep(5); return 'v'; } });
  await Promise.all([cache.get('a'), cache.get('a'), cache.get('a')]);
  assert.equal(calls, 1);
});

test('after ttl the stale entry is served while a refresh runs', async () => {
  let calls = 0;
  const cache = createCache({ max: 10, ttlMs: 20, fetch: async () => { calls += 1; return `v${calls}`; } });
  assert.equal(await cache.get('a'), 'v1');
  await sleep(30);
  assert.equal(await cache.get('a'), 'v1'); // stale, returned immediately
  await sleep(5);
  assert.equal(await cache.get('a'), 'v2'); // background refresh landed
});

test('a failed refresh keeps the last-good entry', async () => {
  let calls = 0;
  const cache = createCache({ max: 10, ttlMs: 20, fetch: async () => { calls += 1; if (calls > 1) throw new Error('down'); return 'good'; } });
  assert.equal(await cache.get('a'), 'good');
  await sleep(30);
  assert.equal(await cache.get('a'), 'good');
  await sleep(5);
  assert.equal(await cache.get('a'), 'good');
  assert.ok(calls >= 2);
});

test('a failed first fetch rejects (nothing stale to fall back on)', async () => {
  const cache = createCache({ max: 10, ttlMs: 60_000, fetch: async () => { throw new Error('down'); } });
  await assert.rejects(cache.get('a'), /down/);
});
