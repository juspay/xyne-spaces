import test from 'node:test';
import assert from 'node:assert/strict';

// Imports the BUILT output on purpose: this is exactly the module consumers
// resolve. Run via `pnpm --filter @xyne/cache test` (builds first).
import { createSnapshotCache } from '../dist/index.js';
import { createFakeClock, deferred, flush } from './fake-clock.mjs';

/** A loader that returns each step in turn (an Error step rejects); the last step repeats. */
function sequence(...steps) {
  let calls = 0;
  const load = async () => {
    const step = steps[Math.min(calls, steps.length - 1)];
    calls += 1;
    if (step instanceof Error) throw step;
    return step;
  };
  return { load, calls: () => calls };
}

function setup(steps, overrides = {}) {
  const clock = createFakeClock();
  const events = [];
  const source = sequence(...steps);
  const cache = createSnapshotCache({
    name: 'test-cache',
    refreshEveryMs: 1000,
    load: source.load,
    clock,
    onEvent: (event) => events.push(event),
    ...overrides,
  });
  return { cache, clock, events, source };
}

const v1 = [['a', 1], ['b', 2]];
const v2 = [['a', 10]];

test('init loads the snapshot and get/snapshot read it', async () => {
  const { cache, events } = setup([v1]);
  await cache.init();
  assert.equal(cache.get('a'), 1);
  assert.equal(cache.snapshot().size, 2);
  assert.deepEqual(events.map((e) => [e.type, e.trigger, e.size]), [['refresh', 'init', 2]]);
});

test('get and snapshot throw before init', () => {
  const { cache } = setup([v1]);
  assert.throws(() => cache.get('a'), /not initialised/);
  assert.throws(() => cache.snapshot(), /not initialised/);
});

test('get returns undefined for an unknown key', async () => {
  const { cache } = setup([v1]);
  await cache.init();
  assert.equal(cache.get('zzz'), undefined);
});

test('interval refresh swaps the snapshot', async () => {
  const { cache, clock, events } = setup([v1, v2]);
  await cache.init();
  assert.equal(clock.intervals[0].everyMs, 1000);
  await clock.tick();
  assert.equal(cache.get('a'), 10);
  assert.equal(events.at(-1).trigger, 'interval');
});

test('failed refresh keeps last-good and emits refresh-failed', async () => {
  const boom = new Error('db down');
  const { cache, clock, events } = setup([v1, boom]);
  await cache.init();
  await clock.tick();
  assert.equal(cache.get('a'), 1);
  const failed = events.filter((e) => e.type === 'refresh-failed');
  assert.equal(failed.length, 1);
  assert.equal(failed[0].error, boom);
  assert.equal(failed[0].trigger, 'interval');
});

test('refresh replaces, never merges: deleted rows disappear', async () => {
  const { cache, clock } = setup([v1, v2]);
  await cache.init();
  await clock.tick();
  assert.equal(cache.get('b'), undefined);
  assert.equal(cache.snapshot().size, 1);
});

test('refreshNow dedupes concurrent calls into one load', async () => {
  const gate = deferred();
  let calls = 0;
  const { cache, events } = setup([v1], {
    load: async () => {
      calls += 1;
      if (calls === 1) return v1;
      await gate.promise;
      return v2;
    },
  });
  await cache.init();
  const first = cache.refreshNow();
  const second = cache.refreshNow();
  gate.resolve();
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.equal(calls, 2); // one for init, one shared by both refreshNow calls
  assert.equal(events.filter((e) => e.type === 'refresh').length, 2);
});

test('stop clears the timer, drops the snapshot, and emits stop', async () => {
  const { cache, clock, events, source } = setup([v1]);
  await cache.init();
  cache.stop();
  assert.equal(clock.cleared, 1);
  assert.equal(events.at(-1).type, 'stop');
  assert.throws(() => cache.get('a'), /not initialised/);
  const before = source.calls();
  await clock.tick();
  assert.equal(source.calls(), before);
});

test('init is idempotent', async () => {
  const { cache, clock, source } = setup([v1]);
  await Promise.all([cache.init(), cache.init()]);
  await cache.init();
  assert.equal(source.calls(), 1);
  assert.equal(clock.registered, 1);
});

test('a failed init rejects with the cause and can be retried', async () => {
  const boom = new Error('boot: db down');
  const { cache, clock, events } = setup([boom, v1]);
  await assert.rejects(cache.init(), boom);
  assert.equal(clock.registered, 0);
  assert.deepEqual(events.map((e) => [e.type, e.trigger]), [['refresh-failed', 'init']]);
  await cache.init();
  assert.equal(cache.get('a'), 1);
  assert.equal(clock.registered, 1);
});

test('refreshNow resolves false on failure and never throws', async () => {
  const { cache } = setup([v1, new Error('later')]);
  await cache.init();
  assert.equal(await cache.refreshNow(), false);
  assert.equal(cache.get('a'), 1);
});

test('init can be called again after stop', async () => {
  const { cache, clock, source } = setup([v1]);
  await cache.init();
  cache.stop();
  await cache.init();
  assert.equal(source.calls(), 2);
  assert.equal(clock.registered, 2);
  assert.equal(cache.get('a'), 1);
  await flush();
});
