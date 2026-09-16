import { percentile } from '../stats';
import type { EventLoopLagResult } from '../types';

/**
 * Timer-drift measurement over the observation window.
 *
 * Long tasks report only what the browser classifies as one: a single stretch of
 * 50ms or more. Work chopped into forty 30ms pieces blocks a user just as
 * thoroughly and registers as nothing at all. Timer drift catches both, because
 * it measures the delay an actual click would have waited, whatever its shape.
 */

const TICK_MS = 100;
/** A tick this late is a stall a person would notice as the app not responding. */
const STALL_THRESHOLD_MS = 50;

export interface EventLoopLagProbe {
  stop: () => EventLoopLagResult;
}

export function startEventLoopLagProbe(): EventLoopLagProbe {
  const lags: number[] = [];
  let expectedAt = performance.now() + TICK_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const tick = (): void => {
    const now = performance.now();
    lags.push(Math.max(0, now - expectedAt));
    // Re-anchor to the schedule rather than to now, so a late tick does not
    // quietly forgive itself by moving the next deadline out with it.
    expectedAt += TICK_MS;
    const delay = Math.max(0, expectedAt - now);
    timer = setTimeout(tick, delay);
  };

  timer = setTimeout(tick, TICK_MS);

  return {
    stop: (): EventLoopLagResult => {
      if (timer !== null) clearTimeout(timer);
      timer = null;

      const stalled = lags.filter(lag => lag >= STALL_THRESHOLD_MS).length;
      return {
        samples: lags.length,
        p50Ms: percentile(lags, 50) ?? 0,
        p95Ms: percentile(lags, 95) ?? 0,
        maxMs: lags.length ? Math.max(...lags) : 0,
        stalledSharePercent: lags.length ? (stalled / lags.length) * 100 : 0,
      };
    },
  };
}
