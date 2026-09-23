import { describe, expect, it } from "vitest";
import {
  DEBUG_TRACE_MAX_BYTES,
  renderDebugTraceHtml,
  renderDebugTraceBundleHtml,
  type DebugTraceBundleEntry,
  type DebugTraceRun,
} from "./debug-trace-html.js";

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

describe("renderDebugTraceBundleHtml", () => {
  function entry(sessionId: string, minutesAgo: number, status: string): DebugTraceBundleEntry {
    return {
      run: { ...fixture(), sessionId },
      sessionId,
      status,
      checkpointMs: Date.parse(START) - minutesAgo * 60_000,
    };
  }

  it("renders one expandable section per session, newest expanded", () => {
    const html = renderDebugTraceBundleHtml([
      entry("sess-newest", 0, "completed"),
      entry("sess-older", 10, "failed"),
    ]);
    const sections = html.match(/<details class="sess"/g) ?? [];
    expect(sections).toHaveLength(2);
    // Only the first section is open; the rest collapse.
    expect(html.match(/<details class="sess" open>/g) ?? []).toHaveLength(1);
    expect(html.indexOf('<details class="sess" open>')).toBeLessThan(html.indexOf('<details class="sess">'));
  });

  it("labels each section with session id and status", () => {
    const html = renderDebugTraceBundleHtml([entry("sess-abc12345", 0, "completed"), entry("sess-def67890", 5, "failed")]);
    expect(html).toContain("sess-abc");
    expect(html).toContain("completed");
    expect(html).toContain("failed");
    expect(html).toContain("#1");
    expect(html).toContain("#2");
  });

  it("still scrubs secrets and omits tool results/final answers in every section", () => {
    const html = renderDebugTraceBundleHtml([entry("s1", 0, "completed"), entry("s2", 1, "completed")]);
    expect(html).not.toContain("TOOLRESULTBODY");
    expect(html).not.toContain("FINALANSWERBODY");
    expect(html).not.toContain("SUPERSECRETPROMPTBODY");
    expect(html).not.toContain("abc123secret");
  });

  it("degrades later sections to a summary line once the page size cap is reached", () => {
    // Each session is heavy enough that a handful blow past the page cap.
    const heavy = (sessionId: string, minutesAgo: number): DebugTraceBundleEntry => ({
      run: {
        startedAt: START,
        agentSlug: "doctor",
        events: Array.from({ length: 8_000 }, (_, i) => ({
          seq: i + 1,
          at: at(i),
          kind: "tool_execution_start",
          toolCallId: `${sessionId}-call-${i}`,
          data: { toolName: `tool-${i}`, args: { q: "x".repeat(30) } },
        })),
      },
      sessionId,
      status: "completed",
      checkpointMs: Date.parse(START) - minutesAgo * 60_000,
    });
    const many = Array.from({ length: 6 }, (_, i) => heavy(`sess-${i}`, i));
    const html = renderDebugTraceBundleHtml(many);
    expect(html).toContain("page size cap reached");
    // Every session is still LISTED even when its timeline is not rendered.
    expect((html.match(/<details class="sess"/g) ?? []).length).toBe(6);
  });

  it("emits a valid standalone document for a single entry", () => {
    const html = renderDebugTraceBundleHtml([entry("only", 0, "running")]);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html.trimEnd().endsWith("</html>")).toBe(true);
    expect(html).toContain("1 session in this thread");
  });
});

describe("waterfall", () => {
  const T0 = "2026-09-20T13:00:00.000Z";
  const at = (secs: number): string => new Date(Date.parse(T0) + secs * 1000).toISOString();

  const run = {
    agentSlug: "xyne",
    provider: "litellm",
    model: "private-large-spaces",
    startedAt: T0,
    finishedAt: at(100),
    // An LLM turn carries no duration of its own — it is measured from its
    // paired session_prompt, keyed by llmCall, exactly as production emits it.
    events: [
      { kind: "session_prompt", at: at(0), llmCall: 1 },
      { kind: "assistant_turn_end", at: at(10), turn: 1, llmCall: 1, data: { ttftMs: 2_000 } },
      { kind: "tool_execution_start", at: at(10), toolCallId: "c1" },
      { kind: "tool_execution_end", at: at(70), toolCallId: "c1", data: { toolName: "spaces", durationMs: 60_000 } },
      { kind: "session_prompt", at: at(70), llmCall: 2 },
      { kind: "assistant_turn_end", at: at(80), turn: 2, llmCall: 2, data: { ttftMs: 1_000 } },
      { kind: "tool_execution_start", at: at(80), toolCallId: "c2" },
      { kind: "tool_execution_end", at: at(82), toolCallId: "c2", data: { toolName: "todo-write", durationMs: 2_000, isError: true } },
    ],
  } as unknown as Parameters<typeof renderDebugTraceHtml>[0];

  it("measures a turn from its prompt, not from a field the event does not carry", () => {
    const html = renderDebugTraceHtml(run);
    expect(html).toContain("Where the time went");
    expect(html).toContain("model 20.0 s");
    expect(html).toContain("tools 1m 02s");
    expect(html).toContain("unaccounted 18.0 s");
  });

  it("positions each span by its start offset, not its order", () => {
    const html = renderDebugTraceHtml(run);
    // The 60s tool starts at 10s of a 100s run.
    expect(html).toMatch(/wf-bar wf-tool[^"]*" style="left:10\.00%;width:60\.00%/);
  });

  it("marks a failed tool call and shows ttft inside the model bar", () => {
    const html = renderDebugTraceHtml(run);
    expect(html).toContain("wf-bad");
    expect(html).toContain("wf-wait");
    expect(html).toContain("ttft 2.0 s");
  });
});

describe("judge visibility", () => {
  const base = Date.parse("2026-09-21T10:00:00.000Z");
  const at = (ms: number): string => new Date(base + ms).toISOString();

  function judgedRun(): DebugTraceRun {
    return {
      agentSlug: "xyne",
      startedAt: at(0),
      finishedAt: at(20_000),
      judge: {
        backend: "jev",
        calls: 3,
        failed: 1,
        questions: 280,
        totalMs: 2600,
        byPurpose: { "tool-search": { calls: 2, failed: 1, totalMs: 1700 }, "answer-completeness": { calls: 1, failed: 0, totalMs: 900 } },
        shadows: [],
      },
      answerAssessment: { verdict: "partial", answered: 0.41, finished: 0.2, intent: 0.1 },
      events: [
        { kind: "judge_call", at: at(1850), data: { backend: "jev", purpose: "tool-search", questions: 140, ms: 850, ok: true } },
        { kind: "judge_call", at: at(1900), data: { backend: "jev", purpose: "tool-search", questions: 140, ms: 900, ok: false } },
        {
          kind: "judge_outcome",
          at: at(1910),
          data: {
            backend: "jev",
            purpose: "tool-search",
            summary: "scored 140 of 273 tools · keyword hits 2 · added 1 at ≥0.4",
            detail: JSON.stringify({ query: "first response time", added: [{ name: "spaces-desk-metrics", score: 0.91 }] }),
          },
        },
        { kind: "auto_continue", at: at(15_000), data: { attempt: 1, maxAttempts: 1, verdict: "partial", answered: 0.41, finished: 0.2, intent: 0.1 } },
      ],
    } as unknown as DebugTraceRun;
  }

  it("summarises the judge and the answer check in the run header", () => {
    const html = renderDebugTraceHtml(judgedRun());
    expect(html).toContain("<th>Judge</th>");
    expect(html).toContain("3 calls");
    expect(html).toContain("1 failed");
    expect(html).toContain("tool-search ×2");
    expect(html).toContain("<th>Answer check</th>");
    expect(html).toContain("verdict partial");
    expect(html).toContain("auto-continued 1×");
  });

  it("shows each judge call, what it decided, and any auto-continue in the timeline", () => {
    const html = renderDebugTraceHtml(judgedRun());
    expect(html).toContain("Judge call");
    expect(html).toContain("FAILED — caller fell back");
    expect(html).toContain("Judge decided");
    expect(html).toContain("added 1 at ≥0.4");
    expect(html).toContain("spaces-desk-metrics");
    expect(html).toContain("Auto-continue 1/1");
    expect(html).toContain("costs one extra model turn");
  });

  it("draws judge time as its own bars in the waterfall", () => {
    const html = renderDebugTraceHtml(judgedRun());
    expect(html).toContain("wf-bar wf-judge");
    expect(html).toContain("jev · tool-search");
    expect(html).toMatch(/judge [\d.]+ ?m?s <em>\(2 calls\)<\/em>/);
  });

  it("renders nothing judge-related for a run that never called one", () => {
    const html = renderDebugTraceHtml({ agentSlug: "xyne", startedAt: at(0), events: [] } as unknown as DebugTraceRun);
    expect(html).not.toContain("<th>Judge</th>");
    expect(html).not.toContain("<th>Answer check</th>");
  });
});
