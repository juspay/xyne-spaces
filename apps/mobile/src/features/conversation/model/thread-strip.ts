import { formatShortRelative } from './relative-time';

export function replyCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'reply' : 'replies'}`;
}

/**
 * The people shown on a strip: the most recent repliers, oldest of them first,
 * each person once. Replier ids arrive oldest first with repeats.
 */
export function stripRepliers(replierIds: readonly string[], max: number): string[] {
  const seen = new Set<string>();
  const latestFirst: string[] = [];
  for (let index = replierIds.length - 1; index >= 0; index -= 1) {
    const id = replierIds[index];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    latestFirst.push(id);
    if (latestFirst.length === max) break;
  }
  return latestFirst.reverse();
}

/** When the thread last moved, as a short relative time ("10m ago"); empty without one. */
export function stripTime(lastActivityAt: number | undefined, nowMs: number): string {
  return lastActivityAt ? formatShortRelative(lastActivityAt, nowMs) : '';
}
