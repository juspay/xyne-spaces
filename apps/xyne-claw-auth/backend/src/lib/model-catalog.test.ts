import { describe, expect, it } from "vitest";
import { labelModel, modelDescription, modelDisplayName } from "./model-catalog.js";

describe("modelDisplayName", () => {
  it("names models the way people say them", () => {
    expect(modelDisplayName("claude-sonnet-4-5-20250929")).toBe("Sonnet 4.5");
    expect(modelDisplayName("anthropic/claude-opus-4-1")).toBe("Opus 4.1");
    expect(modelDisplayName("claude-3-5-haiku-20241022")).toBe("Haiku 3.5");
    expect(modelDisplayName("hosted_vllm/gpt-4o-mini")).toBe("GPT-4o mini");
    expect(modelDisplayName("open-fast")).toBe("Open Fast");
  });
});

describe("modelDescription", () => {
  it("describes a model only when its family says something true", () => {
    expect(modelDescription("claude-haiku-4-5")).toBe("Fastest for quick answers");
    expect(modelDescription("claude-opus-4-1")).toBe("For complex tasks");
    expect(modelDescription("local-harness:claude-code")).toBe("Runs on your computer");
    expect(modelDescription("qwen3-32b")).toBeUndefined();
  });
});

describe("labelModel", () => {
  it("replaces a raw-id name and keeps a label the entry already has", () => {
    expect(labelModel({ id: "claude-sonnet-4-5", name: "claude-sonnet-4-5" })).toEqual({
      id: "claude-sonnet-4-5",
      name: "Sonnet 4.5",
      description: "Most efficient for everyday tasks",
    });
    expect(labelModel({ id: "local-harness:codex", name: "Codex (MacBook)", provider: "local-harness" })).toMatchObject({
      name: "Codex (MacBook)",
      description: "Runs on your computer",
    });
    expect(labelModel({ id: "qwen3-32b", name: "qwen3-32b" })).toEqual({ id: "qwen3-32b", name: "Qwen3 32b" });
  });
});
