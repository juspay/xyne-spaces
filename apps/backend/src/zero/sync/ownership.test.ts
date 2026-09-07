import { test, after } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Integration test — needs Redis + a valid env. It SKIPS (does not fail) when either is
 * unavailable, so it can sit alongside the pure unit suites. Run it with a real env, e.g.:
 *   LIVEKIT_API_KEY=devlocalkey LIVEKIT_API_SECRET=devlocalsecret \
 *     npx dotenv -e .env.local -- tsx --test src/zero/sync/ownership.test.ts
 */
let ownership: (typeof import('./ownership'))['ownership'] | undefined;
let redisService: (typeof import('@/services/redisService'))['redisService'] | undefined;
let reason = '';
try {
  ({ ownership } = await import('./ownership.js'));
  ({ redisService } = await import('@/services/redisService'));
  await redisService.getClient().ping();
} catch (e) {
  reason = `redis/env unavailable: ${String(e).slice(0, 80)}`;
}
const skip = ownership && redisService ? false : reason || 'unavailable';

after(() => {
  redisService?.getClient().disconnect();
});

test('ownership: lease + fence + interest', { skip }, async () => {
  const own = ownership!;
  const client = redisService!.getClient();
  const G = 'testgrp-' + Math.floor(Math.random() * 1e9);
  const I = 'testinst-' + Math.floor(Math.random() * 1e9);
  try {
    const t1 = await own.acquireGroup(G);
    assert.equal(typeof t1, 'number');
    assert.ok((t1 as number) > 0, 'acquire returns a positive fence token');
    assert.equal(await own.acquireGroup(G), null, 're-acquire while held is null (exclusive)');
    assert.equal(await own.ownsGroup(G), true);
    assert.equal(await own.refreshGroup(G), true, 'refresh true while owned');
    assert.equal(await own.fenceOf(G), t1, 'fenceOf == acquired token');
    await own.releaseGroup(G);
    assert.equal(await own.ownsGroup(G), false, 'not owned after release');
    const t2 = await own.acquireGroup(G);
    assert.equal(t2, (t1 as number) + 1, 'fence INCREMENTED on re-acquire (monotonic)');

    assert.equal(await own.liveInterest(I), 0, 'interest starts empty');
    await own.addInterest(I);
    assert.equal(await own.liveInterest(I), 1, 'addInterest → live 1');
    await client.hset('sync:interest:' + I, 'pod-dead', Date.now() - 60_000);
    assert.equal(await own.liveInterest(I), 1, 'expired foreign pod pruned on read');
    await own.removeInterest(I);
    assert.equal(await own.liveInterest(I), 0, 'removeInterest → live 0');
  } finally {
    await client.del('sync:owner:' + G, 'sync:fence:' + G, 'sync:interest:' + I);
  }
});
