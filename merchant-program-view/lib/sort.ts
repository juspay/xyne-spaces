import { RANK } from './flags';
import type { St } from './model';
import type { FTicket, MerchantRow } from './portfolio';

/** Column sorting for the portfolio tables. Unsorted keeps the page's default (health) order. */

export type Dir = 'asc' | 'desc';
export interface Sort<K extends string> {
  key: K;
  dir: Dir;
}

export type MKey = 'sev' | 'mid' | 'open' | 'age' | 'oldest' | 'attn' | 'court' | 'activity';
export type TKey = 'status' | 'key' | 'title' | 'mid' | 'issue' | 'who' | 'age' | 'updated';

/** Direction of the first click: text A→Z, numbers biggest first. */
export const M_FIRST: Record<MKey, Dir> = { sev: 'desc', mid: 'asc', open: 'desc', age: 'desc', oldest: 'desc', attn: 'desc', court: 'desc', activity: 'desc' };
export const T_FIRST: Record<TKey, Dir> = { status: 'asc', key: 'asc', title: 'asc', mid: 'asc', issue: 'desc', who: 'asc', age: 'desc', updated: 'desc' };

export function nextSort<K extends string>(cur: Sort<K> | null, key: K, first: Record<K, Dir>): Sort<K> {
  if (cur?.key === key) return { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: first[key] };
}

const text = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

const M_CMP: Record<MKey, (a: MerchantRow, b: MerchantRow) => number> = {
  sev: (a, b) => RANK[a.sev] - RANK[b.sev] || a.red - b.red || a.amber - b.amber,
  mid: (a, b) => text(a.mid, b.mid),
  open: (a, b) => a.openCount - b.openCount,
  age: (a, b) => (a.median ?? -1) - (b.median ?? -1),
  oldest: (a, b) => (a.oldest?.d ?? -1) - (b.oldest?.d ?? -1),
  attn: (a, b) => a.chips.length - b.chips.length || RANK[a.sev] - RANK[b.sev],
  court: (a, b) => a.court.us - b.court.us,
  activity: (a, b) => a.lastU - b.lastU,
};

const ST_ORDER: Record<St, number> = { todo: 0, started: 1, paused: 2, completed: 3, cancelled: 4 };
// Unassigned sorts after every name, in either direction.
const NOBODY = '￿';

const T_CMP: Record<TKey, (a: FTicket, b: FTicket) => number> = {
  status: (a, b) => ST_ORDER[a.st] - ST_ORDER[b.st],
  key: (a, b) => text(a.key, b.key),
  title: (a, b) => text(a.title, b.title),
  mid: (a, b) => text(a.midR[0] ?? '', b.midR[0] ?? ''),
  issue: (a, b) => RANK[a.sev] - RANK[b.sev] || a.flags.length - b.flags.length,
  who: (a, b) => text(a.who ?? NOBODY, b.who ?? NOBODY),
  age: (a, b) => a.d - b.d,
  updated: (a, b) => a.u - b.u,
};

function sortBy<T, K extends string>(rows: T[], s: Sort<K> | null, cmp: Record<K, (a: T, b: T) => number>): T[] {
  if (!s) return rows;
  const f = cmp[s.key];
  const sign = s.dir === 'asc' ? 1 : -1;
  // Array sort is stable, so ties keep the default order.
  return [...rows].sort((a, b) => sign * f(a, b));
}

export const sortMerchantRows = (rows: MerchantRow[], s: Sort<MKey> | null): MerchantRow[] => sortBy(rows, s, M_CMP);
export function sortTicketRows(rows: FTicket[], s: Sort<TKey> | null): FTicket[] {
  const sorted = sortBy(rows, s, T_CMP);
  // Closed tickets show "done" instead of an age, so they stay at the bottom in both directions.
  return s?.key === 'age' ? [...sorted.filter(t => t.open), ...sorted.filter(t => !t.open)] : sorted;
}
