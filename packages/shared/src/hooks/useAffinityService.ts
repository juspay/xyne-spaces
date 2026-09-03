import { createContext, useContext, useMemo } from "react";
import { AffinityService } from "../services/affinityService.js";
import { useOptionalHttpClient } from "./HttpClientContext.js";

// App-wide single AffinityService. When the host app mounts <AffinityServiceProvider>, every
// useAffinityService() consumer (e.g. useMentionSearch) shares that one instance — so affinity
// weights are fetched from /users/me/affinity once, not once per instance.
const AffinityServiceContext = createContext<AffinityService | null>(null);

// Raw context provider — mount as <AffinityServiceProvider value={affinityService}>.
export const AffinityServiceProvider = AffinityServiceContext.Provider;

// Fallback when no provider is mounted: one instance per HttpClient (backward compatible).
const cache = new WeakMap<object, AffinityService>();

export function useAffinityService(): AffinityService {
  const provided = useContext(AffinityServiceContext);
  const client = useOptionalHttpClient();
  return useMemo(() => {
    if (provided) return provided;
    if (!client) {
      throw new Error(
        "useAffinityService requires an AffinityServiceProvider or HttpClientProvider ancestor",
      );
    }
    const clientKey = client as unknown as object;
    let svc = cache.get(clientKey);
    if (!svc) {
      svc = new AffinityService(client);
      cache.set(clientKey, svc);
    }
    return svc;
  }, [provided, client]);
}
