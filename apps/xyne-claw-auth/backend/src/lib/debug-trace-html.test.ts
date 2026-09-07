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

  it("renders llm_request with its params, effective system prompt, tools and skills", () => {
    const html = renderDebugTraceHtml({
      startedAt: START,
      events: [
        {
          seq: 1,
          at: at(1),
          kind: "llm_request",
          llmCall: 2,
          data: {
            provider: "claude",
            model: "claude-opus-5",
            temperature: 0.2,
            maxTokens: 8000,
            thinkingLevel: "high",
            fastMode: true,
            toolCount: 1,
            systemPrompt: "You are Doctor. <available_skills>pdf-tools</available_skills>",
            tools: [{ name: "spaces", description: "search spaces", parameters: { type: "object", properties: { question: { type: "string" } } } }],
            toolNames: ["spaces"],
            availableSkills: [{ name: "pdf-tools", description: "read pdfs" }],
            paletteAdded: ["spaces"],
            paletteRemoved: [],
          },
        },
      ],
    });
    expect(html).toContain("LLM request #2 — claude/claude-opus-5");
    expect(html).toContain("thinking high");
    expect(html).toContain("maxTokens 8000");
    expect(html).toContain("fast mode");
    expect(html).toContain("palette +1/−0");
    expect(html).toContain("system prompt (62 chars)");
    expect(html).toContain("You are Doctor.");
    expect(html).toContain("tools (1)");
    expect(html).toContain("properties");
    expect(html).toContain("skills — pdf-tools");
  });

  it("renders folded request fields on the session_prompt row", () => {
    const html = renderDebugTraceHtml({
      startedAt: START,
      events: [
        {
          seq: 1,
          at: at(1),
          kind: "session_prompt",
          llmCall: 1,
          data: { kind: "fresh", messageCount: 2, toolCount: 3, thinkingLevel: "low", systemPrompt: "FOLDEDSYSTEMPROMPT" },
        },
      ],
    });
    expect(html).toContain("LLM call #1 sent");
    expect(html).toContain("3 tools");
    expect(html).toContain("FOLDEDSYSTEMPROMPT");
  });

  it("renders blob refs as preview plus a size note, never [object Object]", () => {
    const html = renderDebugTraceHtml({
      startedAt: START,
      events: [
        {
          seq: 1,
          at: at(1),
          kind: "llm_request",
          llmCall: 1,
          data: {
            toolCount: 2,
            systemPrompt: { hash: "deadbeef", bytes: 200, originalBytes: 20481, truncated: true, preview: "PREVIEWOFPROMPT" },
            toolsRef: { hash: "cafebabe", bytes: 4096, preview: "[{\"name\":\"spaces\"}]" },
          },
        },
      ],
    });
    expect(html).not.toContain("[object Object]");
    expect(html).toContain("PREVIEWOFPROMPT");
    expect(html).toContain("truncated — 20481 bytes");
    expect(html).toContain("truncated — 4096 bytes");
  });

  it("renders llm_response stop reason, cache usage and ttft", () => {
    const html = renderDebugTraceHtml({
      startedAt: START,
      events: [
        {
          seq: 1,
          at: at(2),
          kind: "llm_response",
          llmCall: 1,
          data: {
            stopReason: "end_turn",
            ttftMs: 640,
            totalMs: 9000,
            usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 900, cache_creation_input_tokens: 50 },
          },
        },
      ],
    });
    expect(html).toContain("LLM response #1 — stop end_turn");
    expect(html).toContain("ttft 640 ms");
    expect(html).toContain("in 100");
    expect(html).toContain("cacheR 900");
    expect(html).toContain("cacheW 50");
  });

  it("renders the compact rows for palette, skill, subagent, fallback and delegation events", () => {
    const html = renderDebugTraceHtml({
      startedAt: START,
      events: [
        { seq: 1, at: at(1), kind: "tool_palette_change", data: { source: "load-tools", added: ["pdf"], removed: ["code"], activeCount: 7 } },
        { seq: 2, at: at(2), kind: "skill_loaded", data: { slug: "pdf-tools", path: "/skills/pdf-tools/SKILL.md" } },
        { seq: 3, at: at(3), kind: "subagent_start", data: { subagentName: "researcher", provider: "claude", model: "claude-opus-5", questionChars: 120, childRunId: "run-9" } },
        { seq: 4, at: at(4), kind: "subagent_end", data: { subagentName: "researcher", status: "completed", durationMs: 4000, textLength: 900, toolsUsed: ["spaces"] } },
        { seq: 5, at: at(5), kind: "provider_fallback", data: { fromProvider: "claude", toProvider: "bedrock", attempt: 2, reason: "overloaded" } },
        { seq: 6, at: at(6), kind: "delegation", data: { kind: "subagent", caller: "doctor", callee: "researcher", depth: 1, reason: "deep_research" } },
        { seq: 7, at: at(7), kind: "message_append", data: { from: 0, to: 2, count: 2, messages: ["APPENDEDMESSAGEBODY"] } },
      ],
    });
    expect(html).toContain("Tool palette load-tools — +1 / −1");
    expect(html).toContain("added pdf");
    expect(html).toContain("Skill loaded — pdf-tools");
    expect(html).toContain("Subagent start — researcher");
    expect(html).toContain("Subagent end — researcher (completed)");
    expect(html).toContain("Provider fallback claude → bedrock");
    expect(html).toContain("Delegation subagent — doctor → researcher");
    expect(html).not.toContain("message_append");
    expect(html).not.toContain("APPENDEDMESSAGEBODY");
  });
});
