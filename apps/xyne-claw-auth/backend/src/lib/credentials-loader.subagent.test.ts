import { beforeEach, describe, expect, it, vi } from "vitest";

// Focused tests for the per-subagent MCP credential branch added to
// loadEffectiveCredentials: org-scoping (the security fix), the non-overridable
// short-circuit, soft-pin fallthrough, and decrypt-failure behavior.

const state = vi.hoisted(() => ({
  subRow: null as null | Record<string, any>,
  userOrgId: "org-1" as string | null,
  // decrypt() returns a JSON string in production; the branch JSON.parses it.
  decryptImpl: (() => JSON.stringify({ apiKey: "x" })) as (...args: any[]) => unknown,
  findFirstCalls: [] as any[],
}));

vi.mock("../config.js", () => ({ CONFIG: { encryptionKey: Buffer.alloc(32, 7) } }));
vi.mock("../logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock("./errors.js", () => ({ errMsg: (e: unknown) => String(e) }));
vi.mock("../crypto.js", () => ({ decrypt: (...a: any[]) => state.decryptImpl(...a) }));
// Neutralize the OAuth / live-session short-circuits that sit above the branch.
vi.mock("./oauth-server-types.js", () => ({ OAUTH_SERVER_TYPES: new Set<string>() }));
vi.mock("../routes/oauth-token.js", () => ({ getOAuthProvider: () => null }));
vi.mock("./oauth-token-endpoint.js", () => ({
  resolveFreshOAuthCreds: vi.fn(async () => null),
  TokenRefreshError: class extends Error {},
}));
vi.mock("./credentials-refresh.js", () => ({ getFreshCredentials: vi.fn() }));
vi.mock("./spaces-db.js", () => ({
  getSpacesAuthForUser: vi.fn(async () => null),
  getWorkspaceIdForUser: vi.fn(async () => null),
}));
vi.mock("../db.js", () => ({
  prisma: {
    subagentMcpConnection: {
      findFirst: vi.fn(async (args: any) => {
        state.findFirstCalls.push(args);
        return state.subRow;
      }),
    },
    user: {
      findUnique: vi.fn(async () => ({ orgId: state.userOrgId })),
    },
    // Cascade reads that run only on a soft-pin fallthrough — stubbed to null
    // so the resolver returns null instead of throwing.
    userMcpConnection: { findFirst: vi.fn(async () => null) },
    mcpServer: { findUnique: vi.fn(async () => null) },
    agentMcpConnection: { findFirst: vi.fn(async () => null) },
  },
}));

import { loadEffectiveCredentials } from "./credentials-loader.js";

const SERVER = "juspay-internal";
const SUB_ID = "sub-1";

beforeEach(() => {
  state.subRow = null;
  state.userOrgId = "org-1";
  state.decryptImpl = () => JSON.stringify({ apiKey: "x" });
  state.findFirstCalls = [];
});

describe("loadEffectiveCredentials — subagent pin", () => {
  it("scopes the lookup to the caller's org and returns a subagent-sourced credential on a hit", async () => {
    state.subRow = { id: "conn-1", slug: "default", nonOverridable: true, encryptedCreds: "e", iv: "i", authTag: "t" };

    const res = await loadEffectiveCredentials("user-1", SERVER, undefined, undefined, "org-1", SUB_ID);

    expect(res).not.toBeNull();
    expect(res!.source).toBe("subagent");
    expect(res!.connectionId).toBe("conn-1");
    // Security: every lookup must be constrained to the caller's own org.
    expect(state.findFirstCalls.length).toBeGreaterThan(0);
    for (const call of state.findFirstCalls) {
      expect(call.where.subagent).toEqual({ orgId: "org-1" });
      expect(call.where.subagentDefinitionId).toBe(SUB_ID);
    }
  });

  it("resolves the org from userId when agentOrgId is not passed", async () => {
    state.subRow = { id: "conn-2", slug: "default", nonOverridable: true, encryptedCreds: "e", iv: "i", authTag: "t" };
    state.userOrgId = "org-9";

    const res = await loadEffectiveCredentials("user-1", SERVER, undefined, undefined, undefined, SUB_ID);

    expect(res!.source).toBe("subagent");
    expect(state.findFirstCalls.every((c) => c.where.subagent.orgId === "org-9")).toBe(true);
  });

  it("fails closed: when no org can be resolved the subagent pin is never consulted", async () => {
    state.subRow = { id: "conn-3", slug: "default", nonOverridable: true, encryptedCreds: "e", iv: "i", authTag: "t" };
    state.userOrgId = null; // user has no org, agentOrgId not passed

    const res = await loadEffectiveCredentials("user-1", SERVER, undefined, undefined, undefined, SUB_ID);

    expect(state.findFirstCalls.length).toBe(0);
    expect(res).toBeNull(); // fell through to the cascade, which finds nothing
  });

  it("returns null (does NOT fall through) when a non-overridable pin cannot be decrypted", async () => {
    state.subRow = { id: "conn-4", slug: "default", nonOverridable: true, encryptedCreds: "e", iv: "i", authTag: "t" };
    state.decryptImpl = () => { throw new Error("bad key"); };

    const res = await loadEffectiveCredentials("user-1", SERVER, undefined, undefined, "org-1", SUB_ID);

    expect(res).toBeNull();
  });

  it("falls through to the cascade when a SOFT pin cannot be decrypted", async () => {
    state.subRow = { id: "conn-5", slug: "default", nonOverridable: false, encryptedCreds: "e", iv: "i", authTag: "t" };
    state.decryptImpl = () => { throw new Error("bad key"); };

    // Soft pin decrypt-failure must NOT short-circuit to null; it falls through
    // to the cascade (stubbed to null here, so the overall result is null).
    const res = await loadEffectiveCredentials("user-1", SERVER, undefined, undefined, "org-1", SUB_ID);
    expect(res).toBeNull();
  });

  it("does not consult a subagent pin when no subagentId is supplied", async () => {
    state.subRow = { id: "conn-6", slug: "default", nonOverridable: true, encryptedCreds: "e", iv: "i", authTag: "t" };

    await loadEffectiveCredentials("user-1", SERVER, undefined, undefined, "org-1");
    expect(state.findFirstCalls.length).toBe(0);
  });
});
