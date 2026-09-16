import { rowKey, type CompactedRow, type Row, type StreamDiff } from './streamState';
import type { ChildLink } from './queryMeta';

/**
 * ROW-LEVEL ROUTING — pure owner-resolution + per-user demux for the row-level plane (R1/R-2).
 *
 * A row-level instance materializes ONE workspace's rows; the fan-out routes each row to its OWNER
 * (`row[routeColumn]`) so a subscriber sees only its own. Puts carry the full row, so a root's owner
 * reads straight off the row and a related row's owner follows its 1:1 parent. Deletes arrive PK-ONLY
 * (`table:pk`, no owner column, no FK on the wire), so they can only be routed through a persisted
 * `rowKey → ownerUserId` map — maintained here at every put, rebuilt from the snapshot on (re)seed.
 *
 * This module is PURE (no Redis, no sockets): the Fanout owns the live map + the emission. Keeping the
 * owner logic here makes the R-2 correctness cases (same-delta parent, owner-change, unroutable drop)
 * unit-testable without a materializer.
 */

export interface RowLevelMeta {
  /** The workspace-partitioned root table (owner rows live here). */
  rootTable: string;
  /** Column on a ROOT row naming its owner user (the route target). */
  routeColumn: string;
  /** 1:1-owned related links (childTable follows its parent's owner). */
  childLinks: ChildLink[];
}

/** A per-user slice of one delta — what a single owner's socket receives. */
export interface UserDelta {
  upserts: Array<{ tableName: string; row: Row }>;
  deletes: string[];
}

export interface RouteResult {
  /** ownerUserId → the rows/keys to deliver to that user for this delta. */
  perUser: Map<string, UserDelta>;
  /** Puts dropped because their parent isn't indexed / a root put's routeColumn is null — fail-closed. */
  unroutablePuts: number;
  /** Deletes dropped because no owner-map entry exists for the key — fail-closed, never broadcast. */
  unroutableDels: number;
  /** Root rows whose owner CHANGED (routeColumn differs from the map). Owner columns are immutable for
   *  the target tables, so this should stay 0 in prod — a non-zero count means the assumption is wrong
   *  (the caller pins lastOwnerChangeOffset for resume + should alert). */
  ownerChanges: number;
}

type ChildMeta = { childColumn: string; parentColumn: string };

/** childTable → its correlation (how a related row points back at its parent root). */
export function childMetaByTable(meta: RowLevelMeta): Map<string, ChildMeta> {
  const m = new Map<string, ChildMeta>();
  for (const link of meta.childLinks) {
    m.set(link.childTable, { childColumn: link.childColumn, parentColumn: link.parentColumn });
  }
  return m;
}

/** The rowKey of the parent root a related row points at (its childColumn value = the parent's PK). */
function parentKeyOf(
  meta: RowLevelMeta,
  cm: ChildMeta,
  childRow: Row,
  pk: Record<string, readonly string[]>,
): string {
  return rowKey(meta.rootTable, { [cm.parentColumn]: childRow[cm.childColumn] } as Row, pk);
}

/**
 * Rebuild the owner map + per-user hydration buckets from an instance snapshot. Roots first (each names
 * its owner), then related rows (owner via the now-indexed parent). A related row whose parent is absent
 * from the snapshot is a consistency gap — dropped from both (fail-closed; the tap never emits an orphan
 * child in a consistent snapshot). Buckets are the point-in-time per-user row lists for hydration.
 */
export function seedRowLevel(
  rows: CompactedRow[],
  meta: RowLevelMeta,
  pk: Record<string, readonly string[]>,
): { ownerMap: Map<string, string>; buckets: Map<string, CompactedRow[]> } {
  const cmByTable = childMetaByTable(meta);
  const ownerMap = new Map<string, string>();
  const buckets = new Map<string, CompactedRow[]>();
  const addToBucket = (userId: string, cr: CompactedRow): void => {
    const b = buckets.get(userId);
    if (b) b.push(cr);
    else buckets.set(userId, [cr]);
  };

  // Roots first so every related row can resolve its parent's owner in the second pass.
  for (const cr of rows) {
    if (cr.tableName !== meta.rootTable) continue;
    const raw = cr.row[meta.routeColumn];
    if (raw === null || raw === undefined) continue; // no owner to route by → drop (schema says NOT NULL)
    const owner = String(raw);
    ownerMap.set(rowKey(cr.tableName, cr.row, pk), owner);
    addToBucket(owner, cr);
  }
  for (const cr of rows) {
    if (cr.tableName === meta.rootTable) continue;
    const cm = cmByTable.get(cr.tableName);
    if (!cm) continue; // not a known related table — not part of this query's shape
    const owner = ownerMap.get(parentKeyOf(meta, cm, cr.row, pk));
    if (owner === undefined) continue; // orphan child (parent not in snapshot) — drop fail-closed
    ownerMap.set(rowKey(cr.tableName, cr.row, pk), owner);
    addToBucket(owner, cr);
  }
  return { ownerMap, buckets };
}

/**
 * Demux one instance delta into per-owner deltas, MUTATING the live owner map. Order within the delta:
 * root puts (record owner; owner-CHANGE ⇒ delete-to-old + put-to-new) → related puts (owner via the
 * now-updated map, incl. same-delta parents) → deletes (owner via the map, then forget the key). A put
 * whose parent isn't indexed or a delete with no map entry is UNROUTABLE ⇒ dropped fail-closed (counted
 * for obs), never guessed and never broadcast.
 */
export function routeDelta(
  diff: StreamDiff,
  ownerMap: Map<string, string>,
  meta: RowLevelMeta,
  pk: Record<string, readonly string[]>,
): RouteResult {
  const cmByTable = childMetaByTable(meta);
  const perUser = new Map<string, UserDelta>();
  let unroutablePuts = 0;
  let unroutableDels = 0;
  let ownerChanges = 0;
  const slot = (userId: string): UserDelta => {
    let d = perUser.get(userId);
    if (!d) perUser.set(userId, (d = { upserts: [], deletes: [] }));
    return d;
  };

  // 1. Root puts. A change of routeColumn value (owner moved) is rare for these tables — owner columns
  //    are immutable in practice — but handle it: delete from the old owner, put to the new.
  for (const u of diff.upserts) {
    if (u.tableName !== meta.rootTable) continue;
    const raw = u.row[meta.routeColumn];
    if (raw === null || raw === undefined) { unroutablePuts++; continue; } // NOT-NULL by schema — count if reality disagrees
    const newOwner = String(raw);
    const prev = ownerMap.get(u.key);
    if (prev !== undefined && prev !== newOwner) {
      ownerChanges++;
      slot(prev).deletes.push(u.key);
    }
    ownerMap.set(u.key, newOwner);
    slot(newOwner).upserts.push({ tableName: u.tableName, row: u.row });
  }
  // 2. Related puts. Owner follows the 1:1 parent (indexed by a root put above or a prior delta).
  for (const u of diff.upserts) {
    if (u.tableName === meta.rootTable) continue;
    const cm = cmByTable.get(u.tableName);
    if (!cm) { unroutablePuts++; continue; }
    const owner = ownerMap.get(parentKeyOf(meta, cm, u.row, pk));
    if (owner === undefined) { unroutablePuts++; continue; } // parent not indexed → drop fail-closed
    ownerMap.set(u.key, owner);
    slot(owner).upserts.push({ tableName: u.tableName, row: u.row });
  }
  // 3. Deletes (PK-only): route through the map, then forget the key.
  for (const key of diff.deletes) {
    const owner = ownerMap.get(key);
    if (owner === undefined) { unroutableDels++; continue; } // no entry → drop fail-closed
    slot(owner).deletes.push(key);
    ownerMap.delete(key);
  }
  return { perUser, unroutablePuts, unroutableDels, ownerChanges };
}

/**
 * READ-ONLY per-user projection of a delta for RESUME — does NOT mutate the owner map (the live map is
 * already at current state; the replayed diffs were applied to it when they first arrived). Returns the
 * user's slice, or `null` on ANY unroutable op (a related put whose parent is no longer indexed, or a
 * delete with no owner entry). null ⇒ the caller MUST fall back to a full snapshot — the R-2 rule
 * "puts-only resume + snapshot-on-any-unroutable-del": a replayed delete of the user's own row whose
 * map entry is gone (deleted since `sinceOffset`) would otherwise leave the user holding a dead row.
 */
export function projectDeltaForUser(
  diff: StreamDiff,
  ownerMap: Map<string, string>,
  meta: RowLevelMeta,
  pk: Record<string, readonly string[]>,
  userId: string,
): UserDelta | null {
  const cmByTable = childMetaByTable(meta);
  const upserts: UserDelta['upserts'] = [];
  const deletes: string[] = [];
  for (const u of diff.upserts) {
    let owner: string | undefined;
    if (u.tableName === meta.rootTable) {
      owner = String(u.row[meta.routeColumn]);
    } else {
      const cm = cmByTable.get(u.tableName);
      if (!cm) return null;
      owner = ownerMap.get(parentKeyOf(meta, cm, u.row, pk));
      if (owner === undefined) return null; // parent gone → can't confirm ownership → snapshot
    }
    if (owner === userId) upserts.push({ tableName: u.tableName, row: u.row });
  }
  for (const key of diff.deletes) {
    const owner = ownerMap.get(key);
    if (owner === undefined) return null; // unroutable delete → snapshot fallback
    if (owner === userId) deletes.push(key);
  }
  return { upserts, deletes };
}
