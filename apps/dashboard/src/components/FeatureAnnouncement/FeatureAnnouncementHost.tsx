import { ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { useSelector } from '@xstate/react';
import { callActor } from '../../machines/callMachine';
import { isStandaloneWindow } from '../../utils/electronApp';
import { useIsInPanelWebview } from '../../hooks/useIsInPanelWebview';
import { useFeatureAnnouncements } from '../../hooks/useFeatureAnnouncements';
import { FeatureAnnouncementCard } from './FeatureAnnouncementCard';
import { isAnnouncementRoute } from './announcementRoutes';

/**
 * Dashboard-only kill switch. While false the host is inert — no fetch, no listener,
 * nothing rendered — so the surface can be pulled without an Electron release.
 */
const FEATURE_ANNOUNCEMENTS_ENABLED = true;

/**
 * Anchors the card bottom-left. The exact position is a design decision that is not
 * settled yet, so it lives here rather than being spread through the card.
 */
export function FeatureAnnouncementHost(): ReactElement | null {
  const { pathname } = useLocation();
  // Popped-out chat windows and embedded panels are fragments of the app, not the shell
  // the card belongs to.
  const isInPanelWebview = useIsInPanelWebview();

  // Never interrupt a call, matching how the Electron update nudge suppresses itself.
  const inCall = useSelector(
    callActor,
    state =>
      Boolean(state.context.nativeActiveCallId) ||
      Boolean(state.context.acceptingCallId) ||
      state.context.incomingCallQueue.length > 0,
  );

  const allowed =
    FEATURE_ANNOUNCEMENTS_ENABLED &&
    !isInPanelWebview &&
    !isStandaloneWindow() &&
    isAnnouncementRoute(pathname);

  // Gating the hook too, so a suppressed route does not fetch or mark anything as seen.
  const { announcements, markSeen, clickCta, dismissAll } = useFeatureAnnouncements(allowed);

  const announcement = announcements[0];
  if (!allowed || !announcement || inCall) return null;

  return createPortal(
    <div className='pointer-events-none fixed bottom-4 left-4 z-40'>
      <FeatureAnnouncementCard
        announcement={announcement}
        onSeen={markSeen}
        onCta={clickCta}
        onDismiss={dismissAll}
      />
    </div>,
    document.body,
  );
}
