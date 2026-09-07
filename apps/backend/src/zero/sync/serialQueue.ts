/**
 * Per-key serial execution. Tasks enqueued under the same key run one at a time, in
 * enqueue order; tasks under different keys run concurrently.
 *
 * The fan-out uses this to serialize dispatch per Redis stream: a stream is totally
 * ordered by zero-cache, but firing `#dispatch` as `void` let a later entry's re-gate
 * complete before an earlier one's — so a leave could be overtaken by a stale-join
 * admit and revoke integrity was lost until the next grant delta. Chaining per key
 * restores in-order application while keeping unrelated streams parallel.
 */
export class SerialQueue {
  readonly #tails = new Map<string, Promise<void>>();
  readonly #onError?: (error: unknown, key: string) => void;

  constructor(onError?: (error: unknown, key: string) => void) {
    this.#onError = onError;
  }

  /**
   * Chain `task` after any in-flight/pending task for `key`. Fire-and-forget: a task's
   * rejection is reported via `onError` and swallowed so it never poisons the chain.
   */
  enqueue(key: string, task: () => Promise<void>): void {
    const prev = this.#tails.get(key) ?? Promise.resolve();
    const next = prev.then(() =>
      task().catch((error) => {
        this.#onError?.(error, key);
      }),
    );
    this.#tails.set(key, next);
    // Drop the tail once settled if nothing newer was chained — keeps the map bounded
    // to keys with live work.
    void next.then(() => {
      if (this.#tails.get(key) === next) this.#tails.delete(key);
    });
  }

  /** Await all in-flight/pending tasks across every key (tests, graceful shutdown). */
  async drain(): Promise<void> {
    await Promise.all([...this.#tails.values()]);
  }

  /** Number of keys with live (unsettled) work — for observability/tests. */
  get activeKeys(): number {
    return this.#tails.size;
  }
}
