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

export class IvmHost {
  readonly #sources = new Map<string, any>();
  readonly #pk = new Map<string, readonly string[]>();
  readonly #views = new Map<string, ViewEntry>();
  readonly #delegate = new HostDelegate(this);
  /** `${table} ${pkKey}` → ref count + PK row. */
  readonly #refs = new Map<string, RowRef>();
  /** instanceKey → the ref keys it currently holds (for teardown). */
  readonly #instanceRefs = new Map<string, Set<string>>();

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

  /** Apply a fan-out snapshot/delta for one instance, then flush all views once. */
  applyDelta(instanceKey: string, upserts: readonly WireRow[], deleteKeys: readonly string[]): void {
    for (const u of upserts) this.#upsert(instanceKey, u.tableName, u.row);
    for (const rowKey of deleteKeys) this.#deleteByRowKey(instanceKey, rowKey);
    this.flushAll();
  }

  /** Drop everything an instance referenced (on unsubscribe); removes rows no one else holds. */
  dropInstance(instanceKey: string): void {
    const held = this.#instanceRefs.get(instanceKey);
    if (!held) return;
    for (const refKey of held) this.#deref(refKey);
    this.#instanceRefs.delete(instanceKey);
    this.flushAll();
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

  #upsert(instanceKey: string, table: string, row: Row): void {
    const src = this.source(table);
    const old = src.data.get(row) as Row | undefined;
    if (old) consume(src.push(makeSourceChangeEdit(row, old)));
    else consume(src.push(makeSourceChangeAdd(row)));
    this.#addRef(instanceKey, this.#refKey(table, this.#pkKey(table, row)), () => this.#pkOf(table, row));
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

  /** Decrement a row's ref count; remove it from the source when the last instance lets go. */
  #deref(refKey: string): void {
    const ref = this.#refs.get(refKey);
    if (!ref) return;
    ref.count -= 1;
    if (ref.count > 0) return;
    this.#refs.delete(refKey);
    const table = refKey.slice(0, refKey.indexOf(' '));
    const src = this.source(table);
    const old = src.data.get(ref.pk) as Row | undefined; // may be absent — guard the remove
    if (old) consume(src.push(makeSourceChangeRemove(old)));
  }
}
