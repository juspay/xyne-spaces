/**
 * Hosted Zero IVM.
 *
 * The shared-base sync engine removes "shared" queries from per-user Zero
 * materialization and streams their rows from the backend fan-out. On the client we
 * re-derive the query views locally by hosting Zero's IVM: one `MemorySource` per
 * table, `buildPipeline` for each active base (ACL-free) query, and an `ArrayView`
 * whose output is copied into the query cache. A row pushed once fans to every active
 * pipeline — including one materialized later.
 *
 * The `MemorySource` is the single client row store (its primary index is PK-keyed, so
 * the old row for an edit/remove is fetched from it via `data.get` — no side map). A
 * per-PK reference count tracks how many active instances reference each row, so a
 * shared row leaves the source only when the last one lets go (the client twin of the
 * server CVR). Nothing here is persisted; on reload the source is rebuilt from the
 * (already-persisted) query-cache results.
 *
 * `#zql/*` are Zero's compiled internals, mapped in this package's `imports` field.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { MemorySource } from '#zql/ivm/memory-source.js';
import { buildPipeline } from '#zql/builder/builder.js';
import { ArrayView } from '#zql/ivm/array-view.js';
import { makeSourceChangeAdd, makeSourceChangeEdit, makeSourceChangeRemove } from '#zql/ivm/source.js';
import { consume } from '#zql/ivm/stream.js';
import { MemoryStorage } from '#zql/ivm/memory-storage.js';
import type { ReadonlyJSONValue } from '@rocicorp/zero';
import { schema } from '../zero/schema.js';
import type { RowPut, RowKeyRef, SeededRow } from './store.js';

export type Row = Record<string, ReadonlyJSONValue>;
export type Format = { singular: boolean; relationships: Record<string, Format> };

/** A row as delivered on the wire (fan-out snapshot / delta upsert). */
export interface WireRow {
  tableName: string;
  row: Row;
}

type SchemaTable = { columns: Record<string, { type: string }>; primaryKey: readonly string[] };
const tables = schema.tables as unknown as Record<string, SchemaTable>;

class HostDelegate {
  readonly enableNotExists = false;
  constructor(private readonly host: IvmHost) {}
  getSource(table: string): any {
    return this.host.source(table);
  }
  createStorage(): any {
    return new MemoryStorage();
  }
  decorateInput(input: any): any {
    return input;
  }
  decorateFilterInput(input: any): any {
    return input;
  }
  decorateSourceInput(input: any): any {
    return input;
  }
  addEdge(): void {}
  mapAst(ast: any): any {
    return ast;
  }
}

interface ViewEntry {
  view: any;
  onData: (rows: readonly Row[]) => void;
}

/** A row leaves the source only when its ref count hits zero. `pk` is kept so the row
 *  can be located in the source for removal. */
interface RowRef {
  count: number;
  pk: Row;
}

/** The authoritative fan-out row for a PK (independent of any optimistic overlay). `version`
 *  = the cookie `stateVersion` of the last write applied (cross-stream apply-if-newer). */
interface ConfirmedRow {
  row: Row;
  version?: string;
}

/**
 * One optimistic write from a client mutator, mirrored into the host so the shared view
 * reflects it before the server round-trips. `set` = insert/upsert (full row), `patch` =
 * update (PK + changed fields), `delete` = remove (PK). `row` always carries the PK.
 */
export interface OptimisticOp {
  kind: 'set' | 'patch' | 'delete';
  table: string;
  row: Row;
}

/** Internal overlay op with the PK resolved once. */
interface OverlayOp {
  kind: 'set' | 'patch' | 'delete';
  table: string;
  refKey: string;
  pk: Row;
  row: Row;
}

export class IvmHost {
  readonly #sources = new Map<string, any>();
  readonly #pk = new Map<string, readonly string[]>();
  readonly #views = new Map<string, ViewEntry>();
  readonly #delegate = new HostDelegate(this);
  /** `${table} ${pkKey}` → ref count + PK row. */
  readonly #refs = new Map<string, RowRef>();
  /** instanceKey → the ref keys it currently holds (for teardown). */
  readonly #instanceRefs = new Map<string, Set<string>>();
  /**
   * `${table} ${pkKey}` → the authoritative fan-out row + version. The MemorySource holds
   * the EFFECTIVE row (fold of confirmed + the optimistic overlay); this is the confirmed
   * layer the effective row is derived from. With no overlay, effective === confirmed.
   */
  readonly #confirmed = new Map<string, ConfirmedRow>();
  /** mutationID → its optimistic ops (the overlay). Folded over #confirmed into the source. */
  readonly #ledger = new Map<number, OverlayOp[]>();
  /** refKey → mutationIDs whose overlay touches it (reverse index for fold + re-derive). */
  readonly #overlayByPK = new Map<string, Set<number>>();
  /**
   * SERVER-confirmed last-mutation-ID watermark. An overlay is CONFIRMED once
   * `#confirmedLmid >= mutationID`. Advanced ONLY by `noteMutationSettled` — fed by Zero's authoritative
   * per-mutation server result (see confirmedMutations.ts / MutationTracker hook), NOT Zero's
   * `lastMutationID()`, which is the OPTIMISTIC local counter (it advances the instant the client applies
   * a mutation, before any server round-trip). Using the optimistic value retired overlays before the
   * server confirmed them → a slow/out-of-window write flickered out. We retire a confirmed overlay when
   * the fan-out shows its effect (flicker-free — the confirmed row is already the base), with a
   * low-frequency sweep as the fallback for the effect-out-of-window case; a reject reverts immediately.
   */
  #confirmedLmid = 0;
  #sweepTimer?: ReturnType<typeof setInterval>;

  /** Start the periodic confirmed-overlay sweep (the fallback for effects that never echo through a
   *  subscribed instance). Confirmation itself is driven by `noteMutationSettled`, not a poll. */
  startReconcileSweep(sweepMs = 2500): void {
    if (this.#sweepTimer !== undefined) clearInterval(this.#sweepTimer);
    this.#sweepTimer = setInterval(() => this.reconcileConfirmed(), sweepMs);
    (this.#sweepTimer as { unref?: () => void }).unref?.();
  }

  /**
   * Record a mutation's SERVER result (from Zero's per-mutation serverPromise, which settles only once
   * zero-cache has processed the mutation — resolve = success, reject = app/protocol error). `ok === false`
   * (server rejected the mutation) ⇒
   * revert the optimistic overlay NOW (the server row will never carry it). Either way advance the
   * confirmed watermark so the echo path can retire a successful overlay once the fan-out delivers the
   * server row (flicker-free). Success does NOT retire here — that would drop the overlay before the
   * confirmed fan-out row lands (flicker); the echo path / sweep handle it.
   */
  noteMutationSettled(mutationID: number, ok: boolean): void {
    if (!ok) this.dropOptimistic(mutationID);
    if (mutationID > this.#confirmedLmid) this.#confirmedLmid = mutationID;
  }

  /** The (lazily created) MemorySource for a table, built from the shared schema. */
  source(table: string): any {
    let src = this.#sources.get(table);
    if (!src) {
      const t = tables[table];
      if (!t) throw new Error(`IvmHost: unknown table "${table}"`);
      const columns: Record<string, { type: string }> = {};
      for (const [col, def] of Object.entries(t.columns)) columns[col] = { type: def.type };
      src = new MemorySource(table, columns as any, [...t.primaryKey] as [string, ...string[]]);
      this.#sources.set(table, src);
      this.#pk.set(table, [...t.primaryKey]);
    }
    return src;
  }

  /** Build (or refresh) a live pipeline+view for a base query; `onData` fires on every flush. */
  materialize(key: string, ast: any, format: Format, onData: (rows: readonly Row[]) => void): void {
    const existing = this.#views.get(key);
    if (existing) {
      existing.onData = onData;
      onData(existing.view.data as readonly Row[]);
      return;
    }
    const input = buildPipeline(ast, this.#delegate, key);
    const view = new ArrayView(input, format, true, () => {});
    this.#views.set(key, { view, onData });
    view.flush();
    onData(view.data as readonly Row[]);
  }

  #onceSeq = 0;
  /**
   * Run a query ONCE against the host's current sources (the effective, confirmed+overlay
   * rows) and return its result — used by the mutator union-read to resolve a hosted-table
   * read that misses in Zero's store. Transient: the pipeline+view is discarded after.
   */
  runOnce(ast: any, format: Format): unknown {
    const input = buildPipeline(ast, this.#delegate, `once:${(this.#onceSeq += 1)}`);
    const view = new ArrayView(input, format, true, () => {});
    view.flush();
    const data = view.data;
    view.destroy?.();
    return data;
  }

  /** Tear down a query's pipeline+view. Rows are retained until their refs drop to zero. */
  release(key: string): void {
    this.#views.get(key)?.view.destroy?.();
    this.#views.delete(key);
  }

  flushAll(): void {
    for (const entry of this.#views.values()) {
      entry.view.flush();
      entry.onData(entry.view.data as readonly Row[]);
    }
  }

  /** Apply a fan-out delta for one instance, then flush all views once. All upserts in the
   *  frame share its `version` (cookie stateVersion) for cross-stream apply-if-newer. */
  applyDelta(
    instanceKey: string,
    upserts: readonly WireRow[],
    deleteKeys: readonly string[],
    version?: string,
  ): void {
    const touched: string[] = [];
    for (const u of upserts) {
      this.#upsert(instanceKey, u.tableName, u.row, version);
      touched.push(this.#refKey(u.tableName, this.#pkKey(u.tableName, u.row)));
    }
    for (const rowKey of deleteKeys) {
      this.#deleteByRowKey(instanceKey, rowKey);
      const i = rowKey.indexOf(':');
      if (i >= 0) touched.push(`${rowKey.slice(0, i)} ${rowKey.slice(i + 1)}`);
    }
    this.flushAll();
    // The fan-out just delivered these PKs' confirmed state — retire any overlay it confirms.
    this.#retireEchoed(touched);
  }

  /**
   * Seed an instance's persisted rows into the source on reload, each carrying its own
   * stored `version` so the RAM apply-if-newer guard starts correct — a later resume replay
   * of an older shared-row version (from a behind instance) is then skipped, not applied.
   */
  applySeed(instanceKey: string, seeds: readonly SeededRow[]): void {
    for (const s of seeds) this.#upsert(instanceKey, s.tableName, s.row, s.version);
    this.flushAll();
  }

  /**
   * Apply an AUTHORITATIVE snapshot for one instance: clear-then-apply. Rows this instance
   * previously held that aren't in the snapshot are dropped (deletes-while-away), so a
   * hydration / trim-fallback can't leave stale rows. All rows share the snapshot `version`.
   * One flush.
   */
  applySnapshot(instanceKey: string, rows: readonly WireRow[], version?: string): void {
    this.#clear(instanceKey);
    for (const u of rows) this.#upsert(instanceKey, u.tableName, u.row, version);
    this.flushAll();
  }

  /** The persistence key of a wire row: `{ table, pk }` with `pk` = the IVM's PK string. */
  rowPut(wire: WireRow): RowPut {
    return { table: wire.tableName, pk: this.#pkKey(wire.tableName, wire.row), row: wire.row };
  }

  /** Parse a wire delete key (`${table}:${pkString}`) into a persistence key ref. */
  keyRef(rowKey: string): RowKeyRef | null {
    const i = rowKey.indexOf(':');
    if (i < 0) return null;
    return { table: rowKey.slice(0, i), pk: rowKey.slice(i + 1) };
  }

  /** Drop everything an instance referenced (on unsubscribe); removes rows no one else holds. */
  dropInstance(instanceKey: string): void {
    if (!this.#instanceRefs.has(instanceKey)) return;
    this.#clear(instanceKey);
    this.flushAll();
  }

  /** Deref all of an instance's rows and forget its membership. Does NOT flush (caller does). */
  #clear(instanceKey: string): void {
    const held = this.#instanceRefs.get(instanceKey);
    if (!held) return;
    for (const refKey of held) this.#deref(refKey);
    this.#instanceRefs.delete(instanceKey);
  }

  #pkFields(table: string): readonly string[] {
    this.source(table);
    return this.#pk.get(table) ?? ['id'];
  }
  #pkKey(table: string, row: Row): string {
    return this.#pkFields(table)
      .map((f) => String(row[f]))
      .join(' ');
  }
  #pkOf(table: string, row: Row): Row {
    const pk: Row = {};
    for (const f of this.#pkFields(table)) pk[f] = row[f];
    return pk;
  }
  #refKey(table: string, pkKey: string): string {
    return `${table} ${pkKey}`;
  }

  #upsert(instanceKey: string, table: string, row: Row, version?: string): void {
    const refKey = this.#refKey(table, this.#pkKey(table, row));
    const confirmed = this.#confirmed.get(refKey);
    // Cross-stream apply-if-newer: a stale replay (older cookie stateVersion) from one
    // instance's stream must not clobber a shared row another instance advanced. Skip the
    // confirmed update when strictly older, but STILL take the ref (membership is independent).
    const stale =
      confirmed?.version !== undefined && version !== undefined && version < confirmed.version;
    if (!stale) this.#confirmed.set(refKey, { row, version: version ?? confirmed?.version });
    this.#addRef(instanceKey, refKey, () => this.#pkOf(table, row));
    if (!stale) this.#reconcileSource(table, refKey, this.#pkOf(table, row));
  }

  /** The row that should be in the MemorySource for a PK: the confirmed row with the optimistic
   *  overlay folded on top (ops applied in mutationID order), or undefined if the PK holds no
   *  row (never confirmed / deleted by the overlay). */
  #effectiveRow(refKey: string): Row | undefined {
    let row = this.#confirmed.get(refKey)?.row;
    const mids = this.#overlayByPK.get(refKey);
    if (!mids || mids.size === 0) return row;
    for (const mid of [...mids].sort((a, b) => a - b)) {
      for (const op of this.#ledger.get(mid) ?? []) {
        if (op.refKey !== refKey) continue;
        if (op.kind === 'delete') row = undefined;
        else if (op.kind === 'set') row = op.row;
        else row = row ? { ...row, ...op.row } : { ...op.row };
      }
    }
    return row;
  }

  /**
   * Parity with Zero's own `defaultOptionalFieldsToNull` (zero-client crud-impl.ts): a `set`
   * row entering the hosted source must be schema-complete — absent columns become explicit
   * `null`, exactly what Postgres/the wire always delivers — so connection predicates
   * (e.g. `doNotPostToChannel IS NULL`) evaluate identically for optimistic and confirmed
   * rows. Without this, a mutator row missing an optional column is silently dropped by every
   * pipeline's pushed-down filter (`undefined !== null`) and becomes an invisible ghost.
   */
  #normalizeSetRow(table: string, row: Row): Row {
    const t = tables[table];
    if (!t) return row;
    let rv = row;
    for (const name in t.columns) {
      if (rv[name] === undefined) {
        if (rv === row) rv = { ...row };
        (rv as Record<string, ReadonlyJSONValue | null>)[name] = null;
      }
    }
    return rv;
  }

  /**
   * Record (or REPLACE) a mutation's optimistic ops and fold them into the source. Replacing
   * handles Zero's re-invocation of the same mutation on optimistic→rebase identically. Only
   * ops on hosted tables reach here; the caller filters.
   */
  applyOptimistic(mutationID: number, ops: readonly OptimisticOp[]): void {
    const affected = new Map<string, Row>(); // refKey → pk (for re-derive)
    const prev = this.#ledger.get(mutationID);
    if (prev) {
      for (const op of prev) {
        affected.set(op.refKey, op.pk);
        this.#overlayByPK.get(op.refKey)?.delete(mutationID);
      }
    }
    const resolved: OverlayOp[] = ops.map((op) => {
      // `set` rows are normalized to schema shape; `patch`/`delete` stay partial by design.
      const row = op.kind === 'set' ? this.#normalizeSetRow(op.table, op.row) : op.row;
      const refKey = this.#refKey(op.table, this.#pkKey(op.table, row));
      return { kind: op.kind, table: op.table, refKey, pk: this.#pkOf(op.table, row), row };
    });
    if (resolved.length > 0) this.#ledger.set(mutationID, resolved);
    else this.#ledger.delete(mutationID);
    for (const op of resolved) {
      affected.set(op.refKey, op.pk);
      const s = this.#overlayByPK.get(op.refKey) ?? new Set<number>();
      s.add(mutationID);
      this.#overlayByPK.set(op.refKey, s);
    }
    for (const [refKey, pk] of affected) {
      this.#reconcileSource(refKey.slice(0, refKey.indexOf(' ')), refKey, pk);
    }
    this.flushAll();
  }

  /** Retire every confirmed overlay (`#confirmedLmid >= mutationID`). The periodic fallback that
   *  catches effects that never echo through a subscribed instance (rejects revert eagerly in
   *  noteMutationSettled). No-op until a mutation is server-confirmed (watermark starts at 0). */
  reconcileConfirmed(): void {
    const lmid = this.#confirmedLmid;
    if (lmid === 0) return;
    const done: number[] = [];
    for (const mutationID of this.#ledger.keys()) if (mutationID <= lmid) done.push(mutationID);
    for (const mutationID of done) this.dropOptimistic(mutationID);
  }

  /** Retire confirmed overlays whose effect the fan-out just delivered on `refKeys` — the
   *  flicker-free path (the confirmed row is already applied, so the drop is a visual no-op). Gated
   *  on the SERVER-confirmed watermark so a pending overlay on the same row is never dropped early. */
  #retireEchoed(refKeys: Iterable<string>): void {
    const lmid = this.#confirmedLmid;
    if (lmid === 0) return;
    const done = new Set<number>();
    for (const refKey of refKeys) {
      for (const mutationID of this.#overlayByPK.get(refKey) ?? []) {
        if (mutationID <= lmid) done.add(mutationID);
      }
    }
    for (const mutationID of done) this.dropOptimistic(mutationID);
  }

  /** Drop a mutation's overlay (retired on confirm-echo / sweep, or rejected) and revert
   *  those PKs to confirmed. */
  dropOptimistic(mutationID: number): void {
    const ops = this.#ledger.get(mutationID);
    if (!ops) return;
    this.#ledger.delete(mutationID);
    for (const op of ops) {
      const s = this.#overlayByPK.get(op.refKey);
      s?.delete(mutationID);
      if (s && s.size === 0) this.#overlayByPK.delete(op.refKey);
      this.#reconcileSource(op.table, op.refKey, op.pk);
    }
    this.flushAll();
  }

  /** Push the source toward the effective row for a PK: add / edit / remove as needed. */
  #reconcileSource(table: string, refKey: string, pk: Row): void {
    const src = this.source(table);
    const eff = this.#effectiveRow(refKey);
    const current = src.data.get(pk) as Row | undefined;
    if (eff) {
      if (current) consume(src.push(makeSourceChangeEdit(eff, current)));
      else consume(src.push(makeSourceChangeAdd(eff)));
    } else if (current) {
      consume(src.push(makeSourceChangeRemove(current)));
    }
  }

  #deleteByRowKey(instanceKey: string, rowKey: string): void {
    // rowKey = `${table}:${pk values joined by space}` (see backend streamState.rowKey).
    const i = rowKey.indexOf(':');
    if (i < 0) return;
    const table = rowKey.slice(0, i);
    const values = rowKey.slice(i + 1).split(' ');
    const fields = this.#pkFields(table);
    const pk: Row = {};
    fields.forEach((f, idx) => (pk[f] = values[idx]));
    const refKey = this.#refKey(table, this.#pkKey(table, pk));
    // Only decrement if THIS instance referenced the row (guards duplicate/late dels).
    const held = this.#instanceRefs.get(instanceKey);
    if (held?.has(refKey)) {
      held.delete(refKey);
      this.#deref(refKey);
    }
  }

  #addRef(instanceKey: string, refKey: string, makePk: () => Row): void {
    let held = this.#instanceRefs.get(instanceKey);
    if (!held) {
      held = new Set<string>();
      this.#instanceRefs.set(instanceKey, held);
    }
    if (held.has(refKey)) return; // this instance already references the row
    held.add(refKey);
    const existing = this.#refs.get(refKey);
    if (existing) existing.count += 1;
    else this.#refs.set(refKey, { count: 1, pk: makePk() });
  }

  /** Decrement a row's ref count; drop its confirmed row + remove it from the source when the
   *  last instance lets go. */
  #deref(refKey: string): void {
    const ref = this.#refs.get(refKey);
    if (!ref) return;
    ref.count -= 1;
    if (ref.count > 0) return;
    this.#refs.delete(refKey);
    this.#confirmed.delete(refKey);
    const table = refKey.slice(0, refKey.indexOf(' '));
    this.#reconcileSource(table, refKey, ref.pk); // effective now undefined → source removal
  }
}
