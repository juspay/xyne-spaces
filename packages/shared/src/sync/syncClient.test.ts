import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SyncClient, type SyncTransport } from './syncClient.js';
import type { IvmHost } from './ivmHost.js';
import type { SyncStore } from './store.js';

/**
 * Unit-tests the connection-level serving fallback in isolation (fake transport/host/store). Proves the
 * role-agnostic fallback contract: `sync:unavailable` flips the reactive flag (→ useQuery routes to
 * native Zero) and notifies subscribers, `sync:ready` clears it, and a per-query `sync:error` is handled
 * without throwing. No socket, no IVM — construction only touches the transport for the event wiring.
 */

/** A fake transport that records handlers so the test can fire server → client events. */
function fakeTransport() {
  const handlers = new Map<string, (payload: unknown) => void>();
  const transport: SyncTransport = {
    emit: () => {},
    on: <P>(event: string, handler: (payload: P) => void) =>
      handlers.set(event, handler as (p: unknown) => void),
    off: (event: string) => handlers.delete(event),
  };
  const fire = (event: string, payload?: unknown) => handlers.get(event)?.(payload);
  return { transport, fire, has: (e: string) => handlers.has(e) };
}

function makeClient() {
  const t = fakeTransport();
  const host = {} as unknown as IvmHost;
  const store = {} as unknown as SyncStore;
  const client = new SyncClient(host, t.transport, store);
  client.start();
  return { client, ...t };
}

test('sync:unavailable flips isUnavailable() and notifies serving subscribers', () => {
  const { client, fire } = makeClient();
  let notified = 0;
  client.onServingChange(() => { notified += 1; });

  assert.equal(client.isUnavailable(), false, 'serving by default (server has not refused)');
  fire('sync:unavailable', { reason: 'role-not-served' });
  assert.equal(client.isUnavailable(), true, 'refused principal → unavailable');
  assert.equal(notified, 1, 'subscribers notified on the transition');
});

test('a subsequent sync:ready clears unavailable (reconnect may carry a changed role)', () => {
  const { client, fire } = makeClient();
  const flips: boolean[] = [];
  client.onServingChange(() => flips.push(client.isUnavailable()));

  fire('sync:unavailable', { reason: 'role-not-served' });
  fire('sync:ready');
  assert.equal(client.isUnavailable(), false, 'sync:ready re-enables serving');
  assert.deepEqual(flips, [true, false], 'one notify per real transition, no duplicates');
});

test('idempotent: a second sync:unavailable does not re-notify', () => {
  const { client, fire } = makeClient();
  let notified = 0;
  client.onServingChange(() => { notified += 1; });
  fire('sync:unavailable', {});
  fire('sync:unavailable', {});
  assert.equal(notified, 1, 'no notify when the flag is unchanged');
});

test('sync:error is handled without throwing (SWR handoff is the actual fallback)', () => {
  const { client, fire, has } = makeClient();
  assert.ok(has('sync:error'), 'error listener registered');
  assert.doesNotThrow(() => fire('sync:error', { queryName: 'q', message: 'nope' }));
  assert.equal(client.isUnavailable(), false, 'a per-query error does not mark the whole connection unavailable');
});

/**
 * Hydration-completeness gate: `complete` must mean "server-confirmed current AND the local
 * seeded base fully applied" — never an empty/partial view. The zero-delta resume answers in
 * a network round-trip and regularly beats the IDB seed read; flipping early made consumers
 * (ChatListV4 complete+empty branch) wipe on channel switch-return.
 */

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function makeHydrationHarness(seedRows: { tableName: string; row: Record<string, unknown>; version?: string }[]) {
  const handlers = new Map<string, (payload: unknown) => void>();
  const seedGate = deferred<void>();
  const applied: string[] = [];
  const transport: SyncTransport = {
    emit: <P, A = void>(event: string, _payload: P, ack?: (response: A) => void) => {
      if (event === 'sync:subscribe') {
        (ack as ((r: { instanceKey: string }) => void) | undefined)?.({ instanceKey: 'I1' });
      }
    },
    on: <P>(event: string, handler: (payload: P) => void) =>
      handlers.set(event, handler as (p: unknown) => void),
    off: (event: string) => handlers.delete(event),
  };
  const host = {
    applySeed: () => applied.push('seed'),
    applySnapshot: () => applied.push('snapshot'),
    applyDelta: () => applied.push('delta'),
    dropInstance: () => {},
    rowPut: (w: { tableName: string; row: Record<string, unknown> }) => ({ table: w.tableName, pk: 'p', row: w.row }),
    keyRef: () => null,
  } as unknown as IvmHost;
  const store = {
    loadOffset: async () => 'off-1',
    loadInstance: async () => {
      await seedGate.promise; // the slow IDB read, released by the test
      return { rows: seedRows, offset: 'off-1' };
    },
    applySnapshot: async () => {},
    applyDelta: async () => {},
    dropInstance: async () => {},
  } as unknown as SyncStore;
  const client = new SyncClient(host, transport, store);
  client.start();
  handlers.get('sync:ready')?.(undefined);
  const fire = (event: string, payload?: unknown) => handlers.get(event)?.(payload);
  const settle = () => new Promise((r) => setTimeout(r, 0));
  return { client, fire, seedGate, applied, settle };
}

const SEED_ROWS = [{ tableName: 'conversations', row: { conversationId: 'c1' }, version: '01' }];

test('sync:current before the seed lands: complete waits for the seed', async () => {
  const { client, fire, seedGate, applied, settle } = makeHydrationHarness(SEED_ROWS);
  let hydratedCb = 0;
  client.onHydration('q', [null], () => { hydratedCb += 1; });
  client.subscribe('q', [null]);
  await settle(); // loadOffset resolves; subscribe acked (instanceKey I1); seed still pending

  fire('sync:current', { instanceKey: 'I1' }); // zero-delta resume beat the IDB read
  await settle();
  assert.equal(client.isHydrated('q', [null]), false, 'must NOT be complete before the seeded base is applied');
  assert.equal(hydratedCb, 0);

  seedGate.resolve(); // the IDB read completes
  await settle();
  assert.deepEqual(applied, ['seed'], 'seed applied');
  assert.equal(client.isHydrated('q', [null]), true, 'complete once server-current AND base applied');
  assert.equal(hydratedCb, 1);
});

test('late seed after an authoritative snapshot is discarded (no resurrection)', async () => {
  const { client, fire, seedGate, applied, settle } = makeHydrationHarness(SEED_ROWS);
  client.subscribe('q', [null]);
  await settle();

  fire('sync:snapshot', { instanceKey: 'I1', rows: [], offset: 'off-2', version: 'v2' });
  assert.equal(client.isHydrated('q', [null]), true, 'snapshot is authoritative — complete immediately');

  seedGate.resolve(); // the stale IDB read completes AFTER the snapshot
  await settle();
  assert.deepEqual(applied, ['snapshot'], 'late seed must not be applied over authoritative state');
});

test('unsubscribe while sync:current awaits the seed: no late flip', async () => {
  const { client, fire, seedGate, settle } = makeHydrationHarness(SEED_ROWS);
  let hydratedCb = 0;
  client.onHydration('q', [null], () => { hydratedCb += 1; });
  client.subscribe('q', [null]);
  await settle();

  fire('sync:current', { instanceKey: 'I1' });
  client.unsubscribe('q', [null]); // switch away before the seed lands
  seedGate.resolve();
  await settle();
  assert.equal(hydratedCb, 0, 'a dead subscription must not flip hydrated');
});

test('boot: sync:ready before the offset load must not emit an offset-less subscribe', async () => {
  const handlers = new Map<string, (payload: unknown) => void>();
  const sent: { event: string; payload: Record<string, unknown> }[] = [];
  const offsetGate = deferred<void>();
  const transport: SyncTransport = {
    emit: <P, A = void>(event: string, payload: P, ack?: (response: A) => void) => {
      sent.push({ event, payload: payload as Record<string, unknown> });
      if (event === 'sync:subscribe') {
        (ack as ((r: { instanceKey: string }) => void) | undefined)?.({ instanceKey: 'I1' });
      }
    },
    on: <P>(event: string, handler: (payload: P) => void) =>
      handlers.set(event, handler as (p: unknown) => void),
    off: (event: string) => handlers.delete(event),
  };
  const host = { applySeed: () => {}, dropInstance: () => {} } as unknown as IvmHost;
  const store = {
    loadOffset: async () => {
      await offsetGate.promise; // cold IDB, slower than the socket
      return 'off-42';
    },
    loadInstance: async () => null,
  } as unknown as SyncStore;
  const client = new SyncClient(host, transport, store);
  client.start();
  const settle = () => new Promise((r) => setTimeout(r, 0));

  client.subscribe('q', [null]); // boot-time subscribe, socket not ready yet
  handlers.get('sync:ready')?.(undefined); // the socket wins the race
  await settle();
  assert.deepEqual(
    sent.filter((s) => s.event === 'sync:subscribe'),
    [],
    'no subscribe may be emitted before the resume offset is known',
  );

  offsetGate.resolve(); // the IDB read completes
  await settle();
  const subs = sent.filter((s) => s.event === 'sync:subscribe');
  assert.equal(subs.length, 1, 'exactly one subscribe after the offset load (no double-send)');
  assert.equal(subs[0].payload.sinceOffset, 'off-42', 'the subscribe carries the resume offset');
});

test('sync:ready payload carries per-query modes; queryMode resolves with default', () => {
  const { client, fire } = makeClient();
  assert.equal(client.queryMode('getUsersV2'), undefined, 'no modes before ready (legacy)');
  let notified = 0;
  client.onModesChange(() => { notified += 1; });
  fire('sync:ready', { modes: { default: 'shadow', queries: { getUsersV2: 'serve', userDrafts: 'off' } } });
  assert.equal(client.queryMode('getUsersV2'), 'serve');
  assert.equal(client.queryMode('userDrafts'), 'off');
  assert.equal(client.queryMode('channelLatestMultipleConversationsV4'), 'shadow', 'default covers the rest');
  assert.equal(notified, 1);
  // unchanged payload on reconnect → no re-notify
  fire('sync:ready', { modes: { default: 'shadow', queries: { getUsersV2: 'serve', userDrafts: 'off' } } });
  assert.equal(notified, 1, 'identical modes must not re-notify');
});

test('shadow-divergence beacon is throttled per query', () => {
  const handlers = new Map<string, (payload: unknown) => void>();
  const sent: Array<{ event: string; payload: unknown }> = [];
  const transport: SyncTransport = {
    emit: <P, A = void>(event: string, payload: P, _ack?: (r: A) => void) => {
      sent.push({ event, payload });
    },
    on: <P>(event: string, handler: (payload: P) => void) =>
      handlers.set(event, handler as (p: unknown) => void),
    off: (event: string) => handlers.delete(event),
  };
  const client = new SyncClient({} as never, transport, {} as never);
  client.start();
  client.reportShadowDivergence('q1');
  client.reportShadowDivergence('q1'); // throttled
  client.reportShadowDivergence('q2'); // independent query
  const beacons = sent.filter((s) => s.event === 'sync:shadow-divergence');
  assert.equal(beacons.length, 2);
  assert.deepEqual(beacons.map((b) => (b.payload as { queryName: string }).queryName), ['q1', 'q2']);
});
