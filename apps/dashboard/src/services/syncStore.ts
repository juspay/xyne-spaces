/**
 * IndexedDB-backed {@link SyncStore} for the sync engine (web). Persists the confirmed
 * rows a reload seeds the in-memory IVM from. Single copy per row; a shared row is
 * deleted only when its last member goes (checked in-txn via the members reverse index).
 *
 * Uses the object stores added to `indexedDBService`'s DB (see SYNC_*_STORE), so it
 * inherits that DB's user-scoping, schema-version invalidation, and logout-drop.
 *
 * Disk is NEVER auto-evicted (eviction is RAM-only); `dropInstance` runs only on ACL
 * revoke, and logout drops the whole DB. So the eviction-vs-offset invariant holds —
 * an offset can only be MISSING (→ snapshot), never point past rows we still have.
 *
 * All writes are single atomic transactions issued callback-style (never `await` between
 * requests inside a txn — that would let IDB auto-commit mid-flight); we resolve on
 * `tx.oncomplete`, so offset + rows always land together.
 */
import type { SyncStore, RowPut, RowKeyRef, WireRow, SeededRow } from '@xyne/shared/sync';
import {
  indexedDBService,
  SYNC_ROWS_STORE,
  SYNC_MEMBERS_STORE,
  SYNC_META_STORE,
} from './indexedDBService';

interface RowRecord {
  table: string;
  pk: string;
  row: WireRow['row'];
  version: string;
}
interface MemberRecord {
  inst: string;
  table: string;
  pk: string;
}
interface MetaRecord {
  inst: string;
  offset?: string;
  lastActiveAt: number;
}

const STORES = [SYNC_ROWS_STORE, SYNC_MEMBERS_STORE, SYNC_META_STORE];
/** Key range covering every `[inst, *, *]` member (arrays sort after strings in IDB). */
const instRange = (inst: string): IDBKeyRange => IDBKeyRange.bound([inst], [inst, []]);

class IdbSyncStore implements SyncStore {
  #db(): IDBDatabase | null {
    return indexedDBService.getDb();
  }

  #tx(mode: IDBTransactionMode, body: (tx: IDBTransaction) => void): Promise<void> {
    const db = this.#db();
    if (!db) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORES, mode);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
      body(tx);
    });
  }

  /** Put a row iff the incoming version is not older (LexiVersion string compare), and
   *  always ensure the member exists. `undefined` version = unconditional (pre-version-stamps). */
  #putRow(
    rows: IDBObjectStore,
    members: IDBObjectStore,
    inst: string,
    p: RowPut,
    version: string | undefined,
  ): void {
    const getReq = rows.get([p.table, p.pk]);
    getReq.onsuccess = () => {
      const existing = getReq.result as RowRecord | undefined;
      if (!existing || version === undefined || version >= existing.version) {
        const rec: RowRecord = {
          table: p.table,
          pk: p.pk,
          row: p.row,
          version: version ?? existing?.version ?? '',
        };
        rows.put(rec);
      }
    };
    const member: MemberRecord = { inst, table: p.table, pk: p.pk };
    members.put(member);
  }

  /** Remove the member, then delete the row iff no other instance still references it. */
  #delRow(rows: IDBObjectStore, members: IDBObjectStore, inst: string, d: RowKeyRef): void {
    members.delete([inst, d.table, d.pk]);
    const countReq = members.index('byRow').count([d.table, d.pk]);
    countReq.onsuccess = () => {
      if (countReq.result === 0) rows.delete([d.table, d.pk]);
    };
  }

  #writeMeta(meta: IDBObjectStore, inst: string, offset: string | undefined): void {
    const getReq = meta.get(inst);
    getReq.onsuccess = () => {
      const m = getReq.result as MetaRecord | undefined;
      const off = offset ?? m?.offset;
      const rec: MetaRecord = {
        inst,
        lastActiveAt: Date.now(),
        ...(off !== undefined && { offset: off }),
      };
      meta.put(rec);
    };
  }

  applyDelta(
    inst: string,
    puts: readonly RowPut[],
    dels: readonly RowKeyRef[],
    offset: string | undefined,
    version: string | undefined,
  ): Promise<void> {
    return this.#tx('readwrite', tx => {
      const rows = tx.objectStore(SYNC_ROWS_STORE);
      const members = tx.objectStore(SYNC_MEMBERS_STORE);
      const meta = tx.objectStore(SYNC_META_STORE);
      for (const p of puts) this.#putRow(rows, members, inst, p, version);
      for (const d of dels) this.#delRow(rows, members, inst, d);
      this.#writeMeta(meta, inst, offset);
    });
  }

  applySnapshot(
    inst: string,
    puts: readonly RowPut[],
    offset: string | undefined,
    version: string | undefined,
  ): Promise<void> {
    return this.#tx('readwrite', tx => {
      const rows = tx.objectStore(SYNC_ROWS_STORE);
      const members = tx.objectStore(SYNC_MEMBERS_STORE);
      const meta = tx.objectStore(SYNC_META_STORE);
      // Clear-then-apply: drop all of this instance's members (orphan-sweeping rows whose
      // last member was ours), then apply the snapshot. A shared row survives the clear.
      const cursorReq = members.openCursor(instRange(inst));
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor) {
          const { table, pk } = cursor.value as MemberRecord;
          cursor.delete();
          const cReq = members.index('byRow').count([table, pk]);
          cReq.onsuccess = () => {
            if (cReq.result === 0) rows.delete([table, pk]);
          };
          cursor.continue();
          return;
        }
        // Cursor exhausted → apply the snapshot rows + members, then meta.
        for (const p of puts) this.#putRow(rows, members, inst, p, version);
        this.#writeMeta(meta, inst, offset);
      };
    });
  }

  loadOffset(inst: string): Promise<string | undefined> {
    const db = this.#db();
    if (!db) return Promise.resolve(undefined);
    return new Promise((resolve, reject) => {
      const tx = db.transaction([SYNC_META_STORE], 'readonly');
      const req = tx.objectStore(SYNC_META_STORE).get(inst) as IDBRequest<MetaRecord | undefined>;
      let offset: string | undefined;
      req.onsuccess = () => {
        offset = req.result?.offset;
      };
      tx.oncomplete = () => resolve(offset);
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    });
  }

  loadInstance(inst: string): Promise<{ rows: SeededRow[]; offset: string | undefined } | null> {
    const db = this.#db();
    if (!db) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORES, 'readonly');
      const members = tx.objectStore(SYNC_MEMBERS_STORE);
      const rows = tx.objectStore(SYNC_ROWS_STORE);
      const meta = tx.objectStore(SYNC_META_STORE);
      const out: SeededRow[] = [];
      let offset: string | undefined;
      let found = false;

      const memReq = members.getAll(instRange(inst)) as IDBRequest<MemberRecord[]>;
      memReq.onsuccess = () => {
        const mems = memReq.result;
        found = mems.length > 0;
        for (const m of mems) {
          const rReq = rows.get([m.table, m.pk]) as IDBRequest<RowRecord | undefined>;
          rReq.onsuccess = () => {
            if (rReq.result)
              out.push({ tableName: m.table, row: rReq.result.row, version: rReq.result.version });
          };
        }
      };
      const metaReq = meta.get(inst) as IDBRequest<MetaRecord | undefined>;
      metaReq.onsuccess = () => {
        offset = metaReq.result?.offset;
      };

      tx.oncomplete = () => resolve(found ? { rows: out, offset } : null);
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    });
  }

  dropInstance(inst: string): Promise<void> {
    return this.#tx('readwrite', tx => {
      const rows = tx.objectStore(SYNC_ROWS_STORE);
      const members = tx.objectStore(SYNC_MEMBERS_STORE);
      const meta = tx.objectStore(SYNC_META_STORE);
      const cursorReq = members.openCursor(instRange(inst));
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) return;
        const { table, pk } = cursor.value as MemberRecord;
        cursor.delete();
        const cReq = members.index('byRow').count([table, pk]);
        cReq.onsuccess = () => {
          if (cReq.result === 0) rows.delete([table, pk]);
        };
        cursor.continue();
      };
      meta.delete(inst);
    });
  }
}

export const idbSyncStore: SyncStore = new IdbSyncStore();
