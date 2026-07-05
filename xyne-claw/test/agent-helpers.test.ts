import { test, expect } from "vitest";
import { contextWindowFor, capCustomToolOutput, isQuotaExhaustedError } from "../src/agent.js";

test("isQuotaExhaustedError catches copilot/openrouter quota 429 variants", () => {
  // The copilot-proxy now emits this canonical body on a 429.
  expect(isQuotaExhaustedError(new Error("GitHub Copilot quota exceeded — HTTP 429 quota_exceeded / rate_limit_exceeded"))).toBe(true);
  // Bare upstream variants that previously fell through unclassified.
  expect(isQuotaExhaustedError(new Error("quota exceeded"))).toBe(true);
  expect(isQuotaExhaustedError(new Error("quota exhausted"))).toBe(true);
  expect(isQuotaExhaustedError(new Error("rate_limit_error"))).toBe(true);
  // Plain 429 anywhere in the message.
  expect(isQuotaExhaustedError(new Error("AI_APICallError: status 429"))).toBe(true);
  // Non-quota errors stay false.
  expect(isQuotaExhaustedError(new Error("ECONNRESET socket hang up"))).toBe(false);
  expect(isQuotaExhaustedError(new Error("400 invalid request"))).toBe(false);
});

test("contextWindowFor returns real per-model windows from pi's registry", () => {
  expect(contextWindowFor("gpt-4o")).toBe(128_000);
  expect(contextWindowFor("claude-sonnet-4-5")).toBe(200_000);
});

test("contextWindowFor falls back to a conservative default for unknown models", () => {
  // Unknown/custom model → conservative default (never higher than real window).
  expect(contextWindowFor("some-unknown-model-xyz")).toBe(128_000);
  expect(contextWindowFor(undefined)).toBe(128_000);
});

test("capCustomToolOutput sanitizes + caps text content, leaves images untouched", async () => {
  const NUL = String.fromCharCode(0);
  const fakeTool = {
    name: "sandbox-grep",
    execute: async () => ({
      content: [
        { type: "text", text: `hi${NUL}there` },
        { type: "image", data: "base64==", mimeType: "image/png" },
      ],
    }),
  };
  // workspaceDir unused for small output (no spill); just verify sanitize + passthrough.
  const [wrapped] = capCustomToolOutput([fakeTool as never], "/tmp");
  const out = (await (wrapped as { execute: (...a: unknown[]) => Promise<{ content: Array<Record<string, unknown>> }> })
    .execute("id", {}, undefined, undefined, {} as never));
  // NUL stripped from text block.
  expect(out.content[0]!["text"]).toBe("hithere");
  // Image block passed through unchanged.
  expect(out.content[1]!["type"]).toBe("image");
  expect(out.content[1]!["data"]).toBe("base64==");
});
