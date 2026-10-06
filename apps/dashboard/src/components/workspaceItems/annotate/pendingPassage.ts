import type { PassageSelection } from './selectionSink';

let pending: PassageSelection | null = null;

/**
 * A passage waiting to ride along with the next turn. The run carries it as a
 * structured selection rather than pasted prose, so the agent is told which
 * page it came from and whether it was picked to ask about or to change.
 */
export function publishPendingPassage(passage: PassageSelection | null): void {
  pending = passage;
}

/** Read and clear: a passage belongs to one turn, not to the whole thread. */
export function consumePendingPassage(): PassageSelection | null {
  const passage = pending;
  pending = null;
  return passage;
}
