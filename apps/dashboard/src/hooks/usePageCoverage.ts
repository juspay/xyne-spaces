import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';

/**
 * Whether a page is under full-page search: still mounted and live, but not what the user is
 * looking at (see FullPageKeepAliveOutlet). A subscription rather than a value, so covering and
 * uncovering never re-render the page underneath — that render would land in the middle of the
 * expand and collapse animations.
 */
export interface PageCoverage {
  isCovered: () => boolean;
  /**
   * Calls `listener` as the page is covered (true) and uncovered (false). `firstFrame`: uncovered
   * in the frame a collapse lifts full page's layer, outside React — a listener that paints may
   * apply it at once (flushSync). Returns the cleanup.
   */
  subscribe: (listener: (covered: boolean, firstFrame: boolean) => void) => () => void;
  /**
   * Calls `listener` when the route comes back to the page from full page — a collapse that landed,
   * a Back — so the user is looking at it again. A collapse given up on the way (full page back)
   * never does. Returns the cleanup.
   */
  subscribeReturn: (listener: () => void) => () => void;
  /**
   * Whether the page is on screen: not covered, nor in a collapse back to it that the route has yet
   * to follow (from the collapse's first frame until the route is back on the page).
   */
  isShown: () => boolean;
  /**
   * Calls `listener` each time a return to the page has settled: the route came back to it, the
   * collapse is over and the browser idle, and any grow begun meanwhile is over too. Returns the
   * cleanup.
   */
  subscribeSettled: (listener: () => void) => () => void;
}

const NEVER_COVERED: PageCoverage = {
  isCovered: () => false,
  subscribe: () => () => undefined,
  subscribeReturn: () => () => undefined,
  isShown: () => true,
  subscribeSettled: () => () => undefined,
};

export const PageCoveredContext = createContext<PageCoverage>(NEVER_COVERED);

/** A page's coverage store, to settle what only means anything while the user sees the page. */
export function usePageCoverage(): PageCoverage {
  return useContext(PageCoveredContext);
}

/**
 * Dispatched on window as full page starts growing over the page on screen, and once it has
 * opened. A page leaving for full page marks what it shows as seen then — once it has opened, so
 * the re-renders that write sets off stay out of the grow.
 */
export const PAGE_COVERING_EVENT = 'xyne:page-covering';
export const FULL_PAGE_OPENED_EVENT = 'xyne:full-page-opened';

/**
 * Full page has opened over the page: announced once the browser is next idle, so what the
 * announcement sets off never holds up full page's first paint or the user's next input.
 */
export function announceFullPageOpened(): void {
  const announce = (): void => {
    window.dispatchEvent(new Event(FULL_PAGE_OPENED_EVENT));
  };
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(announce, { timeout: 1000 });
  } else {
    setTimeout(announce, 200);
  }
}

/**
 * Stops what is running (`active`: a mic recording, media playing, a voice turn) as full page
 * covers the page, where its controls are out of reach. Leaving the page used to unmount it, which
 * stopped it.
 */
export function useStopWhenCovered(active: boolean, stop: () => void): void {
  const coverage = usePageCoverage();
  const stopRef = useRef(stop);
  stopRef.current = stop;
  useEffect(() => {
    if (!active) return undefined;
    return coverage.subscribe(covered => {
      if (covered) stopRef.current();
    });
  }, [active, coverage]);
}

/**
 * Renders `children` except while full page covers the page: for what must go away under it — an
 * embedded app, a video, a browser — as leaving the page took it, with `fallback` in its place.
 * What it took comes back once the route has come back to the page (a collapse that landed, a
 * Back), so a collapse brings nothing back in its first frames and one given up on the way (the
 * palette closed, full page back) brings nothing back at all; one first rendered once the page is
 * uncovered shows straight away. Only this component re-renders as the page is covered and comes
 * back.
 */
export function UnmountWhenCovered({
  children,
  fallback = null,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}): ReactNode {
  const coverage = usePageCoverage();
  const [shown, setShown] = useState(() => !coverage.isCovered());
  useEffect(() => {
    // As it stands now: one rendered as full page closes was rendered covered, and the page was
    // uncovered and returned to before this effect, with nothing listening yet.
    setShown(!coverage.isCovered());
    const stopWatching = coverage.subscribe(covered => {
      if (covered) setShown(false);
    });
    const stopWatchingReturn = coverage.subscribeReturn(() => setShown(true));
    return (): void => {
      stopWatching();
      stopWatchingReturn();
    };
  }, [coverage]);
  return shown ? children : fallback;
}

/**
 * For a query polling on a page (`refetchInterval`), or refetching on reconnect or a page event:
 * whether it does now — not while full page covers the page, out of sight there, as leaving the
 * page stopped it, nor in the collapse back to it. Covering stops the polling at once. Once the
 * collapse that returns to the page is over, the polling starts again and what has gone stale
 * meanwhile fetches again, as coming back to the page did. `queryKey`: the query's key, or a prefix
 * of the keys of every query polling with it; null while it doesn't poll.
 */
export function usePollWhenShown(queryKey: QueryKey | null): () => boolean {
  const coverage = usePageCoverage();
  const queryClient = useQueryClient();
  const queryKeyRef = useRef(queryKey);
  queryKeyRef.current = queryKey;
  const watchRef = useRef<{ shown: () => boolean } | null>(null);
  useEffect(() => {
    // Each query's interval worked out again, as the page is covered or shown.
    const pollAsShown = (queryKey: QueryKey): void =>
      queryClient
        .getQueryCache()
        .findAll({ queryKey })
        .forEach(query =>
          query.observers.forEach(observer => observer.setOptions(observer.options)),
        );
    // Ahead of the listener below, so the intervals worked out on a cover already read it as held.
    const watch = watchShown(coverage, () => {
      const queryKey = queryKeyRef.current;
      if (!queryKey) return;
      pollAsShown(queryKey);
      void queryClient.refetchQueries(
        { queryKey, type: 'active', stale: true },
        { cancelRefetch: false },
      );
    });
    watchRef.current = watch;
    const stopWatching = coverage.subscribe(covered => {
      const queryKey = queryKeyRef.current;
      if (covered && queryKey) pollAsShown(queryKey);
    });
    return (): void => {
      stopWatching();
      watch.stop();
    };
  }, [coverage, queryClient]);
  return useCallback(() => watchRef.current?.shown() ?? coverage.isShown(), [coverage]);
}

/** A coverage store for the outlet to drive. */
export function createPageCoverage(): PageCoverage & {
  set: (covered: boolean, firstFrame?: boolean) => void;
  returned: () => void;
} {
  let covered = false;
  // From a collapse's first frame until the route is back on the page, or full page is back.
  let collapsing = false;
  let cancelSettle: (() => void) | null = null;
  const listeners = new Set<(covered: boolean, firstFrame: boolean) => void>();
  const returnListeners = new Set<() => void>();
  const settledListeners = new Set<() => void>();
  const stopSettling = (): void => {
    cancelSettle?.();
    cancelSettle = null;
    window.removeEventListener(PAGE_COVERING_EVENT, settleSoon);
  };
  // Settled once the collapse back is over and the browser idle; full page growing open again
  // before then, once that grow is over too.
  function settleSoon(): void {
    cancelSettle?.();
    window.addEventListener(PAGE_COVERING_EVENT, settleSoon);
    cancelSettle = afterTransition(() => {
      stopSettling();
      if (!covered) settledListeners.forEach(listener => listener());
    });
  }
  return {
    isCovered: () => covered,
    isShown: () => !covered && !collapsing,
    subscribeSettled: listener => {
      settledListeners.add(listener);
      return (): void => {
        settledListeners.delete(listener);
      };
    },
    subscribe: listener => {
      listeners.add(listener);
      return (): void => {
        listeners.delete(listener);
      };
    },
    subscribeReturn: listener => {
      returnListeners.add(listener);
      return (): void => {
        returnListeners.delete(listener);
      };
    },
    set: (next: boolean, firstFrame = false): void => {
      if (next === covered) return;
      covered = next;
      // Before the listeners: what they read of it is already this.
      collapsing = !next && firstFrame;
      if (next) stopSettling();
      listeners.forEach(listener => listener(next, firstFrame));
    },
    returned: (): void => {
      collapsing = false;
      settleSoon();
      returnListeners.forEach(listener => listener());
    },
  };
}

// Past the expand or collapse that covers or uncovers a page, and the page settling after it.
const PAST_TRANSITION_MS = 1500;

/**
 * Runs `work` once the expand or collapse that just covered or uncovered the page is over and the
 * browser is idle, so writes it makes never land in the animation. Returns the cancel.
 */
export function afterTransition(work: () => void): () => void {
  let idle: number | undefined;
  const timer = setTimeout(() => {
    if (typeof window.requestIdleCallback === 'function') {
      idle = window.requestIdleCallback(work, { timeout: 2000 });
    } else {
      work();
    }
  }, PAST_TRANSITION_MS);
  return (): void => {
    clearTimeout(timer);
    if (idle !== undefined) window.cancelIdleCallback(idle);
  };
}

/**
 * For what a page does on its own while on screen (polling, reloading as the user looks again):
 * `shown()` says whether it does now, and `onReturn` runs once a return to the page has settled
 * (see PageCoverage.subscribeSettled), as coming back to the page ran it. Held from a cover — or
 * from its start, if started under full page or in a collapse — until that return has settled. One
 * started on a page already on screen (opened from a result as full page closes) is never held for
 * it, and has no return to run. Returns `shown` and the cleanup.
 */
export function watchShown(
  coverage: PageCoverage,
  onReturn?: () => void,
): { shown: () => boolean; stop: () => void } {
  let held = !coverage.isShown();
  const stopWatching = coverage.subscribe(covered => {
    if (covered) held = true;
  });
  const stopSettled = coverage.subscribeSettled(() => {
    if (!held) return;
    held = false;
    onReturn?.();
  });
  return {
    shown: () => !held && coverage.isShown(),
    stop: (): void => {
      stopWatching();
      stopSettled();
    },
  };
}

/**
 * Runs `work` each time the page comes back from full page, once that return has settled (see
 * watchShown): for what stops while the page is covered, to run again as coming back to the page
 * did. Returns the cleanup.
 */
export function afterReturn(coverage: PageCoverage, work: () => void): () => void {
  return watchShown(coverage, work).stop;
}

/**
 * Runs `work` now if the page is on screen, else once the return to it has settled (see
 * watchShown). Once: a page shown again with nothing new to settle does nothing. Returns the
 * cleanup.
 */
export function whenShown(coverage: PageCoverage, work: () => void): () => void {
  if (coverage.isShown()) {
    work();
    return () => undefined;
  }
  const watch = watchShown(coverage, () => {
    watch.stop();
    work();
  });
  return watch.stop;
}

/**
 * Marks what a page shows as seen when the user leaves it: as it unmounts on screen, or as full
 * page covers it — once full page has grown open over it, or, opened without the grow, as it
 * covers it — as when full page replaced the page. Once per cover: what arrives while covered stays
 * unread, and unmounting while covered marks nothing more — nor uncovered, until the route has come
 * back to it. Only a page the route came back to is owed a mark when it is left again: a collapse
 * given up on the way (the palette closed before it landed, full page back) never showed it, so it
 * is still the same cover. Returns the cleanup, for the unmount.
 */
export function markWhenLeft(coverage: PageCoverage, mark: () => void): () => void {
  let growing = false;
  let markedForCover = false;
  const markLeaving = (): void => {
    if (markedForCover) return;
    markedForCover = true;
    mark();
  };
  const onGrowing = (): void => {
    growing = true;
  };
  // Window-wide: only a page full page actually covers is left by it. One outside that page (a
  // call's chat), or back on screen already (a Back mid-grow), is not.
  const onOpened = (): void => {
    if (!growing) return;
    growing = false;
    if (coverage.isCovered()) markLeaving();
  };
  window.addEventListener(PAGE_COVERING_EVENT, onGrowing);
  window.addEventListener(FULL_PAGE_OPENED_EVENT, onOpened);
  const stopWatching = coverage.subscribe(covered => {
    if (covered && !growing) markLeaving();
  });
  const stopWatchingReturn = coverage.subscribeReturn(() => {
    markedForCover = false;
  });
  return (): void => {
    window.removeEventListener(PAGE_COVERING_EVENT, onGrowing);
    window.removeEventListener(FULL_PAGE_OPENED_EVENT, onOpened);
    stopWatching();
    stopWatchingReturn();
    if (coverage.isCovered()) markLeaving();
    else if (!markedForCover) mark();
  };
}
