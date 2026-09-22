/**
 * Byte-bounded LRU for the fan-out snapshot memos (the P5 prerequisite).
 *
 * The memos are pure caches over Redis (`store.snapshot`) — eviction only costs a re-read
 * on the next hydration, never correctness. Unbounded, they are exactly the held-rows-in-RAM
 * class the tap's 4b OOM fix removed: one workspace-sized instance (full roster / every draft
 * in the workspace) pins MBs per instance per pod indefinitely — and since emit-time
 * decryption, those rows are PLAINTEXT, so the bound is also the cap on decrypted content
 * held at rest in RAM.
 *
 * Weight = estimated JSON bytes (sampled — a handful of rows are stringified per insert, not
 * the whole snapshot). Eviction is LRU by entry (get refreshes). A single entry larger than
 * the whole budget is still cached (evicting everything else): the memo exists precisely so a
 * reconnect storm on a giant instance does ONE snapshot read, so refusing to cache the giant
 * would reintroduce the N× re-read it was built to prevent — bounded at one such entry.
 */

const SAMPLE_ROWS = 16;

/** Estimated serialized size of a row set: sampled average × count. */
export function estimateRowsBytes(rows: ReadonlyArray<unknown>): number {
  if (rows.length === 0) return 0;
  const step = Math.max(1, Math.floor(rows.length / SAMPLE_ROWS));
  let sampled = 0;
  let bytes = 0;
  for (let i = 0; i < rows.length; i += step) {
    try {
      bytes += JSON.stringify(rows[i])?.length ?? 0;
    } catch {
      bytes += 1024; // unserializable row — assume something
    }
    sampled += 1;
  }
  return Math.round((bytes / sampled) * rows.length);
}

export class BoundedMemo<V> {
  readonly #map = new Map<string, { value: V; weight: number }>();
  #totalWeight = 0;

  constructor(
    private readonly maxEntries: number,
    private readonly maxWeightBytes: number,
  ) {}

  get(key: string): V | undefined {
    const entry = this.#map.get(key);
    if (!entry) return undefined;
    // LRU refresh (Map preserves insertion order; re-insert moves to the back).
    this.#map.delete(key);
    this.#map.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V, weight: number): void {
    const prev = this.#map.get(key);
    if (prev) {
      this.#totalWeight -= prev.weight;
      this.#map.delete(key);
    }
    this.#map.set(key, { value, weight });
    this.#totalWeight += weight;
    // Evict from the LRU end, but never the entry just inserted (see header).
    for (const oldest of this.#map.keys()) {
      const withinCaps = this.#map.size <= this.maxEntries && this.#totalWeight <= this.maxWeightBytes;
      if (withinCaps || oldest === key) break;
      const evicted = this.#map.get(oldest);
      this.#map.delete(oldest);
      this.#totalWeight -= evicted?.weight ?? 0;
    }
  }

  delete(key: string): void {
    const entry = this.#map.get(key);
    if (!entry) return;
    this.#map.delete(key);
    this.#totalWeight -= entry.weight;
  }

  get size(): number {
    return this.#map.size;
  }

  get totalWeight(): number {
    return this.#totalWeight;
  }
}
