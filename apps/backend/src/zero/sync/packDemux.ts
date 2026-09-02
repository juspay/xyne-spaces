import { ChannelStreamState, rowKey, type RowPatchOp, type StreamDiff } from './streamState';
import type { QueryMeta } from './queryMeta';

/**
 * Demultiplexes one packed client group's poke stream back to its individual
 * query-instances. Instances of the group's query-type are mutually disjoint, so
 * every row belongs to exactly one instance:
 *   - PUT of a root row → `partitionColumn` value → instance (via #byPartition);
 *   - PUT of a related row → `childColumn` value → the root's `parentColumn` index
 *     (#childIndex) → instance;
 *   - DEL/UPDATE (PK only) → #owner (`table:pk → instance`), seeded on put.
 * Each instance keeps its own compacted `ChannelStreamState`; `applyPoke` returns
 * the per-instance diffs to persist.
 */
export class PackDemux {
  readonly #meta: QueryMeta;
  readonly #pkFields: Record<string, readonly string[]>;

  readonly #instances = new Map<string, ChannelStreamState>();
  /** partitionColumn value → instanceKey (root-row attribution). */
  readonly #byPartition = new Map<string, string>();
  /** `parentColumn:value` → instanceKey (related-row attribution). */
  readonly #childIndex = new Map<string, string>();
  /** `table:pk` → instanceKey (del/update attribution). */
  readonly #owner = new Map<string, string>();

  constructor(meta: QueryMeta, pkFields: Record<string, readonly string[]>) {
    this.#meta = meta;
    this.#pkFields = pkFields;
  }

  addInstance(instanceKey: string, partitionValue: string): void {
    if (this.#instances.has(instanceKey)) return;
    this.#instances.set(instanceKey, new ChannelStreamState(this.#pkFields));
    this.#byPartition.set(partitionValue, instanceKey);
  }

  removeInstance(instanceKey: string, partitionValue: string): void {
    this.#instances.delete(instanceKey);
    this.#byPartition.delete(partitionValue);
    for (const [k, v] of this.#childIndex) if (v === instanceKey) this.#childIndex.delete(k);
    for (const [k, v] of this.#owner) if (v === instanceKey) this.#owner.delete(k);
  }

  size(): number {
    return this.#instances.size;
  }

  instanceKeys(): string[] {
    return [...this.#instances.keys()];
  }

  /** CVR-cleared reset: drop compacted state + attribution, keep instance registration. */
  resetAll(): void {
    for (const state of this.#instances.values()) state.clear();
    this.#childIndex.clear();
    this.#owner.clear();
  }

  /** Attribute a poke's rows to instances and apply them; returns each touched instance's diff. */
  applyPoke(version: string, ops: readonly RowPatchOp[]): Map<string, StreamDiff> {
    const perInstance = new Map<string, RowPatchOp[]>();
    const route = (instanceKey: string, op: RowPatchOp): void => {
      const list = perInstance.get(instanceKey);
      if (list) list.push(op);
      else perInstance.set(instanceKey, [op]);
    };

    // clear resets every instance in the group.
    if (ops.some((o) => o.op === 'clear')) {
      for (const instanceKey of this.#instances.keys()) route(instanceKey, { op: 'clear' });
    }

    // Pass 1: root rows (carry the partition column) — must precede related rows so
    // #childIndex is populated before we attribute their children.
    for (const op of ops) {
      if (op.op === 'clear' || op.tableName !== this.#meta.rootTable) continue;
      const instanceKey = this.#attributeRoot(op);
      if (instanceKey) route(instanceKey, op);
    }
    // Pass 2: related rows (attributed via the child-FK index).
    for (const op of ops) {
      if (op.op === 'clear' || op.tableName === this.#meta.rootTable) continue;
      const instanceKey = this.#attributeRelated(op);
      if (instanceKey) route(instanceKey, op);
    }

    const diffs = new Map<string, StreamDiff>();
    for (const [instanceKey, instanceOps] of perInstance) {
      const state = this.#instances.get(instanceKey);
      if (state) diffs.set(instanceKey, state.applyPoke(version, instanceOps));
    }
    return diffs;
  }

  #attributeRoot(op: Exclude<RowPatchOp, { op: 'clear' }>): string | undefined {
    if (op.op === 'put') {
      const partitionValue = String(op.value[this.#meta.partitionColumn]);
      const instanceKey = this.#byPartition.get(partitionValue);
      if (!instanceKey) return undefined;
      this.#owner.set(rowKey(op.tableName, op.value, this.#pkFields), instanceKey);
      for (const link of this.#meta.childLinks) {
        this.#childIndex.set(`${link.parentColumn}:${String(op.value[link.parentColumn])}`, instanceKey);
      }
      return instanceKey;
    }
    // del / update
    const key = rowKey(op.tableName, op.id, this.#pkFields);
    const instanceKey = this.#owner.get(key);
    if (op.op === 'del') this.#owner.delete(key);
    return instanceKey;
  }

  #attributeRelated(op: Exclude<RowPatchOp, { op: 'clear' }>): string | undefined {
    if (op.op === 'put') {
      const link = this.#meta.childLinks.find((l) => l.childTable === op.tableName);
      if (!link) return undefined;
      const instanceKey = this.#childIndex.get(`${link.parentColumn}:${String(op.value[link.childColumn])}`);
      if (!instanceKey) return undefined;
      this.#owner.set(rowKey(op.tableName, op.value, this.#pkFields), instanceKey);
      return instanceKey;
    }
    const key = rowKey(op.tableName, op.id, this.#pkFields);
    const instanceKey = this.#owner.get(key);
    if (op.op === 'del') this.#owner.delete(key);
    return instanceKey;
  }
}
