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
  embedOpen: 'xyne:sdlc-frame:embed-open',
  embedCommand: 'xyne:sdlc-frame:embed-command',
  showBrowser: 'xyne:sdlc-frame:show-browser',
  historyQuery: 'xyne:sdlc-frame:history-query',
  historyResult: 'xyne:sdlc-frame:history-result',
  downloads: 'xyne:sdlc-frame:downloads',
  downloadsRequest: 'xyne:sdlc-frame:downloads-request',
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

export interface SdlcFrameShowBrowserMessage {
  type: typeof SDLC_FRAME_MESSAGE.showBrowser;
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
  | SdlcFrameEmbedEventMessage
  | SdlcFrameEmbedOpenMessage
  | SdlcFrameEmbedCommandMessage
  | SdlcFrameShowBrowserMessage
  | SdlcFrameHistoryQueryMessage
  | SdlcFrameHistoryResultMessage
  | SdlcFrameDownloadsMessage
  | SdlcFrameDownloadsRequestMessage;

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
 *
 * A page with a `key` is one of the lane's tabs, kept by the host for as long as
 * the tab is: `url` starts it, and is not followed after that — the page goes
 * where its reader takes it. Cleared with `keep`, it is put aside rather than
 * thrown away, to come back as it was. A page without a key is the single page of
 * an older lane, replaced whenever its url changes.
 */
export interface SdlcFrameEmbedPageMessage {
  type: typeof SDLC_FRAME_MESSAGE.embedPage;
  url: string | null;
  rect: { x: number; y: number; width: number; height: number } | null;
  /** The lane's tab this page belongs to. */
  key?: string;
  /** With `url` null: put the page aside, not away. */
  keep?: boolean;
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
    | 'stopFind';
  /** The keyed page to drive; without one, an older lane's single page. */
  key?: string;
  /** For 'find': what to look for. */
  text?: string;
  /** For 'find': towards the end of the page, or back up it. */
  forward?: boolean;
  /** For 'find': a step to the next match of the same search, not a new one. */
  findNext?: boolean;
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

/** Why a page didn't load: Chromium's own net error, and the address it was for. */
export interface SdlcEmbedLoadError {
  /** A net error code: -105 is a name that didn't resolve, -106 no connection. */
  code: number;
  description: string;
  url: string;
}

/** One of the lane's tabs as the host holds it: what its strip and its bar show. */
export interface SdlcEmbedPageState {
  key: string;
  url: string;
  title: string;
  favicon: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  /** The last load's failure, until the next load starts. */
  error: SdlcEmbedLoadError | null;
  /** Find in the page, while it runs: which match is shown, of how many. */
  find: { active: number; matches: number } | null;
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
  /** Every keyed page the host holds; absent from a host that keys none. */
  pages?: SdlcEmbedPageState[];
}

/** What a page can ask of the lane's chrome from the keyboard or its menu. */
export type SdlcEmbedCommand =
  | 'find'
  | 'newTab'
  | 'tabs'
  | 'focusAddress'
  | 'back'
  | 'forward'
  | 'save'
  | 'nextTab'
  | 'previousTab';

/**
 * Parent → frame: a keyed page asked for something the lane's chrome does — ⌘F,
 * ⌘T or ⌘L pressed in the page, "Save" from its menu. The page has the keyboard
 * then, not the lane, so the host passes it on.
 */
export interface SdlcFrameEmbedCommandMessage {
  type: typeof SDLC_FRAME_MESSAGE.embedCommand;
  key: string;
  command: SdlcEmbedCommand;
}

/**
 * Parent → frame: a keyed page asked for a new window — a link opening in a new
 * tab, a popup — and the lane opens it as a tab of its own.
 */
export interface SdlcFrameEmbedOpenMessage {
  type: typeof SDLC_FRAME_MESSAGE.embedOpen;
  url: string;
  /** The page it came from. */
  from: string;
}

const EMBED_ACTIONS: readonly string[] = [
  'back',
  'forward',
  'reload',
  'stop',
  'goto',
  'select',
  'close',
  'newTab',
  'find',
  'stopFind',
];

const EMBED_COMMANDS: readonly string[] = [
  'find',
  'newTab',
  'tabs',
  'focusAddress',
  'back',
  'forward',
  'save',
  'nextTab',
  'previousTab',
];

/** A page from the browsing history, as it crosses the frame. */
export interface SdlcHistoryPage {
  url: string;
  title: string;
  favicon: string;
}

/**
 * Frame → parent: what the browsing history suggests for the lane's address bar —
 * matches for what is typed, or the most visited sites. Only the host can ask the
 * desktop app; one that can't, or is older, doesn't answer and the lane goes without.
 */
export interface SdlcFrameHistoryQueryMessage {
  type: typeof SDLC_FRAME_MESSAGE.historyQuery;
  /** Matched by the answer. */
  id: string;
  kind: 'suggest' | 'top';
  typed?: string;
  limit?: number;
}

/** Parent → frame: the answer to a history query. */
export interface SdlcFrameHistoryResultMessage {
  type: typeof SDLC_FRAME_MESSAGE.historyResult;
  id: string;
  searches: string[];
  pages: SdlcHistoryPage[];
}

/** A download as the host lists it for the lane's downloads button. */
export interface SdlcDownload {
  id: string;
  filename: string;
  received: number;
  total: number;
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted';
  paused: boolean;
  canOpen: boolean;
}

/**
 * Parent → frame: the window's downloads, newest first, whenever they change or the
 * lane asks. Only the host reaches the desktop app; the lane shows what it hears.
 */
export interface SdlcFrameDownloadsMessage {
  type: typeof SDLC_FRAME_MESSAGE.downloads;
  downloads: SdlcDownload[];
}

/** What the lane asks of the window's downloads: the list again, to clear the
 *  finished ones, or one download opened, shown, paused, resumed or cancelled. */
export type SdlcDownloadRequest =
  | 'sync'
  | 'clear'
  | 'open'
  | 'show'
  | 'cancel'
  | 'pause'
  | 'resume';

/** Frame → parent: a request about the window's downloads. */
export interface SdlcFrameDownloadsRequestMessage {
  type: typeof SDLC_FRAME_MESSAGE.downloadsRequest;
  request: SdlcDownloadRequest;
  /** The download it is about; none for sync and clear. */
  id?: string;
}

const DOWNLOAD_STATES: readonly string[] = ['progressing', 'completed', 'cancelled', 'interrupted'];
const DOWNLOAD_REQUESTS: readonly string[] = [
  'sync',
  'clear',
  'open',
  'show',
  'cancel',
  'pause',
  'resume',
];
const MAX_DOWNLOADS = 30;

function downloadsFrom(value: unknown): SdlcDownload[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_DOWNLOADS).flatMap(entry => {
    if (!isRecord(entry)) return [];
    const { id, filename, received, total, state, paused, canOpen } = entry;
    if (typeof id !== 'string' || !/^[\w-]{1,64}$/.test(id) || typeof filename !== 'string') {
      return [];
    }
    if (typeof state !== 'string' || !DOWNLOAD_STATES.includes(state)) return [];
    return [
      {
        id,
        filename: filename.slice(0, 300),
        received: typeof received === 'number' ? received : 0,
        total: typeof total === 'number' ? total : 0,
        state: state as SdlcDownload['state'],
        paused: paused === true,
        canOpen: canOpen === true,
      },
    ];
  });
}

const MAX_HISTORY_ITEMS = 12;

function historyPages(value: unknown): SdlcHistoryPage[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_HISTORY_ITEMS).flatMap(entry => {
    if (!isRecord(entry)) return [];
    const url = webUrl(entry['url']);
    if (!url) return [];
    const favicon = webUrl(entry['favicon']);
    return [
      {
        url,
        title: typeof entry['title'] === 'string' ? entry['title'].slice(0, 300) : '',
        favicon: favicon ?? '',
      },
    ];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** A page key as the lane makes them — `LINK:id`, `BROWSER:id` — or nothing. */
function pageKey(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Z]+:[\w-]{1,128}$/.test(value) ? value : undefined;
}

/** An http(s) address, or nothing: a frame must not talk the host into file: or javascript:. */
function webUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? value : undefined;
  } catch {
    return undefined;
  }
}

function pageState(value: unknown): SdlcEmbedPageState[] {
  if (!isRecord(value)) return [];
  const key = pageKey(value['key']);
  if (!key || typeof value['url'] !== 'string') return [];
  const error = value['error'];
  return [
    {
      key,
      url: value['url'],
      title: typeof value['title'] === 'string' ? value['title'] : '',
      favicon: typeof value['favicon'] === 'string' ? value['favicon'] : '',
      loading: value['loading'] === true,
      canGoBack: value['canGoBack'] === true,
      canGoForward: value['canGoForward'] === true,
      error:
        isRecord(error) && typeof error['code'] === 'number'
          ? {
              code: error['code'],
              description: typeof error['description'] === 'string' ? error['description'] : '',
              url: typeof error['url'] === 'string' ? error['url'] : '',
            }
          : null,
      find:
        isRecord(value['find']) &&
        typeof value['find']['active'] === 'number' &&
        typeof value['find']['matches'] === 'number'
          ? { active: value['find']['active'], matches: value['find']['matches'] }
          : null,
    },
  ];
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
    const key = pageKey(data['key']);
    if (url === null) {
      return {
        type,
        url: null,
        rect: null,
        visible: false,
        ...(key && { key }),
        ...(data['keep'] === true && { keep: true }),
      };
    }
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
      ...(key && { key }),
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

  if (type === SDLC_FRAME_MESSAGE.embedCommand) {
    const key = pageKey(data['key']);
    const command = data['command'];
    if (!key || typeof command !== 'string' || !EMBED_COMMANDS.includes(command)) return null;
    return { type, key, command: command as SdlcEmbedCommand };
  }

  if (type === SDLC_FRAME_MESSAGE.embedOpen) {
    const url = webUrl(data['url']);
    const from = pageKey(data['from']);
    return url && from ? { type, url, from } : null;
  }

  if (type === SDLC_FRAME_MESSAGE.embedControl) {
    const { action, url } = data;
    if (typeof action !== 'string' || !EMBED_ACTIONS.includes(action)) return null;
    const key = pageKey(data['key']);
    if (action === 'find') {
      const { text } = data;
      if (typeof text !== 'string' || !text || text.length > 500) return null;
      return {
        type,
        action,
        text,
        forward: data['forward'] !== false,
        findNext: data['findNext'] === true,
        ...(key && { key }),
      };
    }
    if (action === 'stopFind') return { type, action, ...(key && { key }) };
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
      return {
        type,
        action: action as 'back' | 'forward' | 'reload' | 'stop',
        ...(key && { key }),
      };
    }
    if (typeof url !== 'string') return null;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    } catch {
      return null;
    }
    return { type, action: 'goto', url, ...(key && { key }) };
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
      ...(Array.isArray(data['pages']) && { pages: data['pages'].flatMap(pageState) }),
    };
  }

  if (type === SDLC_FRAME_MESSAGE.showBrowser) {
    return { type };
  }

  if (type === SDLC_FRAME_MESSAGE.downloads) {
    return { type, downloads: downloadsFrom(data['downloads']) };
  }

  if (type === SDLC_FRAME_MESSAGE.downloadsRequest) {
    const { request, id } = data;
    if (typeof request !== 'string' || !DOWNLOAD_REQUESTS.includes(request)) return null;
    if (request === 'sync' || request === 'clear') {
      return { type, request: request as SdlcDownloadRequest };
    }
    if (typeof id !== 'string' || !/^[\w-]{1,64}$/.test(id)) return null;
    return { type, request: request as SdlcDownloadRequest, id };
  }

  if (type === SDLC_FRAME_MESSAGE.historyQuery) {
    const { id, kind, typed, limit } = data;
    if (typeof id !== 'string' || !/^[\w-]{1,64}$/.test(id)) return null;
    if (kind !== 'suggest' && kind !== 'top') return null;
    if (typed !== undefined && (typeof typed !== 'string' || typed.length > 500)) return null;
    return {
      type,
      id,
      kind,
      ...(typeof typed === 'string' && { typed }),
      ...(typeof limit === 'number' &&
        Number.isFinite(limit) && { limit: Math.max(1, Math.min(MAX_HISTORY_ITEMS, limit)) }),
    };
  }

  if (type === SDLC_FRAME_MESSAGE.historyResult) {
    const { id, searches } = data;
    if (typeof id !== 'string' || !/^[\w-]{1,64}$/.test(id)) return null;
    return {
      type,
      id,
      searches: Array.isArray(searches)
        ? searches
            .filter((search): search is string => typeof search === 'string')
            .slice(0, MAX_HISTORY_ITEMS)
            .map(search => search.slice(0, 300))
        : [],
      pages: historyPages(data['pages']),
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
