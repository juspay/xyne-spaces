import { diagnosticsStore } from '../store';

/**
 * Measures how long the app stays frozen after a navigation.
 *
 * Deliberately measures *blocking*, not readiness. Waiting on data is already
 * reported as query latency; what makes navigation feel slow is the main thread
 * being unavailable, which is a different fault with a different fix.
 *
 * A screen is considered settled once no long task has run for `QUIET_MS`. The
 * reported figure is the span from navigation to the end of the last block, so
 * the quiet period itself is not counted.
 */
const QUIET_MS = 500;
const POLL_MS = 100;
/** A screen still blocking after this has a problem no finer measurement improves. */
const MAX_WINDOW_MS = 15_000;

let timer: ReturnType<typeof setInterval> | null = null;

function stopPolling(): void {
  if (timer === null) return;
  clearInterval(timer);
  timer = null;
}

export function noteNavigation(route: string): void {
  diagnosticsStore.beginNavigation(route);
  stopPolling();

  const startedAt = Date.now();
  timer = setInterval(() => {
    const now = Date.now();
    const quietSince = Math.max(startedAt, diagnosticsStore.lastBlockEndedAt());

    if (now - quietSince >= QUIET_MS || now - startedAt >= MAX_WINDOW_MS) {
      diagnosticsStore.settleNavigation(now);
      stopPolling();
    }
  }, POLL_MS);
}

export function startNavigationSource(): () => void {
  return stopPolling;
}
