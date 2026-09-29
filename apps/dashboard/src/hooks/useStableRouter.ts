import { createContext, useContext, useSyncExternalStore } from 'react';
import type { Location, NavigateFunction, NavigateOptions, Params, To } from 'react-router-dom';

export interface RouterSnapshot {
  location: Location;
  /** Params of the deepest match. React Router shares one params object across a match chain, so
   * this is what `useParams()` returns at any depth. */
  params: Readonly<Params<string>>;
}

/**
 * Navigation and route state that doesn't subscribe to React Router's contexts.
 *
 * `useNavigate`, `useLocation` and `useParams` read contexts whose value changes on every
 * navigation, and React 19 re-renders their consumers even under a nested provider with a stable
 * value — so a component that only needs to navigate on click re-renders on every navigation
 * anywhere in the app. This context never changes: read the router at event time through
 * `getSnapshot()`, or subscribe to just the slice a component renders from with
 * `useRouterSelector`.
 */
export interface StableRouter {
  navigate: NavigateFunction;
  getSnapshot: () => RouterSnapshot;
  subscribe: (listener: () => void) => () => void;
}

export const StableRouterContext = createContext<StableRouter | null>(null);

export const useStableRouter = (): StableRouter => {
  const router = useContext(StableRouterContext);
  if (!router) throw new Error('useStableRouter must be used under StableRouterContext');
  return router;
};

export const useStableNavigate = (): NavigateFunction => useStableRouter().navigate;

/**
 * Re-renders only when the selected value changes. `select` must return a primitive (or a value
 * that is identical between calls when nothing changed), as with `useSyncExternalStore`.
 */
export const useRouterSelector = <T>(select: (snapshot: RouterSnapshot) => T): T => {
  const router = useStableRouter();
  return useSyncExternalStore(router.subscribe, () => select(router.getSnapshot()));
};

/** The subset of a React Router data router that `createStableRouter` reads. */
interface DataRouterLike {
  state: { location: Location; matches: ReadonlyArray<{ params: Params<string> }> };
  navigate: {
    (to: number): Promise<void>;
    (to: To | null, options?: NavigateOptions): Promise<void>;
  };
  subscribe: (listener: () => void) => () => void;
}

export const createStableRouter = (router: DataRouterLike): StableRouter => {
  let snapshot: RouterSnapshot | null = null;
  const navigate = ((to: To | number, options?: NavigateOptions) =>
    typeof to === 'number'
      ? router.navigate(to)
      : router.navigate(to, options)) as NavigateFunction;
  return {
    navigate,
    getSnapshot: () => {
      const { location, matches } = router.state;
      if (snapshot?.location !== location) {
        snapshot = { location, params: matches[matches.length - 1]?.params ?? {} };
      }
      return snapshot;
    },
    subscribe: listener => router.subscribe(() => listener()),
  };
};
