import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { isSdlcSurface } from '../../config';
import { isElectronApp } from '../../utils/electronApp';
import { parseSdlcFrameMessage, SDLC_FRAME_MESSAGE, type SdlcEmbedTab } from './sdlcFrameMessages';

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
 * Asks the host to open a url in the app. Only the desktop app needs this: the
 * lane's own browser-panel actor has nothing behind it, and a window.open from
 * here reaches Electron's handler, whose open-externally default hands the link
 * to the system browser.
 *
 * On the web the frame opens its own tab instead. Going through the host would
 * cost the click's user activation — postMessage is delivered in a later task,
 * by which point window.open is just a popup and gets blocked.
 *
 * Returns false when the caller should open the url itself.
 */
export function openLinkFromSdlcFrame(url: string): boolean {
  if (!isFramedSdlcSurface() || !isElectronApp()) return false;
  // Attachment urls are relative in this bundle (API_BASE_URL is /sdlc-api), and
  // the host parses what it is sent with `new URL`, which throws on those and
  // drops the message. Resolve against our own location so the host gets an
  // absolute url, and hand the caller back its fallback if it cannot be one.
  let absolute: string;
  try {
    const resolved = new URL(url, window.location.href);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return false;
    absolute = resolved.href;
  } catch {
    return false;
  }
  window.parent.postMessage(
    { type: SDLC_FRAME_MESSAGE.openLink, url: absolute },
    window.location.origin,
  );
  return true;
}

/** Drives the page the host is holding: the lane has the buttons, not the page. */
export function controlEmbeddedPage(
  action: 'back' | 'forward' | 'reload' | 'goto' | 'select' | 'close' | 'newTab',
  payload?: { url?: string; tabId?: string },
): void {
  if (!isFramedSdlcSurface()) return;
  window.parent.postMessage(
    {
      type: SDLC_FRAME_MESSAGE.embedControl,
      action,
      ...(payload?.url ? { url: payload.url } : {}),
      ...(payload?.tabId ? { tabId: payload.tabId } : {}),
    },
    window.location.origin,
  );
}

/**
 * What the held page is doing. Reported by the host on every navigation, so the
 * address bar follows the page rather than the last thing anyone typed.
 */
export function subscribeToEmbeddedPage(
  onState: (state: {
    url: string;
    canGoBack: boolean;
    canGoForward: boolean;
    tabs: SdlcEmbedTab[];
    activeTabId: string;
  }) => void,
): () => void {
  if (!isFramedSdlcSurface()) return () => {};
  const onMessage = (event: MessageEvent): void => {
    if (event.origin !== window.location.origin) return;
    if (event.source !== window.parent) return;
    const message = parseSdlcFrameMessage(event.data);
    if (!message || message.type !== SDLC_FRAME_MESSAGE.embedState) return;
    onState({
      url: message.url,
      canGoBack: message.canGoBack,
      canGoForward: message.canGoForward,
      tabs: message.tabs,
      activeTabId: message.activeTabId,
    });
  };
  window.addEventListener('message', onMessage);
  return () => window.removeEventListener('message', onMessage);
}

/**
 * Takes focus back from the embedded page.
 *
 * The page is a separate web contents; while it holds focus, the first click
 * anywhere on the app's own chrome is spent returning focus and never reaches
 * the DOM. Calling this as the pointer arrives means the click that follows is
 * the one that acts, rather than the second.
 */
export function reclaimHostFocus(): void {
  if (!isFramedSdlcSurface()) return;
  window.parent.postMessage({ type: SDLC_FRAME_MESSAGE.embedRelease }, window.location.origin);
}

/** True when the host can hold a live page over the lane for us. */
export function canHostEmbedPages(): boolean {
  return isFramedSdlcSurface() && isElectronApp();
}

/**
 * Tells the host to hold a page over `element`, and to keep holding it there as
 * the lane resizes or scrolls. Returns a cleanup that clears it again.
 *
 * The lane leaves a hole rather than drawing anything: the real page is the
 * host's webview, sitting above this frame.
 */
export function embedPageOverElement(url: string, element: HTMLElement): () => void {
  if (!canHostEmbedPages()) return () => {};

  const post = (payload: { url: string | null; rect: DOMRect | null; visible: boolean }): void => {
    window.parent.postMessage(
      {
        type: SDLC_FRAME_MESSAGE.embedPage,
        url: payload.url,
        rect: payload.rect
          ? {
              x: payload.rect.x,
              y: payload.rect.y,
              width: payload.rect.width,
              height: payload.rect.height,
            }
          : null,
        visible: payload.visible,
      },
      window.location.origin,
    );
  };

  /**
   * The embedded page is drawn above this frame, so anything the lane opens over
   * it — a dialog, a menu, a popover — would be hidden behind it. These are the
   * portalled overlays; while one is up the page steps aside.
   */
  const overlayOpen = (): boolean => {
    const overlays = document.querySelectorAll(
      '[role="dialog"], [role="menu"], [data-radix-popper-content-wrapper]',
    );
    const hole = element.getBoundingClientRect();
    return Array.from(overlays).some(overlay => {
      // An overlay holding the hole is not in the way — it is the thing asking
      // for the page, as the dialog that browses for a link to save does.
      if (overlay.contains(element)) return false;
      // A tooltip is not either: it is a label for the button under the
      // pointer, and blanking the whole page to show one reads as the page
      // vanishing when the mouse merely passes a toolbar icon.
      if (overlay.matches('[role="tooltip"]') || overlay.querySelector('[role="tooltip"]')) {
        return false;
      }
      // Nor is one that opens somewhere else entirely — a menu in the chat
      // panel beside the page never covers it, so the page can stay.
      const box = overlay.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return false;
      const overlaps =
        box.left < hole.right &&
        box.right > hole.left &&
        box.top < hole.bottom &&
        box.bottom > hole.top;
      return overlaps;
    });
  };

  const sync = (): void =>
    post({ url, rect: element.getBoundingClientRect(), visible: !overlayOpen() });
  sync();

  const resize = new ResizeObserver(sync);
  resize.observe(element);
  resize.observe(document.documentElement);
  // Overlays are portalled to the body, so their arrival is a body mutation.
  const overlays = new MutationObserver(sync);
  overlays.observe(document.body, { childList: true });
  window.addEventListener('scroll', sync, true);

  return () => {
    resize.disconnect();
    overlays.disconnect();
    window.removeEventListener('scroll', sync, true);
    post({ url: null, rect: null, visible: false });
  };
}

/**
 * The SDLC bundle's half of the frame contract: applies NAVIGATE from the parent
 * and reports its own route back. Active only when framed.
 */
export function useSdlcFrameBridge(): void {
  const location = useLocation();
  const navigate = useNavigate();

  // Where the parent is now, from its last NAVIGATE or our last report; reporting it again only echoes.
  const parentLocationRef = useRef<string | null>(null);

  const enabled = isFramedSdlcSurface();

  useEffect(() => {
    if (!enabled) return undefined;

    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== window.location.origin) return;
      if (event.source !== window.parent) return;

      const message = parseSdlcFrameMessage(event.data);
      if (!message || message.type !== SDLC_FRAME_MESSAGE.navigate) return;

      parentLocationRef.current = message.path;
      void navigate(message.path);
    };

    window.addEventListener('message', onMessage);
    window.parent.postMessage({ type: SDLC_FRAME_MESSAGE.ready }, window.location.origin);

    return () => window.removeEventListener('message', onMessage);
  }, [enabled, navigate]);

  useEffect(() => {
    if (!enabled) return;

    const path = `${location.pathname}${location.search}${location.hash}`;
    if (path === parentLocationRef.current) return;

    parentLocationRef.current = path;
    window.parent.postMessage({ type: SDLC_FRAME_MESSAGE.route, path }, window.location.origin);
  }, [enabled, location.pathname, location.search, location.hash]);
}
