import { useEffect } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { usePlatform } from '../../hooks/usePlatform';
import { xyneAIActor } from '../../machines/xyneAIMachine';
import { isAIOnboardingActive, isAIOnboardingPending } from '../../contexts/AIOnboardingContext';
import { useOrganisationsAccess } from '../../routes/OrganisationsModule/organisationsSections';
import { AREAS } from '../Assistant/catalog';
import { visibleActions } from '../Assistant/pages';

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
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const { pathname } = useLocation();
  const { isMobile } = usePlatform();
  const organisations = useOrganisationsAccess();
  const hasActions = visibleActions(AREAS, { organisations }).length > 0;
  const userId = user?.id;

  useEffect(() => {
    if (isOnboarding || isMobile || !isChatRoute(pathname) || !userId || !workspaceId) return;
    if (!hasActions || hasSeenPanel(userId, workspaceId)) return;
    try {
      if (isAIOnboardingActive() || isAIOnboardingPending()) return;
    } catch {
      return;
    }
    xyneAIActor.send({ type: 'OPEN', trackSource: 'setup', startFreshChat: true });
    // OPEN is ignored while a modal holds the panel closed; stay unseen and retry on the next page.
    if (xyneAIActor.getSnapshot().matches('open')) markPanelSeen(userId, workspaceId);
  }, [isOnboarding, isMobile, pathname, userId, workspaceId, hasActions]);

  return null;
};
