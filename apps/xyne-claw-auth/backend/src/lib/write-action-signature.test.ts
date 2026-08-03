import { beforeEach, describe, expect, it, vi } from "vitest";

process.env["ENCRYPTION_KEY"] = "00".repeat(32);

const state = vi.hoisted(() => ({
  consumedNonces: new Set<string>(),
  config: {
    encryptionKey: Buffer.from("00".repeat(32), "hex"),
  },
}));

vi.mock("../config.js", () => ({
  CONFIG: state.config,
}));

vi.mock("../redis.js", () => ({
  redisService: {
    markNonceConsumed: vi.fn(async (nonce: string) => {
      if (state.consumedNonces.has(nonce)) {
        return false;
      }
      state.consumedNonces.add(nonce);
      return true;
    }),
    isNonceConsumed: vi.fn(async (nonce: string) => state.consumedNonces.has(nonce)),
  },
}));

describe("signWriteAction / verifyWriteActionSignature", () => {
  beforeEach(() => {
    state.consumedNonces.clear();
  });

  it("accepts a freshly signed action and rejects replays", async () => {
    const { signWriteAction, verifyWriteActionSignature } = await import("./write-action-signature.js");
    const action = await signWriteAction({
      serverType: "spaces",
      tool: "spaces-create-ticket",
      params: { title: "x" },
      userId: "u1",
      agentSlug: "agent-a",
      spacesAppId: "app-1",
    });

    expect(action.signature).toBeTruthy();
    expect(action.nonce).toHaveLength(36);
    expect(action.issuedAt).toBeGreaterThan(Date.now() - 5000);

    expect(await verifyWriteActionSignature(action, action.signature)).toBe(true);
    expect(await verifyWriteActionSignature(action, action.signature)).toBe(false);
  });

  it("rejects tampered fields", async () => {
    const { signWriteAction, verifyWriteActionSignature } = await import("./write-action-signature.js");
    const action = await signWriteAction({
      serverType: "spaces",
      tool: "spaces-create-ticket",
      params: { title: "x" },
      userId: "u1",
      agentSlug: "agent-a",
      spacesAppId: "app-1",
    });

    expect(await verifyWriteActionSignature({ ...action, tool: "spaces-delete-ticket" }, action.signature)).toBe(false);
    expect(await verifyWriteActionSignature({ ...action, params: { title: "y" } }, action.signature)).toBe(false);
    expect(await verifyWriteActionSignature({ ...action, userId: "u2" }, action.signature)).toBe(false);
    expect(await verifyWriteActionSignature({ ...action, agentSlug: "agent-b" }, action.signature)).toBe(false);
    expect(await verifyWriteActionSignature({ ...action, spacesAppId: "app-2" }, action.signature)).toBe(false);
  });

  it("rejects expired actions", async () => {
    const { signWriteAction, verifyWriteActionSignature } = await import("./write-action-signature.js");
    const action = await signWriteAction({
      serverType: "spaces",
      tool: "spaces-create-ticket",
      params: { title: "x" },
      userId: "u1",
      issuedAt: Date.now() - 11 * 60 * 1000,
    });

    expect(await verifyWriteActionSignature(action, action.signature)).toBe(false);
  });

  it("rejects actions from the future", async () => {
    const { signWriteAction, verifyWriteActionSignature } = await import("./write-action-signature.js");
    const action = await signWriteAction({
      serverType: "spaces",
      tool: "spaces-create-ticket",
      params: { title: "x" },
      userId: "u1",
      issuedAt: Date.now() + 5 * 60 * 1000,
    });

    expect(await verifyWriteActionSignature(action, action.signature)).toBe(false);
  });

  it("rejects invalid signatures", async () => {
    const { signWriteAction, verifyWriteActionSignature } = await import("./write-action-signature.js");
    const action = await signWriteAction({
      serverType: "spaces",
      tool: "spaces-create-ticket",
      params: { title: "x" },
      userId: "u1",
    });

    expect(await verifyWriteActionSignature(action, action.signature.replace(/^.{4}/, "dead"))).toBe(false);
  });
});
