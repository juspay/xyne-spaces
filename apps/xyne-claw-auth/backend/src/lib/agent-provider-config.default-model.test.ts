import { beforeEach, describe, expect, it, vi } from "vitest";

// Credential rows the mocked repository hands back, per test.
type Row = { provider: string; encryptedKey: string | null; iv: string | null; authTag: string | null; model: string | null; baseUrl: null; authType: string | null; reasoningEffort: null };
let rows: Row[] = [];
const row = (provider: string, model: string | null = null): Row => ({
  provider, encryptedKey: "k", iv: "i", authTag: "t", model, baseUrl: null, authType: null, reasoningEffort: null,
});

vi.mock("../db.js", () => ({ prisma: {} }));
vi.mock("../config.js", () => ({ CONFIG: { encryptionKey: "x" } }));
vi.mock("../crypto.js", () => ({ decrypt: () => "secret" }));
vi.mock("../logger.js", () => ({ createLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) }));
vi.mock("../repositories/index.js", () => ({
  agentProviderCredentialsRepository: { listByAgent: async () => rows },
  userProviderCredentialsRepository: {},
  sharedProviderCredentialRepository: {},
}));
vi.mock("./claude-oauth-refresh.js", () => ({ getValidClaudeBearer: async () => "" }));
vi.mock("./codex-oauth-refresh.js", () => ({ getValidCodexBearer: async () => "" }));

import { rankAgentProviders, resolveAgentDefaultModel, resolveAgentProviderConfigs, spacesModelForSpeed } from "./agent-provider-config.js";

const agent = (config: Record<string, unknown>) => ({ id: "a1", config });

beforeEach(() => { rows = []; });

describe("resolveAgentDefaultModel — the picker's 'Uses X by default'", () => {
  // XYNE-66318: codex / claude / copilot were dropped from the label.
  it.each([
    ["codex", "gpt-5.5"],
    ["claude", "claude-opus-4-8"],
    ["copilot", "claude-sonnet-4.6"],
  ])("labels a top-ranked %s credential with its default model", async (provider, model) => {
    rows = [row(provider)];
    const d = await resolveAgentDefaultModel(agent({ providerOrder: [provider, "spaces"], modelSettings: { model: "kimi-k2" } }));
    expect(d).toEqual({ provider, model, speed: "standard" });
  });

  it("uses the credential row's own model when set", async () => {
    rows = [row("claude", "claude-sonnet-5")];
    expect((await resolveAgentDefaultModel(agent({ providerOrder: ["claude"] }))).model).toBe("claude-sonnet-5");
  });

  it("spaces ranked first wins over lower-ranked creds, with the agent's Spaces model", async () => {
    rows = [row("codex")];
    const d = await resolveAgentDefaultModel(agent({ providerOrder: ["spaces", "codex"], modelSettings: { model: "kimi-k2" } }));
    expect(d).toEqual({ provider: "spaces", model: "kimi-k2", speed: "standard" });
  });

  it("skips ranked providers without creds and leaves model null for claw's platform default", async () => {
    const d = await resolveAgentDefaultModel(agent({ providerOrder: ["claude", "spaces"] }));
    expect(d).toEqual({ provider: "spaces", model: null, speed: "standard" });
  });

  it("never routes a saved-but-unselected credential", async () => {
    rows = [row("codex")];
    expect((await resolveAgentDefaultModel(agent({}))).provider).toBe("spaces");
  });

  // XYNE-66323: fast mode with a custom profile changes order and models.
  describe("fast mode", () => {
    const cfg = {
      providerOrder: ["spaces", "claude"],
      modelSettings: { model: "kimi-k2" },
      fastModeProfile: { providers: "custom", providerOrder: ["claude", "spaces"], models: { claude: "claude-haiku-5" } },
    };

    it("explicit speed=fast follows the fast profile's order and model", async () => {
      rows = [row("claude", "claude-opus-4-8")];
      expect(await resolveAgentDefaultModel(agent(cfg), { speed: "fast" })).toEqual({ provider: "claude", model: "claude-haiku-5", speed: "fast" });
      expect(await resolveAgentDefaultModel(agent(cfg), { speed: "standard" })).toEqual({ provider: "spaces", model: "kimi-k2", speed: "standard" });
    });

    it("no speed ⇒ the agent's modelSettings.speed", async () => {
      rows = [row("claude")];
      const d = await resolveAgentDefaultModel(agent({ ...cfg, modelSettings: { model: "kimi-k2", speed: "fast" } }));
      expect(d.provider).toBe("claude");
      expect(d.speed).toBe("fast");
    });

    it("spaces on fast uses fastModeProfile.modelSettings.model (claw's overlay)", () => {
      const c = { modelSettings: { model: "kimi-k2" }, fastModeProfile: { providers: "inherit", modelSettings: { model: "kimi-fast" } } };
      expect(spacesModelForSpeed(c, "fast")).toBe("kimi-fast");
      expect(spacesModelForSpeed(c, "standard")).toBe("kimi-k2");
    });
  });

  // The label must agree with what dispatch resolves.
  it.each([
    [{ providerOrder: ["codex", "spaces"] }, ["codex"]],
    [{ providerOrder: ["spaces", "codex"] }, ["codex"]],
    [{ providerOrder: ["claude", "litellm"] }, ["litellm"]],
    [{ provider: "litellm" }, ["litellm"]],
    [{}, ["claude"]],
  ])("agrees with resolveAgentProviderConfigs for %j", async (config, creds) => {
    rows = creds.map((p) => row(p));
    const dispatch = await resolveAgentProviderConfigs(agent(config));
    const label = await resolveAgentDefaultModel(agent(config));
    expect(label.provider).toBe(dispatch.provider ?? "spaces");
    if (dispatch.provider) expect(label.model).toBe(dispatch.providerConfigs[dispatch.provider]!.model);
  });
});

describe("rankAgentProviders", () => {
  it("returns the full order and a primary only when creds exist", () => {
    expect(rankAgentProviders({ providerOrder: ["codex", "spaces"] }, () => false)).toEqual({ parent: "spaces", providerOrder: ["codex", "spaces"] });
    expect(rankAgentProviders({ providerOrder: ["codex", "spaces"] }, (p) => p === "codex")).toEqual({ parent: "codex", providerOrder: ["codex", "spaces"], primary: "codex" });
    expect(rankAgentProviders({}, () => true)).toEqual({ providerOrder: [] });
  });
});
