import { describe, it, expect } from "vitest";
import { clawMetricsFields } from "./run-metrics-payload.js";

describe("clawMetricsFields", () => {
  it("forwards every metrics field a claw callback carried", () => {
    const fields = clawMetricsFields({
      sessionId: "s-1",
      status: "completed",
      result: "hi",
      toolInvocations: [{ toolName: "search" }],
      tokenUsage: { input: 10, output: 20, cacheRead: 30, cacheWrite: 40 },
      latency: { totalMs: 1200, llmTurns: 3, firstTurnTtftMs: 400 },
      citationReflection: { outcome: "already_cited" },
      llmCalls: [{ callIndex: 1, ttftMs: 400 }],
    });

    expect(fields).toEqual({
      toolInvocations: [{ toolName: "search" }],
      tokenUsage: { input: 10, output: 20, cacheRead: 30, cacheWrite: 40 },
      latency: { totalMs: 1200, llmTurns: 3, firstTurnTtftMs: 400 },
      citationReflection: { outcome: "already_cited" },
      llmCalls: [{ callIndex: 1, ttftMs: 400 }],
    });
  });

  // finalize() writes a column only when its key is PRESENT, so an absent field
  // has to stay absent rather than become an explicit undefined — otherwise a
  // callback carrying no latency would blank what another path already wrote.
  it("omits keys the callback did not carry", () => {
    expect(clawMetricsFields({ sessionId: "s-1", status: "completed" })).toEqual({});
  });

  it("omits an empty token or latency block rather than writing zeroes", () => {
    expect(clawMetricsFields({ tokenUsage: undefined, latency: undefined })).toEqual({});
  });

  // The regression this helper exists to prevent: llmCalls reached exactly one
  // branch of one handler, so streamed / scheduled / error-pipeline runs stored
  // NULL llmTurnStats and never appeared in the per-call latency charts.
  it("carries llmCalls, the field that used to be dropped", () => {
    const series = [{ callIndex: 1, ttftMs: 400, contextTokens: 9000 }];
    expect(clawMetricsFields({ llmCalls: series }).llmCalls).toBe(series);
  });

  it("accepts the loose request-body shape the route handlers cast to", () => {
    const body: Record<string, unknown> = { latency: { totalMs: 900 } };
    expect(clawMetricsFields(body)).toEqual({ latency: { totalMs: 900 } });
  });
});
