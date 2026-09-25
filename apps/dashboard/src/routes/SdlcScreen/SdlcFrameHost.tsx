import { ReactElement, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { SDLC_APP_BASE_PATH } from '../../config';
import { useCallJoinOrInitiate } from '../../hooks/useCallJoinOrInitiate';
import { useSdlcFrame } from './SdlcFrameContext';
import { isSdlcPath, parseSdlcFrameMessage, SDLC_FRAME_MESSAGE } from './sdlcFrameMessages';
import {
  getLastSdlcLocation,
  setLastSdlcLocation,
  sdlcHubIdOf,
  withoutResetParam,
} from './lastSdlcLocation';
import { openLink } from '../../utils/openLink';
import { SdlcEmbeddedWebview } from './SdlcEmbeddedWebview';

/**
 * Owns the SDLC lane's iframe for the lifetime of the workspace.
 *
 * Mounted above the router so leaving /sdlc hides the frame instead of unmounting
 * it, and portalled to document.body so no layout branch in AppRoot can reparent
 * it — moving an iframe in the DOM reloads it. AppRoot is mounted under
 * ':workspaceId', so a workspace switch resets the frame.
 *
 * See docs/sdlc-fast-lane.md.
 */
const SdlcFrameHost = (): ReactElement | null => {
  const { viewport } = useSdlcFrame();
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const location = useLocation();
  const navigate = useNavigate();

  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [isReady, setIsReady] = useState(false);

  // The host owns the roomActor, so a call the SDLC frame requests is initiated
  // here and its mini-view renders in the host's global overlay. Kept in a ref so
  // the message listener below need not re-subscribe when the callback identity
  // changes each render.
  const { initiateCall } = useCallJoinOrInitiate();
  const initiateCallRef = useRef(initiateCall);
  initiateCallRef.current = initiateCall;

  // Where the frame is now, from its last report or our last send; sending it again only echoes.
  const frameLocationRef = useRef<string | null>(null);

  const container = useMemo(() => {
    if (typeof document === 'undefined') return null;
    const element = document.createElement('div');
    element.dataset['sdlcFrameHost'] = 'true';
    return element;
  }, []);

  useEffect(() => {
    if (!container) return undefined;
    document.body.appendChild(container);
    return () => container.remove();
  }, [container]);

  const initialSrcRef = useRef<string | null>(null);
  const [hasActivated, setHasActivated] = useState(false);
  // Only the reset control may remount the frame; a URL-derived key would not.
  const [resetCount, setResetCount] = useState(0);

  // Captured on first SDLC visit, not at mount: AppRoot mounts on any route under
  // :workspaceId, so at mount the location is usually a different screen.
  useEffect(() => {
    if (!viewport || initialSrcRef.current || !workspaceId) return;
    // Bare /sdlc after a reload: resume the durable last-visited page.
    const root = `/${workspaceId}/sdlc`;
    const stored =
      location.pathname === root || location.pathname === `${root}/`
        ? getLastSdlcLocation(workspaceId)
        : null;
    initialSrcRef.current = `${SDLC_APP_BASE_PATH}${stored ?? `${location.pathname}${location.search}${location.hash}`}`;
    setHasActivated(true);
  }, [viewport, workspaceId, location.pathname, location.search, location.hash]);

  // frame → parent
  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== window.location.origin) return;
      if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) return;

      const message = parseSdlcFrameMessage(event.data);
      if (!message) return;

      if (message.type === SDLC_FRAME_MESSAGE.ready) {
        setIsReady(true);
        return;
      }

      if (message.type === SDLC_FRAME_MESSAGE.initiateCall) {
        initiateCallRef.current({
          channelId: message.channelId,
          ...(message.targetUserIds && { targetUserIds: message.targetUserIds }),
          ...(message.callDisplayName && { callDisplayName: message.callDisplayName }),
          ...(message.conversationId && { conversationId: message.conversationId }),
          ...(message.sdlcLink && { sdlcLink: message.sdlcLink }),
        });
        return;
      }

      if (message.type === SDLC_FRAME_MESSAGE.openLink) {
        // Forced in-app: the lane asked because it wants this in the app, not
        // handed to the operating system.
        openLink(message.url, null, { force: 'in-app' });
        return;
      }

      if (message.type === SDLC_FRAME_MESSAGE.reset) {
        // Timestamp forces a fresh document rather than a cached one. Stay on the
        // frame's current page instead of dropping to the hub root.
        const frameLocation = frameLocationRef.current;
        const root =
          frameLocation && sdlcHubIdOf(frameLocation) ? frameLocation : `/${workspaceId}/sdlc`;
        const separator = root.includes('?') ? '&' : '?';
        initialSrcRef.current = `${SDLC_APP_BASE_PATH}${root}${separator}_reset=${Date.now()}`;
        frameLocationRef.current = null;
        setIsReady(false);
        setResetCount(count => count + 1);
        if (location.pathname !== root) void navigate(root, { replace: true });
        return;
      }

      if (message.type !== SDLC_FRAME_MESSAGE.route) return;

      const reported = withoutResetParam(message.path);
      frameLocationRef.current = reported;
      if (workspaceId) setLastSdlcLocation(workspaceId, reported);
      // Only while on screen — a hidden frame must not move the address bar.
      const current = `${location.pathname}${location.search}${location.hash}`;
      if (viewport && isSdlcPath(reported) && reported !== current) {
        void navigate(reported, { replace: true });
      }
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [location.pathname, location.search, location.hash, navigate, viewport, workspaceId]);

  // parent → frame
  useEffect(() => {
    if (!isReady || !viewport) return;
    const target = iframeRef.current?.contentWindow;
    if (!target) return;

    // The hash carries #origin/#messageId scroll targets, so it must ride along.
    const path = `${location.pathname}${location.search}${location.hash}`;
    if (!isSdlcPath(location.pathname)) return;
    if (path === frameLocationRef.current) return;

    // The bare hub link means "back to SDLC", so it returns to wherever the frame
    // already is — when that is an SDLC page, not the Workflows screen it also shows.
    const frameLocation = frameLocationRef.current;
    if (
      frameLocation &&
      /^\/[^/]+\/sdlc(\/|$)/.test(frameLocation) &&
      /^\/[^/]+\/sdlc\/?$/.test(location.pathname)
    ) {
      void navigate(frameLocation, { replace: true });
      return;
    }

    frameLocationRef.current = path;
    target.postMessage({ type: SDLC_FRAME_MESSAGE.navigate, path }, window.location.origin);
  }, [isReady, viewport, location.pathname, location.search, location.hash, navigate]);

  if (!container || !hasActivated || !initialSrcRef.current) return null;

  return createPortal(
    <>
      <iframe
        key={resetCount}
        ref={iframeRef}
        src={initialSrcRef.current}
        title='SDLC'
        style={{
          position: 'fixed',
          top: viewport?.top ?? 0,
          left: viewport?.left ?? 0,
          width: viewport?.width ?? 0,
          height: viewport?.height ?? 0,
          border: 0,
          visibility: viewport ? 'visible' : 'hidden',
          pointerEvents: viewport ? 'auto' : 'none',
          zIndex: 1,
        }}
        allow='clipboard-read; clipboard-write'
      />
      <SdlcEmbeddedWebview
        offset={viewport ? { top: viewport.top, left: viewport.left } : null}
        getFrameWindow={() => iframeRef.current?.contentWindow ?? null}
      />
    </>,
    container,
  );
};

export default SdlcFrameHost;
