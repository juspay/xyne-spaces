import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ChatRouteTarget } from '@/src/notifications/types';
import {
  createNotificationIntentStartGate,
  runLatestNotificationIntentStart,
} from '@/src/observability/logging/notification/notificationIntentStartGate';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>(next => {
    resolve = next;
  });
  return { promise, resolve };
}

const intent = (channelId: string, notificationId: string): ChatRouteTarget => ({
  channelId,
  messageId: `m-${channelId}`,
  notificationId,
});

describe('runLatestNotificationIntentStart', () => {
  it('keeps a single tap when navigation consumes the intent during the clock read', async () => {
    const gate = createNotificationIntentStartGate();
    let current: ChatRouteTarget | null = intent('c1', 'n1');
    const clock = deferred<string>();
    const started: string[] = [];

    const run = runLatestNotificationIntentStart({
      gate,
      intent: current,
      getCurrentIntent: () => current,
      prepare: () => clock.promise,
      commit: value => {
        started.push(value);
      },
    });

    current = null;
    clock.resolve('clock-1');
    assert.equal(await run, true);
    assert.deepEqual(started, ['clock-1']);
  });

  it('drops the older tap when a second notification arrives before the first clock read finishes', async () => {
    const gate = createNotificationIntentStartGate();
    let current: ChatRouteTarget | null = intent('c1', 'n1');
    const firstClock = deferred<string>();
    const secondClock = deferred<string>();
    const started: string[] = [];

    const first = runLatestNotificationIntentStart({
      gate,
      intent: current,
      getCurrentIntent: () => current,
      prepare: () => firstClock.promise,
      commit: value => {
        started.push(value);
      },
    });

    current = intent('c2', 'n2');
    const second = runLatestNotificationIntentStart({
      gate,
      intent: current,
      getCurrentIntent: () => current,
      prepare: () => secondClock.promise,
      commit: value => {
        started.push(value);
      },
    });

    // Newer tap's clock returns first, then the stale tap resumes.
    secondClock.resolve('n2');
    firstClock.resolve('n1');

    assert.equal(await first, false);
    assert.equal(await second, true);
    assert.deepEqual(started, ['n2']);
  });

  it('drops the older tap even if the newer intent was already consumed', async () => {
    const gate = createNotificationIntentStartGate();
    let current: ChatRouteTarget | null = intent('c1', 'n1');
    const firstClock = deferred<string>();
    const secondClock = deferred<string>();
    const started: string[] = [];

    const first = runLatestNotificationIntentStart({
      gate,
      intent: current,
      getCurrentIntent: () => current,
      prepare: () => firstClock.promise,
      commit: value => {
        started.push(value);
      },
    });

    current = intent('c2', 'n2');
    const second = runLatestNotificationIntentStart({
      gate,
      intent: current,
      getCurrentIntent: () => current,
      prepare: () => secondClock.promise,
      commit: value => {
        started.push(value);
      },
    });

    current = null;
    firstClock.resolve('n1');
    secondClock.resolve('n2');

    assert.equal(await first, false);
    assert.equal(await second, true);
    assert.deepEqual(started, ['n2']);
  });
});
