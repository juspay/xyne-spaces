import { test, after } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Integration test for the FENCED redisStore writes — needs Redis + a valid env. SKIPS (does
 * not fail) when either is unavailable, so it sits alongside the pure unit suites. Run with:
 *   LIVEKIT_API_KEY=devlocalkey LIVEKIT_API_SECRET=devlocalsecret \
 *     npx dotenv -e .env.local -- tsx --test src/zero/sync/redisStore.test.ts
 */
let RedisStreamStore: (typeof import('./redisStore'))['RedisStreamStore'] | undefined;
let ownership: (typeof import('./ownership'))['ownership'] | undefined;
let fenceKey: (typeof import('./ownership'))['fenceKey'] | undefined;
let redisService: (typeof import('@/services/redisService'))['redisService'] | undefined;
let reason = '';
try {
  ({ RedisStreamStore } = await import('./redisStore.js'));
  ({ ownership, fenceKey } = await import('./ownership.js'));
  ({ redisService } = await import('@/services/redisService'));
  await redisService.getClient().ping();
} catch (e) {
  reason = `redis/env unavailable: ${String(e).slice(0, 80)}`;
}
const skip = RedisStreamStore && ownership && redisService ? false : reason || 'unavailable';

after(() => {
  redisService?.getClient().disconnect();
});

test('redisStore: fenced writes apply with a matching token, STALE otherwise', { skip }, async () => {
  const store = new RedisStreamStore!();
  const own = ownership!;
  const client = redisService!.getClient();
  const rnd = Math.floor(Math.random() * 1e9);
  const G = `testgrp-${rnd}`;
  const I = `testinst-${rnd}`; // fenced target
  const J = `testinst-${rnd}-plain`; // unfenced reference for byte-parity
  const CG = `testgrp-cookie-${rnd}`;
  const keys = [
    `sync:snap:${I}`, `sync:stream:${I}`, `sync:snap:${J}`, `sync:stream:${J}`,
    `sync:cookie:${CG}`, `sync:owner:${G}`, fenceKey!(G), `sync:zgroup:${CG}`, `sync:ginst:${CG}`,
  ];
  const cleanup = () => client.del(...keys);

  const diff = {
    upserts: [{ key: 'tbl:1', tableName: 'tbl', row: { id: '1', txt: 'héllo "quoted"' } }],
    deletes: [] as string[],
  };

  try {
    const token = (await own.acquireGroup(G)) as number;
    assert.equal(typeof token, 'number');
    const guard = { groupKey: G, token };

    // applied with the right token
    assert.equal(await store.applyDiff(I, 'v1', diff, guard), 'applied');
    // unfenced reference write of the SAME data
    assert.equal(await store.applyDiff(J, 'v1', diff), 'applied');
    // byte-for-byte identical snapshot hash (fenced Lua must not re-encode values)
    assert.deepEqual(
      await client.hgetall(`sync:snap:${I}`),
      await client.hgetall(`sync:snap:${J}`),
      'fenced snapshot bytes identical to unfenced path',
    );
    assert.deepEqual(await store.snapshot(I), [{ tableName: 'tbl', row: { id: '1', txt: 'héllo "quoted"' } }]);

    // STALE with the wrong token → no mutation
    const before = await client.hgetall(`sync:snap:${I}`);
    const badGuard = { groupKey: G, token: token + 777 };
    assert.equal(await store.applyDiff(I, 'v2', { upserts: [{ key: 'tbl:2', tableName: 'tbl', row: { id: '2' } }], deletes: [] }, badGuard), 'stale');
    assert.deepEqual(await client.hgetall(`sync:snap:${I}`), before, 'stale applyDiff mutated nothing');

    // markHydrated / saveCookie / reset / teardown are all STALE under a bad token, applied under the good one
    assert.equal(await store.saveCookie(CG, 'cookie-A', badGuard), 'stale');
    assert.equal(await client.get(`sync:cookie:${CG}`), null, 'stale saveCookie wrote nothing');
    assert.equal(await store.saveCookie(CG, 'cookie-A', guard), 'applied');
    assert.equal(await client.get(`sync:cookie:${CG}`), 'cookie-A');

    assert.equal(await store.reset(CG, [I], badGuard), 'stale');
    assert.equal(await client.get(`sync:cookie:${CG}`), 'cookie-A', 'stale reset left the cookie');
    assert.equal(await store.reset(CG, [I], guard), 'applied');
    assert.equal(await client.get(`sync:cookie:${CG}`), null, 'reset dropped the cookie');
    assert.equal(await client.exists(`sync:snap:${I}`), 0, 'reset dropped the snapshot');
    assert.equal(await store.isHydrated(I), false, 'cleared tail → not hydrated');

    // markHydrated on the cleared instance flips it hydrated (fenced)
    assert.equal(await store.markHydrated(I, 'v3', badGuard), 'stale');
    assert.equal(await store.isHydrated(I), false, 'stale markHydrated did nothing');
    assert.equal(await store.markHydrated(I, 'v3', guard), 'applied');
    assert.equal(await store.isHydrated(I), true, 'fenced markHydrated flipped isHydrated');
    // idempotent: tail is now a real materialization → no-op append
    const headBefore = await store.head(I);
    assert.equal(await store.markHydrated(I, 'v4', guard), 'applied');
    assert.equal(await store.head(I), headBefore, 'markHydrated no-op when already hydrated');

    assert.equal(await store.teardownInstance(I, badGuard), 'stale');
    assert.equal(await client.exists(`sync:stream:${I}`), 1, 'stale teardown left the stream');
    assert.equal(await store.teardownInstance(I, guard), 'applied');
    assert.equal(await client.exists(`sync:snap:${I}`, `sync:stream:${I}`), 0, 'fenced teardown removed both keys');

    // zgroup pointer + subscription registry: fenced save, plain load, dropped by teardownGroup
    assert.equal(await store.saveZGroup(CG, 'zg-rotated', badGuard), 'stale');
    assert.equal(await store.loadZGroup(CG), null, 'stale saveZGroup wrote nothing');
    assert.equal(await store.saveZGroup(CG, 'zg-rotated', guard), 'applied');
    assert.equal(await store.loadZGroup(CG), 'zg-rotated');
    await store.registerInstance(CG, I, JSON.stringify({ args: [], partitionValue: 'p' }));
    assert.equal((await store.groupInstances(CG))[I], JSON.stringify({ args: [], partitionValue: 'p' }));
    assert.equal(await store.deregisterInstance(CG, I, badGuard), 'stale');
    assert.equal((await store.groupInstances(CG))[I] !== undefined, true, 'stale deregister kept the entry');
    assert.equal(await store.deregisterInstance(CG, I, guard), 'applied');
    assert.equal((await store.groupInstances(CG))[I], undefined, 'fenced deregister removed the entry');

    await store.saveZGroup(CG, 'zg-rotated', guard);
    await store.registerInstance(CG, I, '{}');
    assert.equal(await store.teardownGroup(CG, guard), 'applied');
    assert.equal(await store.loadZGroup(CG), null, 'teardownGroup dropped the zgroup pointer');
    assert.equal(Object.keys(await store.groupInstances(CG)).length, 0, 'teardownGroup dropped the registry');

    // Missing fence key ⇒ STALE (never a 0-default match): DEL the fence, then any token fails.
    await client.del(fenceKey!(G));
    assert.equal(await store.applyDiff(I, 'v9', diff, guard), 'stale', 'missing fence ⇒ STALE');
    assert.equal(await client.exists(`sync:snap:${I}`), 0, 'no write against a missing fence');
  } finally {
    await own.releaseGroup(G);
    await cleanup();
  }
});

test('redisStore: fenced applyDiff chunks past the Lua unpack limit', { skip }, async () => {
  const store = new RedisStreamStore!();
  const own = ownership!;
  const client = redisService!.getClient();
  const rnd = Math.floor(Math.random() * 1e9);
  const G = `testgrp-big-${rnd}`;
  const I = `testinst-big-${rnd}`;
  const N = 5000; // > LUAI_MAXCSTACK/2 → a single unpack would throw; chunking must not
  try {
    const token = (await own.acquireGroup(G)) as number;
    const guard = { groupKey: G, token };
    const upserts = Array.from({ length: N }, (_, k) => ({
      key: `tbl:${k}`,
      tableName: 'tbl',
      row: { id: String(k) },
    }));
    assert.equal(await store.applyDiff(I, 'v1', { upserts, deletes: [] }, guard), 'applied');
    assert.equal(await client.hlen(`sync:snap:${I}`), N, 'all rows HSET across chunks');

    // delete more than one HDEL chunk worth
    const deletes = Array.from({ length: N }, (_, k) => `tbl:${k}`);
    assert.equal(await store.applyDiff(I, 'v2', { upserts: [], deletes }, guard), 'applied');
    assert.equal(await client.hlen(`sync:snap:${I}`), 0, 'all rows HDEL across chunks');
  } finally {
    await own.releaseGroup(G);
    await client.del(`sync:snap:${I}`, `sync:stream:${I}`, `sync:owner:${G}`, fenceKey!(G));
  }
});
