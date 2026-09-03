import { ReactElement, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { SDLC_APP_BASE_PATH } from '../../config';
import { useCallJoinOrInitiate } from '../../hooks/useCallJoinOrInitiate';
import { useSdlcFrame } from './SdlcFrameContext';
import { isSdlcPath, parseSdlcFrameMessage, SDLC_FRAME_MESSAGE } from './sdlcFrameMessages';

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

  // Last path each side told the other, so echoes do not loop.
  const lastFromFrameRef = useRef<string | null>(null);
  const lastToFrameRef = useRef<string | null>(null);

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
    initialSrcRef.current = `${SDLC_APP_BASE_PATH}${location.pathname}${location.search}${location.hash}`;
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

      if (message.type === SDLC_FRAME_MESSAGE.reset) {
        // Timestamp forces a fresh document rather than a cached one. JS cannot
        // request a true cache-bypassing reload.
        const root = `/${workspaceId}/sdlc`;
        initialSrcRef.current = `${SDLC_APP_BASE_PATH}${root}?_reset=${Date.now()}`;
        lastFromFrameRef.current = null;
        lastToFrameRef.current = null;
        setIsReady(false);
        setResetCount(count => count + 1);
        if (location.pathname !== root) void navigate(root, { replace: true });
        return;
      }

      if (message.type !== SDLC_FRAME_MESSAGE.route) return;

      lastFromFrameRef.current = message.path;
      // Only while on screen — a hidden frame must not move the address bar.
      const current = `${location.pathname}${location.search}${location.hash}`;
      if (viewport && isSdlcPath(message.path) && message.path !== current) {
        void navigate(message.path, { replace: true });
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
    if (path === lastFromFrameRef.current || path === lastToFrameRef.current) return;

    lastToFrameRef.current = path;
    target.postMessage({ type: SDLC_FRAME_MESSAGE.navigate, path }, window.location.origin);
  }, [isReady, viewport, location.pathname, location.search, location.hash]);

  if (!container || !hasActivated || !initialSrcRef.current) return null;

  return createPortal(
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
    />,
    container,
  );
};

export default SdlcFrameHost;
