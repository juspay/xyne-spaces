import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", () => ({ prisma: {} }));
vi.mock("../config.js", () => ({ CONFIG: { encryptionKey: "k", litellmUrl: "", litellmApiKey: "" } }));
vi.mock("../crypto.js", () => ({ decrypt: (enc: string) => `dec:${enc}` }));
vi.mock("../logger.js", () => ({ createLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) }));

const state = {
  userAgentConfig: null as { provider?: string } | null,
  userCreds: [] as Record<string, unknown>[],
  agentCreds: [] as Record<string, unknown>[],
  subagentConfigs: [] as { subagentName: string; provider: string }[],
};

vi.mock("../repositories/index.js", () => ({
  userAgentConfigRepository: { findByUserAndAgent: async () => state.userAgentConfig },
  userProviderCredentialsRepository: { listByUser: async () => state.userCreds, upsert: async () => {} },
  agentProviderCredentialsRepository: { listByAgent: async () => state.agentCreds },
  userSubagentConfigRepository: { listByUser: async () => state.subagentConfigs },
  sharedProviderCredentialRepository: { persistBundle: async () => {} },
}));
vi.mock("./claude-oauth-refresh.js", () => ({ getValidClaudeBearer: async () => "fresh-claude" }));
vi.mock("./codex-oauth-refresh.js", () => ({ getValidCodexBearer: async () => "fresh-codex" }));

import { resolveProvidersForDispatch } from "./provider-resolution.js";

function cred(provider: string, extra: Record<string, unknown> = {}) {
  return {
    provider,
    encryptedKey: `${provider}-key`,
    iv: "iv",
    authTag: "tag",
    model: `${provider}-model`,
    baseUrl: null,
    authType: null,
    reasoningEffort: null,
    ...extra,
  };
}

const agent = { id: "a1", orgId: "org1", slug: "doctor" };

function run(opts: {
  config?: Record<string, unknown>;
  conversationId?: string;
} = {}) {
  return resolveProvidersForDispatch({
    targetUserId: "u1",
    agent,
    agentRow: { id: "a1", config: opts.config ?? {} },
    conversationId: opts.conversationId ?? "conv1",
  });
}

beforeEach(() => {
  state.userAgentConfig = null;
  state.userCreds = [];
  state.agentCreds = [];
  state.subagentConfigs = [];
});

describe("resolveProvidersForDispatch", () => {
  it("personal pinned provider outranks the agent order", async () => {
    state.userAgentConfig = { provider: "claude" };
    state.userCreds = [cred("claude")];
    state.agentCreds = [cred("codex")];
    const r = await run({ config: { provider: "codex", providerOrder: ["codex"] } });
    expect(r.personalProvider).toBe("claude");
    expect(r.resolvedParentProvider).toBe("claude");
    expect(r.runtimeProviderOrder).toEqual(["claude", "codex"]);
  });

  it("userDeferredToAgent (\"spaces\") skips user creds entirely; agent creds used", async () => {
    state.userAgentConfig = { provider: "spaces" };
    state.userCreds = [cred("codex", { encryptedKey: "USER-codex" })];
    state.agentCreds = [cred("codex", { encryptedKey: "AGENT-codex" })];
    const r = await run({ config: { provider: "codex" } });
    expect(r.userDeferredToAgent).toBe(true);
    expect(r.personalProvider).toBeUndefined();
    expect(r.providerScope["codex"]).toBe("agent");
    expect(r.providerConfigs["codex"]?.apiKey).toBe("dec:AGENT-codex");
    expect(r.resolvedParentProvider).toBe("codex");
  });

  it("no personal: first credentialed entry of the agent order wins, agentLevelProvider is the tail", async () => {
    state.agentCreds = [cred("codex"), cred("claude")];
    const ordered = await run({ config: { providerOrder: ["claude", "codex"], provider: "codex" } });
    expect(ordered.resolvedParentProvider).toBe("claude");
    expect(ordered.runtimeProviderOrder).toEqual(["claude", "codex"]);

    state.agentCreds = [cred("codex")];
    const providerOnly = await run({ config: { provider: "codex" } });
    expect(providerOnly.resolvedParentProvider).toBe("codex");
    expect(providerOnly.runtimeProviderOrder).toEqual(["codex"]);
  });

  it("nothing configured resolves to the platform default", async () => {
    state.userCreds = [];
    state.agentCreds = [];
    const r = await run({ config: {} });
    expect(r.resolvedParentProvider).toBeUndefined();
    expect(r.runtimeProviderOrder).toEqual([]);
  });

  it("unlisted credentials never enter the walk", async () => {
    state.userCreds = [cred("claude")];
    state.agentCreds = [cred("codex")];
    const r = await run({ config: {} });
    expect(r.providerConfigs["claude"]).toBeDefined();
    expect(r.providerConfigs["codex"]).toBeDefined();
    expect(r.resolvedParentProvider).toBeUndefined();
    expect(r.runtimeProviderOrder).toEqual([]);
  });

  it("cred-less configured providers are skipped by the walk", async () => {
    state.userAgentConfig = { provider: "claude" };
    state.agentCreds = [cred("codex", { encryptedKey: null })];
    const r = await run({ config: { providerOrder: ["claude", "codex"], provider: "claude" } });
    expect(r.providerConfigs).toEqual({});
    expect(r.resolvedParentProvider).toBeUndefined();
    expect(r.runtimeProviderOrder).toEqual([]);
  });

  it("429 walk covers personal then the full credentialed agent order", async () => {
    state.userAgentConfig = { provider: "claude" };
    state.userCreds = [cred("claude")];
    state.agentCreds = [cred("codex")];
    const r = await run({ config: { providerOrder: ["codex", "copilot"], provider: "codex" } });
    expect(r.resolvedParentProvider).toBe("claude");
    expect(r.runtimeProviderOrder).toEqual(["claude", "codex"]);
    expect(r.runtimeProviderOrder).not.toContain("copilot");
  });

  it("an explicit spaces entry truncates the walk", async () => {
    state.agentCreds = [cred("codex"), cred("claude")];
    const r = await run({ config: { providerOrder: ["codex", "spaces", "claude"] } });
    expect(r.resolvedParentProvider).toBe("codex");
    expect(r.runtimeProviderOrder).toEqual(["codex"]);
  });

  it("refreshes oauth bearers for both providers through the shared helper", async () => {
    state.userCreds = [cred("claude", { authType: "oauth_token" })];
    state.agentCreds = [cred("codex", { authType: "oauth_token", sharedCredentialId: "s1" })];
    const r = await run({ config: { providerOrder: ["claude", "codex"] } });
    expect(r.providerConfigs["claude"]?.apiKey).toBe("fresh-claude");
    expect(r.providerConfigs["codex"]?.apiKey).toBe("fresh-codex");
  });

  it("passes through subagent overrides and mode", async () => {
    state.subagentConfigs = [{ subagentName: "researcher", provider: "codex" }];
    const r = await run({ config: { subagentProviderMode: "parent" } });
    expect(r.subagentProviders).toEqual({ researcher: "codex" });
    expect(r.subagentProviderMode).toBe("parent");
  });
});
