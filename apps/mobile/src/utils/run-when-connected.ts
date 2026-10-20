import type { ConnectionState } from '@rocicorp/zero';

/** The slice of `zero.connection.state` this needs, so tests can hand in a fake. */
export type ConnectionStateSource = {
  readonly current: ConnectionState;
  subscribe(listener: (state: ConnectionState) => void): () => void;
};

export class RunTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Timed out after ${timeoutMs}ms`);
    this.name = 'RunTimeoutError';
  }
}

export class ConnectionClosedError extends Error {
  constructor(reason: string) {
    super(`Zero connection closed: ${reason}`);
    this.name = 'ConnectionClosedError';
  }
}

/**
 * Runs `run` once Zero is connected, and settles within `timeoutMs` either way.
 *
 * `zero.run(query, { type: 'complete' })` has no timeout of its own: it waits
 * for the server to confirm the query, which never happens while Zero is
 * stuck in `error`, or for a query registered after the instance closed. A
 * caller that latches "in flight" around it would stay latched forever.
 *
 * - Not connected yet: waits for `connected` rather than registering the query
 *   on a socket that is still coming up.
 * - `closed`: rejects at once; a closed instance never reconnects.
 * - Anything else: the timeout covers the wait and the run together, so the
 *   caller always gets its latch back.
 *
 * A run that times out is abandoned, not cancelled — Zero gives no handle to
 * cancel it — so a late result is simply ignored.
 */
export function runWhenConnected<T>(
  connection: ConnectionStateSource,
  run: () => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let unsubscribe: (() => void) | null = null;

    const finish = (outcome: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe?.();
      unsubscribe = null;
      outcome();
    };

    const timer = setTimeout(() => finish(() => reject(new RunTimeoutError(timeoutMs))), timeoutMs);

    const start = (): void => {
      unsubscribe?.();
      unsubscribe = null;
      run().then(
        value => finish(() => resolve(value)),
        (error: unknown) => finish(() => reject(error)),
      );
    };

    const onState = (state: ConnectionState): boolean => {
      if (state.name === 'closed') {
        finish(() => reject(new ConnectionClosedError(state.reason)));
        return true;
      }
      if (state.name === 'connected') {
        start();
        return true;
      }
      return false;
    };

    if (onState(connection.current)) return;
    unsubscribe = connection.subscribe(state => {
      if (!settled) onState(state);
    });
  });
}
