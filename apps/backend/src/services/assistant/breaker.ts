/**
 * Stops calling a service that keeps failing, for a while, so an outage fails fast instead of
 * making every turn wait for a timeout. After a pause, one more failure pauses it again.
 */
export interface Breaker {
  allows(now: number): boolean;
  record(ok: boolean, now: number): void;
}

export function createBreaker(failuresBeforePause: number, pauseMs: number): Breaker {
  let failures = 0;
  let pausedUntil = 0;
  return {
    allows: (now) => now >= pausedUntil,
    record(ok, now) {
      failures = ok ? 0 : failures + 1;
      if (failures >= failuresBeforePause) pausedUntil = now + pauseMs;
    },
  };
}
