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
let RedisStreamStore: (typeof import('./redisStore'))['RedisStreamStore'] | undefined;
let redisService: (typeof import('@/services/redisService'))['redisService'] | undefined;
let reason = '';
try {
  ({ InstanceManager } = await import('./instanceManager.js'));
  ({ ownership, Ownership } = await import('./ownership.js'));
  ({ RedisStreamStore } = await import('./redisStore.js'));
  ({ redisService } = await import('@/services/redisService'));
  await redisService.getClient().ping();
} catch (e) {
  reason = `redis/env unavailable: ${String(e).slice(0, 80)}`;
}
const skip = InstanceManager && ownership && redisService ? false : reason || 'unavailable';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Poll a predicate until true or timeout — robust to async acquire/materialize latency under the
 *  parallel-test Redis load that a fixed sleep can't bound. */
async function waitFor(pred: () => boolean | Promise<boolean>, label: string, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await pred()) return;
    await sleep(10);
  }
  throw new Error(`waitFor timed out: ${label}`);
}

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
      isConnected() { return true; },
      msSinceLastPoke() { return 0; },
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
  await waitFor(() => mgr.activeGroups() === 0, 'empty group closed after grace');
  assert.equal(mgr.activeInstances(), 0, 'instance torn down after grace');
  assert.equal(created[0].stopped, 1, 'connection stopped');
  mgr.stopAll();
});

test('InstanceManager: grant instances get the longer grant grace + warm reconnect', { skip }, async () => {
  const created: Rec[] = [];
  const mgr = new InstanceManager!('http://zero', {
    multiPod: false,
    graceMs: 20, // a DATA instance would tear down this fast
    grantGraceMs: 10_000, // a per-user GRANT instance stays warm far longer
    createConnection: fakeFactory(created),
  });
  const gArgs: readonly unknown[] = [{ userId: 'grace-' + Math.random() }];
  const gik = mgr.subscribe('__grant__channel_participants', gArgs, 'sub1');
  assert.equal(typeof gik, 'string');
  assert.equal(mgr.activeInstances(), 1);

  mgr.unsubscribe(gik!, 'sub1');
  await sleep(80); // well past graceMs(20), well within grantGraceMs(10s)
  assert.equal(mgr.activeInstances(), 1, 'grant instance kept warm past the data grace');
  assert.equal(created[0].stopped, 0, 'grant connection not stopped during grace');

  // A reconnect within the window reuses the WARM instance — same key, no new connection.
  const again = mgr.subscribe('__grant__channel_participants', gArgs, 'sub2');
  assert.equal(again, gik, 'reconnect reuses the same warm grant instance');
  assert.equal(created.length, 1, 'no cold re-materialize');
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
  await waitFor(() => created.length > 0, 'owner materialized the group'); // async: awaits the lease acquire

  const G = created[0].opts.clientGroupID;
  const guard = created[0].opts.guard;
  try {
    assert.equal(created.length, 1);
    assert.ok(guard, 'fenced guard present when owned');
    assert.equal(guard!.groupKey, G);
    assert.equal(guard!.token, await own.fenceOf(G), 'guard token == the acquired fence');
    assert.equal(await own.ownsGroup(G), true, 'this pod holds the lease');
    assert.equal(await own.liveInterest(ik), 1, 'per-instance interest registered');
    assert.deepEqual(created[0].added, [ik]);

    mgr.unsubscribe(ik, 'sub1');
    await waitFor(async () => (await own.liveInterest(ik)) === 0 && !(await own.ownsGroup(G)), 'teardown drains + releases');
    assert.equal(mgr.activeInstances(), 0);
    assert.equal(created[0].stopped, 1, 'connection stopped');
  } finally {
    mgr.stopAll();
    await sleep(40); // let any in-flight heartbeat observe #stopped before we wipe the keys
    await client.del(`sync:owner:${G}`, `sync:fence:${G}`, `sync:interest:${ik}`, `sync:snap:${ik}`, `sync:stream:${ik}`, `sync:cookie:${G}`, `sync:ginst:${G}`);
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
  await waitFor(() => createdA.length > 0, 'A materializes (owns) before B subscribes');
  assert.equal(mgrB.subscribe(QUERY, argsFor(channel), 'subB'), ik, 'same channel → same instanceKey');

  const G = createdA[0].opts.clientGroupID;
  try {
    await waitFor(async () => (await ownA.liveInterest(ik)) === 2, 'both pods registered interest');
    assert.equal(await ownA.ownsGroup(G), true, 'A owns');
    assert.equal(await ownB.ownsGroup(G), false, 'B does not own');
    assert.equal(createdA.length, 1, 'owner A materialized');
    assert.equal(createdB.length, 0, 'non-owner B never opened a connection');

    // B (non-owner) drops its subscriber: LOCAL cleanup only, no Redis reclamation — A keeps serving.
    mgrB.unsubscribe(ik, 'subB');
    await waitFor(async () => (await ownA.liveInterest(ik)) === 1, 'interest drains to just the owner (no resurrection)');
    assert.equal(await ownA.ownsGroup(G), true, 'A still owns after B leaves');
    assert.equal(createdA[0].stopped, 0, "non-owner did NOT tear down the owner's connection");

    // A (owner) drops its subscriber: fleet interest hits 0 → owner reclaims (fenced) + releases.
    mgrA.unsubscribe(ik, 'subA');
    await waitFor(async () => (await ownA.liveInterest(ik)) === 0 && !(await ownA.ownsGroup(G)), 'owner reclaims + releases');
    assert.equal(createdA[0].stopped, 1, 'owner stopped its connection on reclaim');
  } finally {
    mgrA.stopAll();
    mgrB.stopAll();
    await sleep(40); // let any in-flight heartbeat observe #stopped before we wipe the keys
    await client.del(`sync:owner:${G}`, `sync:fence:${G}`, `sync:interest:${ik}`, `sync:snap:${ik}`, `sync:stream:${ik}`, `sync:cookie:${G}`, `sync:ginst:${G}`);
  }
});

test('InstanceManager owner reconcile: materialize remote-only interest, sweep on drain', { skip }, async () => {
  const own = ownership!;
  const client = redisService!.getClient();
  const store = new RedisStreamStore!();
  const rnd = Math.floor(Math.random() * 1e9);
  const created: Rec[] = [];
  const mgr = new InstanceManager!('http://zero', {
    multiPod: true,
    ownership: own,
    assertRedisSafe: async () => {},
    heartbeatMs: 20,
    graceMs: 60_000,
    createConnection: fakeFactory(created),
  });
  // This pod subscribes to X → owns the group. A REMOTE pod subscribes to a different instance I2
  // in the same group: it announces the descriptor + stamps interest under its own podId. The
  // owner's reconcile must materialize I2 even though no local subscriber ever asked for it.
  const ikX = mgr.subscribe(QUERY, argsFor('own-' + rnd), 'subX')!;
  await waitFor(() => created.length > 0, 'this pod owns the group');
  const G = created[0].opts.clientGroupID;
  const remote = new Ownership!(`podFar-${rnd}`);
  const i2 = `remoteinst-${rnd}`;
  try {
    assert.equal(await own.ownsGroup(G), true);
    await remote.addInterest(i2);
    await store.registerInstance(G, i2, JSON.stringify({ args: [{ channelId: 'chY', limit: 25 }], partitionValue: 'chY' }));
    await waitFor(() => created[0].added.includes(i2), 'owner reconcile materializes the remote-only instance');

    // Remote drops interest → owner sweeps it: removeInstance + fenced teardown + deregister.
    await remote.removeInterest(i2);
    await waitFor(async () => created[0].removed.includes(i2) && (await store.groupInstances(G))[i2] === undefined, 'owner sweeps + deregisters the drained remote instance');
    assert.ok(created[0].added.includes(ikX) && !created[0].removed.includes(ikX), 'local instance untouched');
  } finally {
    mgr.stopAll();
    await sleep(40);
    await client.del(`sync:owner:${G}`, `sync:fence:${G}`, `sync:ginst:${G}`, `sync:cookie:${G}`, `sync:interest:${ikX}`, `sync:interest:${i2}`, `sync:snap:${ikX}`, `sync:stream:${ikX}`, `sync:snap:${i2}`, `sync:stream:${i2}`);
  }
});

test('InstanceManager heartbeat re-registers a swept instance (registry self-heal)', { skip }, async () => {
  const own = ownership!;
  const client = redisService!.getClient();
  const store = new RedisStreamStore!();
  const rnd = Math.floor(Math.random() * 1e9);
  const created: Rec[] = [];
  const mgr = new InstanceManager!('http://zero', {
    multiPod: true,
    ownership: own,
    assertRedisSafe: async () => {},
    heartbeatMs: 20,
    graceMs: 60_000,
    createConnection: fakeFactory(created),
  });
  const ik = mgr.subscribe(QUERY, argsFor('heal-' + rnd), 'sub1')!;
  await waitFor(() => created.length > 0, 'owns the group');
  const G = created[0].opts.clientGroupID;
  try {
    await waitFor(async () => (await store.groupInstances(G))[ik] !== undefined, 'registered on subscribe');
    // Simulate a sweep (owner deleted the entry during a remote stall). Interest is still live
    // because this pod's subscriber never left → the heartbeat must re-announce the descriptor,
    // else no owner would ever re-materialize it.
    await client.hdel(`sync:ginst:${G}`, ik);
    assert.equal((await store.groupInstances(G))[ik], undefined, 'entry gone after the sweep');
    await waitFor(async () => (await store.groupInstances(G))[ik] !== undefined, 'heartbeat re-registered the descriptor');
  } finally {
    mgr.stopAll();
    await sleep(40);
    await client.del(`sync:owner:${G}`, `sync:fence:${G}`, `sync:interest:${ik}`, `sync:snap:${ik}`, `sync:stream:${ik}`, `sync:cookie:${G}`, `sync:ginst:${G}`);
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
  await waitFor(() => created.length > 0, 'owns + materializes');
  const G = created[0].opts.clientGroupID;
  try {
    // A foreign pod steals the lease (no TTL → re-acquire keeps failing). Next heartbeat's
    // refreshGroup sees owner != us → demote: stop + discard the connection, no reuse.
    await client.set(`sync:owner:${G}`, 'pod-foreign');
    await waitFor(() => created[0].stopped === 1, 'heartbeat demotes the connection on lost lease');
    assert.equal(created.length, 1, 'not re-materialized while the foreign owner holds the lease');
  } finally {
    mgr.stopAll();
    await sleep(40);
    await client.del(`sync:owner:${G}`, `sync:fence:${G}`, `sync:interest:${ik}`, `sync:snap:${ik}`, `sync:stream:${ik}`, `sync:cookie:${G}`, `sync:ginst:${G}`);
  }
});
