/** Dev-only policy. Do not attach to the live network stack before Phase 9. */

export const DEV_REQUEST_DROP_RATE = 0.1;
export const DEV_MAX_INJECTED_LATENCY_MS = 800;

export const shouldDropDevRequest = (
  isDev: boolean,
  random: () => number = Math.random,
  dropRate: number = DEV_REQUEST_DROP_RATE,
): boolean => isDev && random() < dropRate;

export const devInjectedLatencyMs = (
  isDev: boolean,
  random: () => number = Math.random,
  maxMs: number = DEV_MAX_INJECTED_LATENCY_MS,
): number => (isDev ? Math.floor(random() * maxMs) : 0);
