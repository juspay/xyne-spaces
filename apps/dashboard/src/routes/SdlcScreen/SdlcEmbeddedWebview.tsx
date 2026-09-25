import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { pickWebviewPartition } from '../../utils/browserPanelPartition';
import { registerEmbeddedWebview } from '../../utils/embeddedWebviewRegistry';
import { parseSdlcFrameMessage, SDLC_FRAME_MESSAGE } from './sdlcFrameMessages';
import { ANNOTATE_SCRIPT } from '../../components/workspaceItems';

/** The slice of Electron's webview element this file uses. */
interface WebviewElement extends HTMLElement {
  goBack: () => void;
  goForward: () => void;
  reload: () => void;
  loadURL: (url: string) => Promise<void>;
  canGoBack: () => boolean;
  canGoForward: () => boolean;
  getURL: () => string;
  getTitle: () => string;
  getWebContentsId: () => number;
  executeJavaScript: (script: string) => Promise<unknown>;
}

interface Embed {
  url: string;
  rect: { x: number; y: number; width: number; height: number };
  visible: boolean;
}

interface Tab {
  id: string;
  /** Where the tab started. The live address comes from the element. */
  src: string;
  pinned: boolean;
}

function ask<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}

let tabCounter = 0;
const nextTabId = (): string => `embed-tab-${(tabCounter += 1)}`;

/**
 * The live pages the SDLC lane asks the host to hold over it.
 *
 * They live here, in the top frame, because Electron registers the <webview>
 * element in the top frame only — the lane can never host one itself. The lane
 * says where the pages go and draws the chrome; this drives them and reports
 * back what they are doing, so the two never disagree about what is on screen.
 *
 * Both hosts render this, so the popped-out window and the in-app lane cannot
 * drift apart.
 */
export function SdlcEmbeddedWebview(props: {
  /** Where the frame sits, since the frame's rect is relative to itself. */
  offset: { top: number; left: number } | null;
  getFrameWindow: () => Window | null;
}): ReactElement | null {
  const [embed, setEmbed] = useState<Embed | null>(null);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  const viewRefs = useRef(new Map<string, WebviewElement>());
  // Announced by the page rather than read off it, so it lives beside the
  // element rather than inside the tab list.
  const faviconRefs = useRef(new Map<string, string>());

  // Each tab's navigation listeners are bound once, when that tab mounts, so a
  // callback that closes over state would keep reporting the state of the
  // moment it was bound — one tab, and whichever was active then. Refs give the
  // listeners a stable function that still reads the present.
  const tabsRef = useRef<Tab[]>(tabs);
  /**
   * Evaluates one annotator message in the page the lane is looking at, then
   * relays whatever the page has queued back down to it. The script installs
   * itself on first contact, so no separate injection step is needed.
   */
  const frameWindowRef = useRef(props.getFrameWindow);
  frameWindowRef.current = props.getFrameWindow;

  const annotate = useCallback((payload: Record<string, unknown> | null): void => {
    const view = viewRefs.current.get(activeIdRef.current);
    if (!view) return;
    const message = JSON.stringify(payload ?? { channel: 'xyne-doc-host', type: 'noop' });
    const drained = ask(
      () =>
        view.executeJavaScript(
          `(() => {
             if (!window.__xyneAnnotateApply) { ${ANNOTATE_SCRIPT} }
             window.__xyneAnnotateApply(${message});
             const queue = window.__xyneAnnotateQueue || [];
             window.__xyneAnnotateQueue = [];
             return queue;
           })()`,
        ),
      null,
    );
    void drained?.then((queue: unknown) => {
      if (!Array.isArray(queue)) return;
      // The lane lives in the iframe, so the relay goes to its window — posting
      // to our own would talk to the host and never reach the reader.
      const frame = frameWindowRef.current();
      if (!frame) return;
      for (const event of queue as Array<Record<string, unknown>>) {
        frame.postMessage(
          { type: SDLC_FRAME_MESSAGE.embedEvent, payload: event },
          window.location.origin,
        );
      }
    });
  }, []);

  const annotateRef = useRef(annotate);
  annotateRef.current = annotate;

  // The page reports a pick or a badge click whenever the reader acts, not when
  // the lane next speaks, so drain it on a timer. Only once the lane has armed
  // the annotator for this page, though: plain browsing would otherwise inject
  // and drain a script every 300ms for a feature nobody opened.
  const [annotateArmed, setAnnotateArmed] = useState(false);

  useEffect(() => setAnnotateArmed(false), [embed?.url]);

  useEffect(() => {
    if (!embed || !annotateArmed) return;
    const timer = window.setInterval(() => annotateRef.current(null), 300);
    return () => window.clearInterval(timer);
  }, [embed, annotateArmed]);

  const activeIdRef = useRef(activeId);
  tabsRef.current = tabs;
  activeIdRef.current = activeId;

  const postState = useCallback((): void => {
    const frame = props.getFrameWindow();
    if (!frame) return;
    const currentTabs = tabsRef.current;
    const currentActiveId = activeIdRef.current;
    const active = viewRefs.current.get(currentActiveId);
    const activeTab = currentTabs.find(tab => tab.id === currentActiveId);
    frame.postMessage(
      {
        type: SDLC_FRAME_MESSAGE.embedState,
        url: active ? ask(() => active.getURL(), activeTab?.src ?? '') : (activeTab?.src ?? ''),
        canGoBack: active ? ask(() => active.canGoBack(), false) : false,
        canGoForward: active ? ask(() => active.canGoForward(), false) : false,
        loading: false,
        activeTabId: currentActiveId,
        tabs: currentTabs.map(tab => {
          const view = viewRefs.current.get(tab.id);
          return {
            id: tab.id,
            url: view ? ask(() => view.getURL(), tab.src) || tab.src : tab.src,
            title: view ? ask(() => view.getTitle(), '') : '',
            favicon: faviconRefs.current.get(tab.id) ?? '',
            pinned: tab.pinned,
          };
        }),
      },
      window.location.origin,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The item's own link is the browser's reason to exist: it opens pinned, and
  // changing items starts a fresh browser rather than keeping the old trail.
  useEffect(() => {
    if (!embed) {
      setTabs([]);
      setActiveId('');
      return;
    }
    setTabs(current => {
      const pinned = current.find(tab => tab.pinned);
      if (pinned && pinned.src === embed.url) return current;
      const fresh: Tab = { id: nextTabId(), src: embed.url, pinned: true };
      setActiveId(fresh.id);
      return [fresh];
    });
  }, [embed?.url, Boolean(embed)]);

  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== window.location.origin) return;
      if (event.source !== props.getFrameWindow()) return;

      const message = parseSdlcFrameMessage(event.data);
      if (!message) return;

      // A page is held over the folder page and nowhere else. The lane clears
      // it on unmount, but a frame reset replaces the document outright and no
      // cleanup runs — the page would then sit over whatever came next.
      if (message.type === SDLC_FRAME_MESSAGE.route) {
        if (!message.path.includes('folder=')) setEmbed(null);
        return;
      }

      if (message.type === SDLC_FRAME_MESSAGE.embedPage) {
        setEmbed(
          message.url && message.rect
            ? { url: message.url, rect: message.rect, visible: message.visible }
            : null,
        );
        return;
      }

      if (message.type === SDLC_FRAME_MESSAGE.embedScript) {
        setAnnotateArmed(true);
        annotateRef.current(message.payload);
        return;
      }

      if (message.type === SDLC_FRAME_MESSAGE.embedRelease) {
        // Only the main process can move focus off a guest: blurring the
        // element and focusing the window both leave it where it is.
        void window.electronAPI?.focusHostWebContents?.();
        return;
      }

      if (message.type !== SDLC_FRAME_MESSAGE.embedControl) return;

      if (message.action === 'newTab') {
        const fresh: Tab = {
          id: nextTabId(),
          src: message.url ?? 'https://www.google.com',
          pinned: false,
        };
        setTabs(current => [...current, fresh]);
        setActiveId(fresh.id);
        return;
      }

      if (message.action === 'select' && message.tabId) {
        setActiveId(message.tabId);
        return;
      }
      if (message.action === 'close' && message.tabId) {
        const target = message.tabId;
        setTabs(current => {
          const doomed = current.find(tab => tab.id === target);
          if (!doomed || doomed.pinned) return current;
          const remaining = current.filter(tab => tab.id !== target);
          viewRefs.current.delete(target);
          setActiveId(was => (was === target ? (remaining.at(-1)?.id ?? '') : was));
          return remaining;
        });
        return;
      }

      const view = viewRefs.current.get(activeIdRef.current);
      if (!view) return;
      ask(() => {
        if (message.action === 'back' && view.canGoBack()) view.goBack();
        else if (message.action === 'forward' && view.canGoForward()) view.goForward();
        else if (message.action === 'reload') view.reload();
        else if (message.action === 'goto' && message.url) void view.loadURL(message.url);
        return null;
      }, null);
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Opening, closing or switching a tab is itself news for the lane's strip.
  useEffect(() => {
    postState();
  }, [postState, tabs, activeId]);

  const offset = props.offset;
  if (!embed || !offset) return null;

  return (
    <>
      {tabs.map(tab => (
        <EmbeddedTab
          key={tab.id}
          tab={tab}
          embed={embed}
          offset={offset}
          isActive={tab.id === activeId}
          register={(view: WebviewElement | null) => {
            if (view) viewRefs.current.set(tab.id, view);
            else viewRefs.current.delete(tab.id);
          }}
          onChanged={postState}
          onFavicon={(url: string) => {
            faviconRefs.current.set(tab.id, url);
            postState();
          }}
          onPopup={(url: string) => {
            const fresh: Tab = { id: nextTabId(), src: url, pinned: false };
            setTabs(current => [...current, fresh]);
            setActiveId(fresh.id);
          }}
        />
      ))}
    </>
  );
}

function EmbeddedTab(props: {
  tab: Tab;
  embed: Embed;
  offset: { top: number; left: number };
  isActive: boolean;
  register: (view: WebviewElement | null) => void;
  onChanged: () => void;
  onFavicon: (url: string) => void;
  onPopup: (url: string) => void;
}): ReactElement {
  const ref = useRef<WebviewElement | null>(null);

  useEffect(() => {
    const view = ref.current;
    if (!view) return undefined;
    props.register(view);

    const onChanged = (): void => props.onChanged();
    const events = [
      'did-navigate',
      'did-navigate-in-page',
      'did-stop-loading',
      'page-title-updated',
      'dom-ready',
    ];
    events.forEach(name => view.addEventListener(name, onChanged));

    const onFavicon = (event: Event): void => {
      const icons = (event as Event & { favicons?: string[] }).favicons;
      if (icons && icons.length > 0 && icons[0]) props.onFavicon(icons[0]);
    };
    view.addEventListener('page-favicon-updated', onFavicon);

    // A link that wants its own window gets its own tab here, rather than being
    // thrown to the browser panel across the window. The webContents id only
    // exists once the guest is attached, which dom-ready announces.
    let unregister = (): void => {};
    const claimPopups = (): void => {
      const id = ask(() => view.getWebContentsId(), null);
      if (id === null) return;
      unregister();
      unregister = registerEmbeddedWebview(id, props.onPopup);
    };
    view.addEventListener('dom-ready', claimPopups);

    return () => {
      events.forEach(name => view.removeEventListener(name, onChanged));
      view.removeEventListener('page-favicon-updated', onFavicon);
      view.removeEventListener('dom-ready', claimPopups);
      unregister();
      props.register(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shown = props.isActive && props.embed.visible;

  return (
    <webview
      ref={ref as unknown as React.Ref<HTMLElement>}
      {...({
        src: props.tab.src,
        partition: pickWebviewPartition(props.tab.src),
        allowpopups: '',
        style: {
          position: 'fixed' as const,
          top: props.offset.top + props.embed.rect.y,
          left: props.offset.left + props.embed.rect.x,
          width: props.embed.rect.width,
          height: props.embed.rect.height,
          display: 'flex' as const,
          zIndex: 2,
          // Inactive tabs and anything under a dialog stay mounted but out of
          // the way, so they keep their scroll and their history.
          visibility: shown ? ('visible' as const) : ('hidden' as const),
          pointerEvents: shown ? ('auto' as const) : ('none' as const),
        },
      } as Record<string, unknown>)}
    />
  );
}
