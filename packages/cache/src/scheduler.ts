import type { Clock, TimerHandle } from './clock.js';

/** Fixed-interval loop over an injected clock. Knows nothing about what `run` does. */
export type Scheduler = {
  start(): void;
  stop(): void;
};

export function createScheduler(options: { everyMs: number; run: () => void; clock: Clock }): Scheduler {
  let active: { handle: TimerHandle } | null = null;
  return {
    start: () => {
      active ??= { handle: options.clock.setInterval(options.run, options.everyMs) };
    },
    stop: () => {
      if (active === null) return;
      options.clock.clearInterval(active.handle);
      active = null;
    },
  };
}
