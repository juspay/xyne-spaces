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
 * Anchors the card bottom-left, over the sidebar. Measured off the `Inbox` frame
 * (5011:26289), where the card sits at left 19.5 / bottom 65.56 in a 1730×1039 window —
 * its right edge landing on the sidebar's boundary and clearing the Ask Xyne bar.
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

  if (!allowed || announcements.length === 0 || inCall) return null;

  return createPortal(
    <div className='pointer-events-none fixed bottom-[66px] left-5 z-40'>
      <FeatureAnnouncementCard
        announcements={announcements}
        onSeen={markSeen}
        onCta={clickCta}
        onDismiss={dismissAll}
      />
    </div>,
    document.body,
  );
}
