import { useEffect, useState } from 'react';

/**
 * Returns the current time (ms epoch), kept fresh every 60 seconds and
 * snapped precisely to `boundaryTime` when it arrives.
 *
 * @example
 * // Call starts at 12:00:45 — the hook updates at exactly that moment,
 * // not up to 60s late like a plain interval would.
 * const now = useNowWithBoundary(callStartsAtMs, !isEnded);
 *
 * @param boundaryTime - Exact timestamp to sync on, or null to skip.
 * @param enabled - Set false to avoid timers when not needed (e.g. ended calls).
 */
export function useNowWithBoundary(boundaryTime: number | null, enabled: boolean = true): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled || boundaryTime === null) return;

    const updateNow = (): void => setNow(Date.now());
    const intervalId = window.setInterval(updateNow, 60_000);

    let boundaryTimeoutId: number | null = null;
    const scheduleBoundaryUpdate = (): void => {
      const msUntilBoundary = boundaryTime - Date.now();
      if (msUntilBoundary <= 0) {
        updateNow();
        return;
      }

      boundaryTimeoutId = window.setTimeout(
        scheduleBoundaryUpdate,
        Math.min(msUntilBoundary + 1, 2_147_483_647),
      );
    };
    scheduleBoundaryUpdate();

    return (): void => {
      window.clearInterval(intervalId);
      if (boundaryTimeoutId !== null) window.clearTimeout(boundaryTimeoutId);
    };
  }, [enabled, boundaryTime]);

  return now;
}
