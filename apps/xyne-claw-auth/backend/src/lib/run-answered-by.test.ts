import { describe, expect, it } from "vitest";
import { answeredByFrom, modelFallbackFromRunMetadata, parseModelFallback } from "./run-answered-by.js";

describe("parseModelFallback", () => {
  it("accepts claw's descriptor", () => {
    expect(parseModelFallback({ fromProvider: "codex", fromModel: "gpt-5.5", reason: "auth" })).toEqual({
      fromProvider: "codex",
      fromModel: "gpt-5.5",
      reason: "auth",
    });
  });
  it("rejects missing provider and non-objects", () => {
    expect(parseModelFallback({ fromModel: "x" })).toBeUndefined();
    expect(parseModelFallback("codex")).toBeUndefined();
    expect(parseModelFallback(null)).toBeUndefined();
    expect(parseModelFallback([])).toBeUndefined();
  });
  it("normalises an unknown reason and drops oversized fields", () => {
    expect(parseModelFallback({ fromProvider: "claude", fromModel: "m".repeat(500), reason: "boom" })).toEqual({
      fromProvider: "claude",
      reason: "unknown",
    });
  });
});

describe("answeredByFrom", () => {
  it("needs a provider", () => {
    expect(answeredByFrom(undefined, "private-large", undefined)).toBeUndefined();
  });
  it("carries model and fallback", () => {
    expect(answeredByFrom("spaces", "private-large", { fromProvider: "codex", reason: "quota" })).toEqual({
      provider: "spaces",
      model: "private-large",
      fallbackFrom: { fromProvider: "codex", reason: "quota" },
    });
  });
});

describe("modelFallbackFromRunMetadata", () => {
  it("reads only modelFallback, never other metadata keys", () => {
    const meta = {
      externalResultCallback: { url: "https://x", encryptedSecret: "s" },
      modelFallback: { fromProvider: "codex", reason: "transient" },
    };
    expect(modelFallbackFromRunMetadata(meta)).toEqual({ fromProvider: "codex", reason: "transient" });
    expect(modelFallbackFromRunMetadata({ externalResultCallback: {} })).toBeUndefined();
    expect(modelFallbackFromRunMetadata(null)).toBeUndefined();
  });
});
