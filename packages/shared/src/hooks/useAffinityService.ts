import { useMemo } from 'react';
import { AffinityService } from '../services/affinityService.js';
import { useHttpClient } from './HttpClientContext.js';

// Instance-per-HttpClient. In practice one HttpClient lives for the app's
// lifetime, so this returns the same AffinityService every render — preserving
// its in-memory weight cache across component remounts.
const cache = new WeakMap<object, AffinityService>();

export function useAffinityService(): AffinityService {
  const client = useHttpClient();
  return useMemo(() => {
    const clientKey = client as unknown as object;
    let svc = cache.get(clientKey);
    if (!svc) {
      svc = new AffinityService(client);
      cache.set(clientKey, svc);
    }
    return svc;
  }, [client]);
}
