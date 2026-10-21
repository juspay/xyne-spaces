import { afterEach, beforeEach, vi } from "vitest";

/**
 * Isolate `process.env[keys]` and any stubbed globals per test. Call at file top level.
 * Every key is snapshotted before each test and restored after it (deleted when it was unset,
 * since assigning undefined would store the string "undefined"); `clear` also deletes the keys
 * up front so the test starts from a clean slate.
 */
export function isolateEnv(keys: readonly string[], opts: { clear?: boolean } = {}): void {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of keys) {
      saved[key] = process.env[key];
      if (opts.clear) delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    vi.unstubAllGlobals();
  });
}
