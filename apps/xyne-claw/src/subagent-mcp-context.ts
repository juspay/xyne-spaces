import { AsyncLocalStorage } from "node:async_hooks";

const subagentMcpIdStore = new AsyncLocalStorage<string | undefined>();

export function runWithSubagentMcpId<T>(subagentId: string | undefined, fn: () => T): T {
  return subagentMcpIdStore.run(subagentId, fn);
}

export function currentSubagentMcpId(): string | undefined {
  return subagentMcpIdStore.getStore();
}
