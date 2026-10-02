import { createContext, useContext } from 'react';

/**
 * Whether a page is under full-page search: still mounted and live, but not what the user is
 * looking at (see FullPageKeepAliveOutlet). A subscription rather than a value, so covering and
 * uncovering never re-render the page underneath — that render would land in the middle of the
 * expand and collapse animations.
 */
export interface PageCoverage {
  isCovered: () => boolean;
  /** Calls `listener` as the page is covered (true) and uncovered (false). Returns the cleanup. */
  subscribe: (listener: (covered: boolean) => void) => () => void;
}

const NEVER_COVERED: PageCoverage = {
  isCovered: () => false,
  subscribe: () => () => undefined,
};

export const PageCoveredContext = createContext<PageCoverage>(NEVER_COVERED);

/** A page's coverage store, to settle what only means anything while the user sees the page. */
export function usePageCoverage(): PageCoverage {
  return useContext(PageCoveredContext);
}

/** A coverage store for the outlet to drive. */
export function createPageCoverage(): PageCoverage & { set: (covered: boolean) => void } {
  let covered = false;
  const listeners = new Set<(covered: boolean) => void>();
  return {
    isCovered: () => covered,
    subscribe: listener => {
      listeners.add(listener);
      return (): void => {
        listeners.delete(listener);
      };
    },
    set: (next: boolean): void => {
      if (next === covered) return;
      covered = next;
      listeners.forEach(listener => listener(next));
    },
  };
}

// Past the collapse that uncovers a page (its animation and the palette taking over).
const PAST_COLLAPSE_MS = 1000;

/** Runs `work` once a collapse is over and the browser is idle, so it never lands in the animation. */
export function afterUncovering(work: () => void): void {
  setTimeout(() => {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(work, { timeout: 2000 });
    } else {
      work();
    }
  }, PAST_COLLAPSE_MS);
}
