import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import type { ConnectionState } from '@rocicorp/zero';

import {
  ConnectionClosedError,
  RunTimeoutError,
  runWhenConnected,
  type ConnectionStateSource,
} from '@/src/utils/run-when-connected';

const TIMEOUT_MS = 1000;

/** A connection whose state the test moves by hand. */
function fakeConnection(initial: ConnectionState): ConnectionStateSource & {
  set(next: ConnectionState): void;
  listenerCount(): number;
} {
  let current = initial;
  const listeners = new Set<(state: ConnectionState) => void>();
  return {
    get current() {
      return current;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next) {
      current = next;
      for (const listener of [...listeners]) listener(next);
    },
    listenerCount: () => listeners.size,
  };
}

const flush = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

describe('runWhenConnected', () => {
  beforeEach(() => mock.timers.enable({ apis: ['setTimeout'] }));
  afterEach(() => mock.timers.reset());

  it('runs at once when already connected', async () => {
    const connection = fakeConnection({ name: 'connected' });
    const run = mock.fn(async () => 'page');
    assert.equal(await runWhenConnected(connection, run, TIMEOUT_MS), 'page');
    assert.equal(run.mock.callCount(), 1);
  });

  it('waits for the connection before running', async () => {
    const connection = fakeConnection({ name: 'connecting' });
    const run = mock.fn(async () => 'page');
    const result = runWhenConnected(connection, run, TIMEOUT_MS);
    await flush();
    assert.equal(run.mock.callCount(), 0);

    connection.set({ name: 'connected' });
    assert.equal(await result, 'page');
    assert.equal(run.mock.callCount(), 1);
    assert.equal(connection.listenerCount(), 0);
  });

  it('rejects without running on a closed instance', async () => {
    const connection = fakeConnection({ name: 'closed', reason: 'replaced' });
    const run = mock.fn(async () => 'page');
    await assert.rejects(runWhenConnected(connection, run, TIMEOUT_MS), ConnectionClosedError);
    assert.equal(run.mock.callCount(), 0);
  });

  it('rejects when the instance closes while waiting', async () => {
    const connection = fakeConnection({ name: 'connecting' });
    const result = runWhenConnected(connection, async () => 'page', TIMEOUT_MS);
    connection.set({ name: 'closed', reason: 'replaced' });
    await assert.rejects(result, ConnectionClosedError);
    assert.equal(connection.listenerCount(), 0);
  });

  it('times out when the connection never comes up', async () => {
    const connection = fakeConnection({ name: 'error', reason: 'gave up' });
    const result = runWhenConnected(connection, async () => 'page', TIMEOUT_MS);
    mock.timers.tick(TIMEOUT_MS);
    await assert.rejects(result, RunTimeoutError);
    assert.equal(connection.listenerCount(), 0);
  });

  it('times out when the run itself never settles', async () => {
    const connection = fakeConnection({ name: 'connected' });
    const result = runWhenConnected(connection, () => new Promise<string>(() => {}), TIMEOUT_MS);
    mock.timers.tick(TIMEOUT_MS);
    await assert.rejects(result, RunTimeoutError);
  });

  it("passes the run's own failure through", async () => {
    const connection = fakeConnection({ name: 'connected' });
    const failure = new Error('query failed');
    await assert.rejects(
      runWhenConnected(connection, () => Promise.reject(failure), TIMEOUT_MS),
      failure,
    );
  });
});
