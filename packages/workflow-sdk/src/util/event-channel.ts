/**
 * Bridges a push-based callback into an `AsyncIterable`, so a bus subscription can
 * be consumed by `for await`.
 *
 * Values pushed before the consumer asks for them are queued, not dropped. The SSE
 * route depends on that: it subscribes to the bus *before* it reads the snapshot it
 * sends first, so anything published during the read is held here and delivered
 * once iteration starts.
 *
 *   const ch = createEventChannel<BusEvent>();
 *   const unsub = await eventBus.subscribe(topic, ch.push);
 *   try {
 *     for await (const event of ch) { ... }
 *   } finally {
 *     unsub();
 *     ch.end();   // terminates the iterator
 *   }
 */

export interface EventChannel<T> {
  push: (value: T) => void;
  end: () => void;
  [Symbol.asyncIterator](): AsyncIterator<T>;
}

export function createEventChannel<T>(): EventChannel<T> {
  const queue: T[] = [];
  let resolve: ((result: IteratorResult<T>) => void) | null = null;
  let done = false;

  return {
    push(value: T) {
      if (done) return;
      if (resolve) {
        const r = resolve;
        resolve = null;
        r({ value, done: false });
      } else {
        queue.push(value);
      }
    },

    end() {
      done = true;
      if (resolve) {
        const r = resolve;
        resolve = null;
        r({ value: undefined as T, done: true });
      }
    },

    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<T>> {
          if (queue.length > 0) {
            return Promise.resolve({ value: queue.shift()!, done: false });
          }
          if (done) {
            return Promise.resolve({ value: undefined as T, done: true });
          }
          return new Promise<IteratorResult<T>>((r) => {
            resolve = r;
          });
        },
      };
    },
  };
}
