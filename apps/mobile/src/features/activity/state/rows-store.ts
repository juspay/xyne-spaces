import { batch, observable, type Observable } from '@legendapp/state';

import type { ActivityRowData } from '../model/row';

type ActivityRowsStore = {
  /** Activity ids in display order. The only thing the list itself renders. */
  order: string[];
  /** Row data, keyed by activity id. One subscribable node per row. */
  byId: Record<string, ActivityRowData>;
  /** Which workspace the rows describe. */
  scope: string | null;
};

/**
 * The feed, as two independently observable halves — the same split the DMs
 * list makes, for the same reason: marking one activity read changes that
 * row's tint and nothing else. Not the list, not its neighbours.
 */
const activityRows$ = observable<ActivityRowsStore>({
  order: [],
  byId: {},
  scope: null,
});

export const activityRowOrder$ = activityRows$.order;

/**
 * The node for one activity. A Legend State node exists for any key whether or
 * not a value was written, so the assertion narrows a typing artifact of
 * `noUncheckedIndexedAccess`, not a real case.
 */
export function activityRow$(id: string): Observable<ActivityRowData> {
  return activityRows$.byId[id]!;
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Pushes a freshly derived feed into the store, writing only what moved.
 *
 * One batch, so a sync that touches thirty rows notifies once.
 */
export function syncActivityRows(rows: readonly ActivityRowData[], scope: string | null): void {
  batch(() => {
    if (activityRows$.scope.peek() !== scope) {
      activityRows$.byId.set({});
      activityRows$.order.set([]);
      activityRows$.scope.set(scope);
    }

    const nextOrder: string[] = [];
    const present = new Set<string>();

    for (const row of rows) {
      nextOrder.push(row.id);
      present.add(row.id);
      const node$ = activityRow$(row.id);
      // Rows are cached by source activity, so an unchanged one is the same
      // object and the identity check is the whole comparison.
      if (node$.peek() !== row) node$.set(row);
    }

    // Activities that left the filter. Left in place they would hold their
    // data alive for the life of the process.
    for (const id of Object.keys(activityRows$.byId.peek())) {
      if (!present.has(id)) activityRow$(id).delete();
    }

    if (!sameOrder(activityRows$.order.peek(), nextOrder)) {
      activityRows$.order.set(nextOrder);
    }
  });
}
