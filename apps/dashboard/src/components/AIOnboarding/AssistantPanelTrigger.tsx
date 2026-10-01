import { useEffect } from 'react';
import { WorkspaceRole } from '@xyne/shared';
import { useLocation, useParams } from 'react-router-dom';
import { usePlatform } from '../../hooks/usePlatform';
import { useAuth } from '../../hooks/useAuth';
import { xyneAIActor } from '../../machines/xyneAIMachine';
import { useIsNewUser } from '../Assistant/newUser';

const panelSeenKey = (userId: string, workspaceId: string): string =>
  `xyne-setup-panel-seen:${userId}:${workspaceId}`;

// True when storage throws, so the panel can never open on every load.
const hasSeenPanel = (userId: string, workspaceId: string): boolean => {
  try {
    return localStorage.getItem(panelSeenKey(userId, workspaceId)) !== null;
  } catch {
    return true;
  }
};

const markPanelSeen = (userId: string, workspaceId: string): void => {
  try {
    localStorage.setItem(panelSeenKey(userId, workspaceId), 'true');
  } catch {
    // Already treated as seen when storage is unavailable.
  }
};

// Channels and DMs, with or without the workspace prefix; not the full-screen /ai chat.
const isChatRoute = (pathname: string): boolean =>
  /(^|\/)chat(\/|$)/.test(pathname) && !/\/ai\/chat(\/|$)/.test(pathname);

export const AssistantPanelTrigger = ({ isOnboarding }: { isOnboarding: boolean }): null => {
  const { user } = useAuth();
  const isNewUser = useIsNewUser();
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const { pathname } = useLocation();
  const { isMobile } = usePlatform();
  const userId = user?.id;
  const isGuest = user?.role === WorkspaceRole.GUEST;

  useEffect(() => {
    if (!isNewUser || isGuest || isOnboarding || isMobile || !userId || !workspaceId) return;
    if (!isChatRoute(pathname) || hasSeenPanel(userId, workspaceId)) return;
    xyneAIActor.send({ type: 'OPEN', trackSource: 'setup', startFreshChat: true });
    // OPEN is ignored while a modal holds the panel closed; stay unseen and retry on the next page.
    if (xyneAIActor.getSnapshot().matches('open')) markPanelSeen(userId, workspaceId);
  }, [isNewUser, isGuest, isOnboarding, isMobile, pathname, userId, workspaceId]);

  return null;
};
