import { describe, expect, it } from "vitest";
import { answeredByFromRun, buildAnsweredBy, modelFallbackFromCallback } from "./run-answered-by.js";

describe("modelFallbackFromCallback", () => {
  it("is undefined for an older claw pod that does not report fellBack", () => {
    expect(modelFallbackFromCallback({ provider: "spaces", model: "private-large" })).toBeUndefined();
  });

  it("reads fallback provenance", () => {
    expect(
      modelFallbackFromCallback({ fellBack: true, requestedProvider: "codex", requestedModel: "gpt-5.5" }),
    ).toEqual({ fellBack: true, requestedProvider: "codex", requestedModel: "gpt-5.5" });
  });
});

describe("buildAnsweredBy", () => {
  it("needs a provider", () => {
    expect(buildAnsweredBy(undefined, "x", undefined)).toBeUndefined();
  });

  it("drops requested* when the run did not fall back", () => {
    expect(
      buildAnsweredBy("codex", "gpt-5.5", { fellBack: false, requestedProvider: "codex", requestedModel: "gpt-5.5" }),
    ).toEqual({ provider: "codex", model: "gpt-5.5", fellBack: false });
  });

  it("keeps requested* on a fallback", () => {
    expect(
      buildAnsweredBy("spaces", "private-large", { fellBack: true, requestedProvider: "codex", requestedModel: "gpt-5.5" }),
    ).toEqual({ provider: "spaces", model: "private-large", fellBack: true, requestedProvider: "codex", requestedModel: "gpt-5.5" });
  });
});

describe("answeredByFromRun", () => {
  it("reads columns + metadata.modelFallback, ignoring other metadata keys", () => {
    expect(
      answeredByFromRun({
        provider: "spaces",
        model: "private-large",
        metadata: { externalCallback: { url: "x" }, modelFallback: { fellBack: true, requestedProvider: "claude" } },
      }),
    ).toEqual({ provider: "spaces", model: "private-large", fellBack: true, requestedProvider: "claude" });
  });

  it("legacy rows without metadata report provider/model only", () => {
    expect(answeredByFromRun({ provider: "codex", model: null, metadata: null })).toEqual({ provider: "codex" });
  });

  it("no provider → undefined", () => {
    expect(answeredByFromRun({ provider: null, model: "x" })).toBeUndefined();
  });
});
