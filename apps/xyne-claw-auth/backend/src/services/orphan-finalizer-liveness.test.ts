/**
 * The orphan-finalizer must not kill a run that is still executing.
 *
 * Its only liveness gate used to be the GLOBAL /healthz/ready active-run count.
 * That count is per-pod and load-balanced: the readiness probe can land on a
 * xyne-claw replica that is NOT running the session and report activeRuns=0,
 * so the finalizer flips a live run's row to "failed". When that run later
 * completes, its result callback is rejected as "superseded or settled" and the
 * answer is lost (prod: session a1149216 on 2026-08-31 — finalized at age=36min
 * while still executing, delivered its result 13min later to a dead row).
 *
 * The fix re-checks EACH candidate session before finalizing it, using two
 * pod-independent signals: Redis recovery state and the per-session /alive probe.
 * These assertions pin that guard so it cannot silently regress.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(resolve(here, rel), "utf8");
const worker = (): string => read("./orphan-finalizer-worker.ts");

describe("orphan-finalizer verifies per-session liveness before finalizing", () => {
  it("imports the two pod-independent liveness signals", () => {
    const src = worker();
    expect(src).toContain("hasActiveRunRecovery");
    expect(src).toContain("isRunStillExecuting");
    expect(src).toContain('from "../queue/run-recovery-worker.js"');
  });

  it("checks this session before calling finalizeOrphanedRun", () => {
    const src = worker();
    const loop = src.slice(src.indexOf("for (const run of candidates) {"));
    const guard = loop.indexOf("hasActiveRunRecovery(run.sessionId)");
    const finalize = loop.indexOf("finalizeOrphanedRun(run,");
    expect(guard).toBeGreaterThan(-1);
    // The guard must come BEFORE the destructive finalize, or it cannot prevent it.
    expect(guard).toBeLessThan(finalize);
  });

  it("skips (continues) instead of finalizing when the session is still alive", () => {
    const src = worker();
    const block = src.slice(
      src.indexOf("hasActiveRunRecovery(run.sessionId)"),
      src.indexOf("finalizeOrphanedRun(run,"),
    );
    expect(block).toContain("isRunStillExecuting(run.sessionId)");
    expect(block).toContain("continue;");
  });
});

describe("run-recovery exposes the per-session probe the finalizer reuses", () => {
  it("exports isRunStillExecuting", () => {
    const src = read("../queue/run-recovery-worker.ts");
    expect(src).toContain("export async function isRunStillExecuting(");
  });
});
