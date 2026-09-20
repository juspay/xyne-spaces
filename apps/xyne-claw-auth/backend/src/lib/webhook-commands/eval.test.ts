import { describe, expect, it, vi } from "vitest";
import { parseSlashCommand } from "../parseSlashCommand.js";
import { renderEvalHtml } from "./eval.js";
import type { EvalResult } from "../eval-run.js";

function result(provider: string, over: Partial<EvalResult> = {}): EvalResult {
  return {
    provider,
    useOverride: true,
    model: `${provider}-model`,
    sessionId: `s-${provider}`,
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
    expect(html.indexOf('"p">fast')).toBeLessThan(html.indexOf('"p">slow'));
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
