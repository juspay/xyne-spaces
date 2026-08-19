import { AsyncLocalStorage } from 'node:async_hooks';

export interface AutomationContextStore {
  runId: string;
  automationId: string;
  chain: readonly string[];
  stepName?: string;
}

export const automationContextStorage = new AsyncLocalStorage<AutomationContextStore>();

export function currentUpstreamChain(): readonly string[] {
  const store = automationContextStorage.getStore();
  if (!store) return [];
  return [...store.chain, store.automationId];
}

// The executor sets store.stepName to the real persisted row key before running a
// step. The key is hierarchical for nested branch steps. Steps must NOT infer
// their index from Object.keys(context.steps).length — nested steps break that count.
export function currentStepName(): string | undefined {
  return automationContextStorage.getStore()?.stepName;
}
