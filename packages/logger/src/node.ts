import { AsyncLocalStorage } from "node:async_hooks";
import type { ContextProvider, LogPayload } from "./types.js";

// Node per-request context via AsyncLocalStorage. Separate entry (@xyne/logger/node)
// so the core never pulls node:async_hooks into a browser bundle.
export class AsyncLocalStorageContext implements ContextProvider {
  readonly storage = new AsyncLocalStorage<LogPayload>();

  get(): LogPayload | undefined {
    return this.storage.getStore();
  }

  /** Run `fn` with `fields` merged on top of any inherited context. */
  run<T>(fields: LogPayload, fn: () => T): T {
    const parent = this.storage.getStore() ?? {};
    return this.storage.run({ ...parent, ...fields }, fn);
  }

  /** Merge fields into the active context in place (for ids learned mid-run). */
  set(fields: LogPayload): void {
    const store = this.storage.getStore();
    if (store) Object.assign(store, fields);
  }
}
