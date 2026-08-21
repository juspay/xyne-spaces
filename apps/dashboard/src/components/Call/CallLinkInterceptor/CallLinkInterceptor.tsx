import { useCallback, useEffect, useRef } from 'react';
import { useAuth } from '../../../hooks/useAuth';
import { useCallJoinOrInitiate } from '../../../hooks/useCallJoinOrInitiate';
import { isElectronApp } from '../../../utils/electronApp';
import { roomActor } from '../../../machines/roomMachine';
import { parseCallInviteLink } from '../../Chat/RenderMessageWithHTML/internalLinkUtils';
import { resolveCallLinkTarget } from '../../../utils/callLinkRouting';

/**
 * True when this tab is already in the call the link points at. `joinCall`
 * would otherwise tear the room down and rebuild it, dropping the user out of a
 * call they are sitting in.
 */
function isAlreadyInCall(callId: string): boolean {
  const snapshot = roomActor.getSnapshot();
  if (
    !snapshot.matches('joining') &&
    !snapshot.matches('connecting') &&
    !snapshot.matches('connected')
  ) {
    return false;
  }
  // `callId` is what JOIN_CALL was given; `externalId` is what the join response
  // came back with. For an invite link the two are the same value, but the
  // context only holds both once the call is connected.
  return snapshot.context.externalId === callId || snapshot.context.callId === callId;
}

/**
 * Opens Xyne call invite links inside Spaces instead of letting them navigate.
 *
 * A call has exactly one invite URL, pointed at the external lobby app, so that
 * a host can share the same link with teammates and guests. Following it as a
 * plain anchor makes a workspace member load the lobby, wait for it to probe
 * their session, and then get redirected back into the dashboard — the app
 * boots twice and the screen flashes before the call appears.
 *
 * Claiming the click here asks the same routing question up front, and for a
 * member of the call's workspace hands the call straight to `roomActor`:
 * GlobalCallOverlay renders it over the current screen, with no navigation and
 * no reload. Guests and members of other workspaces still go to the lobby.
 *
 * Mounted alongside GlobalCallOverlay — the overlay is what a joined call
 * renders into, so this belongs wherever that does.
 */
export function CallLinkInterceptor(): null {
  const { user, isAuthenticated } = useAuth();
  const { joinCall } = useCallJoinOrInitiate();

  const openCallLink = useCallback(
    (callId: string, href: string): void => {
      if (isAlreadyInCall(callId)) {
        return;
      }
      void resolveCallLinkTarget(callId, href, user?.workspaceId).then(target => {
        if (target.kind === 'join-in-place') {
          joinCall({ callId: target.callId });
          return;
        }
        window.location.assign(target.url);
      });
    },
    [user?.workspaceId, joinCall],
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
  useEffect(() => {
    if (!isAuthenticated || !isElectronApp()) {
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
