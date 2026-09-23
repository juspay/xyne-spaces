/**
 * P1(d) mixed-version fallback decision (pure — the clock/threshold seam the review asked for).
 *
 * A NEW fan-out pod tailing a grant stream written by an OLD-version tap owner never sees the
 * `{resynced}` sentinel, so the grant would defer admissions forever (fail-closed but silent).
 * The defer is BOUNDED instead: the clock starts at the first non-cleared entry seen while
 * unhydrated, and once entries have been flowing past `thresholdMs` the caller adopts the
 * stream as hydrated — loudly. A `cleared` boundary resets the clock by deleting the key
 * (the caller does this), so a fresh rebuild always restarts the wait.
 */
export function grantSentinelFallbackDecision(
  unhydratedSince: Map<string, number>,
  grantKey: string,
  nowMs: number,
  thresholdMs: number,
): 'defer' | 'adopt' {
  const since = unhydratedSince.get(grantKey);
  if (since === undefined) {
    unhydratedSince.set(grantKey, nowMs);
    return 'defer';
  }
  if (nowMs - since < thresholdMs) return 'defer';
  unhydratedSince.delete(grantKey);
  return 'adopt';
}
