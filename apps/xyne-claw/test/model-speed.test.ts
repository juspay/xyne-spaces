import { describe, it, expect } from "vitest";
import type { Api, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import {
  FAST_MODE_BETA,
  fastModeBetaHeader,
  fastModeEligibility,
  installFastMode,
  isAdaptiveThinkingClaudeModel,
  isFastModeCapableModel,
  parseModelSpeed,
} from "../src/model-speed.js";
import { parseModelSettings } from "../src/agent-model-settings.js";

const anthropicModel = (id: string, provider = "anthropic-user"): Pick<Model<Api>, "api" | "provider" | "id"> =>
  ({ api: "anthropic-messages", provider, id });

describe("isFastModeCapableModel", () => {
  it("accepts Opus 5 and Opus 4.8 ids (bare or with a suffix)", () => {
    expect(isFastModeCapableModel("claude-opus-5")).toBe(true);
    expect(isFastModeCapableModel("claude-opus-4-8")).toBe(true);
    expect(isFastModeCapableModel("claude-opus-5-20260601")).toBe(true);
    expect(isFastModeCapableModel("Claude-Opus-4-8")).toBe(true);
  });
  it("rejects everything else (4.7 lost fast mode; Sonnet/Haiku/Fable never had it)", () => {
    for (const id of ["claude-opus-4-7", "claude-opus-4-6", "claude-sonnet-5", "claude-sonnet-4-6", "claude-fable-5", "claude-opus-50", "gpt-5.5", "", undefined]) {
      expect(isFastModeCapableModel(id)).toBe(false);
    }
  });
});

describe("isAdaptiveThinkingClaudeModel", () => {
  it("is true for 4.6+ and the 5 family", () => {
    for (const id of ["claude-opus-4-6", "claude-sonnet-4-6", "claude-opus-4-7", "claude-opus-4-8", "claude-opus-5", "claude-sonnet-5", "claude-fable-5", "claude-mythos-5", "claude-haiku-5"]) {
      expect(isAdaptiveThinkingClaudeModel(id), id).toBe(true);
    }
  });
  it("is false for budget_tokens-era models and non-Claude ids", () => {
    for (const id of ["claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-4-5", "claude-opus-4", "claude-3-7-sonnet", "gpt-5.5", undefined]) {
      expect(isAdaptiveThinkingClaudeModel(id), String(id)).toBe(false);
    }
  });
});

describe("fastModeEligibility", () => {
  it("is eligible only for direct-Anthropic Opus 5 / 4.8", () => {
    expect(fastModeEligibility(anthropicModel("claude-opus-5")).eligible).toBe(true);
    expect(fastModeEligibility(anthropicModel("claude-opus-4-8")).eligible).toBe(true);
  });
  it("explains each rejection", () => {
    expect(fastModeEligibility({ api: "openai-completions", provider: "litellm", id: "glm-latest" }).reason).toMatch(/Anthropic Messages only/);
    expect(fastModeEligibility(anthropicModel("claude-opus-5", "copilot-user")).reason).toMatch(/not the direct Anthropic API/);
    expect(fastModeEligibility(anthropicModel("claude-sonnet-5")).reason).toMatch(/does not support fast mode/);
  });
});

describe("fastModeBetaHeader", () => {
  it("is just the fast-mode beta for API keys", () => {
    expect(fastModeBetaHeader(undefined, "sk-ant-api03-xxx")).toBe(FAST_MODE_BETA);
  });
  it("does not fabricate OAuth betas (Claude OAuth removed — keys are API keys)", () => {
    expect(fastModeBetaHeader(undefined, undefined)).toBe(FAST_MODE_BETA);
  });
  it("extends an existing header without duplicating", () => {
    expect(fastModeBetaHeader("foo-2025, bar-2026", undefined)).toBe(`foo-2025,bar-2026,${FAST_MODE_BETA}`);
    expect(fastModeBetaHeader(FAST_MODE_BETA, undefined)).toBe(FAST_MODE_BETA);
  });
});

describe("installFastMode", () => {
  function captureAgent() {
    const calls: Array<{ model: Model<Api>; options: SimpleStreamOptions | undefined }> = [];
    const agent = {
      streamFn: (model: Model<Api>, _context: unknown, options?: SimpleStreamOptions) => {
        calls.push({ model, options });
        return {} as never;
      },
    };
    return { agent, calls };
  }

  it("adds speed=fast + the beta header for an eligible model and composes an existing onPayload", async () => {
    const { agent, calls } = captureAgent();
    const model = { ...anthropicModel("claude-opus-5"), baseUrl: "https://api.anthropic.com" } as Model<Api>;
    const result = installFastMode(agent, model);
    expect(result.applied).toBe(true);

    const existingOnPayload: NonNullable<SimpleStreamOptions["onPayload"]> = (payload) => ({ ...(payload as object), marker: 1 });
    await agent.streamFn(model, { messages: [] } as never, {
      apiKey: "sk-ant-api03-xxx",
      headers: { "x-custom": "1" },
      onPayload: existingOnPayload,
    });
    expect(calls).toHaveLength(1);
    const opts = calls[0]!.options!;
    expect(opts.headers).toEqual({ "x-custom": "1", "anthropic-beta": FAST_MODE_BETA });
    const payload = await opts.onPayload!({ model: "claude-opus-5", max_tokens: 10 }, model);
    expect(payload).toEqual({ model: "claude-opus-5", max_tokens: 10, marker: 1, speed: "fast" });
  });

  it("leaves ineligible models untouched, both at install time and per call", async () => {
    const { agent, calls } = captureAgent();
    const litellm = { api: "openai-completions", provider: "litellm", id: "glm-latest", baseUrl: "x" } as Model<Api>;
    expect(installFastMode(agent, litellm).applied).toBe(false);
    const original = { headers: { a: "b" } };
    await agent.streamFn(litellm, { messages: [] } as never, original);
    expect(calls[0]!.options).toBe(original);

    // Eligible session model, but a per-call swap to a different model (fallback/compaction) must not get speed=fast.
    const { agent: agent2, calls: calls2 } = captureAgent();
    const opus = { ...anthropicModel("claude-opus-5"), baseUrl: "x" } as Model<Api>;
    installFastMode(agent2, opus);
    const sonnet = { ...anthropicModel("claude-sonnet-5"), baseUrl: "x" } as Model<Api>;
    await agent2.streamFn(sonnet, { messages: [] } as never, original);
    expect(calls2[0]!.options).toBe(original);
  });
});

describe("modelSettings.speed", () => {
  it("parses fast/standard and drops junk", () => {
    expect(parseModelSpeed("fast")).toBe("fast");
    expect(parseModelSpeed("standard")).toBe("standard");
    expect(parseModelSpeed("turbo")).toBeUndefined();
    expect(parseModelSettings({ modelSettings: { speed: "fast" } })).toEqual({ speed: "fast" });
    expect(parseModelSettings({ modelSettings: { speed: true } })).toBeUndefined();
  });
});

describe("fastModeProfile.modelSettings overlay", () => {
  const cfg = (speed?: string) => ({
    modelSettings: { model: "kimi-latest", thinkingLevel: "minimal", maxTokens: 8192, ...(speed ? { speed } : {}) },
    fastModeProfile: { providers: "custom", providerOrder: ["claude"], modelSettings: { thinkingLevel: "high", model: "glm-latest" } },
  });

  it("overlays set fields when the run is fast; unset fields inherit", () => {
    expect(parseModelSettings(cfg("fast"))).toEqual({ model: "glm-latest", thinkingLevel: "high", maxTokens: 8192, speed: "fast" });
  });

  it("ignores the overlay at standard speed", () => {
    expect(parseModelSettings(cfg())).toEqual({ model: "kimi-latest", thinkingLevel: "minimal", maxTokens: 8192 });
    expect(parseModelSettings(cfg("standard"))).toEqual({ model: "kimi-latest", thinkingLevel: "minimal", maxTokens: 8192, speed: "standard" });
  });

  it("clamps overlay values like the base fields", () => {
    const c = { modelSettings: { speed: "fast" }, fastModeProfile: { modelSettings: { temperature: 9, maxTokens: 1 } } };
    expect(parseModelSettings(c)).toEqual({ speed: "fast", temperature: 1, maxTokens: 1024 });
  });
});
