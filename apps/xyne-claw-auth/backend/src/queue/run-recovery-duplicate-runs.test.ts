/**
 * One request must not become several runs.
 *
 * The watchdog used to infer death from heartbeat age alone. Heartbeats only
 * advance on progress events, so a run sitting inside ONE long tool call looks
 * exactly like a dead one — and the "recovery" re-dispatched the whole request
 * on top of the still-working original. On 2026-08-18 a single /design ask
 * produced four runs across two sandboxes, delivered the same HTML twice, and
 * then told the thread it had failed 3/3 times while two of those runs had in
 * fact completed with 71k tokens of output between them.
 *
 * Three guards came out of that, pinned here.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(resolve(here, rel), "utf8");
const worker = (): string => read("./run-recovery-worker.ts");

describe("watchdog verifies liveness before re-dispatching", () => {
  it("asks claw whether the run is still executing", () => {
    const src = worker();
    const block = src.slice(src.indexOf("const age = Date.now() - state.lastHeartbeatAt;"));
    const probe = block.indexOf("isRunStillExecuting(state.activeSessionId)");
    const retryGate = block.indexOf("state.retriesUsed >= state.maxRetries");
    expect(probe).toBeGreaterThan(-1);
    // The probe must come BEFORE the retry decision, or it cannot prevent one.
    expect(probe).toBeLessThan(retryGate);
  });

  it("re-arms the watchdog instead of retrying while the run is alive", () => {
    const src = worker();
    const block = src.slice(src.indexOf("if (await isRunStillExecuting("));
    expect(block).toContain("scheduleWatchdog(");
    expect(block).toContain("state.lastHeartbeatAt = Date.now()");
  });

  it("caps re-arms so a wedged run still exits", () => {
    const src = worker();
    expect(src).toContain("MAX_LIVENESS_REARMS");
    expect(src).toMatch(/livenessRearms\s*=\s*\(state\.livenessRearms\s*\?\?\s*0\)\s*\+\s*1/);
  });

  it("fails OPEN — an unreachable claw must not block recovery", () => {
    const src = worker();
    const fn = src.slice(
      src.indexOf("async function isRunStillExecuting"),
      src.indexOf("async function anyAttemptDelivered"),
    );
    // Every non-affirmative path returns false, i.e. "assume dead, allow retry".
    expect(fn).toContain("if (!res.ok) return false;");
    expect(fn).toContain("return body.alive === true;");
    expect(fn).toMatch(/catch\s*{\s*return false;\s*}/);
    expect(fn).toContain("AbortSignal.timeout(");
  });

  it("claw exposes the probe the watchdog calls", () => {
    const runTs = read("../../../../xyne-claw/src/routes/run.ts");
    expect(runTs).toContain('router.get("/run/:sessionId/alive", validateS2SKey');
    expect(runTs).toContain("alive: activeRuns.has(sessionId)");
  });
});

describe("non-retryable failures do not burn retries", () => {
  it("classifies the GCS archive refusal as terminal", () => {
    const src = worker();
    const fn = src.slice(
      src.indexOf("function isNonRetryableFailure"),
      src.indexOf("const MAX_LIVENESS_REARMS"),
    );
    expect(fn).toContain("Failed to restore newer GCS archive");
    expect(fn).toContain("refusing to run again");
  });

  it("exhausts immediately, ahead of every retrying branch", () => {
    const src = worker();
    const handler = src.slice(src.indexOf("export async function handleRunCompletion"));
    const terminal = handler.indexOf("isNonRetryableFailure(error)");
    const sandbox = handler.indexOf("isSandboxUnavailableFailure(error)");
    const locked = handler.indexOf("isSessionLockedFailure(error)");
    expect(terminal).toBeGreaterThan(-1);
    expect(terminal).toBeLessThan(sandbox);
    expect(terminal).toBeLessThan(locked);
  });
});

describe("exhaustion notice", () => {
  it("is suppressed when an attempt already delivered", () => {
    const src = worker();
    const fn = src.slice(
      src.indexOf("async function markExhausted"),
      src.indexOf("async function dispatchRetry"),
    );
    const delivered = fn.indexOf("anyAttemptDelivered(state)");
    const notify = fn.indexOf("notifyExhausted(state)");
    expect(delivered).toBeGreaterThan(-1);
    expect(delivered).toBeLessThan(notify);
    // State is still recorded — only the user-facing card is withheld.
    expect(fn.indexOf('state.status = "exhausted"')).toBeLessThan(delivered);
  });

  it("checks the whole session history, not just the active session", () => {
    const src = worker();
    const fn = src.slice(
      src.indexOf("async function anyAttemptDelivered"),
      src.indexOf("function isOneShotScheduledConversation("),
    );
    expect(fn).toContain("state.sessionHistory");
    expect(fn).toContain("state.rootSessionId");
    expect(fn).toContain('status: "completed"');
    // A delivered run has a result; a crashed one does not.
    expect(fn).toContain("NOT: { result: null }");
  });

  it("never suppresses on its own failure", () => {
    const src = worker();
    const fn = src.slice(
      src.indexOf("async function anyAttemptDelivered"),
      src.indexOf("function isOneShotScheduledConversation("),
    );
    const catchBlock = fn.slice(fn.indexOf("} catch (err) {"));
    expect(catchBlock).toContain("return false;");
  });
});
