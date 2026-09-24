// postMessage contract between the main bundle and the SDLC lane's iframe. The
// frame is kept alive across route changes, so it cannot be navigated by swapping
// `src` — that would reload it. Paths on the wire are basename-free: both bundles
// share one route table and react-router strips the basename, so a path means the
// same thing on both sides.

import type { SdlcCallLink } from '@xyne/shared';

export const SDLC_FRAME_MESSAGE = {
  navigate: 'xyne:sdlc-frame:navigate',
  route: 'xyne:sdlc-frame:route',
  ready: 'xyne:sdlc-frame:ready',
  reset: 'xyne:sdlc-frame:reset',
  initiateCall: 'xyne:sdlc-frame:initiate-call',
  openLink: 'xyne:sdlc-frame:open-link',
  embedPage: 'xyne:sdlc-frame:embed-page',
  embedControl: 'xyne:sdlc-frame:embed-control',
  embedRelease: 'xyne:sdlc-frame:embed-release',
  embedState: 'xyne:sdlc-frame:embed-state',
  embedScript: 'xyne:sdlc-frame:embed-script',
  embedEvent: 'xyne:sdlc-frame:embed-event',
} as const;

export interface SdlcFrameNavigateMessage {
  type: typeof SDLC_FRAME_MESSAGE.navigate;
  path: string;
}

export interface SdlcFrameRouteMessage {
  type: typeof SDLC_FRAME_MESSAGE.route;
  path: string;
}

export interface SdlcFrameReadyMessage {
  type: typeof SDLC_FRAME_MESSAGE.ready;
}

/** Frame → parent: destroy this frame and mount a fresh one; the host picks the boot path. */
export interface SdlcFrameResetMessage {
  type: typeof SDLC_FRAME_MESSAGE.reset;
}

/**
 * Frame → parent: initiate a call on the HOST's roomActor. The SDLC lane is a
 * chromeless iframe whose own call overlay is suppressed, so a call started
 * inside it must be owned by the host to render the global mini-view. Only
 * serialisable call params cross the boundary — onComplete stays in the frame.
 */
export interface SdlcFrameInitiateCallMessage {
  type: typeof SDLC_FRAME_MESSAGE.initiateCall;
  channelId: string;
  targetUserIds?: string[];
  callDisplayName?: string;
  conversationId?: string;
  sdlcLink?: SdlcCallLink;
}

export type SdlcFrameMessage =
  | SdlcFrameNavigateMessage
  | SdlcFrameRouteMessage
  | SdlcFrameReadyMessage
  | SdlcFrameResetMessage
  | SdlcFrameInitiateCallMessage
  | SdlcFrameOpenLinkMessage
  | SdlcFrameEmbedPageMessage
  | SdlcFrameEmbedControlMessage
  | SdlcFrameEmbedReleaseMessage
  | SdlcFrameEmbedStateMessage
  | SdlcFrameEmbedScriptMessage
  | SdlcFrameEmbedEventMessage;

/**
 * Frame → parent: open this url the way the app opens links. The lane is an
 * iframe, so its own browser-panel actor has no panel behind it, and a plain
 * window.open reaches Electron's handler where the user's open-externally
 * preference sends it to the system browser. The host owns the panel, so the
 * host does the opening.
 */
export interface SdlcFrameOpenLinkMessage {
  type: typeof SDLC_FRAME_MESSAGE.openLink;
  url: string;
}

/**
 * Frame → parent: put a live page over this rectangle of the lane, or clear it
 * when `url` is null. Electron registers the <webview> element in the top frame
 * only, so the lane cannot host one itself however much it would like to; the
 * host renders it and the lane says where.
 *
 * The rectangle is in the frame's own viewport coordinates, which are the
 * iframe's content box — the host's iframe fills its wrapper, so they are the
 * wrapper's coordinates too.
 */
export interface SdlcFrameEmbedPageMessage {
  type: typeof SDLC_FRAME_MESSAGE.embedPage;
  url: string | null;
  rect: { x: number; y: number; width: number; height: number } | null;
  /**
   * False while the lane has a dialog or a menu open over this area. The page
   * lives above the frame and would otherwise bury it, and hiding beats
   * unmounting: the page keeps its scroll and its state for when it returns.
   */
  visible: boolean;
}

/** Frame → parent: drive the pages the host is holding for us. */
export interface SdlcFrameEmbedControlMessage {
  type: typeof SDLC_FRAME_MESSAGE.embedControl;
  action: 'back' | 'forward' | 'reload' | 'goto' | 'select' | 'close' | 'newTab';
  /** Present for 'goto'. */
  url?: string;
  /** Present for 'select' and 'close'. */
  tabId?: string;
}

/**
 * Frame → parent: drive the annotator inside the held page. The page is the
 * host's web contents, so only the host can evaluate in it; the lane sends the
 * same messages the annotator's in-page script already understands.
 */
export interface SdlcFrameEmbedScriptMessage {
  type: typeof SDLC_FRAME_MESSAGE.embedScript;
  /** An `xyne-doc-host` message, forwarded verbatim into the page. */
  payload: Record<string, unknown>;
}

/** Parent → frame: something the annotator in the held page reported. */
export interface SdlcFrameEmbedEventMessage {
  type: typeof SDLC_FRAME_MESSAGE.embedEvent;
  /** An `xyne-doc` message from the page, or `{ type: 'ready' }`. */
  payload: Record<string, unknown>;
}

/**
 * Frame → parent: let go of the embedded page's focus. Only the host can; the
 * page is its own web contents, and until it yields, the first click on the
 * app's chrome is spent handing focus back instead of pressing anything.
 */
export interface SdlcFrameEmbedReleaseMessage {
  type: typeof SDLC_FRAME_MESSAGE.embedRelease;
}

/** One page open inside the embedded browser. */
export interface SdlcEmbedTab {
  id: string;
  url: string;
  title: string;
  /** The page's own icon, once it announces one. */
  favicon: string;
  /**
   * The item's own link, which is what this browser is for. It opens the
   * browser and cannot be closed; everything else arrived by following a link.
   */
  pinned: boolean;
}

/** Parent → frame: what those pages are doing, so the lane's chrome can say so. */
export interface SdlcFrameEmbedStateMessage {
  type: typeof SDLC_FRAME_MESSAGE.embedState;
  url: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
  tabs: SdlcEmbedTab[];
  activeTabId: string;
}

const EMBED_ACTIONS: readonly string[] = [
  'back',
  'forward',
  'reload',
  'goto',
  'select',
  'close',
  'newTab',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Paths the main bundle shows through the lane's frame: SDLC and Workflows.
 *
 * Both sync directions check this rather than the viewport alone: leaving a framed
 * route updates the location and clears the viewport in separate effects, so there
 * is a render where the new path is visible while the viewport still looks active —
 * enough to push the frame onto /chat and lose its state.
 */
export function isSdlcPath(pathname: string): boolean {
  return /^\/[^/]+\/(sdlc|workflows)(\/|$)/.test(pathname);
}

/** Narrows the shape only — callers must also check `event.origin`. */
export function parseSdlcFrameMessage(data: unknown): SdlcFrameMessage | null {
  if (!isRecord(data)) return null;
  const { type } = data;

  if (type === SDLC_FRAME_MESSAGE.ready || type === SDLC_FRAME_MESSAGE.reset) {
    return { type };
  }

  if (type === SDLC_FRAME_MESSAGE.navigate || type === SDLC_FRAME_MESSAGE.route) {
    // Rooted same-origin paths only; '//' would be another host.
    const { path } = data;
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) {
      return null;
    }
    return { type, path };
  }

  if (type === SDLC_FRAME_MESSAGE.embedPage) {
    const { url, rect } = data;
    if (url === null) return { type, url: null, rect: null, visible: false };
    if (typeof url !== 'string') return null;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    } catch {
      return null;
    }
    if (!isRecord(rect)) return null;
    const { x, y, width, height } = rect;
    if ([x, y, width, height].some(value => typeof value !== 'number' || !Number.isFinite(value))) {
      return null;
    }
    return {
      type,
      url,
      rect: { x: x as number, y: y as number, width: width as number, height: height as number },
      visible: data['visible'] !== false,
    };
  }

  if (type === SDLC_FRAME_MESSAGE.embedRelease) {
    return { type };
  }

  if (type === SDLC_FRAME_MESSAGE.embedScript || type === SDLC_FRAME_MESSAGE.embedEvent) {
    const { payload } = data;
    if (!isRecord(payload) || typeof payload['type'] !== 'string') return null;
    return { type, payload };
  }

  if (type === SDLC_FRAME_MESSAGE.embedControl) {
    const { action, url } = data;
    if (typeof action !== 'string' || !EMBED_ACTIONS.includes(action)) return null;
    if (action === 'newTab') {
      // A new tab may name where it starts, or take the host's default.
      const { url } = data;
      if (url === undefined) return { type, action };
      if (typeof url !== 'string') return null;
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
      } catch {
        return null;
      }
      return { type, action, url };
    }
    if (action === 'select' || action === 'close') {
      const { tabId } = data;
      if (typeof tabId !== 'string' || !tabId) return null;
      return { type, action, tabId };
    }
    if (action !== 'goto') {
      return { type, action: action as 'back' | 'forward' | 'reload' };
    }
    if (typeof url !== 'string') return null;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    } catch {
      return null;
    }
    return { type, action: 'goto', url };
  }

  if (type === SDLC_FRAME_MESSAGE.embedState) {
    const { url, canGoBack, canGoForward, loading, tabs, activeTabId } = data;
    if (typeof url !== 'string') return null;
    const cleanTabs: SdlcEmbedTab[] = Array.isArray(tabs)
      ? tabs.flatMap(tab =>
          isRecord(tab) && typeof tab['id'] === 'string' && typeof tab['url'] === 'string'
            ? [
                {
                  id: tab['id'],
                  url: tab['url'],
                  title: typeof tab['title'] === 'string' ? tab['title'] : '',
                  favicon: typeof tab['favicon'] === 'string' ? tab['favicon'] : '',
                  pinned: tab['pinned'] === true,
                },
              ]
            : [],
        )
      : [];
    return {
      type,
      url,
      canGoBack: canGoBack === true,
      canGoForward: canGoForward === true,
      loading: loading === true,
      tabs: cleanTabs,
      activeTabId: typeof activeTabId === 'string' ? activeTabId : '',
    };
  }

  if (type === SDLC_FRAME_MESSAGE.openLink) {
    // http(s) only: a frame must not talk the host into file: or javascript:.
    const { url } = data;
    if (typeof url !== 'string') return null;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    } catch {
      return null;
    }
    return { type, url };
  }

  if (type === SDLC_FRAME_MESSAGE.initiateCall) {
    const { channelId, targetUserIds, callDisplayName, conversationId, sdlcLink } = data;
    if (typeof channelId !== 'string' || !channelId) return null;
    return {
      type,
      channelId,
      ...(Array.isArray(targetUserIds) &&
        targetUserIds.every((id): id is string => typeof id === 'string') && {
          targetUserIds,
        }),
      ...(typeof callDisplayName === 'string' && { callDisplayName }),
      ...(typeof conversationId === 'string' && { conversationId }),
      ...(isRecord(sdlcLink) && { sdlcLink: sdlcLink as SdlcCallLink }),
    };
  }

  return null;
}
