/** Fixed-capacity circular buffer. Overwrites the oldest entry when full. */
export class RingBuffer<T> {
  private readonly items: (T | undefined)[];
  private next = 0;
  private filled = false;
  readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.items = new Array<T | undefined>(capacity);
  }

  push(item: T): void {
    this.items[this.next] = item;
    this.next = (this.next + 1) % this.capacity;
    if (this.next === 0) this.filled = true;
  }

  get size(): number {
    return this.filled ? this.capacity : this.next;
  }

  /** Oldest-first. */
  toArray(): T[] {
    if (!this.filled) return this.items.slice(0, this.next) as T[];
    return [...this.items.slice(this.next), ...this.items.slice(0, this.next)] as T[];
  }

  last(): T | undefined {
    if (this.next === 0 && !this.filled) return undefined;
    return this.items[(this.next - 1 + this.capacity) % this.capacity];
  }

  clear(): void {
    this.items.fill(undefined);
    this.next = 0;
    this.filled = false;
  }
}

/** Nearest-rank percentile over an unsorted sample. Returns null for an empty sample. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(Math.max(rank, 0), sorted.length - 1)] ?? null;
}
