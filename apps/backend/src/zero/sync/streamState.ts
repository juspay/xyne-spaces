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
  /** Set on the grant-instance resync marker (redisStore.RESYNC_DIFF) — the deterministic
   *  "fully (re)materialized" boundary the fan-out gates cold-defer on. Absent on data diffs. */
  resynced?: boolean;
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
 * Transforms one tapped query-instance's pokes into the net Redis diff. STATELESS (holds no
 * rows — durability lives in the Redis snapshot): `put→upsert, del→delete, clear→cleared`.
 * It does NOT need the current rows because zero-cache's `makeRowPatch` is put/del-ONLY
 * (verified in mono) — it never emits partial `update` merges (the only op that would need
 * the prior row). If an `update` ever appears, the guard resets the instance rather than
 * silently dropping it (a dropped update = a permanent stale row).
 */
export class ChannelStreamState {
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
   * net diff (the Redis store mirrors this; the op-stream appends it).
   */
  applyPoke(version: string, rowsPatch: readonly RowPatchOp[]): StreamDiff {
    // Compact per key, LAST-OP-WINS. A poke can carry both del(K) and put(K) (a row that
    // left and re-entered the view within one advancement); emitting K in BOTH lists let the
    // store's HSET-then-HDEL apply the delete regardless of intra-poke order → the row was
    // silently lost until next touched. Collapsing to one op per key in arrival order fixes
    // that, dedupes repeated puts (smaller stream entries), and guarantees each key lands in
    // exactly one list (no client-side apply-order ambiguity).
    let cleared = false;
    const byKey = new Map<string, { tableName: string; row: Row } | null>(); // null = delete
    for (const op of rowsPatch) {
      switch (op.op) {
        case 'put':
          byKey.set(this.#keyFromRow(op.tableName, op.value), { tableName: op.tableName, row: op.value });
          break;
        case 'del':
          byKey.set(this.#keyFromRow(op.tableName, op.id), null);
          break;
        case 'update':
          // Should never happen (makeRowPatch is put/del-only). We can't merge without the
          // prior row, so RESET the instance (re-hydrate) — never skip → never leave stale.
          // The tap logs the unexpected op loudly (this module stays pure/logger-free).
          cleared = true;
          byKey.clear(); // drop everything before the reset; ops after it re-populate
          break;
        case 'clear':
          cleared = true;
          byKey.clear();
          break;
      }
    }
    const diff: StreamDiff = { upserts: [], deletes: [], cleared };
    for (const [key, value] of byKey) {
      if (value) diff.upserts.push({ key, tableName: value.tableName, row: value.row });
      else diff.deletes.push(key);
    }
    this.#cookie = version;
    return diff;
  }

  /** Reset the cookie at a CVR-cleared boundary (no row state to drop). */
  clear(): void {
    this.#cookie = null;
  }

  /** Current Zero cookie (version) the last poke reflected. */
  cookie(): string | null {
    return this.#cookie;
  }
}
