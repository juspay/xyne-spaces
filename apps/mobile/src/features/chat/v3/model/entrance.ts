import type { ChatRow } from './chatRow.types';

/** Duration the row stays `isEntering` so the animation can finish once. */
export const ENTRANCE_FLUSH_MS = 300;

export type EntranceState = {
  revealed: boolean;
  lastMessageId: string | null;
  seen: ReadonlySet<string>;
  pending: ReadonlySet<string>;
};

export const EMPTY_ENTRANCE: EntranceState = {
  revealed: false,
  lastMessageId: null,
  seen: new Set(),
  pending: new Set(),
};

const lastId = (ids: readonly string[]): string | null => ids[ids.length - 1] ?? null;

const sameSet = (left: ReadonlySet<string>, right: ReadonlySet<string>): boolean => {
  if (left.size !== right.size) {
    return false;
  }
  for (const id of left) {
    if (!right.has(id)) {
      return false;
    }
  }
  return true;
};

/** First paint: mark every current message seen so open/unread landing does not animate. */
export const seedEntrance = (messageIds: readonly string[]): EntranceState => ({
  revealed: true,
  lastMessageId: lastId(messageIds),
  seen: new Set(messageIds),
  pending: new Set(),
});

/**
 * After reveal, only ids appended after the previously known tail enter.
 * Prepends (load older) and window replacements are marked seen, never pending.
 */
export const trackEntrance = (
  state: EntranceState,
  messageIds: readonly string[],
): EntranceState => {
  if (!state.revealed) {
    return state;
  }
  const previousTailIndex = state.lastMessageId ? messageIds.indexOf(state.lastMessageId) : -1;
  if (previousTailIndex < 0) {
    const seeded = seedEntrance(messageIds);
    const unchanged =
      sameSet(state.seen, seeded.seen) &&
      state.pending.size === 0 &&
      state.lastMessageId === seeded.lastMessageId;
    return unchanged ? state : seeded;
  }

  const seen = new Set(state.seen);
  const pending = new Set(state.pending);
  let lastMessageId = state.lastMessageId;
  for (let index = 0; index < messageIds.length; index += 1) {
    const id = messageIds[index];
    if (id === undefined) {
      continue;
    }
    if (index <= previousTailIndex) {
      seen.add(id);
    } else if (!seen.has(id) && !pending.has(id)) {
      pending.add(id);
    }
    lastMessageId = id;
  }

  if (
    lastMessageId === state.lastMessageId &&
    sameSet(seen, state.seen) &&
    sameSet(pending, state.pending)
  ) {
    return state;
  }
  return { revealed: true, lastMessageId, seen, pending };
};

/** After the entrance has played, pending ids become seen so they never replay. */
export const flushEntrance = (state: EntranceState): EntranceState => {
  if (state.pending.size === 0) {
    return state;
  }
  const seen = new Set(state.seen);
  for (const id of state.pending) {
    seen.add(id);
  }
  return { ...state, seen, pending: new Set() };
};

export const messageIdsFromRows = (rows: readonly ChatRow[]): string[] =>
  rows.filter(row => row.type === 'message').map(row => row.model.conversationId);
