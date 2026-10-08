/**
 * In-process cache for customer display names, so a Meta profile lookup is not made on every
 * single DM. Approximate LRU: a Map keeps insertion order, a hit re-inserts the entry at the
 * tail, and on overflow the head is dropped. Entries expire after 24h so a renamed customer is
 * picked up on their next message after that.
 */
export class SenderNameCache {
  private readonly entries = new Map<string, { name: string; expiresAt: number }>();

  constructor(
    private readonly maxSize = 500,
    private readonly ttlMs = 24 * 60 * 60 * 1000,
  ) {}

  get(key: string): string | undefined {
    const cached = this.entries.get(key);
    if (cached === undefined) return undefined;
    this.entries.delete(key);
    if (cached.expiresAt <= Date.now()) return undefined;
    this.entries.set(key, cached);
    return cached.name;
  }

  set(key: string, name: string): void {
    this.entries.delete(key);
    if (this.entries.size >= this.maxSize) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, { name, expiresAt: Date.now() + this.ttlMs });
  }
}
