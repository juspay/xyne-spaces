/**
 * Poke-stream state for a single tapped Zero query-instance (e.g. channelLatest(C, 25)).
 *
 * Zero pokes carry a rowsPatch (verified against @rocicorp/zero 1.9.0
 * zero-protocol/src/row-patch.ts):
 *   - put   { op:'put',   tableName, value }  -> bring row to client   (add/upsert)
 *   - del   { op:'del',   tableName, id }     -> remove row from client (id = PK only)
 *   - update{ op:'update',tableName, id, merge }
 *   - clear { op:'clear' }                    -> wipe all (reset / re-hydration boundary)
 *
 * The stream IS the log of these ops (ordered by the pokeEnd `cookie` version).
 * Hydration is DERIVED from the stream: a running compaction (put sets, del removes)
 * gives the current row set with no separate DB read.
 */

export type PkRecord = Record<string, string | number | boolean | null>;
export type Row = Record<string, unknown>;

export type RowPatchOp =
  | { op: 'put'; tableName: string; value: Row }
  | { op: 'update'; tableName: string; id: PkRecord; merge?: Row }
  | { op: 'del'; tableName: string; id: PkRecord }
  | { op: 'clear' };

export interface CompactedRow {
  tableName: string;
  row: Row;
}

/** The net effect of one poke on the compacted state — persisted to Redis and appended to the op-stream. */
export interface StreamDiff {
  upserts: Array<{ key: string; tableName: string; row: Row }>;
  deletes: string[];
  cleared: boolean;
}

/** Compaction key for a row: "table:pk". A `del` carries only the PK, so callers must know each table's PK. */
export function rowKey(
  tableName: string,
  source: Row | PkRecord,
  pkFields: Record<string, readonly string[]>,
): string {
  const fields = pkFields[tableName] ?? ['id'];
  const parts = fields.map((f) => String((source as Record<string, unknown>)[f]));
  return `${tableName}:${parts.join(' ')}`;
}

/**
 * Maintains the compacted current state for one tapped query-instance. This is the
 * in-memory working copy the connection updates per poke; durability + fan-out live
 * in the Redis store. The compaction semantics here are the source of truth.
 */
export class ChannelStreamState {
  /** Compacted current rows, keyed by "table:pk". This is the hydration source. */
  readonly #rows = new Map<string, CompactedRow>();
  #cookie: string | null = null;

  /** Primary-key field(s) per table, used to key rows for put/del/update. */
  readonly #pkFields: Record<string, readonly string[]>;

  constructor(pkFields: Record<string, readonly string[]>) {
    this.#pkFields = pkFields;
  }

  #keyFromRow(tableName: string, source: Row | PkRecord): string {
    return rowKey(tableName, source, this.#pkFields);
  }

  /**
   * Apply one poke's rowsPatch, stamped with the pokeEnd cookie, and return the
   * net compaction diff (the Redis store mirrors this; the op-stream appends it).
   */
  applyPoke(version: string, rowsPatch: readonly RowPatchOp[]): StreamDiff {
    const diff: StreamDiff = { upserts: [], deletes: [], cleared: false };
    for (const op of rowsPatch) {
      switch (op.op) {
        case 'put': {
          const key = this.#keyFromRow(op.tableName, op.value);
          this.#rows.set(key, { tableName: op.tableName, row: op.value });
          diff.upserts.push({ key, tableName: op.tableName, row: op.value });
          break;
        }
        case 'update': {
          const key = this.#keyFromRow(op.tableName, op.id);
          const existing = this.#rows.get(key);
          if (existing) {
            const row = { ...existing.row, ...(op.merge ?? {}) };
            this.#rows.set(key, { tableName: op.tableName, row });
            diff.upserts.push({ key, tableName: op.tableName, row });
          }
          break;
        }
        case 'del': {
          const key = this.#keyFromRow(op.tableName, op.id);
          this.#rows.delete(key);
          diff.deletes.push(key);
          break;
        }
        case 'clear':
          this.#rows.clear();
          diff.cleared = true;
          diff.upserts.length = 0;
          diff.deletes.length = 0;
          break;
      }
    }
    this.#cookie = version;
    return diff;
  }

  /** Drop all compacted state (CVR-cleared reset boundary). */
  clear(): void {
    this.#rows.clear();
    this.#cookie = null;
  }

  /** Hydration: the current compacted row set, derived purely from applied pokes. */
  snapshot(): CompactedRow[] {
    return [...this.#rows.values()];
  }

  /** Current Zero cookie (version) the compacted state reflects. */
  cookie(): string | null {
    return this.#cookie;
  }

  size(): number {
    return this.#rows.size;
  }
}
