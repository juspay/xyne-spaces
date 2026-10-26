import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import {
  registerSdlcWebviewGetter,
  sdlcWebviewChanged,
} from '../../components/AIScreen/Workspace/sdlcBrowserTarget';
import type { ElectronWebviewElement } from '../../types/electron';
import {
  BrowserWebview,
  IDLE_PAGE,
  useKeptAlive,
  LinkPreview,
  PageContextMenu,
  runPageMenuAction,
  ask,
  subscribeToPageKeys,
  type PageKeyCommand,
  type PageLive,
  type PageMenuAction,
  type PageMenuParams,
  type WebviewElement,
  zoomPage,
} from '../../components/InAppBrowser';
import {
  dropEmbedPlacements,
  emitEmbeddedCommand,
  emitEmbeddedOpen,
  publishEmbeddedPages,
  registerEmbedController,
  useEmbedPlacements,
  type SdlcEmbedCommand,
} from './sdlcEmbeddedPages';

/** A right-click in a page, and the page: the holder's menu for it. */
interface OpenMenu {
  key: string;
  at: { x: number; y: number };
  params: PageMenuParams;
}

/**
 * The live pages of a folder's browsing tabs, each over the hole its tab leaves.
 *
 * They live here rather than in their tabs because a <webview> reloads when it
 * moves in the DOM. The folder page says where the pages go and draws the chrome;
 * this drives them and reports back what they are doing, so the two never disagree
 * about what is on screen.
 *
 * Each tab's page is held for as long as the tab is open: switching away puts it
 * aside, hidden and muted, so coming back finds it as it was — scrolled, signed in,
 * mid-form. A few are kept; past that, or after a while unused, the longest put
 * aside is let go, and comes back by loading afresh.
 */
export function SdlcEmbeddedWebview(): ReactElement | null {
  const pages = useEmbedPlacements();
  const viewRefs = useRef(new Map<string, WebviewElement>());
  // Announced by the page's events rather than read off it, so kept beside the
  // element rather than in the page list.
  const liveRefs = useRef(new Map<string, PageLive>());

  // Each page's listeners are bound once, when that page mounts, so a callback
  // closing over state would keep reporting the moment it was bound. Refs give
  // the listeners stable functions that still read the present.
  const pagesRef = useRef(pages);
  pagesRef.current = pages;

  /** The page on screen: the one the reader is looking at, for the annotator and the agent. */
  const shownView = useCallback((): WebviewElement | null => {
    const page = pagesRef.current.find(candidate => candidate.visible && !candidate.parked);
    return page ? (viewRefs.current.get(page.key) ?? null) : null;
  }, []);

  const live = (key: string): PageLive => liveRefs.current.get(key) ?? IDLE_PAGE;

  /** Hands the keyboard back from a page, so what the folder or a menu draws can take it. */
  const takeFocusBack = (): void => {
    void window.electronAPI?.focusHostWebContents?.();
  };

  const [menu, setMenu] = useState<OpenMenu | null>(null);
  // The link under the pointer in a page, for its address to show.
  const [hover, setHover] = useState<{ key: string; url: string } | null>(null);

  useEffect(
    () =>
      registerSdlcWebviewGetter(
        () => (shownView() as unknown as ElectronWebviewElement | null) ?? null,
      ),
    [shownView],
  );
  // Another tab shown: Xyne AI, waiting for the browser, looks again.
  const shownKey = pages.find(page => page.visible && !page.parked)?.key ?? null;
  useEffect(() => sdlcWebviewChanged(), [shownKey]);

  /** Tells the folder what every page is doing, for its tabs and its bar. */
  const publishState = useCallback((): void => {
    publishEmbeddedPages(
      pagesRef.current.map(page => {
        const view = viewRefs.current.get(page.key);
        const state = live(page.key);
        return {
          key: page.key,
          url: (view ? ask(() => view.getURL(), '') : '') || page.url,
          title: view ? ask(() => view.getTitle(), '') : '',
          favicon: state.favicon,
          loading: state.loading,
          canGoBack: view ? ask(() => view.canGoBack(), false) : false,
          canGoForward: view ? ask(() => view.canGoForward(), false) : false,
          error: state.error,
          find: state.find,
        };
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Which pages put aside stay alive: the same rules as the app's browser — the few
  // shown lately, a while each, all let go when memory runs short (useKeptAlive).
  // Pages the folder is showing are its own to keep; only those put aside are let go.
  const isPlaying = useCallback((key: string): boolean => {
    const view = viewRefs.current.get(key);
    return ask(() => view?.isCurrentlyAudible() ?? false, false);
  }, []);
  const alive = useKeptAlive(
    pages.map(page => page.key),
    shownKey,
    isPlaying,
  );
  useEffect(() => {
    const gone = pages.filter(page => page.parked && !alive.has(page.key)).map(page => page.key);
    if (gone.length > 0) dropEmbedPlacements(gone);
  }, [pages, alive]);

  useEffect(
    () =>
      registerEmbedController((key, action, payload) => {
        const view = viewRefs.current.get(key);
        if (!view) return;
        if (action === 'find' && payload.text) {
          // Electron's findNext begins a new search; the folder's means a step in this one.
          const text = payload.text;
          ask(
            () =>
              view.findInPage(text, {
                forward: payload.forward !== false,
                findNext: !payload.findNext,
              }),
            0,
          );
          return;
        }
        if (action === 'stopFind') {
          ask(() => view.stopFindInPage('clearSelection'), undefined);
          liveRefs.current.set(key, { ...live(key), find: null });
          publishState();
          return;
        }
        ask(() => {
          if (action === 'back' && view.canGoBack()) view.goBack();
          else if (action === 'forward' && view.canGoForward()) view.goForward();
          else if (action === 'reload') view.reload();
          else if (action === 'stop') view.stop();
          else if (action === 'goto' && payload.url) void view.loadURL(payload.url);
          return null;
        }, null);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [publishState],
  );

  /** A browser key pressed in a page: back and forward are the page's own, the rest
   *  the folder's chrome. */
  const onPageKey = (key: string, command: PageKeyCommand): void => {
    const view = viewRefs.current.get(key);
    if (command === 'back') ask(() => view?.canGoBack() && view.goBack(), undefined);
    else if (command === 'forward') ask(() => view?.canGoForward() && view.goForward(), undefined);
    else if (command === 'zoomIn' || command === 'zoomOut' || command === 'zoomReset') {
      // The page's own zoom, kept for its site — nothing the folder draws.
      if (view)
        zoomPage(view, command === 'zoomIn' ? 'in' : command === 'zoomOut' ? 'out' : 'reset');
    } else if (command === 'reopenTab') {
      // A folder keeps no closed tabs to bring back.
    } else {
      takeFocusBack();
      const asFolder: SdlcEmbedCommand = command;
      emitEmbeddedCommand(key, asFolder);
    }
  };
  const onPageKeyRef = useRef(onPageKey);
  onPageKeyRef.current = onPageKey;

  // ⌘F and ⌘T pressed inside a page are caught by the main process and sent to this
  // window without saying which page — as are the browser keys, from a desktop app
  // that passes those on: the one with focus is the one that asked.
  useEffect(() => {
    const focusedKey = (): string | undefined =>
      pagesRef.current.find(page => viewRefs.current.get(page.key) === document.activeElement)?.key;
    const offKeys = subscribeToPageKeys(command => {
      const key = focusedKey();
      if (key) onPageKeyRef.current(key, command);
    });
    const api = window.electronAPI;
    const offFind = api?.onBrowserFindInPage?.(() => {
      const key = focusedKey();
      if (!key) return;
      takeFocusBack();
      emitEmbeddedCommand(key, 'find');
    });
    const offNewTab = api?.onBrowserNewTab?.(() => {
      const key = focusedKey();
      if (key) emitEmbeddedCommand(key, 'newTab');
    });
    return () => {
      offKeys();
      offFind?.();
      offNewTab?.();
    };
  }, []);

  const runMenu = (target: OpenMenu, action: PageMenuAction): void => {
    const view = viewRefs.current.get(target.key);
    if (!view) return;
    runPageMenuAction(view, action, {
      openInTab: url => emitEmbeddedOpen(url, target.key),
      savePage: () => emitEmbeddedCommand(target.key, 'save'),
    });
  };

  // Opening, closing, putting aside or moving a page is itself news for the folder.
  useEffect(() => {
    publishState();
  }, [publishState, pages]);

  if (pages.length === 0) return null;

  return createPortal(
    <>
      {pages.map(page => (
        <BrowserWebview
          key={page.key}
          src={page.url}
          style={{
            position: 'fixed',
            top: page.rect.y,
            left: page.rect.x,
            width: page.rect.width,
            height: page.rect.height,
            display: 'flex',
            zIndex: 2,
          }}
          shown={page.visible && !page.parked}
          // A page out of sight makes no sound: put aside, its tab not open.
          audible={!page.parked}
          // The folder's browser takes none of the browser panel's page script.
          plain
          register={(view: WebviewElement | null) => {
            if (view) viewRefs.current.set(page.key, view);
            else {
              viewRefs.current.delete(page.key);
              liveRefs.current.delete(page.key);
            }
            sdlcWebviewChanged();
          }}
          onLive={(change: Partial<PageLive>) => {
            liveRefs.current.set(page.key, { ...live(page.key), ...change });
            if (change.hoverUrl !== undefined) {
              const url = change.hoverUrl;
              setHover(current =>
                url ? { key: page.key, url } : current?.key === page.key ? null : current,
              );
            }
            // A link pointed at is ours to show; the folder needn't hear of it.
            if (Object.keys(change).some(field => field !== 'hoverUrl')) publishState();
          }}
          onChanged={publishState}
          onMenu={(params: PageMenuParams) => {
            // The menu is ours: it needs the keyboard the page has.
            takeFocusBack();
            // Electron gives a webview's click in the window's coordinates, which
            // place the menu; copying an image or inspecting there take the page's.
            setMenu({
              key: page.key,
              at: { x: params.x, y: params.y },
              params: { ...params, x: params.x - page.rect.x, y: params.y - page.rect.y },
            });
          }}
          onKey={(command: PageKeyCommand) => onPageKey(page.key, command)}
          onPopup={(url: string) => emitEmbeddedOpen(url, page.key)}
        />
      ))}
      {hover &&
        (() => {
          const page = pages.find(
            candidate => candidate.key === hover.key && candidate.visible && !candidate.parked,
          );
          return page ? (
            <LinkPreview
              url={hover.url}
              page={{
                left: page.rect.x,
                top: page.rect.y,
                width: page.rect.width,
                height: page.rect.height,
              }}
            />
          ) : null;
        })()}
      {menu &&
        (() => {
          const view = viewRefs.current.get(menu.key);
          return (
            <PageContextMenu
              at={menu.at}
              params={menu.params}
              page={{
                canGoBack: view ? ask(() => view.canGoBack(), false) : false,
                canGoForward: view ? ask(() => view.canGoForward(), false) : false,
                saveable: /^https?:/.test(menu.params.pageURL),
                inspectable: import.meta.env.DEV,
              }}
              onAction={action => runMenu(menu, action)}
              onClose={() => setMenu(null)}
              trackCategory='SdlcHub'
            />
          );
        })()}
    </>,
    document.body,
  );
}
