/**
 * A Clock whose time and timers are driven by the test. `tick()` fires every
 * live interval once and lets the resulting async work settle.
 */
export function createFakeClock() {
  let now = 0;
  let registered = 0;
  let cleared = 0;
  const intervals = [];
  return {
    now: () => now,
    setInterval: (fn, everyMs) => {
      const handle = { fn, everyMs };
      intervals.push(handle);
      registered += 1;
      return handle;
    },
    clearInterval: (handle) => {
      cleared += 1;
      const index = intervals.indexOf(handle);
      if (index >= 0) intervals.splice(index, 1);
    },
    advance: (ms) => {
      now += ms;
    },
    tick: async () => {
      for (const { fn } of [...intervals]) fn();
      await flush();
    },
    get intervals() {
      return intervals;
    },
    get registered() {
      return registered;
    },
    get cleared() {
      return cleared;
    },
  };
}

export const flush = () => new Promise((resolve) => setImmediate(resolve));

export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
