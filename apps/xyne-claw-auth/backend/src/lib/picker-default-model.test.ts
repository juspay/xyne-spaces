import { describe, expect, it, vi } from "vitest";

vi.mock("../db.js", () => ({ prisma: {} }));
vi.mock("../config.js", () => ({ CONFIG: { encryptionKey: "k" } }));
vi.mock("../crypto.js", () => ({ decrypt: () => "secret" }));
vi.mock("../logger.js", () => ({ createLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) }));
type CredFixture = { provider: string; encryptedKey: string; iv: string; authTag: string; model: string | null; baseUrl: null; authType: string | null; reasoningEffort: null };
const { creds, claudeRefresh } = vi.hoisted(() => ({
  creds: [] as CredFixture[],
  claudeRefresh: vi.fn(async () => "refreshed"),
}));
vi.mock("../repositories/index.js", () => ({
  agentProviderCredentialsRepository: { listByAgent: async () => creds },
  userProviderCredentialsRepository: {},
  sharedProviderCredentialRepository: {},
}));
vi.mock("./claude-oauth-refresh.js", () => ({ getValidClaudeBearer: claudeRefresh }));
vi.mock("./codex-oauth-refresh.js", () => ({ getValidCodexBearer: async () => "" }));

import { resolveAgentProviderConfigs } from "./agent-provider-config.js";
import { parseSpeedParam, resolvePickerDefault, spacesModelForSpeed } from "./picker-default-model.js";

const cred = (provider: string, model: string | null, authType: string | null = null) =>
  ({ provider, encryptedKey: "e", iv: "i", authTag: "t", model, baseUrl: null, authType, reasoningEffort: null });

async function pickerDefault(config: Record<string, unknown>, speed: "fast" | "standard", platformDefaultModel: string | null = "kimi-k2") {
  const resolved = await resolveAgentProviderConfigs({ id: "a1", config }, { speed, skipOAuthRefresh: true });
  return resolvePickerDefault({ config, speed, resolved, platformDefaultModel });
}

describe("model picker default = what a no-pin run starts on", () => {
  it("XYNE-66318: a premium provider ranked above spaces names its credential model, not the Spaces model", async () => {
    creds.splice(0, creds.length, cred("claude", "claude-opus-4-8"));
    const def = await pickerDefault({ providerOrder: ["claude", "spaces"], modelSettings: { model: "glm-5" } }, "standard");
    expect(def).toEqual({ provider: "claude", defaultModel: "claude-opus-4-8", defaultModelName: "Opus 4.8" });
  });

  it("spaces ranked first wins over lower-ranked creds: agent Spaces model, else claw's LITELLM.model", async () => {
    creds.splice(0, creds.length, cred("claude", "claude-opus-4-8"));
    expect((await pickerDefault({ providerOrder: ["spaces", "claude"], modelSettings: { model: "glm-5" } }, "standard")).defaultModel).toBe("glm-5");
    expect((await pickerDefault({ providerOrder: ["spaces", "claude"] }, "standard")).defaultModel).toBe("kimi-k2");
  });

  it("a ranked provider without creds is skipped; no order ⇒ platform default even with a saved cred", async () => {
    creds.splice(0, creds.length, cred("codex", "gpt-5.5"));
    expect((await pickerDefault({ providerOrder: ["claude", "codex"] }, "standard")).provider).toBe("codex");
    expect((await pickerDefault({}, "standard")).provider).toBe("spaces");
  });

  it("litellm credential with no model names the built-in default, not null", async () => {
    creds.splice(0, creds.length, cred("litellm", null));
    expect((await pickerDefault({ providerOrder: ["litellm", "spaces"] }, "standard")).defaultModel).toBe("private-large");
  });

  it("XYNE-66323: a custom fast profile swaps the order and per-provider model", async () => {
    creds.splice(0, creds.length, cred("claude", "claude-opus-4-8"), cred("litellm", "private-large"));
    const config = {
      providerOrder: ["claude", "spaces"],
      fastModeProfile: { providers: "custom", providerOrder: ["litellm", "spaces"], models: { litellm: "open-fast" } },
    };
    expect((await pickerDefault(config, "standard")).defaultModel).toBe("claude-opus-4-8");
    expect(await pickerDefault(config, "fast")).toMatchObject({ provider: "litellm", defaultModel: "open-fast" });
  });

  it("fast mode on spaces uses fastModeProfile.modelSettings.model, falling back to the standard Spaces model", () => {
    const config = { modelSettings: { model: "glm-5" }, fastModeProfile: { modelSettings: { model: "glm-5-fast" } } };
    expect(spacesModelForSpeed(config, "fast")).toBe("glm-5-fast");
    expect(spacesModelForSpeed(config, "standard")).toBe("glm-5");
    expect(spacesModelForSpeed({ modelSettings: { model: " glm-5 " } }, "fast")).toBe("glm-5");
  });

  it("the picker read never refreshes OAuth tokens", async () => {
    creds.splice(0, creds.length, cred("claude", "claude-opus-4-8", "oauth_token"));
    claudeRefresh.mockClear();
    await pickerDefault({ providerOrder: ["claude"] }, "standard");
    expect(claudeRefresh).not.toHaveBeenCalled();
  });

  it("parses only fast|standard from the query", () => {
    expect(parseSpeedParam("fast")).toBe("fast");
    expect(parseSpeedParam("standard")).toBe("standard");
    expect(parseSpeedParam("turbo")).toBeUndefined();
    expect(parseSpeedParam(["fast"])).toBeUndefined();
  });
});
