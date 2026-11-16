import { AsyncLocalStorage } from 'async_hooks';

const dekPassthroughContext = new AsyncLocalStorage<boolean>();

export function runWithDekPassthrough<T>(fn: () => T): T {
  return dekPassthroughContext.run(true, fn);
}

export function isDekPassthrough(): boolean {
  return dekPassthroughContext.getStore() ?? false;
}
