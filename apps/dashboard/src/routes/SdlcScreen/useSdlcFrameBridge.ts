import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { isSdlcSurface } from '../../config';
import { parseSdlcFrameMessage, SDLC_FRAME_MESSAGE } from './sdlcFrameMessages';

/** True when this document is the SDLC bundle running inside the parent's frame. */
export function isFramedSdlcSurface(): boolean {
  return isSdlcSurface && typeof window !== 'undefined' && window.parent !== window;
}

/** Frame name SdlcWindow gives its iframe; survives the lane's own navigations. */
export const SDLC_WINDOW_FRAME_NAME = 'xyne-sdlc-window';

/** True in a popped-out document window, where the lane hides its hub sidebar. */
export function isSdlcDocumentWindow(): boolean {
  return isFramedSdlcSurface() && window.name === SDLC_WINDOW_FRAME_NAME;
}

/**
 * Escape hatch for a wedged frame. It is long-lived by design, so without this
 * the only way to a clean one is reloading the whole dashboard.
 */
export function requestSdlcFrameReset(): void {
  if (!isFramedSdlcSurface()) return;
  window.parent.postMessage({ type: SDLC_FRAME_MESSAGE.reset }, window.location.origin);
}

/**
 * The SDLC bundle's half of the frame contract: applies NAVIGATE from the parent
 * and reports its own route back. Active only when framed.
 */
export function useSdlcFrameBridge(): void {
  const location = useLocation();
  const navigate = useNavigate();

  // Skip reporting a route the parent just asked for.
  const lastFromParentRef = useRef<string | null>(null);
  const lastReportedRef = useRef<string | null>(null);

  const enabled = isFramedSdlcSurface();

  useEffect(() => {
    if (!enabled) return undefined;

    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== window.location.origin) return;
      if (event.source !== window.parent) return;

      const message = parseSdlcFrameMessage(event.data);
      if (!message || message.type !== SDLC_FRAME_MESSAGE.navigate) return;

      lastFromParentRef.current = message.path;
      void navigate(message.path);
    };

    window.addEventListener('message', onMessage);
    window.parent.postMessage({ type: SDLC_FRAME_MESSAGE.ready }, window.location.origin);

    return () => window.removeEventListener('message', onMessage);
  }, [enabled, navigate]);

  useEffect(() => {
    if (!enabled) return;

    const path = `${location.pathname}${location.search}`;
    if (path === lastFromParentRef.current || path === lastReportedRef.current) return;

    lastReportedRef.current = path;
    window.parent.postMessage({ type: SDLC_FRAME_MESSAGE.route, path }, window.location.origin);
  }, [enabled, location.pathname, location.search]);
}
