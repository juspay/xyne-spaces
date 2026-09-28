import type { ContextType, ReactNode } from 'react';
import type { UIMatch, UNSAFE_LocationContext } from 'react-router-dom';

/** `{ location, navigationType }` — what `useLocation()` and friends read from. */
export type LocationContextValue = ContextType<typeof UNSAFE_LocationContext>;

/** One kept-alive screen. */
export interface KeepAlivePane {
  /** Route id of the screen this pane holds. Stable across param changes. */
  key: string;
  /** The outlet element captured while this pane was last active. */
  element: ReactNode;
  /** Location as of that same moment — replayed to the pane while it is hidden. */
  locationContext: LocationContextValue;
}

export interface KeepAliveOutletProps {
  /** Forwarded exactly as `<Outlet context={...} />` forwards it. */
  context?: unknown;
  /** Total screens kept mounted, active included. Least-recently-active is dropped. */
  max?: number;
  /**
   * Pane identity for the matched child route. Defaults to the route id, so param
   * changes re-render one instance; return a param-derived key to keep one
   * instance per param value instead (e.g. one pane per channel).
   */
  getKey?: (match: UIMatch) => string;
}

export interface KeepAlivePaneProps {
  mode: 'visible' | 'hidden';
  children: ReactNode;
}
