import { describe, expect, it } from "vitest";

process.env["XYNE_CLAW_S2S_KEY"] ||= "test-s2s-key";

const { RunCancelledError, ProviderStallError } = await import("../src/agent.js");
const { abortTelemetry } = await import("../src/routes/run.js");
type LlmCallStat = import("../src/llm-turn-stats.js").LlmCallStat;
type LatencyMetrics = import("../src/agent.js").LatencyMetrics;
type ToolInvocation = import("../src/agent.js").ToolInvocation;

const latency: LatencyMetrics = {
  totalMs: 9000, llmDecodeMs: 3000, llmWaitMs: 2000, llmTotalMs: 5000,
  llmTurns: 2, llmRetries: 0, firstTurnTtftMs: 800, toolMs: 3500,
};
const call = (i: number, sa?: string): LlmCallStat => ({ i, ttft: 100, dec: 200, in: 10, out: 5, cr: 0, cw: 0, ...(sa ? { sa } : {}) });
const inv = (toolName: string, extra: Partial<ToolInvocation> = {}): ToolInvocation =>
  ({ toolCallId: `${toolName}-1`, toolName, args: {}, result: "ok", isError: false, durationMs: 10, ...extra }) as ToolInvocation;
const tokenUsage = { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 };

describe("abort-path telemetry", () => {
  it("carries latency and the per-call series on a cancelled run, merged with nested work", () => {
    const err = new RunCancelledError("Run cancelled by user", {
      toolsUsed: ["spaces"],
      toolInvocations: [inv("spaces")],
      tokenUsage,
      partialText: "",
      latency,
      llmCalls: [call(1), call(2)],
    });
    const out = abortTelemetry(err, {
      toolsUsed: ["Xyne_Spaces__spaces-calls"],
      invocations: [inv("Xyne_Spaces__spaces-calls", { subagentName: "spaces" })],
      llmCalls: [call(1, "spaces")],
    });
    expect(out.latency).toEqual(latency);
    expect(out.llmCalls).toEqual([call(1), call(2), call(1, "spaces")]);
    expect(out.toolsUsed).toEqual(["spaces", "Xyne_Spaces__spaces-calls"]);
    expect(out.toolInvocations?.map((i) => i.toolName)).toEqual(["spaces", "Xyne_Spaces__spaces-calls"]);
    expect(out.tokenUsage).toEqual(tokenUsage);
  });

  it("does the same for a provider stall", () => {
    const err = new ProviderStallError("codex", 120_000, {
      toolsUsed: [],
      toolInvocations: [],
      tokenUsage,
      partialText: "",
      latency,
      llmCalls: [call(1)],
    });
    const out = abortTelemetry(err);
    expect(out.latency).toEqual(latency);
    expect(out.llmCalls).toEqual([call(1)]);
    expect(out).not.toHaveProperty("toolsUsed");
    expect(out).not.toHaveProperty("toolInvocations");
  });

  it("omits empty series rather than sending [] and keeps tokenUsage", () => {
    const err = new RunCancelledError("x", { toolsUsed: [], toolInvocations: [], tokenUsage, partialText: "", llmCalls: [] });
    expect(err.llmCalls).toBeUndefined();
    expect(abortTelemetry(err)).toEqual({ tokenUsage });
  });

  it("reports nothing for an error that carries no progress snapshot", () => {
    expect(abortTelemetry(new Error("boom"), { llmCalls: [call(1, "spaces")] })).toEqual({});
  });
});
