/**
 * Deletion events for suggestion anchors.
 *
 * When a block that a pending suggestion is anchored to gets deleted, the
 * anchor must be forwarded to the deleted block's predecessor. The live
 * document cannot answer "what preceded X" once X is gone, so whoever still
 * sees the pre-delete order computes it: the browser editor for human edits,
 * the backend accept path for its own deletes. Both use this one function.
 */

export interface BlockDeletionEvent {
  deletedId: string;
  /** Nearest EARLIER block that survived the same change; null = top of document. */
  previousAliveId: string | null;
}

export function computeDeletionEvents(prevIds: string[], nowIds: string[]): BlockDeletionEvent[] {
  const nowSet = new Set(nowIds);
  const events: BlockDeletionEvent[] = [];
  for (let i = 0; i < prevIds.length; i++) {
    const id = prevIds[i] as string;
    if (nowSet.has(id)) continue;
    // Walk back past blocks that died in the same change.
    let j = i - 1;
    while (j >= 0 && !nowSet.has(prevIds[j] as string)) j--;
    events.push({ deletedId: id, previousAliveId: j >= 0 ? (prevIds[j] as string) : null });
  }
  return events;
}
