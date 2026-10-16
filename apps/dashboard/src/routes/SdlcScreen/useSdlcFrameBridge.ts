import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { isSdlcSurface } from '../../config';
import { isElectronApp } from '../../utils/electronApp';
import {
  parseSdlcFrameMessage,
  SDLC_FRAME_MESSAGE,
  type SdlcEmbedCommand,
  type SdlcEmbedPageState,
  type SdlcEmbedTab,
  type SdlcHistoryPage,
} from './sdlcFrameMessages';

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
  action:
    | 'back'
    | 'forward'
    | 'reload'
    | 'stop'
    | 'goto'
    | 'select'
    | 'close'
    | 'newTab'
    | 'find'
    | 'stopFind',
  payload?: {
    url?: string;
    tabId?: string;
    key?: string;
    /** For 'find'. */
    text?: string;
    forward?: boolean;
    findNext?: boolean;
  },
): void {
  if (!isFramedSdlcSurface()) return;
  window.parent.postMessage(
    {
      type: SDLC_FRAME_MESSAGE.embedControl,
      action,
      ...(payload?.url ? { url: payload.url } : {}),
      ...(payload?.tabId ? { tabId: payload.tabId } : {}),
      ...(payload?.key ? { key: payload.key } : {}),
      ...(payload?.text ? { text: payload.text } : {}),
      ...(payload?.forward === false ? { forward: false } : {}),
      ...(payload?.findNext ? { findNext: true } : {}),
    },
    window.location.origin,
  );
}

/** Lets the host throw a tab's page away: the tab was closed, so it won't be back. */
export function discardEmbeddedPage(key: string): void {
  if (!canHostEmbedPages()) return;
  window.parent.postMessage(
    { type: SDLC_FRAME_MESSAGE.embedPage, url: null, rect: null, visible: false, key },
    window.location.origin,
  );
}

/**
 * The keyed pages the host holds, as it last reported them: every tab's title,
 * icon and loading state, for the strip as well as the open tab's bar. One
 * listener for the whole lane, installed on first use.
 */
let embeddedPages: ReadonlyMap<string, SdlcEmbedPageState> = new Map();
const embeddedPagesListeners = new Set<() => void>();
let embeddedPagesListening = false;

function listenForEmbeddedPages(): void {
  if (embeddedPagesListening || !isFramedSdlcSurface()) return;
  embeddedPagesListening = true;
  window.addEventListener('message', event => {
    if (event.origin !== window.location.origin || event.source !== window.parent) return;
    const message = parseSdlcFrameMessage(event.data);
    if (message?.type !== SDLC_FRAME_MESSAGE.embedState || !message.pages) return;
    embeddedPages = new Map(message.pages.map(page => [page.key, page]));
    embeddedPagesListeners.forEach(listener => listener());
  });
}

function subscribeToEmbeddedPages(listener: () => void): () => void {
  listenForEmbeddedPages();
  embeddedPagesListeners.add(listener);
  return () => embeddedPagesListeners.delete(listener);
}

/** Every keyed page's state, by key; empty off the desktop app, or before the host says. */
export function useEmbeddedPages(): ReadonlyMap<string, SdlcEmbedPageState> {
  return useSyncExternalStore(subscribeToEmbeddedPages, () => embeddedPages);
}

/**
 * Hears a keyed page asking for something the lane's chrome does — ⌘F, ⌘T, ⌘L
 * pressed while the page had the keyboard, "Save" from its menu.
 */
export function subscribeToEmbeddedCommand(
  onCommand: (key: string, command: SdlcEmbedCommand) => void,
): () => void {
  if (!isFramedSdlcSurface()) return () => {};
  const onMessage = (event: MessageEvent): void => {
    if (event.origin !== window.location.origin || event.source !== window.parent) return;
    const message = parseSdlcFrameMessage(event.data);
    if (message?.type === SDLC_FRAME_MESSAGE.embedCommand) onCommand(message.key, message.command);
  };
  window.addEventListener('message', onMessage);
  return () => window.removeEventListener('message', onMessage);
}

/**
 * Hears a keyed page asking for a new window — a link to open in a new tab, a
 * popup — which the lane opens as a tab of its own.
 */
export function subscribeToEmbeddedOpen(onOpen: (url: string, from: string) => void): () => void {
  if (!isFramedSdlcSurface()) return () => {};
  const onMessage = (event: MessageEvent): void => {
    if (event.origin !== window.location.origin || event.source !== window.parent) return;
    const message = parseSdlcFrameMessage(event.data);
    if (message?.type === SDLC_FRAME_MESSAGE.embedOpen) onOpen(message.url, message.from);
  };
  window.addEventListener('message', onMessage);
  return () => window.removeEventListener('message', onMessage);
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

/** How long the lane waits for the host to answer about history before going without. */
const HISTORY_TIMEOUT_MS = 1500;
let historyQueries = 0;

/**
 * Asks the host what the browsing history suggests: matches for what is typed, or
 * the sites visited most. Nothing, quickly, from a host that doesn't answer — an
 * older one, or one whose desktop app keeps no history.
 */
export function historyFromHost(
  kind: 'suggest' | 'top',
  typed: string,
  limit: number,
): Promise<{ searches: string[]; pages: SdlcHistoryPage[] }> {
  const nothing = { searches: [], pages: [] };
  if (!canHostEmbedPages()) return Promise.resolve(nothing);
  historyQueries += 1;
  const id = `history-${historyQueries}`;
  return new Promise(resolve => {
    const done = (answer: { searches: string[]; pages: SdlcHistoryPage[] }): void => {
      window.removeEventListener('message', onMessage);
      window.clearTimeout(timer);
      resolve(answer);
    };
    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== window.location.origin || event.source !== window.parent) return;
      const message = parseSdlcFrameMessage(event.data);
      if (message?.type === SDLC_FRAME_MESSAGE.historyResult && message.id === id) {
        done({ searches: message.searches, pages: message.pages });
      }
    };
    const timer = window.setTimeout(() => done(nothing), HISTORY_TIMEOUT_MS);
    window.addEventListener('message', onMessage);
    window.parent.postMessage(
      { type: SDLC_FRAME_MESSAGE.historyQuery, id, kind, typed, limit },
      window.location.origin,
    );
  });
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
 *
 * With a `key`, the page is one of the lane's tabs: the host keeps it when the
 * cleanup runs — the reader went to another tab — so it comes back as it was, and
 * only lets it go on discardEmbeddedPage. Without one it is cleared outright.
 */
export function embedPageOverElement(url: string, element: HTMLElement, key?: string): () => void {
  if (!canHostEmbedPages()) return () => {};

  // What was last said, so a resize or a toast elsewhere that moves nothing says
  // nothing: each message re-renders the host's pages.
  let last = '';
  const post = (payload: { url: string | null; rect: DOMRect | null; visible: boolean }): void => {
    const message = {
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
      ...(key && { key }),
      ...(key && payload.url === null && { keep: true }),
    };
    const said = JSON.stringify(message);
    if (said === last) return;
    last = said;
    window.parent.postMessage(message, window.location.origin);
  };

  /**
   * The embedded page is drawn above this frame, so anything the lane opens over
   * it — a dialog, a menu, a popover — would be hidden behind it. These are the
   * portalled overlays; while one is up the page steps aside.
   */
  const overlayOpen = (): boolean => {
    const overlays = document.querySelectorAll(
      // Ours too: an address bar's suggestions, drawn over the page below it.
      '[role="dialog"], [role="menu"], [data-radix-popper-content-wrapper], [data-xyne-overlay]',
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
export function browserTabSearch(search: string): string | null {
  const params = new URLSearchParams(search);
  if (!params.get('folder')) return null;
  if (params.get('browse') === '1') return null;
  params.delete('canvas');
  params.delete('file');
  params.delete('link');
  params.set('browse', '1');
  return `?${params.toString()}`;
}

export function useSdlcFrameBridge(): void {
  const location = useLocation();
  const navigate = useNavigate();

  // Where the parent is now, from its last NAVIGATE or our last report; reporting it again only echoes.
  const parentLocationRef = useRef<string | null>(null);
  const locationRef = useRef(location);
  locationRef.current = location;

  const enabled = isFramedSdlcSurface();

  useEffect(() => {
    if (!enabled) return undefined;

    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== window.location.origin) return;
      if (event.source !== window.parent) return;

      const message = parseSdlcFrameMessage(event.data);
      if (message?.type === SDLC_FRAME_MESSAGE.showBrowser) {
        const here = locationRef.current;
        const next = browserTabSearch(here.search);
        if (next !== null) void navigate(`${here.pathname}${next}`);
        return;
      }
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
