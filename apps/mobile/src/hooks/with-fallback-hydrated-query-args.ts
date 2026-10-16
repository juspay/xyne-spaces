/**
 * useFallbackHydratedQuery injects `lastUpdatedAt` on its live delta.
 * Pinned catalog queries (userAllChannels, getUsersV2) filter on `updatedAt`.
 * Remap so the delta is incremental instead of a full re-fetch.
 */

export type FallbackHydratedQueryArgs = {
  updatedAt?: number;
  lastUpdatedAt?: number;
};

export function resolveFallbackHydratedQueryArgs<T>(args: T): T {
  // x != null              // skips both null and undefined
  // x !== undefined        // skips only undefined; null still passes
  if (args == null || typeof args !== 'object') return args;
  const record = args as FallbackHydratedQueryArgs & Record<string, unknown>;
  if (record.updatedAt != null || typeof record.lastUpdatedAt !== 'number') return args;
  const { lastUpdatedAt, ...rest } = record;
  return { ...rest, updatedAt: lastUpdatedAt } as T;
}

export function withFallbackHydratedQueryArgs<T>(request: T): T {
  const original = request as {
    query: { fn: (params: { ctx: unknown; args?: unknown }) => unknown };
  };
  const originalFn = original.query.fn;
  return {
    ...original,
    query: {
      ...original.query,
      fn: (params: { ctx: unknown; args?: unknown }) =>
        originalFn({
          ...params,
          args: resolveFallbackHydratedQueryArgs(params.args),
        }),
    },
  } as T;
}
