export interface TabState {
  openIds: string[];
  activeId: string | null;
}

export const EMPTY_TABS: TabState = { openIds: [], activeId: null };

const MAX_TABS = 12;

export function openTab(state: TabState, id: string): TabState {
  if (!id) return state;
  if (state.openIds.includes(id)) {
    return state.activeId === id ? state : { ...state, activeId: id };
  }
  const openIds = [...state.openIds, id].slice(-MAX_TABS);
  return { openIds, activeId: id };
}

export function closeTab(state: TabState, id: string): TabState {
  const index = state.openIds.indexOf(id);
  if (index === -1) return state;

  const openIds = state.openIds.filter(open => open !== id);
  if (state.activeId !== id) return { openIds, activeId: state.activeId };

  const next = openIds[index] ?? openIds[index - 1] ?? null;
  return { openIds, activeId: next };
}

export function activateTab(state: TabState, id: string): TabState {
  if (!state.openIds.includes(id) || state.activeId === id) return state;
  return { ...state, activeId: id };
}

/**
 * Drops tabs whose item has gone, keeping the active one if it survived. A tab
 * is kept while its row has simply not arrived yet, so a just-created item does
 * not flicker out of the strip.
 */
export function pruneTabs(
  state: TabState,
  knownIds: readonly string[],
  pending: readonly string[] = [],
): TabState {
  const known = new Set([...knownIds, ...pending]);
  const openIds = state.openIds.filter(id => known.has(id));
  if (openIds.length === state.openIds.length) return state;

  const activeId =
    state.activeId && openIds.includes(state.activeId)
      ? state.activeId
      : (openIds[openIds.length - 1] ?? null);
  return { openIds, activeId };
}

export function moveTab(state: TabState, id: string, toIndex: number): TabState {
  const from = state.openIds.indexOf(id);
  if (from === -1) return state;
  const bounded = Math.max(0, Math.min(toIndex, state.openIds.length - 1));
  if (bounded === from) return state;

  const openIds = [...state.openIds];
  openIds.splice(from, 1);
  openIds.splice(bounded, 0, id);
  return { ...state, openIds };
}
