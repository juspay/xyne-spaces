/**
 * A resumed attempt may produce an empty completed callback after another pod
 * interruption. The callback must not settle the logical run or post the
 * generic apology while another bounded recovery attempt can answer.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(resolve(here, rel), "utf8");
const webhook = (): string => read("../routes/webhook.ts");
const worker = (): string => read("./run-recovery-worker.ts");

describe("empty completed callbacks defer to run recovery", () => {
  it("does not settle recovery completed before the empty-result decision", () => {
    const src = webhook();
    expect(src).toContain("deferCompletedRecoveryForEmptyResult");
    expect(src).toContain('recoveryCallbackDisposition === "active_continuation"');
    expect(src).toContain('payload.status === "completed" && !deferCompletedRecoveryForEmptyResult');
    expect(src).toContain('handleRunCompletion(sessionId, "failed", "empty_result")');
  });

  it("returns silently when recovery retries the empty result", () => {
    const src = webhook();
    const empty = src.slice(src.indexOf('handleRunCompletion(sessionId, "failed", "empty_result")'));
    const retryGuard = empty.indexOf("recoveryEmptyResult?.stale || recoveryEmptyResult?.retried");
    const apology = empty.indexOf('"Sorry, I wasn\'t able to produce a response');
    expect(retryGuard).toBeGreaterThan(-1);
    expect(apology).toBeGreaterThan(retryGuard);
    expect(empty.slice(retryGuard, apology)).toContain("return;");
  });

  it("records the empty physical attempt as failed and undelivered", () => {
    const src = webhook();
    const finalize = src.slice(
      src.indexOf("// Finalize the physical AgentRun record"),
      src.indexOf('if (payload.status === "completed" && !deferCompletedRecoveryForEmptyResult)'),
    );
    expect(finalize).toContain('? "completed"');
    expect(finalize).toContain(': "failed"');
    expect(finalize).toContain('error: deferCompletedRecoveryForEmptyResult ? "empty_result"');
    expect(finalize).toMatch(/result:\s*deferCompletedRecoveryForEmptyResult\s*\? null/);
  });
});

describe("superseded pod callbacks are silent", () => {
  it("only classifies an active retry or handoff attempt as a continuation", () => {
    const src = worker();
    const fn = src.slice(
      src.indexOf("export async function classifyRunRecoveryCallback"),
      src.indexOf("export async function handleRunCompletion"),
    );
    expect(fn).toContain('return "stale"');
    expect(fn).toContain("state.retriesUsed > 0");
    expect(fn).toContain("state.sessionHistory.some");
    expect(fn).toContain('"active_continuation"');
    expect(fn).toContain('"active_initial"');
  });

  it("rejects a callback whose physical session no longer owns the root", () => {
    const src = worker();
    const handler = src.slice(src.indexOf("export async function handleRunCompletion"));
    const staleGuard = handler.indexOf('state.status !== "running" || state.activeSessionId !== sessionId');
    const completion = handler.indexOf('if (status === "completed")');
    expect(staleGuard).toBeGreaterThan(-1);
    expect(staleGuard).toBeLessThan(completion);
    expect(handler.slice(staleGuard, completion)).toContain("stale: true");
  });

  it("returns from the webhook for stale completed and failed callbacks", () => {
    const src = webhook();
    expect(src).toContain('if (recoveryCallbackDisposition === "stale")');
    expect(src).toContain("if (recoveryCompletion?.stale)");
    expect(src).toContain("if (recoveryFailure?.stale)");
  });
});
