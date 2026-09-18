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
