import { describe, expect, it } from "vitest";
import { DEBUG_TRACE_MAX_BYTES, renderDebugTraceHtml, type DebugTraceRun } from "./debug-trace-html.js";

const START = "2026-09-01T12:00:00.000Z";

function at(secondsIn: number): string {
  return new Date(Date.parse(START) + secondsIn * 1000).toISOString();
}

function fixture(): DebugTraceRun {
  return {
    schemaVersion: 1,
    conversationId: "conv-1",
    sessionId: "sess-abcdef123456",
    agentSlug: "doctor",
    provider: "claude",
    model: "claude-opus-5",
    thinking: "high",
    startedAt: START,
    finishedAt: at(120),
    task: "look at <script>alert(1)</script> & fix it",
    tokenUsage: { input: 1200, output: 400, cacheRead: 50, cacheWrite: 10 },
    latency: { totalMs: 120_000, llmTurns: 2, llmTotalMs: 40_000, llmWaitMs: 15_000, llmDecodeMs: 25_000, toolMs: 60_000, llmRetries: 1 },
    events: [
      { seq: 1, at: at(0), kind: "session_start", data: { provider: "claude", model: "claude-opus-5", thinking: "high", mode: "auto", task: "look at <script>alert(1)</script> & fix it" } },
      { seq: 2, at: at(1), kind: "session_tools", data: { toolCount: 2, tools: ["spaces", "code"] } },
      { seq: 3, at: at(2), kind: "mode_switch", data: { from: "plan", to: "auto", reason: "plan_approved" } },
      { seq: 4, at: at(3), kind: "session_prompt", llmCall: 1, data: { kind: "fresh", messageCount: 3, prompt: "SUPERSECRETPROMPTBODY" } },
      { seq: 5, at: at(6), kind: "thinking", turn: 1, llmCall: 1, data: { text: `${"z".repeat(2000)}`, chars: 2000 } },
      { seq: 6, at: at(7), kind: "assistant_turn_end", turn: 1, llmCall: 1, data: { stopReason: "tool_use", usage: { input: 900, output: 100 }, assistantText: "FINALANSWERBODY", ttftMs: 850 } },
      {
        seq: 7,
        at: at(8),
        kind: "tool_execution_start",
        toolCallId: "call-1",
        data: { toolName: "spaces", args: { question: "where is the LEAKYARGVALUE", authorization: "Bearer abc123secret", limit: 5, nested: { a: 1 } } },
      },
      {
        seq: 8,
        at: at(20),
        kind: "tool_execution_end",
        toolCallId: "call-1",
        data: { toolName: "spaces", durationMs: 12_000, isError: false, result: "TOOLRESULTBODY should never appear", args: { question: "where is the LEAKYARGVALUE" } },
      },
      { seq: 9, at: at(21), kind: "tool_execution_start", toolCallId: "call-2", data: { toolName: "code", args: { path: "/tmp/x" } } },
      { seq: 10, at: at(30), kind: "tool_execution_end", toolCallId: "call-2", data: { toolName: "code", durationMs: 9000, isError: true, result: "boom" } },
      { seq: 11, at: at(31), kind: "compaction_start", data: { reason: "context_limit", tokensBefore: 180_000 } },
      { seq: 12, at: at(40), kind: "compaction_end", data: { reason: "context_limit", tokensBefore: 180_000, summary: "COMPACTIONSUMMARYBODY" } },
      { seq: 13, at: at(41), kind: "auto_retry_start", data: { attempt: 1, maxAttempts: 3, errorMessage: "overloaded, falling back" } },
      { seq: 14, at: at(42), kind: "background_subagents_delivered", data: { round: 1, count: 2, tasks: ["a", "b"] } },
      { seq: 15, at: at(43), kind: "citation_reflection", data: { phase: "result", round: 1 } },
      { seq: 16, at: at(120), kind: "session_end", data: { textLength: 900, toolCount: 2, latency: { totalMs: 120_000, llmTurns: 2 } } },
    ],
  };
}

describe("renderDebugTraceHtml", () => {
  it("renders header, summary table and timeline", () => {
    const html = renderDebugTraceHtml(fixture());
    expect(html).toContain("Execution trace");
    expect(html).toContain("doctor");
    expect(html).toContain("sess-abcdef123456");
    expect(html).toContain("claude-opus-5");
    expect(html).toContain("Session start");
    expect(html).toContain("Tool palette");
    expect(html).toContain("Compaction started");
    expect(html).toContain("Provider retry / fallback");
    expect(html).toContain("Background subagents delivered");
    expect(html).toContain("Session end");
    expect(html).toContain("00:08");
  });

  it("escapes user-controlled text", () => {
    const html = renderDebugTraceHtml(fixture());
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("never includes tool results or the final answer body", () => {
    const html = renderDebugTraceHtml(fixture());
    expect(html).not.toContain("TOOLRESULTBODY");
    expect(html).not.toContain("FINALANSWERBODY");
    expect(html).not.toContain("COMPACTIONSUMMARYBODY");
    expect(html).not.toContain("SUPERSECRETPROMPTBODY");
  });

  it("reduces tool args to a short summary and scrubs secrets", () => {
    const html = renderDebugTraceHtml(fixture());
    expect(html).toContain("args question=where is the LEAKYARGVALUE");
    expect(html).not.toContain("Bearer abc123secret");
    expect(html).not.toContain("abc123secret");
  });

  it("scrubs bearer tokens and api keys anywhere they are rendered", () => {
    const html = renderDebugTraceHtml({
      startedAt: START,
      events: [
        { seq: 1, at: at(0), kind: "auto_retry_start", data: { attempt: 1, maxAttempts: 2, errorMessage: "auth failed for Bearer eyJleaked and sk-abcdefgh12345" } },
      ],
    });
    expect(html).not.toContain("eyJleaked");
    expect(html).not.toContain("sk-abcdefgh12345");
    expect(html).toContain("[redacted]");
  });

  it("truncates thinking blocks and keeps them collapsed", () => {
    const html = renderDebugTraceHtml(fixture());
    expect(html).toContain("<details><summary>show reasoning</summary>");
    expect(html).toContain("…[truncated]");
    expect(html).not.toContain("z".repeat(700));
  });

  it("summarises tool calls by name with counts and errors", () => {
    const html = renderDebugTraceHtml(fixture());
    const table = html.slice(html.indexOf("Tool calls by name"), html.indexOf("Timeline"));
    expect(table).toContain("<td>spaces</td><td>1</td>");
    expect(table).toContain("<td>code</td><td>1</td>");
    expect(table).toContain(`<span class="err-count">1</span>`);
  });

  it("marks failed tool calls with ✕ and successful ones with ✓", () => {
    const html = renderDebugTraceHtml(fixture());
    expect(html).toContain("✓ spaces");
    expect(html).toContain("✕ code");
  });

  it("adds a truncation notice past the size cap", () => {
    const many: DebugTraceRun = {
      startedAt: START,
      events: Array.from({ length: 40_000 }, (_, i) => ({
        seq: i + 1,
        at: at(i),
        kind: "tool_execution_start",
        toolCallId: `call-${i}`,
        data: { toolName: `tool-${i}`, args: { q: "x".repeat(30) } },
      })),
    };
    const html = renderDebugTraceHtml(many);
    expect(html).toContain("Timeline truncated");
    expect(html.length).toBeLessThan(DEBUG_TRACE_MAX_BYTES + 200_000);
  });

  it("handles an empty run without throwing", () => {
    const html = renderDebugTraceHtml({});
    expect(html).toContain("No tool calls recorded.");
  });
});
