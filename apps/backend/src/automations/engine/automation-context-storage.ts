import { AsyncLocalStorage } from 'node:async_hooks';

export interface AutomationContextStore {
  runId: string;
  automationId: string;
  chain: readonly string[];
  currentStepName?: string;
}

export const automationContextStorage = new AsyncLocalStorage<AutomationContextStore>();

export function currentUpstreamChain(): readonly string[] {
  const store = automationContextStorage.getStore();
  if (!store) return [];
  return [...store.chain, store.automationId];
}
