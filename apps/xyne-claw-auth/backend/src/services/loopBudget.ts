/**
 * Pure loop-budget helpers, deliberately free of any DB / Prisma import so the
 * relooper's budget guards stay unit-testable without a generated client.
 *
 * A goal loop is bounded by two ceilings enforced in goalRelooper:
 *   - maxTurns       — hard cap on completed turns (always present, default 5)
 *   - maxWallClockMs — optional wall-clock budget measured from createdAt
 * Both must halt the loop; this module owns the wall-clock arithmetic.
 */

/**
 * True when the elapsed time since `createdAt` meets or exceeds
 * `maxWallClockMs`. `now` is injectable for testing.
 */
export function isWallClockExceeded(
  createdAt: Date,
  maxWallClockMs: number,
  now: number = Date.now(),
): boolean {
  return now - createdAt.getTime() >= maxWallClockMs;
}

/** Compact human label for a ms duration (e.g. 1_800_000 → "30m"). */
export function formatDurationMs(ms: number): string {
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000}h`;
  if (ms % 60_000 === 0) return `${ms / 60_000}m`;
  if (ms % 1000 === 0) return `${ms / 1000}s`;
  return `${ms}ms`;
}
