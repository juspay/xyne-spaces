import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { usePlatform } from '../../hooks/usePlatform';
import { xyneAIActor } from '../../machines/xyneAIMachine';
import { clearJustOnboarded, hasJustOnboarded } from '../Assistant/newUser';

// Channels and DMs, with or without the workspace prefix; not the full-screen /ai chat.
const isChatRoute = (pathname: string): boolean =>
  /(^|\/)chat(\/|$)/.test(pathname) && !/\/ai\/chat(\/|$)/.test(pathname);

export const AssistantPanelTrigger = (): null => {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const { isMobile } = usePlatform();
  const userId = user?.id;

  useEffect(() => {
    if (!userId || isMobile || !isChatRoute(pathname)) return;
    if (!hasJustOnboarded(userId)) return;
    xyneAIActor.send({ type: 'OPEN', trackSource: 'setup', startFreshChat: true });
    // OPEN is ignored while a modal holds the panel closed; keep the mark and retry on the next page.
    if (xyneAIActor.getSnapshot().matches('open')) clearJustOnboarded(userId);
  }, [userId, isMobile, pathname]);

  return null;
};
