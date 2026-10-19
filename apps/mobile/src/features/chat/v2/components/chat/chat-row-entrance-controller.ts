type RowEntranceControllerOptions<T> = {
  getId: (item: T) => string;
  isMessageLike?: ((item: T) => boolean) | undefined;
};

/**
 * Tracks which rows should play an entrance animation.
 *
 * Rules:
 * - On first reveal, every row that is already in the list is marked as seen so
 *   the open experience stays stable and the unread banner lands cleanly.
 * - After the channel/thread is open, any brand-new message appended after the
 *   current tail animates in (older messages loaded while scrolling up do not).
 */
export class RowEntranceController<T> {
  private identityKey: string;
  private getId: (item: T) => string;
  private isMessageLike: (item: T) => boolean;
  private seen = new Set<string>();
  private pending = new Set<string>();
  private revealed = false;
  private seeded = false;
  private lastMessageId: string | null = null;

  constructor(identityKey: string, options: RowEntranceControllerOptions<T>) {
    this.identityKey = identityKey;
    this.getId = options.getId;
    this.isMessageLike = options.isMessageLike ?? ((): boolean => true);
  }

  getIdentityKey(): string {
    return this.identityKey;
  }

  hasRevealed(): boolean {
    return this.revealed;
  }

  /**
   * Called once when the list is first revealed. All current rows are treated as
   * already-present so the unread banner/anchor landing is not disturbed.
   */
  onRevealed(rows: readonly T[]): void {
    if (this.revealed || this.seeded) return;
    this.revealed = true;
    this.seeded = true;

    for (const row of rows) {
      if (this.isMessageLike(row)) {
        const id = this.getId(row);
        this.seen.add(id);
        this.lastMessageId = id;
      }
    }
  }

  /**
   * Called whenever the row set changes after reveal. Only brand-new rows that
   * are appended after the previously known tail are animated; prepended older
   * rows and any replaced window are marked seen without animation.
   */
  trackNewRows(rows: readonly T[]): boolean {
    if (!this.revealed) return false;

    const previousTailIndex = this.lastMessageId
      ? rows.findIndex(row => this.isMessageLike(row) && this.getId(row) === this.lastMessageId)
      : -1;

    // An empty first reveal or a cache-window replacement has no trustworthy
    // append boundary. Seed it instead of animating a potentially stale page.
    if (previousTailIndex < 0) {
      for (const row of rows) {
        if (this.isMessageLike(row)) {
          const id = this.getId(row);
          this.seen.add(id);
          this.lastMessageId = id;
        }
      }
      return false;
    }

    let added = false;
    let index = 0;

    for (const row of rows) {
      if (this.isMessageLike(row)) {
        const id = this.getId(row);

        if (index <= previousTailIndex) {
          // Existing rows and history prepended before the old tail never animate.
          this.seen.add(id);
        } else if (!this.seen.has(id) && !this.pending.has(id)) {
          this.pending.add(id);
          added = true;
        }
        this.lastMessageId = id;
      }
      index += 1;
    }
    return added;
  }

  getPending(): ReadonlySet<string> {
    return this.pending;
  }

  /**
   * Move all pending ids to the seen set so they only animate once.
   */
  flushPending(): void {
    for (const id of this.pending) {
      this.seen.add(id);
    }
    this.pending.clear();
  }
}
