import { describe, expect, it } from "vitest";
import { parseSlashCommand } from "../parseSlashCommand.js";
import { renderEvalHtml } from "./eval.js";
import type { EvalResult } from "../eval-run.js";

function result(provider: string, over: Partial<EvalResult> = {}): EvalResult {
  return {
    provider,
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
