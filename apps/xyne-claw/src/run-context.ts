import { AsyncLocalStorage } from "node:async_hooks";

const store = new AsyncLocalStorage<{ task: string }>();

export function pinRunTask(task: string): void {
  store.enterWith({ task });
}

export function currentRunTask(): string {
  return store.getStore()?.task ?? "";
}
