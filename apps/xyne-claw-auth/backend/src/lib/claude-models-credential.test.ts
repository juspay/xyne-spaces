import { beforeEach, describe, expect, it, vi } from "vitest";

type Cred = { encryptedKey: string; iv: string; authTag: string; baseUrl: string | null; authType: string | null } | null;

const state = vi.hoisted(() => ({
  userCred: null as Cred,
  agentCred: null as Cred,
  agent: { id: "agent-1" } as { id: string } | null,
}));

vi.mock("../repositories/index.js", () => ({
  userProviderCredentialsRepository: { findByUserAndProvider: vi.fn(async () => state.userCred) },
  agentProviderCredentialsRepository: { findByAgentAndProvider: vi.fn(async () => state.agentCred) },
  agentRepository: { findBySlug: vi.fn(async () => state.agent) },
}));

vi.mock("../config.js", () => ({ CONFIG: { encryptionKey: Buffer.alloc(32) } }));
vi.mock("../crypto.js", () => ({ decrypt: vi.fn((encryptedKey: string) => `plain:${encryptedKey}`) }));
vi.mock("./claude-creds.js", () => ({ extractClaudeBearer: vi.fn((value: string) => value) }));

const { resolveClaudeModelsCredential } = await import("./claude-models-credential.js");

const base = { userId: "u1", agentSlug: "agent-a", orgId: "org-1" };

describe("resolveClaudeModelsCredential", () => {
  beforeEach(() => {
    state.userCred = null;
    state.agentCred = null;
    state.agent = { id: "agent-1" };
  });

  it("uses a typed key with the caller's baseUrl", async () => {
    expect(await resolveClaudeModelsCredential({ ...base, apiKey: " sk-typed ", baseUrl: "https://mine.example" })).toEqual({
      apiKey: "sk-typed",
      baseUrl: "https://mine.example",
    });
  });

  it("lets a user point their own stored key at a baseUrl they choose", async () => {
    state.userCred = { encryptedKey: "user-key", iv: "i", authTag: "t", baseUrl: "https://saved.example", authType: null };
    expect(await resolveClaudeModelsCredential({ ...base, baseUrl: "https://mine.example" })).toEqual({
      apiKey: "plain:user-key",
      baseUrl: "https://mine.example",
    });
  });

  it("sends the agent's key only to the agent's saved baseUrl, ignoring the caller's", async () => {
    state.agentCred = { encryptedKey: "agent-key", iv: "i", authTag: "t", baseUrl: "https://agent-proxy.example", authType: "api_key" };
    expect(await resolveClaudeModelsCredential({ ...base, baseUrl: "https://attacker.example", authType: "oauth_token" })).toEqual({
      apiKey: "plain:agent-key",
      baseUrl: "https://agent-proxy.example",
      authType: "api_key",
    });
  });

  it("uses the default Anthropic endpoint for an agent key with no saved baseUrl, even if the caller sends one", async () => {
    state.agentCred = { encryptedKey: "agent-key", iv: "i", authTag: "t", baseUrl: null, authType: null };
    const cred = await resolveClaudeModelsCredential({ ...base, baseUrl: "https://attacker.example" });
    expect(cred).toEqual({ apiKey: "plain:agent-key" });
    expect(cred?.baseUrl).toBeUndefined();
  });

  it("returns null when there is no key anywhere", async () => {
    expect(await resolveClaudeModelsCredential({ ...base, baseUrl: "https://attacker.example" })).toBeNull();
  });
});
