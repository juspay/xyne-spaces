import { test, expect, vi } from "vitest";
import { installMidTurnCompaction, forceCompaction } from "../src/mid-turn-compaction.js";

/** A pi-session-like object exposing exactly the internals the adapter touches. */
function fakeSession(over: Record<string, unknown> = {}) {
  return {
    settingsManager: { getCompactionSettings: () => ({ enabled: true }) },
    _checkCompaction: vi.fn(async () => false),
    _runAutoCompaction: vi.fn(async () => true),
    messages: [],
    agent: {
      createLoopConfig: vi.fn(() => ({})),
      state: { model: { contextWindow: 128_000 } },
    },
    ...over,
  };
}

test("installs on a well-formed session: wraps createLoopConfig + _checkCompaction", () => {
  const s = fakeSession();
  const origCheck = s._checkCompaction;
  const origLoop = s.agent.createLoopConfig;
  installMidTurnCompaction(s as unknown as object);
  // Both internals are replaced with wrappers.
  expect(s._checkCompaction).not.toBe(origCheck);
  expect(s.agent.createLoopConfig).not.toBe(origLoop);
});

test("version guard: missing internals → no-op + loud metric, never throws", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  expect(() => installMidTurnCompaction({} as object)).not.toThrow();
  expect(await forceCompaction({} as object, "manual")).toBe(false);
  expect(log).toHaveBeenCalledWith(expect.stringContaining("compaction_patch_unavailable"));
  log.mockRestore(); warn.mockRestore();
});

test("forceCompaction runs _runAutoCompaction on a valid session", async () => {
  const s = fakeSession();
  const ran = await forceCompaction(s as unknown as object, "manual");
  expect(ran).toBe(true);
  expect(s._runAutoCompaction).toHaveBeenCalledWith("manual", false);
});

test("forceCompaction swallows a throwing _runAutoCompaction (best-effort)", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const s = fakeSession({ _runAutoCompaction: vi.fn(async () => { throw new Error("boom"); }) });
  expect(await forceCompaction(s as unknown as object, "manual")).toBe(false);
  warn.mockRestore();
});
