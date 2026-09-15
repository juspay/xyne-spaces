import { describe, expect, it } from "vitest";
import { validateAgentModelConfig } from "./agent-config-validation.js";

describe("validateAgentModelConfig — modelSettings.speed", () => {
  it("accepts fast / standard", () => {
    expect(validateAgentModelConfig({ modelSettings: { speed: "fast" } })).toEqual({ ok: true });
    expect(validateAgentModelConfig({ modelSettings: { speed: "standard" } })).toEqual({ ok: true });
  });

  it("rejects anything else", () => {
    expect(validateAgentModelConfig({ modelSettings: { speed: "turbo" } }).error).toMatch(/modelSettings\.speed must be one of: standard, fast/);
    expect(validateAgentModelConfig({ modelSettings: { speed: true } }).ok).toBe(false);
  });

  it("still rejects unknown modelSettings keys", () => {
    expect(validateAgentModelConfig({ modelSettings: { fastMode: true } }).error).toMatch(/not a recognized setting/);
  });
});

describe("validateAgentModelConfig — fastModeProfile", () => {
  it("accepts inherit and a custom profile", () => {
    expect(validateAgentModelConfig({ fastModeProfile: { providers: "inherit" } })).toEqual({ ok: true });
    expect(validateAgentModelConfig({ fastModeProfile: { providers: "custom", providerOrder: ["claude", "spaces"], models: { claude: "claude-opus-5" } } })).toEqual({ ok: true });
  });
  it("rejects bad shapes", () => {
    expect(validateAgentModelConfig({ fastModeProfile: { providers: "turbo" } }).ok).toBe(false);
    expect(validateAgentModelConfig({ fastModeProfile: { providers: "custom", providerOrder: ["gemini"] } }).ok).toBe(false);
    expect(validateAgentModelConfig({ fastModeProfile: { models: { claude: "" } } }).ok).toBe(false);
    expect(validateAgentModelConfig({ fastModeProfile: { extra: 1 } }).ok).toBe(false);
  });
});

describe("validateAgentModelConfig — fastModeProfile.modelSettings", () => {
  it("accepts run-setting overrides", () => {
    expect(validateAgentModelConfig({ fastModeProfile: { modelSettings: { thinkingLevel: "high", model: "glm-latest", maxTokens: 32000 } } })).toEqual({ ok: true });
  });
  it("rejects bad fields and a nested speed", () => {
    expect(validateAgentModelConfig({ fastModeProfile: { modelSettings: { thinkingLevel: "ultra" } } }).ok).toBe(false);
    expect(validateAgentModelConfig({ fastModeProfile: { modelSettings: { speed: "fast" } } }).error).toMatch(/speed is not allowed/);
    expect(validateAgentModelConfig({ fastModeProfile: { modelSettings: { temperature: 2 } } }).ok).toBe(false);
  });
});
