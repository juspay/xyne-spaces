/**
 * Position resolution for inserted blocks — PURE, no imports beyond types,
 * so it tests without booting config (the same lesson applyBlockChanges
 * learned: a logger import here would demand JWT_SECRET in unit tests).
 */

export interface InsertSlot {
  rowId: string;
  basePos: number;
  orderIndex: number;
}

/**
 * Where should this insertion land in the document AS IT IS NOW?
 *
 * Build the VIRTUAL SEQUENCE — the document as it would look if every insert
 * were accepted: each base block (frozen order from the suggestion's
 * baseBlockIds) followed by the inserts anchored at its position, in
 * orderIndex order. Then walk backwards from this insert's own slot and land
 * after the first element actually alive in the current document.
 *
 * This resolves every case a stored pointer cannot: anchors deleted by the
 * agent OR by a human in the editor, whole runs deleted, siblings accepted in
 * any order, and an insert whose intended spot sat between a sibling and a
 * now-deleted block. Covered by 11 cases in applySuggestion.test.ts.
 *
 * Returns the id to insert after, or null to prepend.
 */
export function resolveVirtualAnchor(
  baseOrder: string[],
  insert: InsertSlot,
  currentBlockIds: Set<string>,
  siblings: InsertSlot[]
): string | null {
  const virtual: string[] = [];
  const byPos = new Map<number, InsertSlot[]>();
  for (const slot of [...siblings, insert]) {
    const list = byPos.get(slot.basePos) ?? [];
    list.push(slot);
    byPos.set(slot.basePos, list);
  }
  const pushInserts = (pos: number): void => {
    for (const slot of (byPos.get(pos) ?? []).sort((a, b) => a.orderIndex - b.orderIndex)) {
      virtual.push(slot.rowId);
    }
  };
  pushInserts(-1);
  baseOrder.forEach((id, i) => {
    virtual.push(id);
    pushInserts(i);
  });

  const self = virtual.indexOf(insert.rowId);
  for (let i = self - 1; i >= 0; i--) {
    if (currentBlockIds.has(virtual[i] as string)) return virtual[i] as string;
  }
  return null;
}
