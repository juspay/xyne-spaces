import axios from 'axios';
import { useCallback } from 'react';
import { toast } from 'sonner';
import { useParams } from 'react-router-dom-actual';
import type { NavigateFunction } from 'react-router-dom-actual';

import { API_BASE_URL, DEFAULT_WORKSPACE_ID } from '../config';
import { queryClient } from '../services/clients/queryClient';
import { confirmInterrupt } from '../components/InterruptGuard/InterruptGuard';
import { parseInternalXyneLink } from '../components/Chat/RenderMessageWithHTML/internalLinkUtils';
import { useWorkspaceNavigate } from './useWorkspaceNavigate';

export interface CrossWorkspaceNavigateOptions {
  href: string;
  currentWorkspaceId?: string | undefined;
  navigate: NavigateFunction;
}

const toInternalLocation = (href: string): string | null => {
  try {
    const url = new URL(href, window.location.origin);
    if (url.origin !== window.location.origin && !parseInternalXyneLink(href)) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
};

/** Navigate to an internal Spaces URL after switching the authenticated workspace when needed. */
export const crossWorkspaceNavigate = async ({
  href,
  currentWorkspaceId,
  navigate,
}: CrossWorkspaceNavigateOptions): Promise<void> => {
  const parsed = parseInternalXyneLink(href);
  const internalLocation = toInternalLocation(href);
  const targetWorkspaceId = parsed?.workspaceId;

  if (!internalLocation || !targetWorkspaceId || targetWorkspaceId === currentWorkspaceId) {
    // `NavigateFunction` is typed void but router.navigate returns a promise.
    if (internalLocation) void navigate(internalLocation);
    else window.location.href = href;
    return;
  }

  // Switching tears the session down and hard-reloads, so it has to ask first —
  // every other switch call site does (WorkspaceSwitcher, NotificationHandler,
  // SosAlertBanner). Without this, clicking a link mid-call or mid-recording
  // drops the recording with no prompt.
  if (!(await confirmInterrupt('workspaceSwitch'))) return;

  // Membership and token issuance remain server-authoritative. The hard reload
  // then initializes Zero against the same workspace as the URL.
  try {
    await axios.post(
      `${API_BASE_URL}/auth/switch-workspace`,
      { workspaceId: targetWorkspaceId },
      { withCredentials: true },
    );
  } catch (error) {
    // 403 is terminal: the server resolves membership from the session's own
    // verified email, so retrying can never succeed. Offering "try again" there
    // sends people round a loop that has no exit.
    const isForbidden = axios.isAxiosError(error) && error.response?.status === 403;
    toast.error(
      isForbidden
        ? "You don't have access to that workspace."
        : 'Failed to switch workspace. Please try again.',
    );
    throw error;
  }
  queryClient.clear();
  window.location.href = internalLocation;
};

export const useCrossWorkspaceNavigate = (): ((href: string) => Promise<void>) => {
  const { workspaceId: routeWorkspaceId } = useParams<{ workspaceId?: string }>();
  const navigate = useWorkspaceNavigate();
  const currentWorkspaceId = routeWorkspaceId || DEFAULT_WORKSPACE_ID || undefined;

  return useCallback(
    (href: string) => crossWorkspaceNavigate({ href, currentWorkspaceId, navigate }),
    [currentWorkspaceId, navigate],
  );
};
