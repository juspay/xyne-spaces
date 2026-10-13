import { useEffect } from 'react';
import { useUnreadActivitiesCount } from './useUnreadActivitiesCount';

/**
 * Syncs the unread count to the native desktop app-icon badge (macOS Dock
 * badge / Windows taskbar overlay) when running inside the Electron desktop app.
 *
 * The count comes from {@link useUnreadActivitiesCount}, the same hook that
 * drives the sidebar Activity bell and the active workspace badge in the
 * WorkspaceSwitcher. All three read the Zero-synced `unreadActivities` list
 * through `isAllVisibleActivity`, so the dock badge rises and clears in the
 * same render as the in-app badges.
 *
 * This is a no-op in the browser and in SSR: `window.electronAPI.setBadgeCount`
 * is only exposed by the Electron main preload (`electron/src/preload.ts`),
 * which forwards to `app.setBadgeCount()` in the main process
 * (`electron/src/ipc/handlers.ts`). Passing `0` clears the badge.
 *
 * NOTE (known limitation / follow-up): the count reflects the *currently active
 * workspace* only, matching the Activity bell. Cross-workspace aggregation
 * would need `GET /activity/workspace-counts` (see WorkspaceSwitcher) to apply
 * the same visibility predicate first, so it is intentionally left out.
 */
export const useElectronBadge = (): void => {
  const unreadCount = useUnreadActivitiesCount();

  useEffect(() => {
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (!api || typeof api.setBadgeCount !== 'function') {
      return;
    }

    api.setBadgeCount(unreadCount);
  }, [unreadCount]);
};
