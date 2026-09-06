/**
 * Durable store for the sync engine's confirmed rows — the one persisted copy that a
 * reload seeds the in-memory MemorySource from (so it can resume from an offset instead
 * of a full snapshot). Hydration-only: it is NEVER queried (the IVM is the query engine);
 * the only "query" is "give me every row of this instance", a key-range scan.
 *
 * Shape (Zero's replica+CVR model, single copy per row):
 *   rows    [table, pk]            → { row, version }   // version = content stamp (cookie)
 *   members [instanceKey, table, pk]                    // the persisted client CVR
 *   meta    [instanceKey]          → { offset, lastActiveAt }
 * A shared row lives once; it is deleted only when its LAST member goes (checked on disk
 * via the members reverse index, in the same txn) — the refcount is on disk, not in RAM.
 *
 * `version` is the Zero cookie `stateVersion` (a LexiVersion) — lexicographically
 * comparable by plain string compare, so "apply-if-newer" is `incoming >= stored`.
 *
 * The interface is platform-agnostic; web backs it with IndexedDB object stores, native
 * with op-sqlite tables. Row keys (`pk`) are computed by the caller (which owns the
 * schema), keeping this layer schema-free.
 */
import type { ReadonlyJSONValue } from '@rocicorp/zero';

/** A row as delivered on the wire / returned for seeding. */
export interface WireRow {
  tableName: string;
  row: Record<string, ReadonlyJSONValue>;
}

/** A persisted row returned for seeding: the wire row plus its stored content `version`, so
 *  the seed can initialize the RAM apply-if-newer guard (else a post-reload stale replay
 *  from a behind instance would clobber a shared row seeded fresh). */
export interface SeededRow extends WireRow {
  version?: string;
}

/** An upsert to persist: identity (`table`,`pk`) + payload. Stamped with the frame version. */
export interface RowPut {
  table: string;
  pk: string;
  row: Record<string, ReadonlyJSONValue>;
}

/** A row identity, for deletes. */
export interface RowKeyRef {
  table: string;
  pk: string;
}

export interface SyncStore {
  /**
   * Persist one fan-out delta for an instance in a single atomic transaction:
   *  - each put: write the row iff `version` ≥ the stored version (apply-if-newer), and
   *    always ensure the `[instanceKey, table, pk]` member exists;
   *  - each delete: remove the member, then delete the row iff no other member references
   *    it (reverse-index existence check, in-txn);
   *  - write the instance's resume `offset`.
   * Offset behind rows is safe (idempotent replay); the single txn prevents offset-ahead.
   */
  applyDelta(
    instanceKey: string,
    puts: readonly RowPut[],
    dels: readonly RowKeyRef[],
    offset: string | undefined,
    version: string | undefined,
  ): Promise<void>;

  /**
   * Clear-then-apply an authoritative snapshot in one txn: drop this instance's members
   * (orphan-sweeping any row whose last member was ours), then apply the puts as members +
   * apply-if-newer rows, then write the offset. Used on fresh hydration / trim fallback.
   */
  applySnapshot(
    instanceKey: string,
    puts: readonly RowPut[],
    offset: string | undefined,
    version: string | undefined,
  ): Promise<void>;

  /**
   * Just an instance's resume offset — a fast single lookup, so a (re)subscribe can send
   * `sinceOffset` immediately without waiting to load all its rows (the rows are only
   * needed for paint, and are seeded in parallel).
   */
  loadOffset(instanceKey: string): Promise<string | undefined>;

  /** Every row an instance holds (for seeding the MemorySource, with its version) + its
   *  resume offset. */
  loadInstance(instanceKey: string): Promise<{ rows: SeededRow[]; offset: string | undefined } | null>;

  /**
   * Drop an instance's members (orphan-sweeping rows) + its meta. Disk is otherwise
   * NEVER auto-evicted — eviction is RAM-only. This is called only on ACL revoke (access
   * lost) or replaced by the DB-wide drop on logout; there is no retention GC (deferred).
   */
  dropInstance(instanceKey: string): Promise<void>;
}

/**
 * No-op store — the default when no persistence is injected. The engine then behaves
 * exactly as the in-memory-only build (reload does a full snapshot, no resume).
 */
export const noopSyncStore: SyncStore = {
  async applyDelta() {},
  async applySnapshot() {},
  async loadOffset() {
    return undefined;
  },
  async loadInstance() {
    return null;
  },
  async dropInstance() {},
};
