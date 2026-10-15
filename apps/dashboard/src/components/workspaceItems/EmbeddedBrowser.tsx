import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { isElectronApp } from '../../utils/electronApp';
import type { ElectronWebviewElement } from '../../types/electron';
import { SandboxedFrame } from './primitives';
import { ask } from '../InAppBrowser/ask';
import { subscribeToPageKeys, type PageKeyCommand } from '../InAppBrowser/pageKeys';
import { zoomPage } from '../InAppBrowser/zoom';
import {
  BrowserWebview,
  IDLE_PAGE,
  type PageLive,
  type WebviewElement,
} from '../InAppBrowser/BrowserWebview';
import { LoadError } from '../InAppBrowser/LoadError';
import { LinkPreview } from '../InAppBrowser/LinkPreview';
import {
  PageContextMenu,
  type PageMenuAction,
  type PageMenuParams,
} from '../InAppBrowser/PageContextMenu';
import { runPageMenuAction } from '../InAppBrowser/pageMenuActions';
import {
  canHostEmbedPages,
  embedPageOverElement,
  reclaimHostFocus,
} from '../../routes/SdlcScreen/useSdlcFrameBridge';

export interface EmbeddedBrowserProps {
  url: string;
  title: string;
  /** Rendered above the page, for a surface's own notice or offer. */
  banner?: (view: ElectronWebviewElement | null) => ReactNode;
  /** Rendered over the page, for a surface's own controls. */
  overlay?: (view: ElectronWebviewElement | null) => ReactNode;
  /** Called with the live webview, and with null when it goes away. */
  onView?: (view: ElectronWebviewElement | null) => void;
  /** Called on every navigation, with the url the page moved to. */
  onNavigate?: (url: string) => void;
  /**
   * On screen. A surface that keeps the page while showing something else says
   * so: out of sight a while, the page is frozen, and it wakes when shown again.
   */
  shown?: boolean;
  /** Told when the page starts or stops playing a video or a sound. */
  onPlaying?: (playing: boolean) => void;
}

/**
 * A page held by the host window, over a hole this element leaves. Used when the
 * surface is inside a frame, where a webview of its own cannot live.
 */
function HostedPage({ url }: { url: string }): ReactElement {
  const [element, setElement] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!element) return undefined;
    return embedPageOverElement(url, element);
  }, [url, element]);

  return <div ref={setElement} className='h-full w-full bg-background' />;
}

/** A right-click in the page: the menu, where the click was, and the page's own point. */
interface OpenMenu {
  at: { x: number; y: number };
  params: PageMenuParams;
}

/**
 * One web page, as Xyne AI's workspace shows it: the in-app browsers' own page —
 * its error card, right-click menu, link preview, zoom and keys — without tabs or a
 * bar of its own, which the surface around it provides. A link that wants a new
 * window opens in this same page.
 */
export function EmbeddedBrowser({
  url,
  title,
  banner,
  overlay,
  onView,
  onNavigate,
  shown = true,
  onPlaying,
}: EmbeddedBrowserProps): ReactElement {
  const [view, setView] = useState<WebviewElement | null>(null);
  const viewRef = useRef<WebviewElement | null>(null);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [live, setLive] = useState<PageLive>(IDLE_PAGE);
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const onViewRef = useRef(onView);
  onViewRef.current = onView;
  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;
  const onPlayingRef = useRef(onPlaying);
  onPlayingRef.current = onPlaying;

  const releaseFocus = useCallback((): void => {
    reclaimHostFocus();
    void window.electronAPI?.focusHostWebContents?.();
  }, []);

  const register = useCallback((next: WebviewElement | null): void => {
    viewRef.current = next;
    setView(next);
    // The same element, as the surfaces that drive it type it.
    onViewRef.current?.(next ? (next as unknown as ElectronWebviewElement) : null);
  }, []);

  /** Back, forward and zoom, from the keyboard while this page has it. */
  const onKey = useCallback((command: PageKeyCommand): void => {
    const page = viewRef.current;
    if (!page) return;
    ask(() => {
      if (command === 'back' && page.canGoBack()) page.goBack();
      else if (command === 'forward' && page.canGoForward()) page.goForward();
      else if (command === 'zoomIn' || command === 'zoomOut' || command === 'zoomReset') {
        zoomPage(page, command === 'zoomIn' ? 'in' : command === 'zoomOut' ? 'out' : 'reset');
      }
      return null;
    }, null);
  }, []);

  // Browser keys pressed in this page, which the desktop app passes on — the View
  // menu's zoom too. The rest belong to browsers with a bar.
  useEffect(() => {
    if (!view) return undefined;
    return subscribeToPageKeys(command => {
      if (document.activeElement === view) onKey(command);
    });
  }, [view, onKey]);

  useEffect(() => {
    if (!host) return;
    let outside = false;
    const onMove = (event: PointerEvent): void => {
      const target = event.target as Node | null;
      const isOutside = !target || !host.contains(target);
      if (isOutside === outside) return;
      outside = isOutside;
      if (isOutside) releaseFocus();
    };
    window.addEventListener('pointermove', onMove, true);
    return () => window.removeEventListener('pointermove', onMove, true);
  }, [host, releaseFocus]);

  if (canHostEmbedPages()) {
    return (
      <div className='flex h-full min-h-0 flex-col'>
        {banner?.(null)}
        <div ref={setHost} className='relative min-h-0 flex-1' onPointerLeave={releaseFocus}>
          <HostedPage url={url} />
          {overlay?.(null)}
        </div>
      </div>
    );
  }

  if (!isElectronApp()) {
    return <SandboxedFrame url={url} title={title} />;
  }

  const typedView = view ? (view as unknown as ElectronWebviewElement) : null;
  const box = host?.getBoundingClientRect();

  return (
    <div className='flex h-full min-h-0 flex-col'>
      {banner?.(typedView)}
      <div ref={setHost} className='relative min-h-0 flex-1' onPointerLeave={releaseFocus}>
        <BrowserWebview
          src={url}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
          shown={shown}
          audible
          // Xyne AI already sees this page: it takes none of the browser panel's page
          // script, as a folder's browser doesn't.
          plain
          register={register}
          onLive={change => {
            setLive(current => ({ ...current, ...change }));
            if (change.playing !== undefined) onPlayingRef.current?.(change.playing);
          }}
          onChanged={() => {
            const page = viewRef.current;
            if (page) onNavigateRef.current?.(ask(() => page.getURL(), url));
          }}
          onMenu={params => {
            releaseFocus();
            // Electron gives the click in the window's coordinates, which place the
            // menu; copying an image or inspecting there take the page's.
            const origin = host?.getBoundingClientRect();
            setMenu({
              at: { x: params.x, y: params.y },
              params: {
                ...params,
                x: params.x - (origin?.left ?? 0),
                y: params.y - (origin?.top ?? 0),
              },
            });
          }}
          onKey={onKey}
          // A link that wants a window of its own opens here, in the same page.
          onPopup={next => {
            const page = viewRef.current;
            if (page) void ask(() => page.loadURL(next), Promise.resolve()).catch(() => undefined);
          }}
        />
        {live.error && (
          <LoadError
            error={live.error}
            onRetry={() => {
              const page = viewRef.current;
              const retry = live.error?.url || url;
              if (page)
                void ask(() => page.loadURL(retry), Promise.resolve()).catch(() => undefined);
            }}
            trackCategory='Workspace'
          />
        )}
        {overlay?.(typedView)}
        {shown && box && <LinkPreview url={live.hoverUrl} page={box} />}
      </div>
      {menu &&
        view &&
        (() => {
          const page = view;
          return (
            <PageContextMenu
              at={menu.at}
              params={menu.params}
              page={{
                canGoBack: ask(() => page.canGoBack(), false),
                canGoForward: ask(() => page.canGoForward(), false),
                saveable: false,
                inspectable: import.meta.env.DEV,
              }}
              onAction={(action: PageMenuAction) =>
                runPageMenuAction(page, action, {
                  // One page here: a link to a new tab opens in it.
                  openInTab: next => void ask(() => page.loadURL(next), Promise.resolve()),
                })
              }
              onClose={() => setMenu(null)}
              trackCategory='Workspace'
            />
          );
        })()}
    </div>
  );
}
