import { batch, observable, type Observable } from '@legendapp/state';

import type { DmListItemData } from '@/src/types/dm-list-item';

type DmRowsStore = {
  /** Channel ids in display order. The only thing the list itself
   * renders.
   */
  order: string[];
  /** Row data, keyed by channel id. One subscribable node per row. */
  byId: Record<string, DmListItemData>;
  /**
   * Which workspace `byId` describes. A switch must not leave the
   * previous workspace's conversations on screen for the frame before
   * first sync.
   */
  scope: string | null;
};

/**
 * The DM list, as two independently observable halves.
 *
 * Keyed by id rather than held as an observable array on purpose. An
 * array's nodes are addressed by index, so a conversation moving from
 * position 3 to 0 would notify every node it passed. Keyed, a reorder
 * writes `order` and nothing else - the rows do not hear about it at
 * all.
 *
 * What that buys, concretely: a read receipt changes one row's
 * `unreadCount`, which re-renders that row's badge. Not the row. Not
 * the list.
 */
const dmRows$ = observable<DmRowsStore>({
  order: [],
  byId: {},
  scope: null,
});

export const dmRowOrder$ = dmRows$.order;

/**
 * The node for one conversation.
 *
 * `noUncheckedIndexedAccess` types a record index as possibly `undefined`, but
 * a Legend State node is a proxy: a child node exists for any key whether or
 * not a value was ever written, and writing through it is how the key comes
 * into being. The node is never absent — only its value, which every reader
 * already sees as `DmListItemData | undefined` through `.get()`.
 */
export function dmRow$(id: string): Observable<DmListItemData> {
  return dmRows$.byId[id]!;
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }

  return true;
}

/**
 * Pushes a freshly derived list into the store, writing only what
 * moved.
 *
 * `useDmList` returns reference-stable rows (see `reconcileDmRow`), so
 * an unchanged conversation fails to identify check here and is never
 * written.
 * Legend State diffs on `set` as well, so a cache miss upstream costs a
 * comparison rather than a render - the reference check is a
 * optimisation, not a correctness requirement.
 *
 * One batch, so a sync that touches thirty rows notifies once.
 */

export function syncDmRows(items: readonly DmListItemData[], scope: string | null): void {
  batch(() => {
    if (dmRows$.scope.peek() !== scope) {
      dmRows$.byId.set({});
      dmRows$.order.set([]);
      dmRows$.scope.set(scope);
    }

    const nextOrder: string[] = [];
    const nextIds = new Set<string>();

    for (const item of items) {
      nextOrder.push(item.id);
      nextIds.add(item.id);
      const node$ = dmRow$(item.id);
      if (node$.peek() !== item) {
        node$.set(item);
      }
    }

    /**
     * Conversations that left the current filter or the workspace.
     * Left in place they would hold their row data alive for the life
     * of the process.
     */
    for (const id of Object.keys(dmRows$.byId.peek())) {
      if (!nextIds.has(id)) dmRow$(id).delete();
    }

    if (!sameOrder(dmRows$.order.peek(), nextOrder)) {
      dmRows$.order.set(nextOrder);
    }
  });
}
