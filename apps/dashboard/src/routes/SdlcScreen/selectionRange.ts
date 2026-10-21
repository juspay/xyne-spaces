/**
 * Ticks or unticks one row of a list, or a run of them.
 *
 * Extending does to every row from the anchor — the last one ticked or unticked —
 * to this one what is being done to this one: ticking it ticks the run, unticking
 * it unticks the run. Runs ticked before, anywhere else in the list, stay as they
 * were, so a selection can be several runs. Without an anchor still in the list
 * there is no run to make, and only this row changes.
 */
export function toggleSelection(
  selected: ReadonlySet<string>,
  order: readonly string[],
  id: string,
  anchorId: string | null,
  extend: boolean,
): Set<string> {
  const next = new Set(selected);
  const select = !selected.has(id);
  const index = order.indexOf(id);
  const anchorIndex = anchorId === null ? -1 : order.indexOf(anchorId);
  const run =
    extend && index !== -1 && anchorIndex !== -1
      ? order.slice(Math.min(index, anchorIndex), Math.max(index, anchorIndex) + 1)
      : [id];
  for (const item of run) {
    if (select) next.add(item);
    else next.delete(item);
  }
  return next;
}
