import { describe, expect, it } from "vitest";
import {
  classifyToolOutcome,
  installHonestErrorFlag,
  installToolOutcomeMetric,
  isReportedFailure,
  validationKind,
} from "../src/tool-outcome.js";

const text = (t: string) => ({ content: [{ type: "text", text: t }], details: {} });

describe("classifyToolOutcome", () => {
  it("splits rejected calls from failed tools", () => {
    expect(classifyToolOutcome({ isError: false, result: text("ok") }, false)).toEqual({ outcome: "ok", validationKind: "none" });
    expect(classifyToolOutcome({ isError: true, result: text("Tool web-search not found. Use search-tools") }, false).outcome).toBe("not_found");
    expect(classifyToolOutcome({ isError: true, result: text("Operation aborted") }, false).outcome).toBe("aborted");
    expect(classifyToolOutcome({ isError: true, result: text("anything") }, true).outcome).toBe("blocked");
    expect(classifyToolOutcome({ isError: true, result: text("Error: HTTP 502") }, false).outcome).toBe("error");
  });

  it("names the kind of validation failure", () => {
    expect(classifyToolOutcome({ isError: true, result: text('Validation failed for tool "x":\n  - cmd: must have required property \'cmd\'') }, false)).toEqual({
      outcome: "validation",
      validationKind: "missing",
    });
    expect(validationKind("  - a: must be number")).toBe("type");
    expect(validationKind("  - a: must be equal to one of the allowed values")).toBe("enum");
    expect(validationKind("  - root: must not have additional properties")).toBe("structure");
  });
});

describe("installToolOutcomeMetric", () => {
  it("marks a call blocked by an earlier beforeToolCall hook", async () => {
    const agent = {
      beforeToolCall: async (ctx: { toolCall: { id: string } }) => (ctx.toolCall.id === "b" ? { block: true, reason: "no" } : undefined),
    };
    const record = installToolOutcomeMetric(agent as never, () => ({ model: "m" }));
    await agent.beforeToolCall({ toolCall: { id: "b" } } as never);
    // No throw, and the blocked id is consumed once.
    record({ toolCallId: "b", toolName: "t", isError: true, result: text("Tool execution was blocked") });
    record({ toolCallId: "b", toolName: "t", isError: true, result: text("Tool execution was blocked") });
  });
});

describe("honest error flag", () => {
  it("recognises claw-written failures", () => {
    expect(isReportedFailure(text("Error: Session s1 not found."))).toBe(true);
    expect(isReportedFailure(text("  Error: x"))).toBe(true);
    expect(isReportedFailure({ content: [{ type: "text", text: "spaces subagent failed: boom" }], details: { failed: true } })).toBe(true);
    expect(isReportedFailure(text("All good, no Error: here"))).toBe(false);
  });

  it("flags non-MCP tools only", async () => {
    const agent: { afterToolCall?: (ctx: never) => Promise<{ isError?: boolean } | undefined> } = {};
    installHonestErrorFlag(agent as never, (name) => name.includes("__"));
    const ctx = (name: string, result: unknown, isError = false) => ({ toolCall: { id: "1", name }, result, isError }) as never;
    expect(await agent.afterToolCall!(ctx("sandbox-run", text("Error: Session s1 not found.")))).toEqual({ isError: true });
    expect(await agent.afterToolCall!(ctx("Grafana__query", text("Error: upstream text")))).toBeUndefined();
    expect(await agent.afterToolCall!(ctx("sandbox-run", text("ok")))).toBeUndefined();
  });
});
