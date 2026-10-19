import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { runAfterFirstPaint } from '../scheduling/afterFirstPaint';
import {
  DEV_REQUEST_DROP_RATE,
  devInjectedLatencyMs,
  shouldDropDevRequest,
} from '../scheduling/adversarialNetwork';
import { CHAT_OPEN_DEFERRAL_MS, acquireDeferral, type DeferralClock } from '../scheduling/deferral';

const fakeClock = (): DeferralClock & { flush: () => void } => {
  let now = 0;
  let pending: { at: number; work: () => void } | null = null;
  return {
    now: (): number => now,
    setTimeout: (work: () => void, ms: number): ReturnType<typeof setTimeout> => {
      pending = { at: now + ms, work };
      return 1 as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout: (): void => {
      pending = null;
    },
    flush: (): void => {
      if (!pending) {
        return;
      }
      now = pending.at;
      const work = pending.work;
      pending = null;
      work();
    },
  };
};

describe('acquireDeferral', (): void => {
  it('holds named work until release, then flushes once', (): void => {
    const clock = fakeClock();
    const token = acquireDeferral('chat-open', CHAT_OPEN_DEFERRAL_MS, clock);
    const order: string[] = [];
    token.defer('badges', (): void => {
      order.push('badges');
    });
    token.defer('activity', (): void => {
      order.push('activity');
    });
    assert.equal(token.isActive(), true);
    assert.deepEqual(order, []);
    token.release();
    assert.deepEqual(order, ['badges', 'activity']);
    token.release();
    assert.deepEqual(order, ['badges', 'activity']);
    assert.equal(token.isActive(), false);
  });

  it('flushes when the budget elapses if teardown never comes', (): void => {
    const clock = fakeClock();
    const token = acquireDeferral('chat-open', CHAT_OPEN_DEFERRAL_MS, clock);
    const ran: string[] = [];
    token.defer('preview', (): void => {
      ran.push('preview');
    });
    clock.flush();
    assert.deepEqual(ran, ['preview']);
    assert.equal(token.isActive(), false);
  });

  it('runs work immediately after the token is released', (): void => {
    const token = acquireDeferral('chat-open', CHAT_OPEN_DEFERRAL_MS, fakeClock());
    token.release();
    let ran = false;
    token.defer('late', (): void => {
      ran = true;
    });
    assert.equal(ran, true);
  });

  it('is a sub-second budget, not a 10s window', (): void => {
    assert.equal(CHAT_OPEN_DEFERRAL_MS < 1000, true);
    assert.equal(CHAT_OPEN_DEFERRAL_MS > 100, true);
  });
});

describe('runAfterFirstPaint', (): void => {
  it('runs after two animation frames and cancel prevents the callback', (): void => {
    const queue: Array<() => void> = [];
    const scheduler = {
      request: (callback: () => void): number => {
        queue.push(callback);
        return queue.length;
      },
      cancel: (): void => undefined,
    };
    let ran = 0;
    runAfterFirstPaint((): void => {
      ran += 1;
    }, scheduler);
    assert.equal(ran, 0);
    queue[0]?.();
    assert.equal(ran, 0);
    queue[1]?.();
    assert.equal(ran, 1);

    const cancelled = runAfterFirstPaint((): void => {
      ran += 1;
    }, scheduler);
    cancelled.cancel();
    queue[2]?.();
    queue[3]?.();
    assert.equal(ran, 1);
  });
});

describe('v3 scheduling isolation (B9)', (): void => {
  it('never imports the global 10s interactionCriticalWindow', (): void => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const next = join(dir, entry.name);
        if (entry.isDirectory() && entry.name !== '__tests__') {
          return walk(next);
        }
        return entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') ? [next] : [];
      });
    for (const file of walk(root)) {
      const source = readFileSync(file, 'utf8');
      assert.equal(/interactionCriticalWindow/.test(source), false, file);
      assert.equal(/beginCriticalWindow/.test(source), false, file);
    }
  });
});

describe('adversarial network policy', (): void => {
  it('drops about 10% of requests only in dev', (): void => {
    assert.equal(DEV_REQUEST_DROP_RATE, 0.1);
    assert.equal(
      shouldDropDevRequest(false, (): number => 0),
      false,
    );
    assert.equal(
      shouldDropDevRequest(true, (): number => 0.09),
      true,
    );
    assert.equal(
      shouldDropDevRequest(true, (): number => 0.11),
      false,
    );
    assert.equal(
      devInjectedLatencyMs(false, (): number => 1),
      0,
    );
    assert.equal(
      devInjectedLatencyMs(true, (): number => 0.5, 800),
      400,
    );
  });
});
