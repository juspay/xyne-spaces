import { afterEach, describe, expect, it, vi } from "vitest";

const shared = vi.hoisted(() => {
  const row = (id: string, provider: string, key: string) => ({
    id,
    orgId: null,
    provider,
    name: id,
    encryptedKey: key,
    iv: `${key}-iv`,
    authTag: `${key}-tag`,
    model: `${id}-model`,
    baseUrl: null,
    authType: "oauth_token",
    reasoningEffort: null,
    ownerUserId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  });
  return {
    rows: new Map([
      ["sonnet", row("sonnet", "claude", "sonnet-key")],
      ["opus", row("opus", "claude", "opus-key")],
      ["codex-main", row("codex-main", "codex", "codex-key")],
    ]),
  };
});

vi.mock("../db.js", () => ({
  prisma: {
    sharedProviderCredential: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => shared.rows.get(where.id) ?? null),
    },
    agentProviderCredentials: {
      findMany: vi.fn(async () => [binding("agent-1")]),
      findUnique: vi.fn(async () => binding("agent-1")),
    },
  },
}));
vi.mock("../logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

function binding(agentId: string) {
  return {
    agentId,
    provider: "claude",
    encryptedKey: null,
    iv: null,
    authTag: null,
    model: null,
    baseUrl: null,
    authType: null,
    reasoningEffort: null,
    createdByUserId: null,
    sharedCredentialId: "sonnet",
    sharedCredential: shared.rows.get("sonnet")!,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

const { setSharedCredentialOverride, applySharedCredentialOverride } = await import("./shared-credential-override.js");
const { agentProviderCredentialsRepository } = await import("../repositories/agentProviderCredentialsRepository.js");

afterEach(() => setSharedCredentialOverride(null));

describe("shared credential override", () => {
  it("leaves rows alone when no resolver is registered", async () => {
    const row = binding("agent-1");
    expect(await applySharedCredentialOverride(row, { agentId: "agent-1" })).toBe(row);
  });

  it("swaps in the replacement shared credential and its id", async () => {
    const resolver = vi.fn(() => "opus");
    setSharedCredentialOverride(resolver);
    const result = await applySharedCredentialOverride(binding("agent-1"), { agentId: "agent-1" });
    expect(result.sharedCredentialId).toBe("opus");
    expect(result.sharedCredential?.encryptedKey).toBe("opus-key");
    expect(resolver).toHaveBeenCalledWith({ provider: "claude", sharedCredentialId: "sonnet", agentId: "agent-1" });
  });

  it("ignores a replacement for another provider, an unknown id, the same id or a failing resolver", async () => {
    for (const resolver of [() => "codex-main", () => "missing", () => "sonnet", () => { throw new Error("boom"); }]) {
      setSharedCredentialOverride(resolver);
      const result = await applySharedCredentialOverride(binding("agent-1"), { agentId: "agent-1" });
      expect(result.sharedCredentialId).toBe("sonnet");
    }
  });

  it("agent credential reads resolve through the override", async () => {
    setSharedCredentialOverride(({ agentId }) => (agentId === "agent-1" ? "opus" : null));
    const [listed] = await agentProviderCredentialsRepository.listByAgent("agent-1");
    const found = await agentProviderCredentialsRepository.findByAgentAndProvider("agent-1", "claude");
    for (const row of [listed, found]) {
      expect(row?.encryptedKey).toBe("opus-key");
      expect(row?.sharedCredentialId).toBe("opus");
      expect(row?.model).toBe("opus-model");
    }
  });
});
