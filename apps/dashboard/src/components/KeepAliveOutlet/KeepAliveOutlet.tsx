import { Activity, useContext, useEffect, useLayoutEffect, useRef, type ReactElement } from 'react';
import {
  useMatches,
  useOutlet,
  UNSAFE_LocationContext as LocationContext,
  UNSAFE_RouteContext as RouteContext,
} from 'react-router-dom';
import type {
  KeepAlivePane as Pane,
  KeepAliveOutletProps,
  KeepAlivePaneProps,
} from './KeepAliveOutlet.types';
import { upsertPane } from './KeepAliveOutlet.utils';

/**
 * Restores scroll offsets after an `Activity` reveal.
 *
 * Lives *outside* `Activity` on purpose: a hidden `Activity` unmounts its
 * subtree's effects, so a recorder placed inside it would be torn down exactly
 * when it needs to keep holding state.
 */
const KeepAlivePane = ({ mode, children }: KeepAlivePaneProps): ReactElement => {
  const hostRef = useRef<HTMLDivElement>(null);
  const offsets = useRef(new Map<Element, { top: number; left: number }>());

  // `scroll` does not bubble, but it does capture — one listener on the host
  // records every scroll container in the pane without having to find them.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const record = (event: Event): void => {
      const el = event.target;
      if (el instanceof Element) {
        offsets.current.set(el, { top: el.scrollTop, left: el.scrollLeft });
      }
    };
    host.addEventListener('scroll', record, { capture: true, passive: true });
    return (): void => host.removeEventListener('scroll', record, { capture: true });
  }, []);

  // React hides an Activity subtree with `display: none !important`, which
  // destroys its layout boxes and with them every scrollTop in the pane. Replay
  // the recorded offsets on the way back in, before paint. React commits layout
  // effects child-first, so this runs after the revealed screen's own layout
  // effects and wins over anything they scroll on re-mount.
  useLayoutEffect(() => {
    if (mode !== 'visible') return;
    for (const [el, { top, left }] of offsets.current) {
      if (!el.isConnected) {
        offsets.current.delete(el);
        continue;
      }
      if (el.scrollTop !== top) el.scrollTop = top;
      if (el.scrollLeft !== left) el.scrollLeft = left;
    }
  }, [mode]);

  // `display: contents` keeps the wrapper out of layout, so dropping it into an
  // existing flex/grid tree does not change how the screen lays out. React
  // restores this exact value when it unhides, so it survives the round trip.
  return (
    <div ref={hostRef} style={{ display: 'contents' }}>
      {children}
    </div>
  );
};

KeepAlivePane.displayName = 'KeepAlivePane';

/**
 * Drop-in replacement for `<Outlet />` that keeps recently-visited sibling
 * screens mounted instead of destroying them.
 *
 * `<Outlet />` renders exactly one matched child, so sibling routes are mutually
 * exclusive: navigating away unmounts the outgoing screen and navigating back
 * rebuilds it from nothing. This keeps the last `max` screens alive, hidden
 * behind `<Activity mode='hidden'>`, so returning is a visibility flip rather
 * than a reconstruction. DOM and React state survive; effects do not — that is
 * Activity's contract, and it is what keeps subscriptions off hidden screens.
 *
 * A hidden pane must not observe the *current* route. The element handed back by
 * `useOutlet()` already carries its own frozen `RouteContext`, so `useParams()`
 * and `useOutletContext()` are safe by construction — but `useLocation()` and
 * everything derived from it read `LocationContext`, which sits above the router
 * outlet and would otherwise report wherever the user has since navigated. Each
 * hidden pane is therefore re-provided the location it was captured with.
 */
export const KeepAliveOutlet = ({
  context,
  max = 3,
  getKey,
}: KeepAliveOutletProps): ReactElement | null => {
  const outlet = useOutlet(context);
  const liveLocation = useContext(LocationContext);
  const matches = useMatches();
  const { matches: parentMatches } = useContext(RouteContext);
  const panesRef = useRef<Pane[]>([]);

  // The match this outlet renders sits directly below our own depth. Keying on
  // its route id rather than its pathname gives one live instance per screen:
  // param changes within a screen reconcile as they always did, while sibling
  // screens each keep their own instance.
  const activeMatch = matches[parentMatches.length];
  const activeKey = activeMatch ? (getKey?.(activeMatch) ?? activeMatch.id) : null;

  if (activeKey !== null && outlet !== null) {
    panesRef.current = upsertPane(
      panesRef.current,
      { key: activeKey, element: outlet, locationContext: liveLocation },
      max,
    );
  }

  const panes = panesRef.current;
  if (panes.length === 0) return null;

  return (
    <>
      {panes.map(pane => {
        const isActive = pane.key === activeKey;
        // Tree shape is identical for active and hidden panes. Wrapping only the
        // hidden ones would change the element type at this key on every
        // navigation, which is a remount — the exact thing this component exists
        // to avoid.
        return (
          <LocationContext.Provider
            key={pane.key}
            value={isActive ? liveLocation : pane.locationContext}
          >
            <KeepAlivePane mode={isActive ? 'visible' : 'hidden'}>
              <Activity mode={isActive ? 'visible' : 'hidden'} name={pane.key}>
                {pane.element}
              </Activity>
            </KeepAlivePane>
          </LocationContext.Provider>
        );
      })}
    </>
  );
};

KeepAliveOutlet.displayName = 'KeepAliveOutlet';
