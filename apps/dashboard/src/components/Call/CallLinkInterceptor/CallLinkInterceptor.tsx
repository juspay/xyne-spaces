import { useCallback, useEffect, useRef } from 'react';
import { useAuth } from '../../../hooks/useAuth';
import { useCallJoinOrInitiate } from '../../../hooks/useCallJoinOrInitiate';
import { useIsActiveCallParticipant } from '../../../hooks/useCalls';
import { parseCallInviteLink } from '../../Chat/RenderMessageWithHTML/internalLinkUtils';

/**
 * Opens Xyne call invite links inside Spaces instead of letting them navigate.
 *
 * A call has exactly one invite URL, pointed at the external lobby app, so that
 * a host can share the same link with teammates and guests. Following it as a
 * plain anchor makes a workspace member load the lobby, wait for it to probe
 * their session, and then get redirected back into the dashboard — the app
 * boots twice and the screen flashes before the call appears.
 *
 * Claiming the click here hands the call straight to `roomActor` instead:
 * GlobalCallOverlay renders it over the current screen, with no navigation and
 * no reload. Nothing is asked first — a click inside the dashboard comes from a
 * signed-in member, and the join itself is what knows whether the call is one
 * of theirs. Only when it says no does the lobby come back into it.
 *
 * Mounted alongside GlobalCallOverlay — the overlay is what a joined call
 * renders into, so this belongs wherever that does.
 */
export function CallLinkInterceptor(): null {
  const { user, isAuthenticated } = useAuth();
  const { joinCall } = useCallJoinOrInitiate();
  const isActiveCallParticipant = useIsActiveCallParticipant(user?.id);

  const openCallLink = useCallback(
    (callId: string, href: string): void => {
      // The call already lists this user as an active participant, so there is
      // nothing for the link to do.
      if (isActiveCallParticipant(callId)) {
        return;
      }
      // Straight to the join — no routing probe first. Inside the dashboard the
      // clicker is a signed-in member by construction, and `/calls/join` reads
      // calls through the tenant ACL, so it already answers the only question a
      // probe could: a call outside this workspace is invisible there and comes
      // back 404. `externalLobbyUrl` is where that answer sends them, and
      // carrying the href rather than rebuilding it keeps the desktop app right,
      // where `window.location.origin` is not the Spaces origin.
      joinCall({ callId, externalLobbyUrl: href });
    },
    [joinCall, isActiveCallParticipant],
  );

  // `joinCall` is rebuilt on every roomActor update, so the listeners below read
  // the handler through a ref rather than resubscribing mid-call.
  const openCallLinkRef = useRef(openCallLink);
  useEffect(() => {
    openCallLinkRef.current = openCallLink;
  });

  useEffect(() => {
    if (!isAuthenticated) {
      return undefined;
    }

    const handleClick = (event: MouseEvent): void => {
      if (event.defaultPrevented || event.button !== 0) {
        return;
      }
      // Modified clicks mean "open somewhere else" — leave them to the browser.
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }

      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const anchor = target.closest('a');
      if (!anchor?.href) {
        return;
      }

      const callId = parseCallInviteLink(anchor.href);
      if (!callId) {
        return;
      }

      event.preventDefault();
      openCallLinkRef.current(callId, anchor.href);
    };

    // Capture phase, so this is the single place that decides where a call link
    // opens no matter which renderer drew the anchor.
    document.addEventListener('click', handleClick, true);
    return (): void => {
      document.removeEventListener('click', handleClick, true);
    };
  }, [isAuthenticated]);

  // Links that never reach a renderer click — deep links, notification actions,
  // anchors followed inside the browser panel — are handed back by the Electron
  // main process rather than opening a browser panel for a call the app hosts.
  //
  // Desktop-only by absence, not by a platform check: the web build has no
  // `electronAPI` to subscribe to, and nothing there opens a call link outside
  // the click above, which is intercepted on every platform.
  useEffect(() => {
    if (!isAuthenticated) {
      return undefined;
    }
    const onOpenCallLink = window.electronAPI?.onOpenCallLink;
    if (!onOpenCallLink) {
      return undefined;
    }

    return onOpenCallLink((url: string) => {
      const callId = parseCallInviteLink(url);
      if (callId) {
        openCallLinkRef.current(callId, url);
      }
    });
  }, [isAuthenticated]);

  return null;
}
