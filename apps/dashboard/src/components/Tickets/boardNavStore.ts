import { useSyncExternalStore } from 'react';
import type { KanbanTicketsPageBaseArgs } from '../../routes/KanbanBoardScreen/useKanbanTicketsPage';

export interface BoardNavState {
  channelId: string | null;
  baseArgs: KanbanTicketsPageBaseArgs | null;
  columnType: 'stage' | 'status';
}

let state: BoardNavState = { channelId: null, baseArgs: null, columnType: 'stage' };
const listeners = new Set<() => void>();

export const setBoardNavParams = (next: BoardNavState): void => {
  state = next;
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = (): BoardNavState => state;

export const useBoardNavParams = (): BoardNavState | null => {
  const current = useSyncExternalStore(subscribe, getSnapshot);
  return current.baseArgs ? current : null;
};
