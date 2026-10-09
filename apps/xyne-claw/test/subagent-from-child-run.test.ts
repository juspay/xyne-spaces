/**
 * subagent-from-child-run.test.ts — projecting a v2 child run into the shape the
 * debug drawer nests on.
 *
 * The drawer matches `parentSessionId` against a turn's run `sessionId`. A
 * subagent shares its parent's session so either field works; a delegated agent
 * has its own, and reading `sessionId` there points the trace at itself — the
 * whole delegation then lands in "could not be matched to a parent turn".
 */
import { describe, it, expect } from "vitest";
import { subagentFromChildRun } from "../src/routes/debug.js";
import type { RunHeader } from "../src/debug/types.js";

const header = (over: Partial<RunHeader>): RunHeader =>
  ({
    schemaVersion: 2,
    runId: "1700000000000-child",
    storeKey: "conv_orchestrator",
    captureLevel: "full",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:00:01.000Z",
    status: "completed",
    task: "t",
    counts: { events: 0, blobs: 0, messages: 0, toolCalls: 0 },
    tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    latency: { totalMs: 0, llmDecodeMs: 0, llmWaitMs: 0, llmTotalMs: 0, llmTurns: 0, llmRetries: 0, toolMs: 0 },
    ...over,
  }) as RunHeader;

describe("subagentFromChildRun", () => {
  it("points a delegated agent at the CALLER's session, not its own", () => {
    const out = subagentFromChildRun(
      header({
        sessionId: "parent-session-a2a-call_1",
        parentSessionId: "parent-session",
        parentToolCallId: "call_1",
        subagentName: "ask-ai",
        childKind: "agent",
      }),
      {},
    );
    expect(out?.data["parentSessionId"]).toBe("parent-session");
    expect(out?.data["childKind"]).toBe("agent");
  });

  it("falls back to sessionId for a subagent, which shares its parent's session", () => {
    const out = subagentFromChildRun(
      header({ sessionId: "parent-session", parentToolCallId: "call_2", subagentName: "spaces", childKind: "subagent" }),
      {},
    );
    expect(out?.data["parentSessionId"]).toBe("parent-session");
  });

  it("still resolves a legacy child header written before parentSessionId existed", () => {
    const out = subagentFromChildRun(
      header({ parentRunId: "1699999999999-parent", parentToolCallId: "call_3", subagentName: "spaces" }),
      {},
    );
    expect(out?.data["parentSessionId"]).toBe("1699999999999-parent");
  });

  it("names the file per tool call so two children of one callee stay distinct", () => {
    const a = subagentFromChildRun(header({ parentToolCallId: "call_1", subagentName: "ask-ai" }), {});
    const b = subagentFromChildRun(header({ parentToolCallId: "call_2", subagentName: "ask-ai" }), {});
    expect(a?.fileName).not.toBe(b?.fileName);
  });

  it("ignores a run that is nobody's child", () => {
    expect(subagentFromChildRun(header({ sessionId: "top-level" }), {})).toBeNull();
  });
});
