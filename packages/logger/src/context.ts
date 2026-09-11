import type { ContextProvider, LogPayload } from "./types.js";

// Process-lifetime ambient context (browser/electron model — no ALS off-Node).
export class SetOnceContext implements ContextProvider {
  private fields: LogPayload = {};

  /** Merge fields into the ambient context (last write wins per key). */
  set(fields: LogPayload): void {
    this.fields = { ...this.fields, ...fields };
  }

  /** Replace the entire ambient context. */
  reset(fields: LogPayload = {}): void {
    this.fields = { ...fields };
  }

  get(): LogPayload | undefined {
    return this.fields;
  }
}

/** A provider that never contributes any ambient fields. */
export const emptyContext: ContextProvider = { get: () => undefined };
