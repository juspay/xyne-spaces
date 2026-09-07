import { test, after } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Integration test for InstanceManager ownership gating — needs Redis + a valid env. SKIPS when
 * either is unavailable. The PackConnection is a FAKE (injected factory) so no zero-cache is
 * required; ownership is the REAL singleton against the dev Redis, so lease/fence/interest state
 * is asserted end-to-end. Run:
 *   LIVEKIT_API_KEY=devlocalkey LIVEKIT_API_SECRET=devlocalsecret \
 *     npx dotenv -e .env.local -- tsx --test src/zero/sync/instanceManager.test.ts
 */
type Mod = typeof import('./instanceManager');
let InstanceManager: Mod['InstanceManager'] | undefined;
let ownership: (typeof import('./ownership'))['ownership'] | undefined;
let Ownership: (typeof import('./ownership'))['Ownership'] | undefined;
let redisService: (typeof import('@/services/redisService'))['redisService'] | undefined;
let reason = '';
try {
  ({ InstanceManager } = await import('./instanceManager.js'));
  ({ ownership, Ownership } = await import('./ownership.js'));
  ({ redisService } = await import('@/services/redisService'));
  await redisService.getClient().ping();
} catch (e) {
  reason = `redis/env unavailable: ${String(e).slice(0, 80)}`;
}
const skip = InstanceManager && ownership && redisService ? false : reason || 'unavailable';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface Rec {
  opts: import('./tapConnection').PackConnectionOptions;
  started: number;
  stopped: number;
  added: string[];
  removed: string[];
}
function fakeFactory(created: Rec[]): (opts: import('./tapConnection').PackConnectionOptions) => import('./instanceManager').PackConnectionLike {
  return (opts) => {
    const rec: Rec = { opts, started: 0, stopped: 0, added: [], removed: [] };
    created.push(rec);
    return {
      async start() { rec.started++; },
      stop() { rec.stopped++; },
      addInstance(ik: string) { if (!rec.added.includes(ik)) rec.added.push(ik); },
      removeInstance(ik: string) { rec.removed.push(ik); },
      size() { return rec.added.length - rec.removed.length; },
    };
  };
}

const QUERY = 'channelLatestMultipleConversationsV4';
const argsFor = (channelId: string): readonly unknown[] => [{ channelId, limit: 25 }];

after(() => {
  redisService?.getClient().disconnect();
});

test('InstanceManager single-pod: unfenced materialize + teardown', { skip }, async () => {
  const created: Rec[] = [];
  const mgr = new InstanceManager!('http://zero', {
    multiPod: false,
    graceMs: 20,
    createConnection: fakeFactory(created),
  });
  const ik = mgr.subscribe(QUERY, argsFor('single-' + Math.random()), 'sub1');
  assert.equal(typeof ik, 'string');
  // single-pod runs materialization synchronously (no ownership await)
  assert.equal(created.length, 1, 'connection opened');
  assert.equal(created[0].opts.guard, undefined, 'no fence guard in single-pod');
  assert.deepEqual(created[0].added, [ik], 'instance desired');
  assert.equal(created[0].started, 1);
  assert.equal(mgr.activeGroups(), 1);

  mgr.unsubscribe(ik!, 'sub1');
  await sleep(80); // > graceMs
  assert.equal(mgr.activeInstances(), 0, 'instance torn down after grace');
  assert.equal(mgr.activeGroups(), 0, 'empty group closed');
  assert.equal(created[0].stopped, 1, 'connection stopped');
  mgr.stopAll();
});

test('InstanceManager multi-pod: acquire → fenced materialize → interest, teardown releases', { skip }, async () => {
  const own = ownership!;
  const client = redisService!.getClient();
  const created: Rec[] = [];
  const mgr = new InstanceManager!('http://zero', {
    multiPod: true,
    ownership: own,
    assertRedisSafe: async () => {},
    heartbeatMs: 60_000, // parked — this test drives lifecycle directly
    graceMs: 20,
    createConnection: fakeFactory(created),
  });
  const ik = mgr.subscribe(QUERY, argsFor('multi-' + Math.floor(Math.random() * 1e9)), 'sub1')!;
  await sleep(60); // materialization is async (awaits the lease acquire)

  assert.equal(created.length, 1, 'owner materialized the group');
  const G = created[0].opts.clientGroupID;
  const guard = created[0].opts.guard;
  try {
    assert.ok(guard, 'fenced guard present when owned');
    assert.equal(guard!.groupKey, G);
    assert.equal(guard!.token, await own.fenceOf(G), 'guard token == the acquired fence');
    assert.equal(await own.ownsGroup(G), true, 'this pod holds the lease');
    assert.equal(await own.liveInterest(ik), 1, 'per-instance interest registered');
    assert.deepEqual(created[0].added, [ik]);

    mgr.unsubscribe(ik, 'sub1');
    await sleep(80);
    assert.equal(await own.liveInterest(ik), 0, 'interest dropped on teardown');
    assert.equal(await own.ownsGroup(G), false, 'lease released when the group emptied');
    assert.equal(mgr.activeInstances(), 0);
    assert.equal(created[0].stopped, 1, 'connection stopped');
  } finally {
    mgr.stopAll();
    await client.del(`sync:owner:${G}`, `sync:fence:${G}`, `sync:interest:${ik}`, `sync:snap:${ik}`, `sync:stream:${ik}`, `sync:cookie:${G}`);
  }
});

test('InstanceManager two pods: exactly one owns; non-owner never reclaims; interest drains', { skip }, async () => {
  const client = redisService!.getClient();
  const rnd = Math.floor(Math.random() * 1e9);
  const ownA = new Ownership!(`podA-${rnd}`);
  const ownB = new Ownership!(`podB-${rnd}`);
  const createdA: Rec[] = [];
  const createdB: Rec[] = [];
  const mk = (own: import('./ownership').Ownership, created: Rec[]) =>
    new InstanceManager!('http://zero', {
      multiPod: true,
      ownership: own,
      assertRedisSafe: async () => {},
      heartbeatMs: 25,
      graceMs: 20,
      createConnection: fakeFactory(created),
    });
  const mgrA = mk(ownA, createdA);
  const mgrB = mk(ownB, createdB);
  const channel = `twopod-${rnd}`;

  // A subscribes first and wins the lease deterministically; then B subscribes and sees it owned.
  const ik = mgrA.subscribe(QUERY, argsFor(channel), 'subA')!;
  await sleep(60);
  assert.equal(mgrB.subscribe(QUERY, argsFor(channel), 'subB'), ik, 'same channel → same instanceKey');
  await sleep(60);

  const G = createdA[0].opts.clientGroupID;
  try {
    assert.equal(await ownA.ownsGroup(G), true, 'A owns');
    assert.equal(await ownB.ownsGroup(G), false, 'B does not own');
    assert.equal(createdA.length, 1, 'owner A materialized');
    assert.equal(createdB.length, 0, 'non-owner B never opened a connection');
    assert.equal(await ownA.liveInterest(ik), 2, 'both pods registered interest');

    // B (non-owner) drops its subscriber: LOCAL cleanup only, no Redis reclamation — A keeps serving.
    mgrB.unsubscribe(ik, 'subB');
    await sleep(70);
    assert.equal(await ownA.ownsGroup(G), true, 'A still owns after B leaves');
    assert.equal(createdA[0].stopped, 0, "non-owner did NOT tear down the owner's connection");
    assert.equal(await ownA.liveInterest(ik), 1, 'interest drained to just the owner (no re-stamp resurrection)');

    // A (owner) drops its subscriber: fleet interest hits 0 → owner reclaims (fenced) + releases.
    mgrA.unsubscribe(ik, 'subA');
    await sleep(70);
    assert.equal(await ownA.liveInterest(ik), 0, 'fleet interest fully drained');
    assert.equal(await ownA.ownsGroup(G), false, 'owner released the lease on reclaim');
    assert.equal(createdA[0].stopped, 1, 'owner stopped its connection on reclaim');
  } finally {
    mgrA.stopAll();
    mgrB.stopAll();
    await client.del(`sync:owner:${G}`, `sync:fence:${G}`, `sync:interest:${ik}`, `sync:snap:${ik}`, `sync:stream:${ik}`, `sync:cookie:${G}`);
  }
});

test('InstanceManager multi-pod: heartbeat demotes a stolen lease', { skip }, async () => {
  const own = ownership!;
  const client = redisService!.getClient();
  const created: Rec[] = [];
  const mgr = new InstanceManager!('http://zero', {
    multiPod: true,
    ownership: own,
    assertRedisSafe: async () => {},
    heartbeatMs: 25,
    graceMs: 60_000, // park teardown — this test drives the heartbeat
    createConnection: fakeFactory(created),
  });
  const ik = mgr.subscribe(QUERY, argsFor('steal-' + Math.floor(Math.random() * 1e9)), 'sub1')!;
  await sleep(60);
  assert.equal(created.length, 1);
  const G = created[0].opts.clientGroupID;
  try {
    // A foreign pod steals the lease (no TTL → re-acquire keeps failing). Next heartbeat's
    // refreshGroup sees owner != us → demote: stop + discard the connection, no reuse.
    await client.set(`sync:owner:${G}`, 'pod-foreign');
    await sleep(90); // a few heartbeats
    assert.equal(created[0].stopped, 1, 'demoted connection stopped');
    assert.equal(created.length, 1, 'not re-materialized while the foreign owner holds the lease');
  } finally {
    mgr.stopAll();
    await client.del(`sync:owner:${G}`, `sync:fence:${G}`, `sync:interest:${ik}`, `sync:snap:${ik}`, `sync:stream:${ik}`, `sync:cookie:${G}`);
  }
});
