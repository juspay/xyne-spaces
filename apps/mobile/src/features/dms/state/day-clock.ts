import { observable } from '@legendapp/state';

import { startOfLocalDay } from '../model/timestamp';

/**
 * Local midnight of the day it currently is.
 *
 * Timestamps are relative, so a label goes stale on its own: a row last
 * touched this afternoon still says "4:58 pm" tomorrow morning unless
 * something re-renders it. Nothing would — the row's data has not changed.
 *
 * The classic list avoids this by rebuilding every label on every derivation
 * pass, which is work on every unread tick. One observable that changes once
 * a day costs nothing and re-labels every visible row at the moment it should.
 */
export const todayStart$ = observable(startOfLocalDay(Date.now()));

let timer: ReturnType<typeof setTimeout> | null = null;

function scheduleNextRollover(): void {
  const now = Date.now();
  const nextMidnight = startOfLocalDay(now) + 86_400_000;

  // One second past midnight, so a timer that fires a hair early does not
  // compute the day it has just left and then wait another full day.
  timer = setTimeout(
    () => {
      todayStart$.set(startOfLocalDay(Date.now()));
      scheduleNextRollover();
    },
    nextMidnight - now + 1_000,
  );
}

scheduleNextRollover();

/** Tests only. */
export function stopDayClock(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}
