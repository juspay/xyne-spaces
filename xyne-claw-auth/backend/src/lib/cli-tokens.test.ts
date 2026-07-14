import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  tokenRecord: null as null | {
    userId: string;
    orgId: string;
    scopes: string[];
    expiresAt: Date | null;
    revokedAt: Date | null;
    user: { orgId: string };
  },
  findUniqueHash: "",
  lastUsedHash: "",
}));

vi.mock("../db.js", () => ({
  prisma: {
    surfaceAccessToken: {
      findUnique: vi.fn(async (args: { where: { tokenHash: string } }) => {
        state.findUniqueHash = args.where.tokenHash;
        return state.tokenRecord;
      }),
      updateMany: vi.fn(async (args: { where: { tokenHash: string } }) => {
        state.lastUsedHash = args.where.tokenHash;
        return { count: 1 };
      }),
    },
  },
}));

describe("cli-tokens", () => {
  beforeEach(() => {
    state.tokenRecord = null;
    state.findUniqueHash = "";
    state.lastUsedHash = "";
  });

  it("generates, hashes, and verifies a CLI token round trip", async () => {
    const { generate, hash, verify } = await import("./cli-tokens.js");
    const token = generate();

    expect(token.raw.startsWith("xyne_cli_")).toBe(true);
    expect(token.hashed).toBe(hash(token.raw));
    expect(token.prefix).toBe(token.raw.slice(0, 12));

    state.tokenRecord = {
      userId: "user-owner",
      orgId: "org-1",
      scopes: ["agents:read", "runs:read", "runs:write"],
      expiresAt: null,
      revokedAt: null,
      user: { orgId: "org-1" },
    };

    await expect(verify(token.raw)).resolves.toEqual({
      userId: "user-owner",
      orgId: "org-1",
      scopes: ["agents:read", "runs:read", "runs:write"],
    });
    expect(state.findUniqueHash).toBe(token.hashed);
    expect(state.lastUsedHash).toBe(token.hashed);
  });

  it("rejects a token when stored orgId no longer matches the user's org", async () => {
    const { hash, verify } = await import("./cli-tokens.js");
    const raw = "xyne_cli_stale_org";
    state.tokenRecord = {
      userId: "user-owner",
      orgId: "org-old",
      scopes: ["agents:read"],
      expiresAt: null,
      revokedAt: null,
      user: { orgId: "org-new" },
    };

    await expect(verify(raw)).resolves.toBeNull();
    expect(state.findUniqueHash).toBe(hash(raw));
    expect(state.lastUsedHash).toBe("");
  });
});
