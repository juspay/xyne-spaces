import axios from 'axios';
import { useCallback } from 'react';
import { toast } from 'sonner';
import { useParams } from 'react-router-dom-actual';
import type { NavigateFunction } from 'react-router-dom-actual';

import { API_BASE_URL, DEFAULT_WORKSPACE_ID } from '../config';
import { queryClient } from '../services/clients/queryClient';
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
    if (internalLocation) navigate(internalLocation);
    else window.location.href = href;
    return;
  }

  // Membership and token issuance remain server-authoritative. The hard reload
  // then initializes Zero against the same workspace as the URL.
  try {
    await axios.post(
      `${API_BASE_URL}/auth/switch-workspace`,
      { workspaceId: targetWorkspaceId },
      { withCredentials: true },
    );
  } catch (error) {
    toast.error('Failed to switch workspace. Please try again.');
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
