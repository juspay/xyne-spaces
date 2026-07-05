import { test, expect, vi } from "vitest";
import { runWithProviderFallback } from "../src/provider-fallback.js";

// Minimal attempt/result shapes mirroring the real ones.
type A = { provider: string | undefined };
type R = { text: string };

const QUOTA = new Error("quota");
const CANCEL = new Error("cancel");
const isQuota = (e: unknown) => e === QUOTA;
const isCancel = (e: unknown) => e === CANCEL;
const label = (a: A) => a.provider ?? "spaces";

/** Build a runAttempt that yields scripted outcomes per attempt index.
 *  Each script entry is either {text} (returns), or {throw} (throws). */
function scripted(outcomes: Array<{ text?: string; throw?: unknown }>) {
  const calls: Array<{ provider: string; forceCompact: boolean }> = [];
  const runAttempt = async (a: A, forceCompact: boolean): Promise<R> => {
    const i = calls.length;
    calls.push({ provider: label(a), forceCompact });
    const o = outcomes[i]!;
    if ("throw" in o && o.throw !== undefined) throw o.throw;
    return { text: o.text ?? "" };
  };
  return { runAttempt, calls };
}

const base = (over: Partial<Parameters<typeof runWithProviderFallback<A, R>>[0]>) => ({
  attempts: [{ provider: "codex" }, { provider: "claude" }, { provider: undefined }] as A[],
  providerLabel: label,
  producedNothing: (r: R) => !r.text.trim(),
  isQuotaError: isQuota,
  isCancelled: isCancel,
  ...over,
});

test("first attempt succeeds → no fallback", async () => {
  const { runAttempt, calls } = scripted([{ text: "done" }]);
  const onRecovered = vi.fn();
  const out = await runWithProviderFallback<A, R>(base({ runAttempt, hooks: { onRecovered } }));
  expect(out.result.text).toBe("done");
  expect(out.completedAttempt.provider).toBe("codex");
  expect(out.fellBackProvider).toBeNull();
  expect(calls).toHaveLength(1);
  expect(calls[0]!.forceCompact).toBe(false);
  expect(onRecovered).not.toHaveBeenCalled();
});

test("empty completion → compacts + falls back to next provider", async () => {
  const { runAttempt, calls } = scripted([{ text: "" }, { text: "recovered" }]);
  const onEmpty = vi.fn();
  const onRecovered = vi.fn();
  const out = await runWithProviderFallback<A, R>(base({ runAttempt, hooks: { onEmpty, onRecovered } }));
  expect(out.result.text).toBe("recovered");
  expect(out.completedAttempt.provider).toBe("claude");
  expect(out.fellBackProvider).toBe("claude");
  // The 2nd attempt must be told to compact first (prev was empty).
  expect(calls[1]!.forceCompact).toBe(true);
  expect(onEmpty).toHaveBeenCalledWith("codex", false); // non-terminal empty
  expect(onRecovered).toHaveBeenCalledWith("claude");
});

test("all attempts empty → terminal empty, returns last (no throw)", async () => {
  const { runAttempt } = scripted([{ text: "" }, { text: "" }, { text: "" }]);
  const onEmpty = vi.fn();
  const out = await runWithProviderFallback<A, R>(base({ runAttempt, hooks: { onEmpty } }));
  expect(out.result.text).toBe("");
  expect(out.completedAttempt.provider).toBeUndefined(); // terminal = spaces
  // Two non-terminal empties + one terminal empty.
  expect(onEmpty.mock.calls).toEqual([["codex", false], ["claude", false], ["spaces", true]]);
});

test("quota error → falls back; non-empty fallback succeeds", async () => {
  const { runAttempt, calls } = scripted([{ throw: QUOTA }, { text: "ok" }]);
  const onFallback = vi.fn();
  const out = await runWithProviderFallback<A, R>(base({ runAttempt, hooks: { onFallback } }));
  expect(out.result.text).toBe("ok");
  expect(out.fellBackProvider).toBe("claude");
  // Quota fallback does NOT request compaction (only empties do).
  expect(calls[1]!.forceCompact).toBe(false);
  expect(onFallback).toHaveBeenCalledWith("codex", "claude", QUOTA);
});

test("non-quota error → rethrows immediately, no fallback", async () => {
  const boom = new Error("boom");
  const { runAttempt, calls } = scripted([{ throw: boom }, { text: "unused" }]);
  await expect(runWithProviderFallback<A, R>(base({ runAttempt }))).rejects.toBe(boom);
  expect(calls).toHaveLength(1); // never tried the fallback
});

const STALL = new Error("Provider codex stalled: no stream activity for 120000ms");
const isTransient = (e: unknown) => e === STALL;

test("transient/stall error → falls back to next provider", async () => {
  const { runAttempt, calls } = scripted([{ throw: STALL }, { text: "ok" }]);
  const onFallback = vi.fn();
  const out = await runWithProviderFallback<A, R>(
    base({ runAttempt, isTransientError: isTransient, hooks: { onFallback } }),
  );
  expect(out.result.text).toBe("ok");
  expect(out.fellBackProvider).toBe("claude");
  // Matches quota semantics: no forced compaction on a thrown transient error.
  expect(calls[1]!.forceCompact).toBe(false);
  expect(onFallback).toHaveBeenCalledWith("codex", "claude", STALL);
});

test("transient error that is ALSO a cancel → rethrows, no fallback", async () => {
  // isCancelled wins over transient eligibility (user stop must never fall back).
  const { runAttempt, calls } = scripted([{ throw: STALL }, { text: "unused" }]);
  await expect(
    runWithProviderFallback<A, R>(
      base({ runAttempt, isTransientError: isTransient, isCancelled: () => true }),
    ),
  ).rejects.toBe(STALL);
  expect(calls).toHaveLength(1);
});

test("transient error with no fallback left → rethrows", async () => {
  // Single-attempt chain: a stall on the only/last provider surfaces (→ run.ts
  // turns it into the user-visible 'temporarily unavailable' notice).
  const { runAttempt } = scripted([{ throw: STALL }]);
  await expect(
    runWithProviderFallback<A, R>(
      base({ attempts: [{ provider: "codex" }], runAttempt, isTransientError: isTransient }),
    ),
  ).rejects.toBe(STALL);
});

test("cancellation → rethrows even though it would be quota-eligible", async () => {
  const { runAttempt, calls } = scripted([{ throw: CANCEL }, { text: "unused" }]);
  await expect(runWithProviderFallback<A, R>(base({ runAttempt }))).rejects.toBe(CANCEL);
  expect(calls).toHaveLength(1);
});

test("all attempts throw quota → throws the last error", async () => {
  const last = new Error("quota");
  const isQ = (e: unknown) => e === QUOTA || e === last;
  const { runAttempt } = scripted([{ throw: QUOTA }, { throw: QUOTA }, { throw: last }]);
  await expect(
    runWithProviderFallback<A, R>(base({ runAttempt, isQuotaError: isQ })),
  ).rejects.toBe(last);
});

test("mixed: empty → quota → success", async () => {
  const { runAttempt, calls } = scripted([{ text: "" }, { throw: QUOTA }, { text: "final" }]);
  const out = await runWithProviderFallback<A, R>(base({ runAttempt }));
  expect(out.result.text).toBe("final");
  expect(out.fellBackProvider).toBe("spaces");
  expect(calls[0]!.forceCompact).toBe(false); // first call
  expect(calls[1]!.forceCompact).toBe(true);  // after empty
  expect(calls[2]!.forceCompact).toBe(false); // after quota (not empty)
});
