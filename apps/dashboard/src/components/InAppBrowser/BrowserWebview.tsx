import { useEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import { pickWebviewPartition } from '../../utils/browserPanelPartition';
import { registerEmbeddedWebview } from '../../utils/embeddedWebviewRegistry';
import type { PageLoadError } from './LoadError';
import type { FindResult } from './FindBar';
import type { PageMenuParams } from './PageContextMenu';
import {
  KEY_RELAY,
  PICTURE_IN_PICTURE_RETURN,
  consoleCommand,
  desktopPassesPageKeys,
  type PageKeyCommand,
} from './pageKeys';
import { isOnBattery } from './power';
import { ask } from './ask';
import { zoomFor, zoomPage } from './zoom';

/** The slice of Electron's webview element the in-app browsers use. */
export interface WebviewElement extends HTMLElement {
  goBack: () => void;
  goForward: () => void;
  reload: () => void;
  stop: () => void;
  loadURL: (url: string) => Promise<void>;
  canGoBack: () => boolean;
  canGoForward: () => boolean;
  getURL: () => string;
  getTitle: () => string;
  isLoading: () => boolean;
  setAudioMuted: (muted: boolean) => void;
  isCurrentlyAudible: () => boolean;
  getWebContentsId: () => number;
  executeJavaScript: (script: string, userGesture?: boolean) => Promise<unknown>;
  getZoomFactor: () => number;
  setZoomFactor: (factor: number) => void;
  replaceMisspelling: (text: string) => void;
  findInPage: (text: string, options: { forward: boolean; findNext: boolean }) => number;
  stopFindInPage: (action: 'clearSelection' | 'keepSelection') => void;
  undo: () => void;
  redo: () => void;
  cut: () => void;
  copy: () => void;
  paste: () => void;
  selectAll: () => void;
  copyImageAt: (x: number, y: number) => void;
  inspectElement: (x: number, y: number) => void;
}

/** What a page is doing, as its events say; its address and title are read off it. */
export interface PageLive {
  loading: boolean;
  error: PageLoadError | null;
  favicon: string;
  find: FindResult | null;
  /** Playing a video or a sound. */
  playing: boolean;
  /** The link under the pointer, for its address to show; empty for none. */
  hoverUrl: string;
  /** Its zoom: 1 at 100%. */
  zoom: number;
}

export const IDLE_PAGE: PageLive = {
  loading: false,
  error: null,
  favicon: '',
  find: null,
  playing: false,
  hoverUrl: '',
  zoom: 1,
};

/** Chromium's code for a load that was stopped or replaced by another: not a failure. */
const ERR_ABORTED = -3;
/** How long a page out of sight runs on before it is frozen; on battery, less. */
const FREEZE_AFTER_MS = 60_000;
const FREEZE_ON_BATTERY_AFTER_MS = 15_000;

/** How to wake each mounted page that can be frozen. */
const wakers = new WeakMap<object, () => Promise<void>>();

/**
 * Wakes a page frozen out of sight, for something about to work in it, and keeps it
 * awake a while longer. Resolves once it runs again; at once for a page that isn't
 * frozen, or isn't one of these.
 */
export function wakePage(view: object): Promise<void> {
  return wakers.get(view)?.() ?? Promise.resolve();
}

/** Floats the page's playing video — its biggest — in a window of its own. */
const PICTURE_IN_PICTURE = `(() => {
  if (document.pictureInPictureElement || !document.pictureInPictureEnabled) return false;
  const playing = [...document.querySelectorAll('video')].filter(
    video => !video.paused && !video.ended && video.readyState > 2 && !video.disablePictureInPicture,
  );
  playing.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight);
  const video = playing[0];
  if (!video) return false;
  const say = console.debug.bind(console);
  return video.requestPictureInPicture().then(() => {
    // Back to tab closes the floating window and leaves the video playing, where its
    // close button pauses it a moment before: the page says which, for the app.
    video.addEventListener('leavepictureinpicture', () => {
      setTimeout(() => { if (!video.paused) say(${JSON.stringify(PICTURE_IN_PICTURE_RETURN)}); }, 150);
    }, { once: true });
    return true;
  }, () => false);
})()`;
/** Brings a floating video back into its page. */
const LEAVE_PICTURE_IN_PICTURE = `document.pictureInPictureElement
  ? document.exitPictureInPicture().then(() => true, () => false)
  : false`;

export { ask };

/**
 * One page of an in-app browser: a <webview>, and what it does said back as it
 * happens — loading, failing, its icon, find results, a right-click, a key meant
 * for the browser, a link wanting a new tab, text sent to Xyne AI.
 *
 * Its partition is chosen once, from where it starts: a Xyne address loads signed
 * in, everything else in the outside sites' jar, which Xyne's cookies never enter.
 */
export function BrowserWebview(props: {
  /** Where it starts. Taken once: after that it goes where its reader takes it, and
   *  anywhere else through `loadURL`. */
  src: string;
  /** Where it sits; whether it shows is `shown`. */
  style: CSSProperties;
  /** On screen. Kept mounted out of sight otherwise, so it keeps its scroll and history. */
  shown: boolean;
  /** Heard: off while put aside or behind another tab. */
  audible: boolean;
  /** Plain browsing: none of the desktop app's page script (its Ask AI button). */
  plain: boolean;
  register: (view: WebviewElement | null) => void;
  onLive: (change: Partial<PageLive>) => void;
  /** It went somewhere, or its title changed. */
  onChanged: () => void;
  onMenu: (params: PageMenuParams) => void;
  onKey: (command: PageKeyCommand) => void;
  /** A link or a script asked for a new window; `background` for a ⌘-click or
   *  middle click, which opens behind. */
  onPopup: (url: string, background: boolean) => void;
  /** Ask AI was pressed on a selection; absent where the page has no Ask AI. */
  onAskAi?: (payload: unknown) => void;
  /** A playing video floats in its own window while its page is out of sight. */
  pictureInPicture?: boolean;
  /** The floating video's "back to tab" was pressed. */
  onPictureInPictureReturn?: () => void;
}): ReactElement {
  const ref = useRef<WebviewElement | null>(null);
  const [failed, setFailed] = useState(false);
  const playingRef = useRef(false);
  // A floating video this page put up, while it is up: only then is "back to tab"
  // heard from the page, which could otherwise say it whenever it liked.
  const floatingRef = useRef(false);
  // The page is full screen — a video — and covers the app's whole window meanwhile.
  const [pageFullscreen, setPageFullscreen] = useState(false);
  // The listeners are bound once, when the page mounts; through this they still
  // reach the present callbacks.
  const propsRef = useRef(props);
  propsRef.current = props;
  const srcRef = useRef(props.src);
  const partitionRef = useRef(pickWebviewPartition(props.src));

  useEffect(() => {
    const view = ref.current;
    if (!view) return undefined;
    const now = (): typeof props => propsRef.current;
    now().register(view);

    const onChanged = (): void => now().onChanged();
    const events = ['did-navigate', 'did-navigate-in-page', 'page-title-updated'];
    events.forEach(name => view.addEventListener(name, onChanged));

    const onStart = (): void => {
      setFailed(false);
      now().onLive({ loading: true, error: null, find: null });
    };
    const onFullscreen = (): void => setPageFullscreen(true);
    const onFullscreenLeft = (): void => setPageFullscreen(false);
    const onPlaying = (): void => {
      playingRef.current = true;
      now().onLive({ playing: true });
    };
    const onPaused = (): void => {
      playingRef.current = false;
      now().onLive({ playing: false });
    };
    const onHover = (event: Event): void => {
      now().onLive({ hoverUrl: (event as Event & { url?: string }).url ?? '' });
    };
    // A site opens at the zoom it was last given here.
    const onNavigated = (): void => {
      const factor = zoomFor(ask(() => view.getURL(), ''));
      ask(() => view.setZoomFactor(factor), undefined);
      now().onLive({ zoom: factor, hoverUrl: '' });
    };
    const onStop = (): void => now().onLive({ loading: false });
    const onFound = (event: Event): void => {
      // Electron puts the result on the event itself, not in `detail`.
      const result = (
        event as Event & { result?: { activeMatchOrdinal?: number; matches?: number } }
      ).result;
      if (result?.matches === undefined) return;
      now().onLive({ find: { active: result.activeMatchOrdinal ?? 0, matches: result.matches } });
    };
    const onContextMenu = (event: Event): void => {
      const params = (event as Event & { params?: PageMenuParams }).params;
      if (params) now().onMenu(params);
    };
    const onConsole = (event: Event): void => {
      const line = (event as Event & { message?: string }).message;
      if (line === PICTURE_IN_PICTURE_RETURN) {
        if (!floatingRef.current) return;
        floatingRef.current = false;
        now().onPictureInPictureReturn?.();
        return;
      }
      const command = consoleCommand(line);
      if (command) now().onKey(command);
    };
    const onFail = (event: Event): void => {
      const detail = event as Event & {
        errorCode?: number;
        errorDescription?: string;
        validatedURL?: string;
        isMainFrame?: boolean;
      };
      if (
        !detail.isMainFrame ||
        detail.errorCode === undefined ||
        detail.errorCode === ERR_ABORTED
      ) {
        return;
      }
      setFailed(true);
      now().onLive({
        loading: false,
        error: {
          code: detail.errorCode,
          description: detail.errorDescription ?? '',
          url: detail.validatedURL ?? srcRef.current,
        },
      });
    };
    const onFavicon = (event: Event): void => {
      const icons = (event as Event & { favicons?: string[] }).favicons;
      if (icons?.[0]) now().onLive({ favicon: icons[0] });
    };
    const onMessage = (event: Event): void => {
      const { channel, args } = event as Event & { channel?: string; args?: unknown[] };
      if (channel === 'ask-ai-request') now().onAskAi?.(args?.[0]);
    };
    view.addEventListener('did-start-loading', onStart);
    view.addEventListener('did-stop-loading', onStop);
    view.addEventListener('did-fail-load', onFail);
    view.addEventListener('page-favicon-updated', onFavicon);
    view.addEventListener('found-in-page', onFound);
    view.addEventListener('context-menu', onContextMenu);
    view.addEventListener('console-message', onConsole);
    view.addEventListener('ipc-message', onMessage);
    view.addEventListener('media-started-playing', onPlaying);
    view.addEventListener('enter-html-full-screen', onFullscreen);
    view.addEventListener('update-target-url', onHover);
    view.addEventListener('did-navigate', onNavigated);
    view.addEventListener('leave-html-full-screen', onFullscreenLeft);
    view.addEventListener('media-paused', onPaused);

    // A link that wants its own window gets a tab of this browser's own, rather than
    // being thrown to another browser across the window. The webContents id only
    // exists once the guest is attached, which dom-ready announces.
    let unregister = (): void => {};
    const onReady = (): void => {
      const id = ask(() => view.getWebContentsId(), null);
      if (id !== null) {
        unregister();
        unregister = registerEmbeddedWebview(id, (url, background) =>
          now().onPopup(url, background),
        );
      }
      // Each document anew, and only where the desktop app doesn't pass keys on.
      if (!desktopPassesPageKeys()) {
        void ask(() => view.executeJavaScript(KEY_RELAY), Promise.resolve()).catch(() => undefined);
      }
      now().onChanged();
    };
    view.addEventListener('dom-ready', onReady);

    // Now and then a guest attaches without starting on its src — no load, no
    // dom-ready — and would sit on a blank page for good. When it attaches, and a
    // little after, one still on nothing and not loading is started by hand, once.
    let kicked = false;
    const kick = (): void => {
      if (kicked) return;
      const at = ask(() => view.getURL(), null);
      if (at === null || (at !== '' && at !== 'about:blank')) return;
      const src = srcRef.current;
      if (ask(() => view.isLoading(), false) || src === 'about:blank') return;
      kicked = true;
      void ask(() => view.loadURL(src), Promise.resolve()).catch(() => undefined);
    };
    view.addEventListener('did-attach', kick);
    const kickTimers = [800, 2500].map(delay => window.setTimeout(kick, delay));

    return () => {
      events.forEach(name => view.removeEventListener(name, onChanged));
      view.removeEventListener('did-start-loading', onStart);
      view.removeEventListener('did-stop-loading', onStop);
      view.removeEventListener('did-fail-load', onFail);
      view.removeEventListener('page-favicon-updated', onFavicon);
      view.removeEventListener('found-in-page', onFound);
      view.removeEventListener('context-menu', onContextMenu);
      view.removeEventListener('console-message', onConsole);
      view.removeEventListener('ipc-message', onMessage);
      view.removeEventListener('media-started-playing', onPlaying);
      view.removeEventListener('enter-html-full-screen', onFullscreen);
      view.removeEventListener('update-target-url', onHover);
      view.removeEventListener('did-navigate', onNavigated);
      view.removeEventListener('leave-html-full-screen', onFullscreenLeft);
      view.removeEventListener('media-paused', onPaused);
      view.removeEventListener('dom-ready', onReady);
      view.removeEventListener('did-attach', kick);
      kickTimers.forEach(timer => window.clearTimeout(timer));
      unregister();
      now().register(null);
    };
  }, []);

  // ⌘-scroll over this page, which the desktop app passes on by the page's id: a
  // step in or out, as the keys do.
  useEffect(() => {
    const view = ref.current;
    const api = window.electronAPI;
    if (!view || !api?.onBrowserPageZoom) return undefined;
    return api.onBrowserPageZoom((pageId, direction) => {
      if (pageId !== ask(() => view.getWebContentsId(), null)) return;
      propsRef.current.onLive({ zoom: zoomPage(view, direction) });
    });
  }, []);

  // A page out of sight makes no sound.
  useEffect(() => {
    const view = ref.current;
    if (view) ask(() => view.setAudioMuted(!props.audible), undefined);
  }, [props.audible]);

  // A video playing as its page goes out of sight floats on in a window of its own,
  // as in Arc, and comes back into the page when it shows again. Pressed for the
  // reader, since a page can only do it on a click.
  useEffect(() => {
    const view = ref.current;
    if (!view || !props.pictureInPicture) return;
    if (props.shown) {
      // Back on screen: the video comes home, and that isn't "back to tab" pressed.
      floatingRef.current = false;
      void ask(
        () => view.executeJavaScript(LEAVE_PICTURE_IN_PICTURE, true),
        Promise.resolve(),
      ).catch(() => undefined);
    } else if (playingRef.current) {
      void ask(() => view.executeJavaScript(PICTURE_IN_PICTURE, true), Promise.resolve())
        .then(floating => {
          floatingRef.current = floating === true;
        })
        .catch(() => undefined);
    }
  }, [props.shown, props.pictureInPicture]);

  // A page going out of sight with the keyboard gives it back to the app: typing
  // would otherwise go on into a page no one can see. Only the desktop app can move
  // focus off a page — blurring it leaves it where it is.
  useEffect(() => {
    const view = ref.current;
    if (props.shown || !view || document.activeElement !== view) return;
    view.blur();
    void window.electronAPI?.focusHostWebContents?.();
  }, [props.shown]);

  // A page out of sight a while is frozen — it runs nothing, as Chrome's background
  // tabs — and woken the moment it shows again; one playing sound is left playing,
  // and looked at again later. Where the desktop app can't freeze pages, they run on.
  const frozenRef = useRef(false);
  useEffect(() => {
    const view = ref.current;
    const api = window.electronAPI;
    if (!view || !api?.setBrowserPageFrozen) return undefined;
    const freeze = (frozen: boolean): Promise<void> => {
      const id = ask(() => view.getWebContentsId(), null);
      if (id === null) return Promise.resolve();
      frozenRef.current = frozen;
      return (api.setBrowserPageFrozen?.(id, frozen) ?? Promise.resolve()).then(
        () => undefined,
        () => undefined,
      );
    };
    let timer = 0;
    const later = (): void => {
      timer = window.setTimeout(
        () => {
          if (ask(() => view.isCurrentlyAudible(), false)) later();
          else void freeze(true);
        },
        isOnBattery() ? FREEZE_ON_BATTERY_AFTER_MS : FREEZE_AFTER_MS,
      );
    };
    if (props.shown) {
      if (frozenRef.current) void freeze(false);
    } else {
      later();
    }
    // Something working in the page while it is out of sight — Xyne AI's page tools —
    // wakes it, and it is given a fresh while before it is frozen again.
    const wake = (): Promise<void> => {
      const woken = frozenRef.current ? freeze(false) : Promise.resolve();
      if (!props.shown) {
        window.clearTimeout(timer);
        later();
      }
      return woken;
    };
    wakers.set(view, wake);
    return () => {
      window.clearTimeout(timer);
      if (wakers.get(view) === wake) wakers.delete(view);
    };
  }, [props.shown]);

  // A page that failed steps aside for the error card drawn in its place.
  const shown = props.shown && !failed;
  return (
    <webview
      ref={ref as unknown as React.Ref<HTMLElement>}
      {...({
        src: srcRef.current,
        partition: partitionRef.current,
        allowpopups: '',
        // Tells the desktop app this page takes none of its page script.
        ...(props.plain && { webpreferences: 'xyneSurface=plain' }),
        style: {
          ...props.style,
          // Full screen, over everything in the window, until the page leaves it.
          ...(pageFullscreen && {
            position: 'fixed' as const,
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            zIndex: 2147483000,
          }),
          visibility: shown || pageFullscreen ? ('visible' as const) : ('hidden' as const),
          pointerEvents: shown || pageFullscreen ? ('auto' as const) : ('none' as const),
        },
      } as Record<string, unknown>)}
    />
  );
}
