import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import axios from 'axios';
import { API_BASE_URL, isSdlcSurface } from '../config';
import { UNREAD_REFETCH_EVENT_NAME } from '@xyne/shared';
import { useIsInPanelWebview } from './useIsInPanelWebview';
import { logger, Event as LogEvent } from '../utils/logger';

/**
 * How often the poll refreshes counts (ms). Rails are Zero-synced (live); this
 * hook only feeds the workspace switcher and the dock badge.
 */
const POLL_INTERVAL_MS = 30_000;

interface WorkspaceCountItem {
  workspaceId: string;
  count: number;
}

interface WorkspaceCountsResponse {
  counts: WorkspaceCountItem[];
}

export interface WorkspaceUnreadCounts {
  /** workspaceId -> unread count (dm + bell + call) */
  byWorkspace: Record<string, number>;
  /** Sum over all workspaces — the dock badge value. */
  totalAllWorkspaces: number;
  /** Force an immediate poll refresh. */
  refetch: () => Promise<void>;
}

const WorkspaceUnreadCountsContext = createContext<WorkspaceUnreadCounts | undefined>(undefined);

const emptyCounts: WorkspaceUnreadCounts = {
  byWorkspace: {},
  totalAllWorkspaces: 0,
  refetch: async () => {},
};

/**
 * Single poller for `GET /activity/workspace-counts`.
 *
 * Mounted once at the app root (WorkspaceUnreadCountsProvider); consumers
 * subscribe via {@link useWorkspaceUnreadCounts}. Only the workspace switcher
 * and the dock badge consume it — rail badges are Zero-synced by design.
 *
 * Refreshes: mount, 30s interval, tab becoming visible, and the
 * `unread:refetch` window event (fired after read mutations). visibilitychange
 * alone covers both tab switches and app switches; listening to window focus
 * as well would double-fire on returning to the app.
 */
export const WorkspaceUnreadCountsProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [byWorkspace, setByWorkspace] = useState<Record<string, number>>({});
  // Sequence guard — a slow in-flight response must not overwrite a newer one.
  const seq = useRef(0);

  // Embedded documents (in-app browser panel webviews, the SDLC lane) render
  // neither the sidebar nor the dock badge — polling from every one of them
  // would multiply server load for no visible badge. Only the main window polls.
  const isInPanelWebview = useIsInPanelWebview();
  const shouldPoll = !isInPanelWebview && !isSdlcSurface;

  const fetchCounts = useCallback(async (): Promise<void> => {
    const requestId = ++seq.current;
    try {
      const res = await axios.get<WorkspaceCountsResponse>(
        `${API_BASE_URL}/activity/workspace-counts`,
        { withCredentials: true },
      );
      if (requestId !== seq.current) return; // superseded
      const next: Record<string, number> = {};
      for (const item of res.data.counts) {
        next[item.workspaceId] = item.count;
      }
      setByWorkspace(next);
    } catch (error) {
      // Keep the last good counts and retry on the next poll, but log at warn:
      // at debug level a failing endpoint (e.g. a 500) left the badges frozen
      // with nothing in the console to explain why.
      logger.warn(LogEvent.FRONTEND_ERROR, {
        type: 'workspace_unread_counts_poll_failed',
        status: axios.isAxiosError(error) ? error.response?.status : undefined,
      });
    }
  }, []);

  useEffect(() => {
    if (!shouldPoll) return;

    void fetchCounts();

    const interval = setInterval(() => {
      void fetchCounts();
    }, POLL_INTERVAL_MS);

    const refreshWhenVisible = (): void => {
      if (document.visibilityState === 'visible') void fetchCounts();
    };
    document.addEventListener('visibilitychange', refreshWhenVisible);

    const onRefetchEvent = (): void => void fetchCounts();
    window.addEventListener(UNREAD_REFETCH_EVENT_NAME, onRefetchEvent);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.removeEventListener(UNREAD_REFETCH_EVENT_NAME, onRefetchEvent);
    };
  }, [fetchCounts, shouldPoll]);

  const value = useMemo<WorkspaceUnreadCounts>(() => {
    let total = 0;
    for (const count of Object.values(byWorkspace)) {
      total += count > 0 ? count : 0;
    }
    return { byWorkspace, totalAllWorkspaces: total, refetch: fetchCounts };
  }, [byWorkspace, fetchCounts]);

  return (
    <WorkspaceUnreadCountsContext.Provider value={value}>
      {children}
    </WorkspaceUnreadCountsContext.Provider>
  );
};

export const useWorkspaceUnreadCounts = (): WorkspaceUnreadCounts => {
  const context = useContext(WorkspaceUnreadCountsContext);
  if (context === undefined) {
    // Allowed fallback so components render (without counts) when mounted
    // outside the provider — same convention as useTypingState.
    return emptyCounts;
  }
  return context;
};
