/** How the merchant page's ticket list is sorted: one column, either way round (picked in the list's subtitle). */

export type SortCol = 'age' | 'priority' | 'updated';
export type SortDir = 'desc' | 'asc';

export interface Order {
  col: SortCol;
  /** 'desc' puts the biggest value first: oldest, highest priority, longest without an update. */
  dir: SortDir;
}

export const SORT_COLS: SortCol[] = ['age', 'priority', 'updated'];
export const DEFAULT_ORDER: Order = { col: 'age', dir: 'desc' };

/** Menu wording for each column and direction. */
export const ORDER_TEXT: Record<SortCol, Record<SortDir, string>> = {
  age: { desc: 'Oldest first', asc: 'Newest first' },
  priority: { desc: 'Highest priority first', asc: 'Lowest priority first' },
  updated: { desc: 'Least recently updated first', asc: 'Most recently updated first' },
};

const LEGACY: Record<string, Order> = {
  oldest: { col: 'age', dir: 'desc' },
  newest: { col: 'age', dir: 'asc' },
  priority: { col: 'priority', dir: 'desc' },
  stale: { col: 'updated', dir: 'desc' },
  recent: { col: 'updated', dir: 'asc' },
};

/** An order saved in the old two-key format ({ by, then }): keep its first key. */
export function fromLegacy(by: string): Order | null {
  return LEGACY[by] ?? null;
}
