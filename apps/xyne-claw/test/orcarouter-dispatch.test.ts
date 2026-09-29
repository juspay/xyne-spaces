import { describe, expect, it } from "vitest";

// config.ts reads these at import time, so they must be set before the import.
process.env["LITELLM_URL"] = "http://litellm.local";
process.env["LITELLM_API_KEY"] = "sk-platform";
delete process.env["ORCA_API_BASE_URL"];
delete process.env["ORCA_BASE_URL"];

const { AuthStorage, ModelRegistry } = await import("@earendil-works/pi-coding-agent");
const { resolveModel } = await import("../src/agent.js");
const { ORCAROUTER } = await import("../src/config.js");

// OrcaRouter is a BYO OpenAI-compatible gateway: the user's own `sk-orca-…` key
// against https://api.orcarouter.ai/v1. The bug this file pins down is the one
// an unhandled provider name produces — the run silently falls through to the
// platform LiteLLM proxy (platform key, platform model), i.e. a wrong answer
// attributed to the user's own credential.

function registry(): ModelRegistry {
  return ModelRegistry.inMemory(AuthStorage.inMemory());
}

describe("resolveModel — orcarouter dispatch", () => {
  it("registers an OpenAI-compatible provider on the credential's key and base URL", () => {
    const model = resolveModel(registry(), "orcarouter", {
      apiKey: "sk-orca-fake",
      model: "openai/gpt-5.5",
    });
    expect(model.provider).toBe("orcarouter-user");
    expect(model.api).toBe("openai-completions");
    expect(model.baseUrl).toBe("https://api.orcarouter.ai/v1");
    expect(model.id).toBe("openai/gpt-5.5");
  });

  it("never resolves to the platform LiteLLM provider (the openrouter-style fall-through bug)", () => {
    const model = resolveModel(registry(), "orcarouter", {
      apiKey: "sk-orca-fake",
      model: "openai/gpt-5.5",
    });
    expect(model.provider).not.toBe("litellm");
    expect(model.baseUrl).not.toBe("http://litellm.local");
  });

  it("honours an explicit self-hosted base URL and strips trailing slashes", () => {
    const model = resolveModel(registry(), "orcarouter", {
      apiKey: "sk-orca-fake",
      model: "deepseek/deepseek-v4-pro",
      baseUrl: "https://orca.internal.example/v1///",
    });
    expect(model.baseUrl).toBe("https://orca.internal.example/v1");
  });

  it("picks the adapter by model id: reasoning families get reasoning_effort, aliases do not", () => {
    const reg = registry();
    expect(resolveModel(reg, "orcarouter", { apiKey: "k", model: "openai/gpt-5.5" }).reasoning).toBe(true);
    expect(resolveModel(reg, "orcarouter", { apiKey: "k", model: "anthropic/claude-opus-4.8" }).reasoning).toBe(true);
    expect(resolveModel(reg, "orcarouter", { apiKey: "k", model: "google/gemini-3.5-flash" }).reasoning).toBe(true);
    expect(resolveModel(reg, "orcarouter", { apiKey: "k", model: "deepseek/deepseek-v4-pro" }).reasoning).toBe(true);
    // OrcaRouter's own aliases route to whatever the router picks — never send
    // them a reasoning_effort they may reject.
    expect(resolveModel(reg, "orcarouter", { apiKey: "k", model: "orcarouter/auto" }).reasoning).toBe(false);
  });

  it("disables the developer role, which the relay rejects with a 422", () => {
    const model = resolveModel(registry(), "orcarouter", { apiKey: "k", model: "openai/gpt-5.5" });
    expect(model.compat?.supportsDeveloperRole).toBe(false);
  });

  it("falls through to the platform default only when no key is supplied", () => {
    const model = resolveModel(registry(), "orcarouter", undefined);
    expect(model.provider).toBe("litellm");
  });
});

describe("ORCAROUTER config origin", () => {
  it("defaults to the public inference origin, with the /v1 path already included", () => {
    expect(ORCAROUTER.baseUrl).toBe("https://api.orcarouter.ai/v1");
  });
});
