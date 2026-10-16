/**
 * Telemetry the future SQLite read model needs (design §11.1). Collect only —
 * no storage scaffolding.
 */

export type WarmTelemetry = {
  reads: number;
  hits: number;
  misses: number;
  staleHits: number;
  liveSupersedes: number;
  lastStoreBytes: number | null;
};

export const EMPTY_WARM_TELEMETRY: WarmTelemetry = {
  reads: 0,
  hits: 0,
  misses: 0,
  staleHits: 0,
  liveSupersedes: 0,
  lastStoreBytes: null,
};

export const STALE_WARM_AGE_MS = 30_000;

export const recordWarmRead = (
  stats: WarmTelemetry,
  input: { containsTarget: boolean; ageMs: number; staleAfterMs?: number },
): WarmTelemetry => {
  const staleAfter = input.staleAfterMs ?? STALE_WARM_AGE_MS;
  const hit = input.containsTarget;
  return {
    ...stats,
    reads: stats.reads + 1,
    hits: stats.hits + (hit ? 1 : 0),
    misses: stats.misses + (hit ? 0 : 1),
    staleHits: stats.staleHits + (hit && input.ageMs > staleAfter ? 1 : 0),
  };
};

export const recordLiveSupersede = (stats: WarmTelemetry): WarmTelemetry => ({
  ...stats,
  liveSupersedes: stats.liveSupersedes + 1,
});

export const recordStoreBytes = (stats: WarmTelemetry, bytes: number): WarmTelemetry => ({
  ...stats,
  lastStoreBytes: bytes,
});
