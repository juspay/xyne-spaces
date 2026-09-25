import { useEffect } from 'react';
import { useAllUnreadCount } from './useUnreadCount';
import { useWorkspaceUnreadCounts } from './useWorkspaceUnreadCounts';
import { DOCK_BADGE_POLL_SOURCE } from '../config';

/**
 * Syncs the total unread count to the native desktop app-icon badge (macOS
 * Dock badge / Windows taskbar overlay) when running inside the Electron
 * desktop app.
 *
 * Two sources, selected by the DOCK_BADGE_POLL_SOURCE flag:
 *
 * - Flag on (default): `useWorkspaceUnreadCounts` — the cross-workspace poll
 *   (GET /activity/workspace-counts). The badge reflects the unread badge
 *   invariant (dm + bell + call summed over every workspace the member
 *   belongs to), matching the workspace switcher exactly. Updates on the
 *   30s poll, tab-visible, and the unread:refetch event fired after read
 *   mutations.
 * - Flag off (legacy, rollback): `useAllUnreadCount` — the Zero-synced
 *   per-channel counts of the active workspace only, summed.
 *
 * This is a no-op in the browser and in SSR: `window.electronAPI.setBadgeCount`
 * is only exposed by the Electron main preload (`electron/src/preload.ts`),
 * which forwards to `app.setBadgeCount()` in the main process
 * (`electron/src/ipc/handlers.ts`). Passing `0` clears the badge.
 */
export const useElectronBadge = (): void => {
  const unreadCounts = useAllUnreadCount();
  const { totalAllWorkspaces } = useWorkspaceUnreadCounts();

  useEffect(() => {
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (!api || typeof api.setBadgeCount !== 'function') {
      return;
    }

    let total: number;
    if (DOCK_BADGE_POLL_SOURCE) {
      total = totalAllWorkspaces;
    } else {
      total = Object.values(unreadCounts).reduce((sum, count) => sum + (count > 0 ? count : 0), 0);
    }

    api.setBadgeCount(total);
  }, [unreadCounts, totalAllWorkspaces]);
};
