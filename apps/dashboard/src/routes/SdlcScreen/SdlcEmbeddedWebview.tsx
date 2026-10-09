import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import {
  ANNOTATE_SCRIPT,
  annotateEventFrom,
  measuredRect,
  rectOnScreen,
} from '../../components/workspaceItems';
import {
  registerSdlcWebviewGetter,
  sdlcWebviewChanged,
} from '../../components/AIScreen/Workspace/sdlcBrowserTarget';
import type { ElectronWebviewElement } from '../../types/electron';
import {
  BrowserWebview,
  IDLE_PAGE,
  actOnDownload,
  clearFinishedDownloads,
  currentDownloads,
  subscribeToDownloads,
  LinkPreview,
  PageContextMenu,
  runPageMenuAction,
  ask,
  desktopHistory,
  subscribeToPageKeys,
  type PageKeyCommand,
  type PageLive,
  type PageMenuAction,
  type PageMenuParams,
  type WebviewElement,
  zoomPage,
} from '../../components/InAppBrowser';
import {
  parseSdlcFrameMessage,
  SDLC_FRAME_MESSAGE,
  type SdlcEmbedCommand,
  type SdlcEmbedPageState,
} from './sdlcFrameMessages';

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Tab {
  id: string;
  /** Where the tab started. The live address comes from the element. */
  src: string;
  pinned: boolean;
}

/**
 * A page the lane asked for. A keyed page is one of the lane's tabs and is a single
 * tab here: anything it opens becomes a tab of the lane's own. An unkeyed page is an
 * older lane's, which keeps its own strip of tabs inside it.
 */
interface Page {
  key: string;
  keyed: boolean;
  tabs: Tab[];
  activeId: string;
  /** Where it goes, in the frame's coordinates; kept while it is put aside. */
  rect: Rect;
  /** On screen: the lane is showing its tab, with nothing of its own over it. */
  visible: boolean;
  /** Put aside: the lane's tab isn't open. Hidden, muted, and in time let go. */
  parked: boolean;
  /** When it was last on screen or put aside, to let the longest-unused go first. */
  touched: number;
}

/** A right-click in a page, and the page: the host's menu for it. */
interface OpenMenu {
  key: string;
  tabId: string;
  at: { x: number; y: number };
  params: PageMenuParams;
}

/** The key the single page of an older, unkeyed lane is held under. */
const LEGACY_KEY = 'legacy';
/** Pages kept alive at once, the one on screen included; past it the longest put aside go. */
const MAX_LIVE_PAGES = 4;
/** How long a page put aside stays alive before it is let go, to stop costing memory and power. */
const PARKED_LIFETIME_MS = 10 * 60 * 1000;
let tabCounter = 0;
const nextTabId = (): string => `embed-tab-${(tabCounter += 1)}`;

const activeTab = (page: Page): Tab | undefined => page.tabs.find(tab => tab.id === page.activeId);

/** Lets go of pages past the limit, the longest put aside first; never one on screen. */
function withinLimit(all: Page[]): Page[] {
  const excess = all.length - MAX_LIVE_PAGES;
  if (excess <= 0) return all;
  const parked = all.filter(page => page.parked).sort((a, b) => a.touched - b.touched);
  const going = new Set(parked.slice(0, excess).map(page => page.key));
  return all.filter(page => !going.has(page.key));
}

/**
 * The live pages the SDLC lane asks the host to hold over it.
 *
 * They live here, in the top frame, because Electron registers the <webview>
 * element in the top frame only — the lane can never host one itself. The lane
 * says where the pages go and draws the chrome; this drives them and reports
 * back what they are doing, so the two never disagree about what is on screen.
 *
 * Each of the lane's browsing tabs is a page held here for as long as the tab is
 * open: switching away puts it aside, hidden and muted, so coming back finds it as
 * it was — scrolled, signed in, mid-form. A few are kept; past that, or after a
 * while unused, the longest put aside is let go, and comes back by loading afresh.
 *
 * Both hosts render this, so the popped-out window and the in-app lane cannot
 * drift apart.
 */
export function SdlcEmbeddedWebview(props: {
  /** Where the frame sits, since the frame's rect is relative to itself. */
  offset: { top: number; left: number } | null;
  getFrameWindow: () => Window | null;
}): ReactElement | null {
  const [pages, setPages] = useState<Page[]>([]);
  const viewRefs = useRef(new Map<string, WebviewElement>());
  // Announced by the page's events rather than read off it, so kept beside the
  // element rather than in the page list.
  const liveRefs = useRef(new Map<string, PageLive>());

  // Each tab's listeners are bound once, when that tab mounts, so a callback
  // closing over state would keep reporting the moment it was bound. Refs give
  // the listeners stable functions that still read the present.
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const frameWindowRef = useRef(props.getFrameWindow);
  frameWindowRef.current = props.getFrameWindow;

  /** The page on screen: the one the reader is looking at, for the annotator and the agent. */
  const shownView = useCallback((): WebviewElement | null => {
    const page = pagesRef.current.find(candidate => candidate.visible && !candidate.parked);
    return page ? (viewRefs.current.get(page.activeId) ?? null) : null;
  }, []);

  const live = (tabId: string): PageLive => liveRefs.current.get(tabId) ?? IDLE_PAGE;

  /** The window's downloads, for the lane's downloads button. */
  const postDownloads = useCallback((): void => {
    frameWindowRef
      .current()
      ?.postMessage(
        { type: SDLC_FRAME_MESSAGE.downloads, downloads: currentDownloads() },
        window.location.origin,
      );
  }, []);
  // Sent as they change, so the lane's button fills as a file comes in.
  useEffect(() => subscribeToDownloads(postDownloads), [postDownloads]);

  /** Passes on what a page asked for that the lane's chrome does. */
  const postCommand = useCallback((key: string, command: SdlcEmbedCommand): void => {
    frameWindowRef
      .current()
      ?.postMessage(
        { type: SDLC_FRAME_MESSAGE.embedCommand, key, command },
        window.location.origin,
      );
  }, []);

  /** Hands the keyboard back from a page, so what the lane or a menu draws can take it. */
  const takeFocusBack = (): void => {
    void window.electronAPI?.focusHostWebContents?.();
  };

  const [menu, setMenu] = useState<OpenMenu | null>(null);
  // The link under the pointer in a page, for its address to show.
  const [hover, setHover] = useState<{ tabId: string; url: string } | null>(null);

  /**
   * Evaluates one annotator message in the page the lane is looking at. The script
   * installs itself on first contact, so no separate injection step is needed.
   */
  const annotate = useCallback(
    (payload: Record<string, unknown>): void => {
      const view = shownView();
      if (!view) return;
      const message = JSON.stringify(payload);
      void ask(
        () =>
          view.executeJavaScript(
            `(() => {
             if (!window.__xyneAnnotateApply) { ${ANNOTATE_SCRIPT} }
             window.__xyneAnnotateApply(${message});
           })()`,
          ),
        Promise.resolve(),
      )?.catch(() => undefined);
    },
    [shownView],
  );
  const annotateRef = useRef(annotate);
  annotateRef.current = annotate;

  // The page says a pick or a badge click as the reader makes it; it goes down to the
  // lane. Only once the lane has armed the annotator for the page on screen.
  const [armedTab, setArmedTab] = useState<string | null>(null);
  const shownTabId = pages.find(page => page.visible && !page.parked)?.activeId ?? null;
  useEffect(() => {
    if (!armedTab || armedTab !== shownTabId) return undefined;
    const view = viewRefs.current.get(armedTab);
    if (!view) return undefined;
    const onConsole = (event: Event): void => {
      const said = annotateEventFrom((event as Event & { message?: string }).message);
      // The lane lives in the iframe, so the relay goes to its window — posting
      // to our own would talk to the host and never reach the reader.
      const frame = frameWindowRef.current();
      if (!said || !frame) return;
      // The page measures in its own zoomed units; the lane places the box and
      // threads beside a block by the app's.
      const rect = measuredRect(said['rect']);
      const zoom = ask(() => view.getZoomFactor(), 1);
      frame.postMessage(
        {
          type: SDLC_FRAME_MESSAGE.embedEvent,
          payload: rect ? { ...said, rect: rectOnScreen(rect, zoom) } : said,
        },
        window.location.origin,
      );
    };
    // A page loaded afresh has lost the script: it goes back in, as the lane left it.
    const onLoaded = (): void => annotateRef.current({ channel: 'xyne-doc-host', type: 'noop' });
    view.addEventListener('console-message', onConsole);
    view.addEventListener('dom-ready', onLoaded);
    return () => {
      view.removeEventListener('console-message', onConsole);
      view.removeEventListener('dom-ready', onLoaded);
    };
  }, [armedTab, shownTabId]);

  useEffect(
    () =>
      registerSdlcWebviewGetter(
        () => (shownView() as unknown as ElectronWebviewElement | null) ?? null,
      ),
    [shownView],
  );
  // Another tab shown: Xyne AI, waiting for the browser, looks again.
  useEffect(() => sdlcWebviewChanged(), [shownTabId]);

  /** Tells the lane what every page is doing: the keyed ones for its tabs, an older
   *  lane's single page in the fields it reads. */
  const postState = useCallback((): void => {
    const frame = frameWindowRef.current();
    if (!frame) return;
    const describe = (page: Page): SdlcEmbedPageState => {
      const tab = activeTab(page);
      const view = viewRefs.current.get(page.activeId);
      const state = live(page.activeId);
      return {
        key: page.key,
        url: (view ? ask(() => view.getURL(), '') : '') || tab?.src || '',
        title: view ? ask(() => view.getTitle(), '') : '',
        favicon: state.favicon,
        loading: state.loading,
        canGoBack: view ? ask(() => view.canGoBack(), false) : false,
        canGoForward: view ? ask(() => view.canGoForward(), false) : false,
        error: state.error,
        find: state.find,
      };
    };
    const legacy = pagesRef.current.find(page => !page.keyed);
    const legacyState = legacy ? describe(legacy) : null;
    frame.postMessage(
      {
        type: SDLC_FRAME_MESSAGE.embedState,
        url: legacyState?.url ?? '',
        canGoBack: legacyState?.canGoBack ?? false,
        canGoForward: legacyState?.canGoForward ?? false,
        loading: legacyState?.loading ?? false,
        activeTabId: legacy?.activeId ?? '',
        tabs: (legacy?.tabs ?? []).map(tab => {
          const view = viewRefs.current.get(tab.id);
          return {
            id: tab.id,
            url: view ? ask(() => view.getURL(), tab.src) || tab.src : tab.src,
            title: view ? ask(() => view.getTitle(), '') : '',
            favicon: live(tab.id).favicon,
            pinned: tab.pinned,
          };
        }),
        pages: pagesRef.current.filter(page => page.keyed).map(describe),
      },
      window.location.origin,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The pages use too much memory, says the desktop app: those put aside go now.
  useEffect(
    () =>
      window.electronAPI?.onBrowserMemoryPressure?.(() => {
        setPages(current => current.filter(page => !page.parked));
      }),
    [],
  );

  // A page put aside long enough is let go: one timer, for the next to expire.
  useEffect(() => {
    const parked = pages.filter(page => page.parked);
    if (parked.length === 0) return;
    const next = Math.min(...parked.map(page => page.touched)) + PARKED_LIFETIME_MS;
    const timer = window.setTimeout(
      () => {
        const now = Date.now();
        setPages(current =>
          current.filter(page => !page.parked || now - page.touched < PARKED_LIFETIME_MS),
        );
      },
      Math.max(0, next - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [pages]);

  const openInLane = useCallback((url: string, from: string): void => {
    frameWindowRef
      .current()
      ?.postMessage({ type: SDLC_FRAME_MESSAGE.embedOpen, url, from }, window.location.origin);
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== window.location.origin) return;
      if (event.source !== frameWindowRef.current()) return;

      const message = parseSdlcFrameMessage(event.data);
      if (!message) return;

      // Pages are held over the folder page and nowhere else. The lane clears
      // them on unmount, but a frame reset replaces the document outright and no
      // cleanup runs — they would then sit over whatever came next.
      if (message.type === SDLC_FRAME_MESSAGE.route) {
        if (!message.path.includes('folder=')) setPages([]);
        return;
      }

      if (message.type === SDLC_FRAME_MESSAGE.embedPage) {
        const key = message.key ?? LEGACY_KEY;
        const keyed = message.key !== undefined;
        const now = Date.now();
        setPages(current => {
          const existing = current.find(page => page.key === key);
          if (message.url === null || !message.rect) {
            // A tab switched away keeps its page aside; anything else lets it go.
            if (!existing) return current;
            return keyed && message.keep
              ? withinLimit(
                  current.map(page =>
                    page.key === key
                      ? { ...page, visible: false, parked: true, touched: now }
                      : page,
                  ),
                )
              : current.filter(page => page.key !== key);
          }
          const placed = { rect: message.rect, visible: message.visible, parked: false };
          // A keyed page goes where its reader takes it; the lane's url only starts
          // it. An older lane's page starts afresh when its url changes.
          const restart =
            !existing || (!keyed && existing.tabs.find(tab => tab.pinned)?.src !== message.url);
          if (!restart) {
            return current.map(page =>
              page.key === key ? { ...page, ...placed, touched: now } : page,
            );
          }
          const tab: Tab = { id: nextTabId(), src: message.url, pinned: true };
          const fresh: Page = {
            key,
            keyed,
            tabs: [tab],
            activeId: tab.id,
            ...placed,
            touched: now,
          };
          return withinLimit([...current.filter(page => page.key !== key), fresh]);
        });
        return;
      }

      if (message.type === SDLC_FRAME_MESSAGE.embedScript) {
        setArmedTab(pagesRef.current.find(page => page.visible && !page.parked)?.activeId ?? null);
        annotateRef.current(message.payload);
        return;
      }

      if (message.type === SDLC_FRAME_MESSAGE.downloadsRequest) {
        // The lane's downloads button: the list again, finished ones cleared, or
        // one acted on — only the host reaches the desktop app.
        if (message.request === 'sync') postDownloads();
        else if (message.request === 'clear') clearFinishedDownloads();
        else if (message.id) actOnDownload(message.id, message.request);
        return;
      }

      if (message.type === SDLC_FRAME_MESSAGE.historyQuery) {
        // Only the host can ask the desktop app; the lane asks through it.
        const { id, kind } = message;
        const limit = message.limit ?? 6;
        const answer =
          kind === 'top'
            ? desktopHistory.top(limit).then(pages => ({ searches: [], pages }))
            : desktopHistory.suggest(message.typed ?? '', limit);
        void answer.then(found =>
          frameWindowRef
            .current()
            ?.postMessage(
              { type: SDLC_FRAME_MESSAGE.historyResult, id, ...found },
              window.location.origin,
            ),
        );
        return;
      }

      if (message.type === SDLC_FRAME_MESSAGE.embedRelease) {
        // Only the main process can move focus off a guest: blurring the
        // element and focusing the window both leave it where it is.
        void window.electronAPI?.focusHostWebContents?.();
        return;
      }

      if (message.type !== SDLC_FRAME_MESSAGE.embedControl) return;
      const key = message.key ?? LEGACY_KEY;

      // An older lane's own strip of tabs inside its page.
      if (
        message.action === 'newTab' ||
        message.action === 'select' ||
        message.action === 'close'
      ) {
        setPages(current =>
          current.map(page => {
            if (page.key !== key) return page;
            if (message.action === 'newTab') {
              const fresh: Tab = {
                id: nextTabId(),
                src: message.url ?? 'https://www.google.com',
                pinned: false,
              };
              return { ...page, tabs: [...page.tabs, fresh], activeId: fresh.id };
            }
            if (message.action === 'select') {
              return page.tabs.some(tab => tab.id === message.tabId)
                ? { ...page, activeId: message.tabId ?? page.activeId }
                : page;
            }
            const doomed = page.tabs.find(tab => tab.id === message.tabId);
            if (!doomed || doomed.pinned) return page;
            const remaining = page.tabs.filter(tab => tab.id !== doomed.id);
            return {
              ...page,
              tabs: remaining,
              activeId: page.activeId === doomed.id ? (remaining.at(-1)?.id ?? '') : page.activeId,
            };
          }),
        );
        return;
      }

      const page = pagesRef.current.find(candidate => candidate.key === key);
      const view = page ? viewRefs.current.get(page.activeId) : undefined;
      if (!page || !view) return;
      if (message.action === 'find' && message.text) {
        // Electron's findNext begins a new search; the lane's means a step in this one.
        const text = message.text;
        ask(
          () =>
            view.findInPage(text, {
              forward: message.forward !== false,
              findNext: !message.findNext,
            }),
          0,
        );
        return;
      }
      if (message.action === 'stopFind') {
        ask(() => view.stopFindInPage('clearSelection'), undefined);
        liveRefs.current.set(page.activeId, { ...live(page.activeId), find: null });
        postState();
        return;
      }
      ask(() => {
        if (message.action === 'back' && view.canGoBack()) view.goBack();
        else if (message.action === 'forward' && view.canGoForward()) view.goForward();
        else if (message.action === 'reload') view.reload();
        else if (message.action === 'stop') view.stop();
        else if (message.action === 'goto' && message.url) void view.loadURL(message.url);
        return null;
      }, null);
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** A browser key pressed in a page: back and forward are the page's own, the rest
   *  the lane's chrome. */
  const onPageKey = (page: Page, tabId: string, command: PageKeyCommand): void => {
    const view = viewRefs.current.get(tabId);
    if (command === 'back') ask(() => view?.canGoBack() && view.goBack(), undefined);
    else if (command === 'forward') ask(() => view?.canGoForward() && view.goForward(), undefined);
    else if (command === 'zoomIn' || command === 'zoomOut' || command === 'zoomReset') {
      // The page's own zoom, kept for its site — nothing the lane draws.
      if (view)
        zoomPage(view, command === 'zoomIn' ? 'in' : command === 'zoomOut' ? 'out' : 'reset');
    } else if (command === 'reopenTab') {
      // A folder keeps no closed tabs to bring back.
    } else if (page.keyed) {
      takeFocusBack();
      const asLane: SdlcEmbedCommand = command;
      postCommand(page.key, asLane);
    }
  };
  const onPageKeyRef = useRef(onPageKey);
  onPageKeyRef.current = onPageKey;

  // ⌘F and ⌘T pressed inside a page are caught by the main process and sent to this
  // window without saying which page — as are the browser keys, from a desktop app
  // that passes those on: the one with focus is the one that asked.
  useEffect(() => {
    const focusedPage = (): Page | undefined =>
      pagesRef.current.find(
        page => page.keyed && viewRefs.current.get(page.activeId) === document.activeElement,
      );
    const offKeys = subscribeToPageKeys(command => {
      const page = focusedPage();
      if (page) onPageKeyRef.current(page, page.activeId, command);
    });
    const api = window.electronAPI;
    const offFind = api?.onBrowserFindInPage?.(() => {
      const page = focusedPage();
      if (!page) return;
      takeFocusBack();
      postCommand(page.key, 'find');
    });
    const offNewTab = api?.onBrowserNewTab?.(() => {
      const page = focusedPage();
      if (page) postCommand(page.key, 'newTab');
    });
    return () => {
      offKeys();
      offFind?.();
      offNewTab?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postCommand]);

  const runMenu = (target: OpenMenu, action: PageMenuAction): void => {
    const page = pagesRef.current.find(candidate => candidate.key === target.key);
    const view = viewRefs.current.get(target.tabId);
    if (!page || !view) return;
    runPageMenuAction(view, action, {
      openInTab: url => {
        if (page.keyed) {
          openInLane(url, page.key);
          return;
        }
        const fresh: Tab = { id: nextTabId(), src: url, pinned: false };
        setPages(current =>
          current.map(candidate =>
            candidate.key === page.key
              ? { ...candidate, tabs: [...candidate.tabs, fresh], activeId: fresh.id }
              : candidate,
          ),
        );
      },
      savePage: () => postCommand(page.key, 'save'),
    });
  };

  // Opening, closing, putting aside or switching a page is itself news for the lane.
  useEffect(() => {
    postState();
  }, [postState, pages]);

  const offset = props.offset;
  if (!offset || pages.length === 0) return null;

  return (
    <>
      {pages.flatMap(page =>
        page.tabs.map(tab => (
          <BrowserWebview
            key={tab.id}
            src={tab.src}
            style={{
              position: 'fixed',
              top: offset.top + page.rect.y,
              left: offset.left + page.rect.x,
              width: page.rect.width,
              height: page.rect.height,
              display: 'flex',
              zIndex: 2,
            }}
            shown={tab.id === page.activeId && page.visible && !page.parked}
            // A page out of sight makes no sound: put aside, or behind another tab.
            audible={tab.id === page.activeId && !page.parked}
            // The folder's browser takes none of the browser panel's page script.
            plain
            register={(view: WebviewElement | null) => {
              if (view) viewRefs.current.set(tab.id, view);
              else {
                viewRefs.current.delete(tab.id);
                liveRefs.current.delete(tab.id);
              }
              sdlcWebviewChanged();
            }}
            onLive={(change: Partial<PageLive>) => {
              liveRefs.current.set(tab.id, { ...live(tab.id), ...change });
              if (change.hoverUrl !== undefined) {
                const url = change.hoverUrl;
                setHover(current =>
                  url ? { tabId: tab.id, url } : current?.tabId === tab.id ? null : current,
                );
              }
              // A link pointed at is the host's to show; the lane needn't hear of it.
              if (Object.keys(change).some(field => field !== 'hoverUrl')) postState();
            }}
            onChanged={postState}
            onMenu={(params: PageMenuParams) => {
              // The menu is the host's: it needs the keyboard the page has.
              takeFocusBack();
              // Electron gives a webview's click in the window's coordinates, which
              // place the menu; copying an image or inspecting there take the page's.
              const origin = { x: offset.left + page.rect.x, y: offset.top + page.rect.y };
              setMenu({
                key: page.key,
                tabId: tab.id,
                at: { x: params.x, y: params.y },
                params: { ...params, x: params.x - origin.x, y: params.y - origin.y },
              });
            }}
            onKey={(command: PageKeyCommand) => onPageKey(page, tab.id, command)}
            onPopup={(url: string) => {
              if (page.keyed) {
                openInLane(url, page.key);
                return;
              }
              const fresh: Tab = { id: nextTabId(), src: url, pinned: false };
              setPages(current =>
                current.map(candidate =>
                  candidate.key === page.key
                    ? { ...candidate, tabs: [...candidate.tabs, fresh], activeId: fresh.id }
                    : candidate,
                ),
              );
            }}
          />
        )),
      )}
      {hover &&
        (() => {
          const page = pages.find(
            candidate =>
              candidate.activeId === hover.tabId && candidate.visible && !candidate.parked,
          );
          return page ? (
            <LinkPreview
              url={hover.url}
              page={{
                left: offset.left + page.rect.x,
                top: offset.top + page.rect.y,
                width: page.rect.width,
                height: page.rect.height,
              }}
            />
          ) : null;
        })()}
      {menu &&
        (() => {
          const page = pages.find(candidate => candidate.key === menu.key);
          const view = viewRefs.current.get(menu.tabId);
          return (
            <PageContextMenu
              at={menu.at}
              params={menu.params}
              page={{
                canGoBack: view ? ask(() => view.canGoBack(), false) : false,
                canGoForward: view ? ask(() => view.canGoForward(), false) : false,
                saveable: Boolean(page?.keyed) && /^https?:/.test(menu.params.pageURL),
                inspectable: import.meta.env.DEV,
              }}
              onAction={action => runMenu(menu, action)}
              onClose={() => setMenu(null)}
              trackCategory='SdlcHub'
            />
          );
        })()}
    </>
  );
}
