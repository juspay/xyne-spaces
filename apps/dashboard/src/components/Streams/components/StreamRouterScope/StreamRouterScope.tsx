import { ReactElement, ReactNode, useCallback, useMemo, useRef, useState } from 'react';
import {
  createPath,
  NavigationType,
  parsePath,
  useLocation,
  UNSAFE_LocationContext,
  UNSAFE_NavigationContext,
  UNSAFE_RouteContext,
  type Location,
  type NavigateOptions,
  type To,
} from 'react-router-dom';

/**
 * Gives one Streams column a private URL.
 *
 * Xyne's chat panel stores per-panel view state in the address bar — `?tab`,
 * `?ticketId`, `?conversationId`, `#origin=` — so N columns sharing one real URL
 * would overwrite each other's tab selection. Each column needs its own.
 *
 * The obvious approach, wrapping each column in `<MemoryRouter>`, is rejected by
 * React Router at runtime: "You cannot render a <Router> inside another <Router>."
 * Routers are singletons by design.
 *
 * So this supplies the three contexts a Router would have supplied, without being
 * one. `useLocation`, `useNavigate`, `useSearchParams` and `useParams` read from
 * these and nothing else, so everything below behaves normally and has no idea it
 * isn't the whole page. Navigation mutates local state instead of the browser URL.
 *
 * Cost of the approach: it touches React Router's `UNSAFE_` internals, so a major
 * version bump could move the ground. That's an acceptable trade for an experiment
 * and a contained one — it lives in this file. The durable fix, if Streams ships,
 * is to give `ConversationPanelV2` optional props for its view state with the URL
 * as fallback, exactly as `CanvasScreen` already does for `canvasId`.
 */

let keySeed = 0;
const nextKey = (): string => {
  keySeed += 1;
  return `stream${keySeed}`;
};

const toLocation = (to: To, state: unknown, current: Location): Location => {
  const partial = typeof to === 'string' ? parsePath(to) : to;
  return {
    pathname: partial.pathname ?? current.pathname,
    search: partial.search ?? '',
    hash: partial.hash ?? '',
    state: state ?? null,
    key: nextKey(),
  };
};

export interface StreamRouterScopeProps {
  /** Seed URL for this column, e.g. `/{workspaceId}/chat/dir/{channelId}`. */
  initialPath: string;
  /**
   * Route params the column should see. Supplied explicitly rather than matched
   * from a pattern — there is no route table here, just one leaf.
   */
  params: Record<string, string>;
  /**
   * Called when the column tries to navigate somewhere that isn't its own view
   * state. Without this, "open in full screen" style links would silently move
   * the column's private URL and appear to do nothing. Return `true` to say the
   * navigation was handled globally and should not touch local state.
   */
  onEscape?: (path: string) => boolean;
  children: ReactNode;
}

const StreamRouterScope = ({
  initialPath,
  params,
  onEscape,
  children,
}: StreamRouterScopeProps): ReactElement => {
  const [location, setLocation] = useState<Location>(() => ({
    ...parsePath(initialPath),
    pathname: parsePath(initialPath).pathname ?? initialPath,
    search: parsePath(initialPath).search ?? '',
    hash: parsePath(initialPath).hash ?? '',
    state: null,
    key: 'default',
  }));

  // Read inside `navigator` callbacks without making them change identity on
  // every navigation — a new navigator object re-renders the whole subtree.
  const locationRef = useRef(location);
  locationRef.current = location;
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;

  const go = useCallback((to: To, state: unknown): void => {
    const next = toLocation(to, state, locationRef.current);
    // A navigation that leaves this column's own path is the host's business,
    // not ours: hand it up rather than pretending to handle it.
    if (escapeRef.current?.(createPath(next))) return;
    setLocation(next);
  }, []);

  const navigator = useMemo(
    () => ({
      createHref: (to: To): string => (typeof to === 'string' ? to : createPath(to)),
      encodeLocation: (to: To): Location => toLocation(to, null, locationRef.current),
      // A column has no history stack of its own; back/forward belong to the app.
      go: (): void => {},
      push: (to: To, state?: unknown, _opts?: NavigateOptions): void => go(to, state),
      replace: (to: To, state?: unknown, _opts?: NavigateOptions): void => go(to, state),
    }),
    [go],
  );

  const navigationValue = useMemo(
    () => ({
      basename: '',
      navigator,
      static: false,
      useTransitions: undefined,
      future: {},
    }),
    [navigator],
  );

  const locationValue = useMemo(
    () => ({ location, navigationType: NavigationType.Pop }),
    [location],
  );

  // One synthetic leaf match. `useParams` reads the last match's params;
  // `useNavigate` uses `pathnameBase` to resolve relative links.
  const routeValue = useMemo(
    () => ({
      outlet: null,
      matches: [
        {
          params,
          pathname: location.pathname,
          pathnameBase: '/',
          route: { id: 'stream-scope', path: location.pathname },
        },
      ],
      isDataRoute: false,
    }),
    [params, location.pathname],
  );

  return (
    <UNSAFE_NavigationContext.Provider value={navigationValue}>
      <UNSAFE_LocationContext.Provider value={locationValue}>
        <UNSAFE_RouteContext.Provider value={routeValue}>{children}</UNSAFE_RouteContext.Provider>
      </UNSAFE_LocationContext.Provider>
    </UNSAFE_NavigationContext.Provider>
  );
};

StreamRouterScope.displayName = 'StreamRouterScope';

export default StreamRouterScope;

/**
 * Prints the URL as seen from inside the current scope. Diagnostic only — it is
 * the whole isolation question made visible: three distinct paths means three
 * private address bars, three identical ones means they are sharing.
 */
export const ScopePathReadout = (): ReactElement => {
  const { pathname, search, hash } = useLocation();
  const shown = `${pathname}${search}${hash}`;
  return (
    <div
      className='shrink-0 truncate border-b border-border bg-muted/40 px-3 py-1 font-mono text-[10px] text-muted-foreground'
      title={shown}
    >
      {shown}
    </div>
  );
};
