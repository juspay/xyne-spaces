import {
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ContextType,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  UNSAFE_DataRouterContext,
  UNSAFE_DataRouterStateContext,
  UNSAFE_LocationContext,
  useLocation,
  useOutlet,
  type NavigateFunction,
} from 'react-router-dom';
import {
  CMDK_CLOSED_EVENT,
  COLLAPSE_ABANDONED_EVENT,
  COLLAPSE_STARTED_EVENT,
  collapseLandsOnKeptPage,
  isDialogOpenOverPage,
  isFullPageSearchPath,
  KEPT_PAGE_ATTR,
  KEPT_PATH_ATTR,
  type FullPageOrigin,
  KEPT_DRAWN_ATTR,
  RESULTS_PAGE_ATTR,
} from '../components/Chat/ChatDirectory/cmdkFullPage';
import { useScope } from '../shortcuts';
import { OVERLAY_STATE_KEY } from '../hooks/useHistoryBackedOverlay';
import {
  createPageCoverage,
  PageCoveredContext,
  type PageCoverage,
} from '../hooks/usePageCoverage';
import {
  StableRouterContext,
  type RouterSnapshot,
  type StableRouter,
} from '../hooks/useStableRouter';

const CONTENTS = { display: 'contents' } as const;

// What a page reads of the router: where it is, and the router's state (navigations in flight,
// matches). The page under full page keeps both as they were when it was last on screen.
interface RouterView {
  location: ContextType<typeof UNSAFE_LocationContext>;
  routerState: ContextType<typeof UNSAFE_DataRouterStateContext>;
}

type DataRouterContextValue = NonNullable<ContextType<typeof UNSAFE_DataRouterContext>>;
type Navigate = (...args: unknown[]) => unknown;

interface HeldNavigation {
  /** The path of the page that asked for it. */
  from: string;
  navigate: () => void;
}

// Route outlet that keeps the page full page opened from mounted (inert, frozen router, skipped
// while full page opens) under a fixed results layer: the overlay-route pattern.
export function FullPageKeepAliveOutlet(): ReactElement {
  const outlet = useOutlet();
  const view: RouterView = {
    location: useContext(UNSAFE_LocationContext),
    routerState: useContext(UNSAFE_DataRouterStateContext),
  };
  const { pathname, search, key: locationKey } = useLocation();
  const onFullPage = isFullPageSearchPath(pathname);
  // Read by the router the page underneath gets, which has to know in the same render.
  const onFullPageRef = useRef(onFullPage);
  onFullPageRef.current = onFullPage;

  // The page under full page — the last one outside it that was on screen — and the router as it
  // saw it then. Kept once committed: a render the router abandons (an interrupted navigation)
  // must not become the page under full page.
  const backgroundRef = useRef<{ outlet: ReactElement | null; view: RouterView }>({
    outlet: null,
    view,
  });
  useLayoutEffect(() => {
    if (!onFullPage) backgroundRef.current = { outlet, view };
  });
  const background = onFullPage ? backgroundRef.current : { outlet, view };

  // Drawn again under a settled full page (see KEPT_DRAWN_ATTR); back off full page it is simply
  // on screen, and the next full page starts it undrawn.
  const keptRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!onFullPage) keptRef.current?.removeAttribute(KEPT_DRAWN_ATTR);
  }, [onFullPage]);

  // Tells the page underneath it is covered (usePageCoverage) without re-rendering it; CoverageSync
  // sets it.
  const [coverage] = useState(createPageCoverage);
  // A collapse is this page coming back: uncovered from its first frame, so nothing owed for having
  // been covered is written in the middle of the collapse. One abandoned on the way (the palette
  // closed while still on full page) puts full page back, and the page is covered again. One going
  // to another page (Back past a result opened from full page) leaves it covered: it is not shown.
  useEffect(() => {
    if (!onFullPage) return;
    const uncover = (event: Event): void => {
      const origin = (event as CustomEvent<FullPageOrigin | null>).detail;
      if (collapseLandsOnKeptPage(keptRef.current, origin)) coverage.set(false, true);
    };
    const cover = (): void => coverage.set(true);
    window.addEventListener(COLLAPSE_STARTED_EVENT, uncover);
    window.addEventListener(COLLAPSE_ABANDONED_EVENT, cover);
    return (): void => {
      window.removeEventListener(COLLAPSE_STARTED_EVENT, uncover);
      window.removeEventListener(COLLAPSE_ABANDONED_EVENT, cover);
    };
  }, [coverage, onFullPage]);

  // Nothing plays on under full page: the page's controls are out of reach there. Players that
  // keep their media off the DOM (voice notes, AI voice) pause themselves (usePageCoverage).
  useEffect(
    () =>
      coverage.subscribe(covered => {
        if (!covered) return;
        keptRef.current
          ?.querySelectorAll<HTMLMediaElement>('audio, video')
          .forEach(media => media.pause());
      }),
    [coverage],
  );

  // Navigation the page underneath asks for on its own while covered (a URL sync, a redirect, a new
  // AI chat putting its id in the URL) would replace full page: held for the page's own place in
  // history, and replayed once the route is back there (see below). The page navigating again on
  // screen first has moved on from it.
  const heldNavigationsRef = useRef<HeldNavigation[]>([]);
  const hold = useMemo(
    () =>
      (navigate: Navigate): Navigate =>
      (...args) => {
        if (!onFullPageRef.current) {
          heldNavigationsRef.current = [];
          return navigate(...args);
        }
        heldNavigationsRef.current.push({
          from: backgroundRef.current.view.location.location.pathname,
          navigate: () => void navigate(...args),
        });
        return Promise.resolve();
      },
    [],
  );
  const dataRouter = useContext(UNSAFE_DataRouterContext);

  // Held navigation is replayed once the route is back on the page that asked for it, and dropped
  // when it is anywhere else (a result opened from full page). Back on the page but on the
  // palette's own history entry — where a collapse that expanded from the palette lands — it waits
  // for the palette to close: replayed there, a replace would take the palette's entry, and close
  // it. Read from the router itself, which has the navigation a close sets off before this outlet
  // has rendered it.
  useEffect(() => {
    if (onFullPage) return;
    const settle = (paletteClosed: boolean): void => {
      const held = heldNavigationsRef.current;
      const router = dataRouter?.router;
      // A navigation still on its way settles it as it lands.
      if (held.length === 0 || (router && router.state.navigation.state !== 'idle')) return;
      const here = router?.state.location ?? { pathname, state: null };
      if (isFullPageSearchPath(here.pathname)) return;
      const own = held.filter(entry => entry.from === here.pathname);
      const onPaletteEntry = !!(here.state as Record<string, unknown> | null)?.[OVERLAY_STATE_KEY];
      if (own.length > 0 && onPaletteEntry && !paletteClosed) {
        heldNavigationsRef.current = own;
        return;
      }
      heldNavigationsRef.current = [];
      own.forEach(entry => entry.navigate());
    };
    settle(false);
    // A task later, so a navigation the close came with has started.
    let timer = 0;
    const onPaletteClosed = (): void => {
      clearTimeout(timer);
      timer = window.setTimeout(() => settle(true));
    };
    window.addEventListener(CMDK_CLOSED_EVENT, onPaletteClosed);
    return (): void => {
      window.removeEventListener(CMDK_CLOSED_EVENT, onPaletteClosed);
      clearTimeout(timer);
    };
  }, [onFullPage, pathname, search, locationKey, dataRouter]);
  const keptDataRouter = useMemo((): DataRouterContextValue | null => {
    if (!dataRouter) return null;
    const live = dataRouter.router as unknown as { navigate: Navigate };
    const navigate = hold((...args) => live.navigate(...args));
    const router = new Proxy(dataRouter.router, {
      get: (target, key): unknown =>
        key === 'navigate' ? navigate : (Reflect.get(target, key, target) as unknown),
    });
    return { ...dataRouter, router };
  }, [dataRouter, hold]);

  // The app's stable router (useRouterSelector, useStableNavigate), frozen for the page underneath
  // like React Router's own state: it neither re-renders for /search-results nor sees it.
  const stableRouter = useContext(StableRouterContext);
  const keptSnapshotRef = useRef<RouterSnapshot | null>(null);
  useLayoutEffect(() => {
    if (!onFullPage && stableRouter) keptSnapshotRef.current = stableRouter.getSnapshot();
  });
  const keptStableRouter = useMemo(
    (): (StableRouter & { notify: () => void }) | null =>
      stableRouter && keptRouterOver(stableRouter, onFullPageRef, keptSnapshotRef, hold),
    [stableRouter, hold],
  );

  // Focus as the page had it: the element last focused in it is given focus back when full page
  // closes over it — at once after a Back, once its palette has closed after a collapse — unless
  // something else has taken focus by then.
  const lastFocusedRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const target = lastFocusedRef.current;
    if (onFullPage || !target) return;
    lastFocusedRef.current = null;
    let timer = 0;
    const stop = (): void => {
      document.removeEventListener('focusout', onFocusOut, true);
      clearTimeout(timer);
    };
    const giveBack = (): void => {
      if (isDialogOpenOverPage()) return;
      stop();
      const active = document.activeElement;
      if (target.isConnected && (!active || active === document.body)) {
        target.focus({ preventScroll: true });
      }
    };
    // Focus moving on settles it: checked once the element losing it has let go.
    const onFocusOut = (): void => {
      clearTimeout(timer);
      timer = window.setTimeout(giveBack);
    };
    document.addEventListener('focusout', onFocusOut, true);
    giveBack();
    return stop;
  }, [onFullPage]);

  let page = background.outlet;
  if (keptStableRouter) {
    page = (
      <StableRouterContext.Provider value={keptStableRouter}>{page}</StableRouterContext.Provider>
    );
  }
  if (keptDataRouter) {
    page = (
      <UNSAFE_DataRouterContext.Provider value={keptDataRouter}>
        {page}
      </UNSAFE_DataRouterContext.Provider>
    );
  }
  return (
    <>
      <div
        ref={keptRef}
        onFocus={event => {
          if (!onFullPage && event.target instanceof HTMLElement) {
            lastFocusedRef.current = event.target;
          }
        }}
        {...{ [KEPT_PAGE_ATTR]: '', [KEPT_PATH_ATTR]: background.view.location.location.pathname }}
        style={CONTENTS}
        inert={onFullPage}
        aria-hidden={onFullPage || undefined}
      >
        <PageCoveredContext.Provider value={coverage}>
          <CoverageSync
            coverage={coverage}
            onFullPage={onFullPage}
            stableRouter={keptStableRouter}
          />
          <UNSAFE_DataRouterStateContext.Provider value={background.view.routerState}>
            <UNSAFE_LocationContext.Provider value={background.view.location}>
              {page}
            </UNSAFE_LocationContext.Provider>
          </UNSAFE_DataRouterStateContext.Provider>
        </PageCoveredContext.Provider>
      </div>
      {onFullPage ? <FullPageLayer>{outlet}</FullPageLayer> : null}
    </>
  );
}

/**
 * Covers and uncovers the page underneath as the route goes to full page and back. Rendered ahead
 * of the page so its effect runs after a page that is going away has cleaned up — leaving for a
 * result, it still reads as covered: it was never seen again — and before a page that is arriving
 * runs its own: one opened from a result is on screen from its first effect.
 *
 * Leaving full page is a return for whatever of the page stayed mounted, wherever the route went
 * (a collapse, a Back, a result in the same channel): React runs every effect cleanup of a commit
 * before any effect, so a page that went away has stopped listening by now, and one that stayed
 * is on screen again.
 */
function CoverageSync({
  coverage,
  onFullPage,
  stableRouter,
}: {
  coverage: PageCoverage & {
    set: (covered: boolean, firstFrame?: boolean) => void;
    returned: () => void;
  };
  onFullPage: boolean;
  stableRouter: { notify: () => void } | null;
}): null {
  const wasOnFullPageRef = useRef(onFullPage);
  useEffect(() => {
    const left = wasOnFullPageRef.current && !onFullPage;
    wasOnFullPageRef.current = onFullPage;
    coverage.set(onFullPage);
    if (!left) return;
    stableRouter?.notify();
    coverage.returned();
  }, [coverage, onFullPage, stableRouter]);
  return null;
}

// The stable router as the page underneath sees it: frozen on its own location while covered (no
// re-render for /search-results), its navigation held like React Router's.
function keptRouterOver(
  router: StableRouter,
  frozenRef: { current: boolean },
  snapshotRef: { current: RouterSnapshot | null },
  hold: (navigate: Navigate) => Navigate,
): StableRouter & { notify: () => void } {
  const listeners = new Set<() => void>();
  // The router tells its subscribers before the outlet renders the change, so a router already on
  // full page counts too.
  const frozen = (): boolean =>
    frozenRef.current || isFullPageSearchPath(router.getSnapshot().location.pathname);
  return {
    navigate: hold(router.navigate as Navigate) as NavigateFunction,
    getSnapshot: () => (frozen() && snapshotRef.current) || router.getSnapshot(),
    subscribe: listener => {
      listeners.add(listener);
      const stop = router.subscribe(() => {
        if (!frozen()) listener();
      });
      return (): void => {
        listeners.delete(listener);
        stop();
      };
    },
    // Full page closed: what was held back while frozen is read again.
    notify: () => listeners.forEach(listener => listener()),
  };
}

/**
 * Full page, over the route area: fixed to the `<main>` box, following it as panels resize, so the
 * route area's own layout is untouched. The area holds still under it — nothing scrolls the page
 * underneath out from beneath the layer — until full page closes.
 */
function FullPageLayer({ children }: { children: ReactNode }): ReactElement {
  useScope('modal');
  const layerRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const layer = layerRef.current;
    const area = layer?.parentElement;
    if (!layer || !area) return;
    const place = (): void => {
      const box = area.getBoundingClientRect();
      layer.style.top = `${box.top}px`;
      layer.style.left = `${box.left}px`;
      layer.style.width = `${box.width}px`;
      layer.style.height = `${box.height}px`;
      layer.style.borderRadius = getComputedStyle(area).borderRadius;
    };
    place();
    const resize = new ResizeObserver(place);
    resize.observe(area);
    window.addEventListener('resize', place);
    const { overflow } = area.style;
    area.style.overflow = 'hidden';
    return (): void => {
      resize.disconnect();
      window.removeEventListener('resize', place);
      area.style.overflow = overflow;
    };
  }, []);
  // Esc on full page is full page's. The page underneath keeps window-level Esc handlers that would
  // act on it unseen (an expanded RCA panel, a FlowPlan selection, the Ask AI drawer): stopped on
  // the way up at the document, so the shortcut registry and Radix, which listen there, still get
  // it. A key with nothing focused (body) is full page's too; one inside a dialog or the palette is
  // theirs.
  useEffect(() => {
    const keepEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      const target = event.target;
      const onFullPage =
        !(target instanceof Node) ||
        target === document.body ||
        target === document.documentElement ||
        !!layerRef.current?.contains(target);
      if (onFullPage) event.stopPropagation();
    };
    document.addEventListener('keydown', keepEscape);
    return (): void => document.removeEventListener('keydown', keepEscape);
  }, []);
  return (
    <div
      ref={layerRef}
      {...{ [RESULTS_PAGE_ATTR]: '' }}
      // Over the page underneath; under the palette, dialogs and popovers.
      className='fixed z-40 overflow-hidden bg-background'
    >
      {children}
    </div>
  );
}
