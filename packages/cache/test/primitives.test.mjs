import test from 'node:test';
import assert from 'node:assert/strict';

import { singleFlight } from '../dist/single-flight.js';
import { createScheduler } from '../dist/scheduler.js';
import { systemClock } from '../dist/clock.js';
import { createFakeClock, deferred } from './fake-clock.mjs';

test('singleFlight shares the in-flight promise and clears after it settles', async () => {
  const gate = deferred();
  let calls = 0;
  const run = singleFlight(async () => {
    calls += 1;
    return gate.promise;
  });
  const a = run();
  const b = run();
  assert.equal(a, b);
  gate.resolve('done');
  assert.equal(await a, 'done');
  const c = run();
  assert.notEqual(c, a);
  assert.equal(calls, 2);
  gate.resolve();
  await c;
});

test('singleFlight clears after rejection so the next call retries', async () => {
  let calls = 0;
  const run = singleFlight(async () => {
    calls += 1;
    if (calls === 1) throw new Error('first');
    return 'second';
  });
  await assert.rejects(run(), /first/);
  assert.equal(await run(), 'second');
});

test('scheduler.start is idempotent and stop clears once', () => {
  const clock = createFakeClock();
  const scheduler = createScheduler({ everyMs: 50, run: () => {}, clock });
  scheduler.start();
  scheduler.start();
  assert.equal(clock.registered, 1);
  scheduler.stop();
  scheduler.stop();
  assert.equal(clock.cleared, 1);
});

test('systemClock timers are unref’d so they never hold the process open', () => {
  const handle = systemClock.setInterval(() => {}, 60_000);
  assert.equal(typeof handle.unref, 'function');
  assert.equal(handle.hasRef(), false);
  systemClock.clearInterval(handle);
});
