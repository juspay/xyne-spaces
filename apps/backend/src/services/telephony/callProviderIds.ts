// Dependency-free so pure helpers (callTranscript.ts) can use it; add a provider here and in callProviderRegistry.ts.
export const CALL_PROVIDER_IDS = ['ozonetel'] as const;

export type CallProviderId = (typeof CALL_PROVIDER_IDS)[number];

/** True for ExternalSource.sourceType values that are call-provider connections. */
export function isCallProviderSourceType(value: unknown): value is CallProviderId {
  return typeof value === 'string' && (CALL_PROVIDER_IDS as readonly string[]).includes(value);
}
