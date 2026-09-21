import { describe, expect, it, vi } from "vitest";
import { parseSlashCommand } from "../parseSlashCommand.js";
import { renderEvalHtml } from "./eval.js";
import type { EvalResult } from "../eval-run.js";
import { traceTiming, type DebugTraceRun } from "../debug-trace-html.js";
import type { EvalTrace } from "./eval.js";

function result(provider: string, over: Partial<EvalResult> = {}): EvalResult {
  return {
    provider,
    useOverride: true,
    model: `${provider}-model`,
    sessionId: `s-${provider}`,
    sessionKey: `conv-eval-t1-${provider}`,
    traceId: `t1-${provider}`,
    answer: `${provider} says hello`,
    status: "completed",
    totalMs: 1000,
    llmTotalMs: 800,
    toolMs: 200,
    ttftMs: 100,
    tokensIn: 10,
    tokensOut: 20,
    tokensCacheRead: 0,
    tokensPerSec: 5,
    error: null,
    ...over,
  };
}

describe("/eval parsing", () => {
  it("takes the question after the command", () => {
    expect(parseSlashCommand("/eval how many tickets are open?")).toEqual({
      kind: "eval",
      question: "how many tickets are open?",
      providers: [],
    });
  });

  it("extracts a providers filter without leaving it in the question", () => {
    const parsed = parseSlashCommand("/eval providers=claude,codex summarize the channel");
    expect(parsed).toEqual({ kind: "eval", question: "summarize the channel", providers: ["claude", "codex"] });
  });

  it("treats a bare /eval as a usage request", () => {
    expect(parseSlashCommand("/eval")).toEqual({ kind: "eval", question: "", providers: [] });
  });

  it("does not claim commands that merely start with eval", () => {
    expect(parseSlashCommand("/evaluate the thing")).not.toMatchObject({ kind: "eval" });
  });
});

describe("eval comparison report", () => {
  const started = new Date("2026-09-20T10:00:00.000Z");

  it("marks the fastest completed provider and scales bars to the slowest", () => {
    const html = renderEvalHtml("q", [result("fast", { totalMs: 1000 }), result("slow", { totalMs: 4000 })], started);
    expect(html).toContain("fastest");
    expect(html.indexOf('#arm-s-fast"')).toBeLessThan(html.indexOf('#arm-s-slow"'));
    expect(html).toContain("4.0×");
  });

  it("shows unfinished runs instead of dropping them", () => {
    const html = renderEvalHtml("q", [result("ok"), result("stuck", { status: "pending", totalMs: null })], started);
    expect(html).toContain("pending");
    expect(html).toContain("stuck");
  });

  it("escapes the question and error text", () => {
    const html = renderEvalHtml("<script>x</script>", [result("a", { status: "failed", error: "<b>boom</b>" })], started);
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;b&gt;boom");
  });
});

describe("eval provider selection", () => {
  it("runs the agent's own provider as the default arm and adds keyless ones", async () => {
    vi.resetModules();
    vi.doMock("../provider-resolution.js", () => ({
      resolveProvidersForDispatch: async () => ({
        runtimeProviderOrder: ["claude", "codex", "litellm"],
        providerConfigs: { claude: { model: "claude-opus-5" } },
        resolvedParentProvider: "claude",
      }),
    }));
    const { resolveEvalTargets } = await import("../eval-run.js");
    const targets = await resolveEvalTargets({ userId: "u", agent: { slug: "xyne", orgId: "o" } });
    const names = targets.map((t) => t.provider).sort();
    expect(names).toEqual(["claude", "litellm", "spaces"]);
    // Every arm is pinned, the agent's primary included: an unpinned run walks
    // the agent's fallback order and can execute on a different provider than
    // the one the row claims.
    expect(targets.every((t) => t.useOverride)).toBe(true);
    expect(targets.find((t) => t.provider === "claude")?.model).toBe("claude-opus-5");
    vi.doUnmock("../provider-resolution.js");
  });

  it("does not try to override a personal-cred provider the user has not connected", async () => {
    vi.resetModules();
    vi.doMock("../provider-resolution.js", () => ({
      resolveProvidersForDispatch: async () => ({
        runtimeProviderOrder: ["claude", "codex"],
        providerConfigs: {},
        resolvedParentProvider: undefined,
      }),
    }));
    const { resolveEvalTargets } = await import("../eval-run.js");
    const targets = await resolveEvalTargets({ userId: "u", agent: { slug: "xyne", orgId: "o" } });
    expect(targets.map((t) => t.provider).sort()).toEqual(["litellm", "spaces"]);
    expect(targets.some((t) => t.provider === "claude" || t.provider === "codex")).toBe(false);
    vi.doUnmock("../provider-resolution.js");
  });
});

describe("eval reply labelling", () => {
  it("leaves provider and model as placeholders for the delivery path to fill", async () => {
    const { evalReplyPrefix } = await import("../eval-run.js");
    const prefix = evalReplyPrefix({ provider: "codex", model: "gpt-5.6-sol", useOverride: true });
    // Resolved from the run's ACTUAL provider in webhook.ts — a literal here
    // would name the pin even when the run fell back to something else.
    expect(prefix).toContain("{provider}");
    expect(prefix).toContain("{model}");
  });

  it("records which provider the arm was pinned to", async () => {
    const { evalReplyPrefix } = await import("../eval-run.js");
    expect(evalReplyPrefix({ provider: "claude", useOverride: true })).toContain("pinned to claude");
  });
});

describe("eval fallback honesty", () => {
  const started = new Date("2026-09-20T10:00:00.000Z");

  it("labels a run by the provider it actually used and names the pin it ignored", () => {
    const html = renderEvalHtml("q", [
      result("codex", { model: "gpt-5.6-luna", requested: "claude" }),
    ], started);
    expect(html).toContain("codex");
    expect(html).toContain("fell back from claude");
  });

  it("says nothing about fallback when the run honoured its pin", () => {
    const html = renderEvalHtml("q", [result("codex")], started);
    expect(html).not.toContain("fell back");
  });
});

describe("eval full sessions", () => {
  const started = new Date("2026-09-20T10:00:00.000Z");
  const base = Date.parse("2026-09-20T10:00:00.000Z");
  const at = (offsetMs: number): string => new Date(base + offsetMs).toISOString();

  /** Twenty 4s tool calls fired together: 4s of wall clock, 80s if summed. */
  function fanOutTrace(): DebugTraceRun {
    const events: Array<Record<string, unknown>> = [
      { kind: "session_prompt", at: at(0), llmCall: 1 },
      { kind: "assistant_turn_end", at: at(1000), llmCall: 1, turn: 1, data: { ttftMs: 400 } },
    ];
    for (let i = 0; i < 20; i += 1) {
      events.push({ kind: "tool_execution_start", at: at(1000), toolCallId: `t${i}` });
      events.push({
        kind: "tool_execution_end",
        at: at(5000),
        toolCallId: `t${i}`,
        data: { toolName: `tool_${i}`, durationMs: 4000 },
      });
    }
    return { agentSlug: "xyne", startedAt: at(0), events } as unknown as DebugTraceRun;
  }

  function traceMap(sessionId: string): Map<string, EvalTrace> {
    const run = fanOutTrace();
    return new Map([[sessionId, { run, timing: traceTiming(run) }]]);
  }

  it("embeds each provider's answer and full trace, not just a summary row", () => {
    const html = renderEvalHtml(
      "q",
      [result("codex", { answer: "the channel discussed rollout" })],
      started,
      traceMap("s-codex"),
      "xyne",
    );
    expect(html).toContain("Full sessions");
    expect(html).toContain("Provider: codex");
    expect(html).toContain("the channel discussed rollout");
    expect(html).toContain("Where the time went");
    expect(html).toContain("tool_0");
  });

  it("reports tool time as merged wall clock, not the inflated sum", () => {
    const html = renderEvalHtml("q", [result("codex")], started, traceMap("s-codex"), "xyne");
    expect(html).toContain("across 20 calls");
    expect(html).toContain("up to 20 at once");
    // 4.0 s of wall clock, not the 80.0 s the stored sum would claim.
    expect(html).toContain("4.0 s");
    expect(html).not.toMatch(/<td class="n">80\.0 s/);
  });

  it("says so plainly when an arm has no checkpointed trace", () => {
    const html = renderEvalHtml("q", [result("codex")], started, new Map(), "xyne");
    expect(html).toContain("No execution trace was checkpointed");
  });

  it("still renders when nothing but the summary is available", () => {
    const html = renderEvalHtml("q", [result("codex", { answer: null })], started);
    expect(html).toContain("No answer recorded");
  });
});

describe("eval session isolation", () => {
  it("gives each arm a distinct, id-safe session key", async () => {
    const { evalSessionKey } = await import("../eval-run.js");
    const conv = "93798b97-6c4a-4d9c-b471-0062fed175c4_xyne";
    const a = evalSessionKey(conv, "abc123-claude");
    const b = evalSessionKey(conv, "abc123-codex");
    expect(a).not.toBe(b);
    // Shared per-conversation session = shared lock: three of four arms failed
    // with session_locked before each got its own.
    expect(a).not.toBe(conv);
    expect(a).toMatch(/^[A-Za-z0-9._-]+$/);
  });
});
