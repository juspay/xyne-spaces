import { useEffect, useRef } from 'react';
import { InteractionManager } from 'react-native';

import { useStartupPhase } from '@/src/providers/StartupPhaseProvider';

type TabPreloader = {
  preload: (name: string) => void;
};

/**
 * Mounts the sibling tabs ahead of time so switching to one is not a mount.
 *
 * `BottomTabView` is lazy by default: the first `navigate` to a tab mounts that
 * screen's whole tree inside the same React commit that changes the tab state,
 * so the bar cannot paint the new tab until the destination has rendered.
 * React Navigation's `preload` puts the route in `state.preloadedRouteKeys`,
 * which renders it inactive and *unfrozen*; the later switch is then only an
 * `activityState` flip.
 *
 * Work is deferred past the first frame and spread one route per frame, so
 * this never competes with startup or turns into one long frame of its own.
 */
export function usePreloadTabs(navigation: TabPreloader, routeNames: readonly string[]): void {
  const { hasFirstFramePainted } = useStartupPhase();
  const navigationRef = useRef(navigation);
  navigationRef.current = navigation;

  // Which routes have already been asked for. Tracked per route rather than as
  // a single latch, so rearranging the bar preloads whatever just became a pill
  // without paying for the ones already mounted.
  const preloaded = useRef(new Set<string>());

  useEffect(() => {
    if (!hasFirstFramePainted) return;

    const pending = routeNames.filter(name => !preloaded.current.has(name));
    if (pending.length === 0) return;
    for (const name of pending) preloaded.current.add(name);

    let cancelled = false;
    let frame: number | null = null;

    const task = InteractionManager.runAfterInteractions(() => {
      const step = (): void => {
        if (cancelled) return;
        const next = pending.shift();
        if (next === undefined) return;
        navigationRef.current.preload(next);
        frame = requestAnimationFrame(step);
      };
      step();
    });

    return (): void => {
      cancelled = true;
      task.cancel();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [hasFirstFramePainted, routeNames]);
}
