import { useEffect } from 'react';
import { useAllUnreadCount } from './useUnreadCount';

/**
 * Syncs the total unread message count to the native desktop app-icon badge
 * (macOS Dock badge / Windows taskbar overlay) when running inside the Electron
 * desktop app.
 *
 * The unread source of truth is {@link useAllUnreadCount}, the same hook that
 * drives the in-app sidebar badges and the Unreads Inbox, so the dock badge
 * always matches what the user sees inside the app. The total is the sum of the
 * per-channel unread counts (channels + DMs/GROUP_DMs) for the active
 * workspace.
 *
 * This is a no-op in the browser and in SSR: `window.electronAPI.setBadgeCount`
 * is only exposed by the Electron main preload (`electron/src/preload.ts`),
 * which forwards to `app.setBadgeCount()` in the main process
 * (`electron/src/ipc/handlers.ts`). Passing `0` clears the badge.
 *
 * NOTE (known limitation / follow-up): the count reflects the *currently active
 * workspace* only, because `useAllUnreadCount` reads from the per-workspace
 * state machine. Cross-workspace aggregation would require polling
 * `GET /activity/workspace-counts` (see WorkspaceSwitcher) and is intentionally
 * left out of this first version to keep the change scoped and network-free.
 */
export const useElectronBadge = (): void => {
  const unreadCounts = useAllUnreadCount();

  useEffect(() => {
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (!api || typeof api.setBadgeCount !== 'function') {
      return;
    }

    const total = Object.values(unreadCounts).reduce(
      (sum, count) => sum + (count > 0 ? count : 0),
      0,
    );

    api.setBadgeCount(total);
  }, [unreadCounts]);
};
