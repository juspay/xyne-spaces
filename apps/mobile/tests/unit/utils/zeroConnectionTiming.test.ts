import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import {
  clearZeroConnectionEvents,
  getConnectionDurationDuring,
  trackZeroConnectionDuration,
} from '@/src/utils/zeroConnectionTiming';

type StateListener = (state: { name: string }) => void;
type ZeroArg = Parameters<typeof trackZeroConnectionDuration>[0];

/** Minimal stand-in for the Zero connection surface the tracker reads. */
function makeFakeZero(initialName: string): {
  zero: ZeroArg;
  emit: (name: string) => void;
} {
  let listener: StateListener | undefined;
  const zero = {
    connection: {
      state: {
        current: { name: initialName },
        subscribe: (cb: StateListener) => {
          listener = cb;
          return () => {
            listener = undefined;
          };
        },
      },
    },
  } as unknown as ZeroArg;

  return {
    zero,
    emit: (name: string) => listener?.({ name }),
  };
}

describe('getConnectionDurationDuring', () => {
  beforeEach(() => {
    clearZeroConnectionEvents();
  });

  it('returns undefined when no events have been recorded', () => {
    assert.equal(getConnectionDurationDuring(0, 100), undefined);
  });

  it('returns undefined when the window start is after its end', () => {
    const { zero } = makeFakeZero('connecting');
    trackZeroConnectionDuration(zero);
    assert.equal(getConnectionDurationDuring(100, 50), undefined);
  });

  it('returns 0 when the connection was already connected at the window start', () => {
    const { zero } = makeFakeZero('connected');
    trackZeroConnectionDuration(zero);
    const afterConnected = performance.now() + 1;
    assert.equal(getConnectionDurationDuring(afterConnected, afterConnected + 1000), 0);
  });

  it('measures a connecting -> connected transition as a finite, non-negative duration', () => {
    const { zero, emit } = makeFakeZero('disconnected');
    const start = performance.now();
    trackZeroConnectionDuration(zero);
    emit('connecting');
    emit('connected');
    const end = performance.now() + 1;

    const duration = getConnectionDurationDuring(start, end);
    assert.equal(typeof duration, 'number');
    assert.ok((duration as number) >= 0);
    assert.ok(Number.isInteger(duration as number));
  });

  it('returns undefined when the window has no connecting event to anchor', () => {
    const { zero } = makeFakeZero('disconnected');
    trackZeroConnectionDuration(zero);
    const now = performance.now() + 1;
    // Only a non-connecting state exists before the window, and nothing
    // transitions to connecting inside it, so there is no duration to report.
    assert.equal(getConnectionDurationDuring(now, now + 10), undefined);
  });
});

describe('trackZeroConnectionDuration', () => {
  it('returns the unsubscribe handle from the connection subscription', () => {
    clearZeroConnectionEvents();
    const { zero } = makeFakeZero('connecting');
    const unsubscribe = trackZeroConnectionDuration(zero);
    assert.equal(typeof unsubscribe, 'function');
    unsubscribe();
  });
});
