import { useMemo } from 'react';
import { toolbarItemsStore } from './barItems';

/**
 * Membership view of the toolbar list, kept for callers that only ask "is this
 * path in the rail?". Order and app entries live in `toolbarItemsStore`.
 */
export const useToolbarItems = (): {
  toolbarPaths: Set<string>;
  setInToolbar: (path: string, inToolbar: boolean) => void;
} => {
  const items = toolbarItemsStore.useItems();
  // The store hands back the same array until localStorage changes, so this
  // Set is stable too — callers can put it in hook deps.
  const toolbarPaths = useMemo(() => new Set(items), [items]);
  return {
    toolbarPaths,
    setInToolbar: (path, inToolbar) => {
      if (inToolbar) toolbarItemsStore.add(path);
      else toolbarItemsStore.remove(path);
    },
  };
};
