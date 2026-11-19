import { ozonetelProvider } from '@/services/ozonetel/ozonetelProvider';
import type { CallProvider } from './callProvider';
import { CALL_PROVIDER_IDS, isCallProviderSourceType, type CallProviderId } from './callProviderIds';

// Keyed by id so adding an id to CALL_PROVIDER_IDS without a provider fails to compile.
const PROVIDERS: Record<CallProviderId, CallProvider> = {
  ozonetel: ozonetelProvider,
};

export function getCallProvider(id: string | null | undefined): CallProvider | undefined {
  return isCallProviderSourceType(id) ? PROVIDERS[id] : undefined;
}

export function listCallProviders(): CallProvider[] {
  return CALL_PROVIDER_IDS.map(id => PROVIDERS[id]);
}
