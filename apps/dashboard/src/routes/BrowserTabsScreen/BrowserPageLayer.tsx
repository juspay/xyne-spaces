import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { createPortal } from 'react-dom';
import { useSelector } from '@xstate/react';
import { browserPanelActor, type BrowserTab } from '../../machines/browserPanelMachine';
import { useActivityTracking } from '../../hooks/useActivityTracking';
import { isElectronApp } from '../../utils/electronApp';
import { hostOf } from '../../utils/browserAddress';
import {
  BrowserWebview,
  LinkPreview,
  PageContextMenu,
  runPageMenuAction,
  ask,
  askAiAboutSelection,
  subscribeToPageKeys,
  type PageKeyCommand,
  type PageMenuAction,
  zoomPage,
  useFirstSeenOrder,
  useKeptAlive,
  type PageMenuParams,
} from '../../components/InAppBrowser';
import { browserPages, usePageHole, usePageLives } from './browserPages';
import { useUserPreference } from '../../machines/userPreferencesMachine';

const TRACK = 'BROWSER';
interface Place {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface OpenMenu {
  tabId: string;
  at: { x: number; y: number };
  params: PageMenuParams;
}

/**
 * Where the hole is on screen, followed as it moves: the docked panel resizes and
 * slides, the window resizes. Measured when the layout changes — never polled.
 */
function useHolePlace(hole: HTMLElement | null): Place | null {
  const [place, setPlace] = useState<Place | null>(null);
  useLayoutEffect(() => {
    if (!hole) return undefined;
    const measure = (): void => {
      const box = hole.getBoundingClientRect();
      setPlace(current =>
        current &&
        current.top === box.top &&
        current.left === box.left &&
        current.width === box.width &&
        current.height === box.height
          ? current
          : { top: box.top, left: box.left, width: box.width, height: box.height },
      );
    };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(hole);
    resize.observe(document.documentElement);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    // A panel sliding in moves the hole without resizing it; its move ends in one.
    document.addEventListener('transitionend', measure, true);
    return () => {
      resize.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
      document.removeEventListener('transitionend', measure, true);
    };
  }, [hole]);
  return place;
}

/** A page playing sound right now: never let go of, nor frozen, while it plays. */
const isPlayingSound = (tabId: string): boolean =>
  ask(() => browserPages.view(tabId)?.isCurrentlyAudible() ?? false, false);

/**
 * The browser panel's pages, in one place that never moves.
 *
 * A page taken out of the document and put back is loaded afresh, so the pages
 * can't live inside the browser screen — docked beside the app and full screen are
 * two screens. They live here instead, drawn over the hole whichever screen leaves,
 * and docking or undocking only moves the hole.
 *
 * The open tab's page shows; the few opened lately stay alive out of sight, and are
 * frozen after a minute so they run nothing. Closing the browser puts the open one
 * aside too. Past four, or ten minutes unused, the longest unused is let go. A page
 * playing sound plays on, as in Chrome — out of sight, with the browser hidden —
 * until its tab is muted or the sound stops.
 */
export function BrowserPageLayer(): ReactElement | null {
  const tabs = useSelector(browserPanelActor, state => state.context.tabs);
  const activeTabId = useSelector(browserPanelActor, state => state.context.activeTabId);
  const hole = usePageHole();
  const place = useHolePlace(hole);
  const lives = usePageLives();
  const pictureInPicture = useUserPreference('browserAutoPictureInPicture');
  // Where pages sit while the browser is closed: where they last were, so they keep
  // their size rather than lay themselves out again.
  const lastPlace = useRef<Place | null>(null);
  if (place) lastPlace.current = place;
  const { track } = useActivityTracking();
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeRef = useRef(activeTabId);
  activeRef.current = activeTabId;

  // The page on screen: the open tab's, while the browser shows.
  const shownId = hole && activeTabId ? activeTabId : null;

  const alive = useKeptAlive(
    tabs.map(tab => tab.id),
    shownId,
    isPlayingSound,
  );
  // Pages in the order they were opened, not their tabs': rearranging tabs would
  // otherwise move — and so reload — them.
  const pageTabs = useFirstSeenOrder(tabs, tab => tab.id);

  const openTab = useCallback(
    (url: string, options: { after?: string; background?: boolean } = {}) => {
      const tab: BrowserTab = {
        id: crypto.randomUUID(),
        url,
        title: hostOf(url) || url,
        canGoBack: false,
        canGoForward: false,
        isLoading: false,
      };
      browserPanelActor.send({
        type: 'ADD_TAB',
        tab,
        ...(options.after && { after: options.after }),
        ...(options.background && { background: true }),
      });
    },
    [],
  );

  /** Hands the keyboard back from a page, so the browser screen can have it. */
  const takeFocusBack = (): void => {
    void window.electronAPI?.focusHostWebContents?.();
  };

  const stepTab = (by: 1 | -1): void => {
    const list = tabsRef.current;
    const index = list.findIndex(tab => tab.id === activeRef.current);
    const next = list[(index + by + list.length) % list.length];
    if (next) browserPanelActor.send({ type: 'SWITCH_TAB', tabId: next.id });
  };

  const onKey = (command: PageKeyCommand): void => {
    const page = browserPages.view(activeRef.current);
    if (command === 'back') ask(() => page?.canGoBack() && page.goBack(), undefined);
    else if (command === 'forward') ask(() => page?.canGoForward() && page.goForward(), undefined);
    else if (command === 'nextTab') stepTab(1);
    else if (command === 'previousTab') stepTab(-1);
    else if (command === 'reopenTab') browserPanelActor.send({ type: 'REOPEN_TAB' });
    else if (command === 'zoomIn' || command === 'zoomOut' || command === 'zoomReset') {
      const tabId = activeRef.current;
      if (!page || !tabId) return;
      const step = command === 'zoomIn' ? 'in' : command === 'zoomOut' ? 'out' : 'reset';
      browserPages.setLive(tabId, { zoom: zoomPage(page, step) });
    } else {
      takeFocusBack();
      browserPages.command(command);
    }
  };
  const onKeyRef = useRef(onKey);
  onKeyRef.current = onKey;

  // Keys pressed inside a page reach the app, not the page: every browser in the
  // window hears them, and this one acts when the page with the keyboard is its own.
  useEffect(() => {
    const offKeys = subscribeToPageKeys(command => {
      if (browserPages.hasKeyboard()) onKeyRef.current(command);
    });
    const api = window.electronAPI;
    const offFind = api?.onBrowserFindInPage?.(() => {
      if (!browserPages.hasKeyboard()) return;
      takeFocusBack();
      browserPages.command('find');
    });
    const offNewTab = api?.onBrowserNewTab?.(() => {
      if (browserPages.hasKeyboard()) openTab('');
    });
    return () => {
      offKeys();
      offFind?.();
      offNewTab?.();
    };
  }, [openTab]);

  const onChanged = (tabId: string): void => {
    const page = browserPages.view(tabId);
    if (!page) return;
    const url = ask(() => page.getURL(), '');
    const patch: Partial<BrowserTab> = {
      canGoBack: ask(() => page.canGoBack(), false),
      canGoForward: ask(() => page.canGoForward(), false),
    };
    // Before a guest has gone anywhere it reports nothing, or a blank page.
    if (/^https?:/.test(url)) {
      patch.url = url;
      patch.title = ask(() => page.getTitle(), '') || hostOf(url) || url;
      const before = tabsRef.current.find(tab => tab.id === tabId)?.url;
      if (tabId === activeRef.current && before !== url) {
        track({
          eventCategory: TRACK,
          eventName: 'INTERNAL_NAVIGATION',
          eventLabel: url,
          contextMetadata: { tabId, url },
        });
      }
    }
    browserPanelActor.send({ type: 'UPDATE_TAB', tabId, patch });
  };

  const runMenu = (target: OpenMenu, action: PageMenuAction): void => {
    const page = browserPages.view(target.tabId);
    if (!page) return;
    runPageMenuAction(page, action, {
      // Beside the page it came from, behind it, as a browser's own menu does.
      openInTab: url => openTab(url, { after: target.tabId, background: true }),
    });
  };

  const at = place ?? lastPlace.current;
  if (!isElectronApp() || !at) return null;

  return createPortal(
    <>
      {pageTabs.map(tab =>
        tab.url && alive.has(tab.id) ? (
          <BrowserWebview
            key={tab.id}
            src={tab.url}
            style={{
              position: 'fixed',
              top: at.top,
              left: at.left,
              width: at.width,
              height: at.height,
              zIndex: 1,
            }}
            shown={tab.id === shownId}
            audible={!tab.muted}
            plain={false}
            register={view => browserPages.setView(tab.id, view)}
            onLive={change => {
              browserPages.setLive(tab.id, change);
              if (change.favicon) {
                browserPanelActor.send({
                  type: 'UPDATE_TAB',
                  tabId: tab.id,
                  patch: { favicon: change.favicon },
                });
              }
            }}
            onChanged={() => onChanged(tab.id)}
            onMenu={params => {
              takeFocusBack();
              // Electron gives the click in the window's coordinates, which place
              // the menu; copying an image or inspecting there take the page's.
              setMenu({
                tabId: tab.id,
                at: { x: params.x, y: params.y },
                params: { ...params, x: params.x - at.left, y: params.y - at.top },
              });
            }}
            onKey={command => onKeyRef.current(command)}
            onPopup={(url, background) => openTab(url, { after: tab.id, background })}
            pictureInPicture={pictureInPicture}
            onPictureInPictureReturn={() => {
              // Back to the video's tab: the browser shows it, and the app comes forward.
              browserPanelActor.send({ type: 'SWITCH_TAB', tabId: tab.id });
              if (!browserPages.isShowing()) browserPanelActor.send({ type: 'OPEN' });
              window.electronAPI?.bringAppToFront?.();
            }}
            onAskAi={payload => {
              const page = browserPages.view(tab.id);
              if (!page) return;
              askAiAboutSelection(
                payload,
                { url: ask(() => page.getURL(), ''), title: ask(() => page.getTitle(), '') },
                'browser_panel',
              );
            }}
          />
        ) : null,
      )}
      {shownId && place && <LinkPreview url={lives[shownId]?.hoverUrl ?? ''} page={place} />}
      {menu &&
        (() => {
          const page = browserPages.view(menu.tabId);
          return (
            <PageContextMenu
              at={menu.at}
              params={menu.params}
              page={{
                canGoBack: page ? ask(() => page.canGoBack(), false) : false,
                canGoForward: page ? ask(() => page.canGoForward(), false) : false,
                saveable: false,
                inspectable: import.meta.env.DEV,
              }}
              onAction={action => runMenu(menu, action)}
              onClose={() => setMenu(null)}
              trackCategory={TRACK}
            />
          );
        })()}
    </>,
    document.body,
  );
}
