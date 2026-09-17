import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hookMutationTrackerPrototype } from './confirmedMutations.js';

/**
 * Unit-tests the MutationTracker correlation in isolation (a fake tracker prototype + a fake host), so
 * it runs in a plain node runner without the `#zero-client` deep import. Proves: trackMutation captures
 * the serverPromise, mutationIDAssigned pairs it with the id, and the host is told the SERVER result —
 * success ⇒ ok, app-error ⇒ !ok, rejection ⇒ !ok — with the ORIGINAL methods still invoked.
 */

type Settled = { mutationID: number; ok: boolean };

function fakeHost() {
  const settled: Settled[] = [];
  return { settled, noteMutationSettled: (mutationID: number, ok: boolean) => settled.push({ mutationID, ok }) };
}

// Minimal stand-in for Zero's MutationTracker: trackMutation hands out an ephemeralID + a resolvable
// serverPromise (the test drives resolution); the originals just record that they ran.
function fakeTrackerClass() {
  const origCalls: string[] = [];
  const resolvers = new Map<object, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
  class FakeTracker {
    trackMutation() {
      origCalls.push('track');
      const ephemeralID = {};
      let resolve!: (v: unknown) => void;
      let reject!: (e: unknown) => void;
      const serverPromise = new Promise((res, rej) => { resolve = res; reject = rej; });
      resolvers.set(ephemeralID, { resolve, reject });
      return { ephemeralID, serverPromise };
    }
    mutationIDAssigned(_ephemeralID: unknown, _mutationID: number) {
      origCalls.push('assign');
    }
  }
  return { FakeTracker, origCalls, resolvers };
}

const tick = () => new Promise((r) => setImmediate(r));

test('a server SUCCESS settles the paired mutationID as ok=true (originals still run)', async () => {
  const { FakeTracker, origCalls, resolvers } = fakeTrackerClass();
  const host = fakeHost();
  hookMutationTrackerPrototype(FakeTracker.prototype, host as never);
  const t = new FakeTracker();
  const { ephemeralID, serverPromise } = t.trackMutation() as { ephemeralID: object; serverPromise: Promise<unknown> };
  t.mutationIDAssigned(ephemeralID, 42);
  resolvers.get(ephemeralID)!.resolve({ type: 'success' });
  await serverPromise;
  await tick();
  assert.deepEqual(host.settled, [{ mutationID: 42, ok: true }]);
  assert.deepEqual(origCalls, ['track', 'assign']); // wraps delegate to the originals
});

test('a server APP-ERROR settles ok=false (revert)', async () => {
  const { FakeTracker, resolvers } = fakeTrackerClass();
  const host = fakeHost();
  hookMutationTrackerPrototype(FakeTracker.prototype, host as never);
  const t = new FakeTracker();
  const { ephemeralID } = t.trackMutation() as { ephemeralID: object };
  t.mutationIDAssigned(ephemeralID, 7);
  resolvers.get(ephemeralID)!.resolve({ type: 'error', error: { type: 'app', message: 'x' } });
  await tick();
  assert.deepEqual(host.settled, [{ mutationID: 7, ok: false }]);
});

test('a serverPromise REJECTION settles ok=false', async () => {
  const { FakeTracker, resolvers } = fakeTrackerClass();
  const host = fakeHost();
  hookMutationTrackerPrototype(FakeTracker.prototype, host as never);
  const t = new FakeTracker();
  const { ephemeralID } = t.trackMutation() as { ephemeralID: object };
  t.mutationIDAssigned(ephemeralID, 9);
  resolvers.get(ephemeralID)!.reject(new Error('infra'));
  await tick();
  assert.deepEqual(host.settled, [{ mutationID: 9, ok: false }]);
});

test('distinct trackers stay isolated; unpaired ids never settle', async () => {
  const { FakeTracker, resolvers } = fakeTrackerClass();
  const host = fakeHost();
  hookMutationTrackerPrototype(FakeTracker.prototype, host as never);
  const a = new FakeTracker();
  const b = new FakeTracker();
  const ra = a.trackMutation() as { ephemeralID: object };
  const rb = b.trackMutation() as { ephemeralID: object };
  a.mutationIDAssigned(ra.ephemeralID, 100);
  // b's mutation is tracked but never id-assigned → must not settle anything.
  resolvers.get(ra.ephemeralID)!.resolve({ type: 'success' });
  resolvers.get(rb.ephemeralID)!.resolve({ type: 'success' });
  await tick();
  assert.deepEqual(host.settled, [{ mutationID: 100, ok: true }]);
});

test('hooking is idempotent (second call does not double-wrap → single settle)', async () => {
  const { FakeTracker, resolvers } = fakeTrackerClass();
  const host = fakeHost();
  hookMutationTrackerPrototype(FakeTracker.prototype, host as never);
  hookMutationTrackerPrototype(FakeTracker.prototype, host as never); // no-op
  const t = new FakeTracker();
  const { ephemeralID } = t.trackMutation() as { ephemeralID: object };
  t.mutationIDAssigned(ephemeralID, 5);
  resolvers.get(ephemeralID)!.resolve({ type: 'success' });
  await tick();
  assert.deepEqual(host.settled, [{ mutationID: 5, ok: true }]);
});
