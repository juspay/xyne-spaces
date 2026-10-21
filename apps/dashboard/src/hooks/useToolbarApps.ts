import { useMemo } from 'react';
import {
  toolbarItemsStore,
  setAppSnapshot,
  appItemId,
  isAppItemId,
  MAX_APPS_PER_BAR,
} from './barItems';

export interface ToolbarAppInput {
  id: string;
  title: string;
  icon?: string | null;
}

/**
 * "Pin to sidebar" from the Apps tab, expressed over the toolbar list: a pinned
 * app is simply a toolbar member with an `app:` id, sorted with everything else
 * the user put in the rail.
 */
export const useToolbarApps = (): {
  isPinned: (appId: string) => boolean;
  pinApp: (app: ToolbarAppInput) => void;
  unpinApp: (appId: string) => void;
  togglePin: (app: ToolbarAppInput) => void;
  /** The rail already holds MAX_APPS_PER_BAR apps. */
  isFull: boolean;
} => {
  const items = toolbarItemsStore.useItems();
  const appCount = useMemo(() => items.filter(isAppItemId).length, [items]);

  // Reads the subscribed snapshot, so render-time calls stay reactive.
  const isPinned = (appId: string): boolean => items.includes(appItemId(appId));

  const pinApp = (app: ToolbarAppInput): void => {
    if (isPinned(app.id)) return;
    if (toolbarItemsStore.get().filter(isAppItemId).length >= MAX_APPS_PER_BAR) return;
    setAppSnapshot(app.id, { title: app.title, icon: app.icon ?? null });
    toolbarItemsStore.add(appItemId(app.id));
  };

  const unpinApp = (appId: string): void => toolbarItemsStore.remove(appItemId(appId));

  const togglePin = (app: ToolbarAppInput): void => {
    if (isPinned(app.id)) unpinApp(app.id);
    else pinApp(app);
  };

  return { isPinned, pinApp, unpinApp, togglePin, isFull: appCount >= MAX_APPS_PER_BAR };
};
