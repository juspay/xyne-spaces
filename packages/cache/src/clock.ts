/**
 * Time and timers, injected so tests drive them without fake-timer frameworks.
 * `systemClock` is the only place that touches the real event loop, and the
 * only place that decides a refresh timer must never hold the process open.
 */
export type TimerHandle = unknown;

export type Clock = {
  now(): number;
  setInterval(fn: () => void, everyMs: number): TimerHandle;
  clearInterval(handle: TimerHandle): void;
};

export const systemClock: Clock = {
  now: () => Date.now(),
  setInterval: (fn, everyMs) => {
    const handle = setInterval(fn, everyMs);
    handle.unref();
    return handle;
  },
  clearInterval: (handle) => clearInterval(handle as NodeJS.Timeout),
};
