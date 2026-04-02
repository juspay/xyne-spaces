import { useSyncExternalStore } from 'react';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import type { DrawState, DrawTool } from '../stores/drawStore';
import { drawStore as _rawStore } from '../stores/drawStore';

export type DrawStoreEvent =
  | { type: 'toggleDrawMode' }
  | { type: 'disableDrawMode' }
  | { type: 'setColor'; color: string }
  | { type: 'setStrokeWidth'; width: number }
  | { type: 'setTool'; tool: DrawTool };

interface DrawStoreSnapshot {
  status: 'active';
  context: DrawState;
  output: undefined;
  error: undefined;
}

interface TypedDrawStore {
  subscribe: (cb: () => void) => { unsubscribe: () => void };
  getSnapshot: () => DrawStoreSnapshot;
  send: (event: DrawStoreEvent) => void;
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const store = _rawStore as unknown as TypedDrawStore;

export function useDrawStore<T>(selector: (ctx: DrawState) => T): T {
  return useSyncExternalStore(
    (cb): (() => void) => {
      const sub = store.subscribe(cb);
      return (): void => sub.unsubscribe();
    },
    (): T => selector(store.getSnapshot().context),
  );
}

export function sendDrawEvent(event: DrawStoreEvent): void {
  store.send(event);
}
