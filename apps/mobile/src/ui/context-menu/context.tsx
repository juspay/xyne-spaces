import { createContext, useContext } from 'react';

import type { MenuAnchor } from './placement';

export type ContextMenuState = {
  isOpen: boolean;
  /** Where the trigger was when it opened. `null` until it has measured. */
  anchor: MenuAnchor | null;
  open: (anchor: MenuAnchor) => void;
  close: () => void;
};

const ContextMenuStateContext = createContext<ContextMenuState | null>(null);

export const ContextMenuProvider = ContextMenuStateContext.Provider;

export function useContextMenuState(component: string): ContextMenuState {
  const state = useContext(ContextMenuStateContext);
  if (state === null) {
    throw new Error(`${component} must be rendered inside <ContextMenu.Root>`);
  }
  return state;
}
