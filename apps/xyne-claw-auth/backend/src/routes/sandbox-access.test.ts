import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rows: [] as Array<{ conversationId: string; createdByUserId: string }>,
  verdicts: {} as Record<string, "ok" | "denied" | "unknown">,
  findManyArgs: null as unknown,
}));

vi.mock("../db.js", () => ({
  prisma: {
    conversationArtifact: {
      findMany: vi.fn(async (args: unknown) => {
        state.findManyArgs = args;
        return state.rows;
      }),
    },
  },
}));

vi.mock("../lib/conversation-access.js", () => ({
  checkConversationAccess: vi.fn(async (conversationId: string) => state.verdicts[conversationId] ?? "unknown"),
}));

vi.mock("../logger.js", () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }),
}));

vi.mock("../middleware/agent-acl.js", () => ({
  getRequesterId: vi.fn(() => undefined),
}));

const { resolveSandboxAccess } = await import("./sandbox-access.js");

describe("resolveSandboxAccess", () => {
  beforeEach(() => {
    state.rows = [];
    state.verdicts = {};
    state.findManyArgs = null;
  });

  it("denies a malformed sandbox id without touching the database", async () => {
    expect(await resolveSandboxAccess("../etc", "u1")).toEqual({ allow: false, reason: "invalid-sandbox" });
    expect(await resolveSandboxAccess("", "u1")).toEqual({ allow: false, reason: "invalid-sandbox" });
    expect(state.findManyArgs).toBeNull();
  });

  it("denies a sandbox that was never posted to any conversation", async () => {
    expect(await resolveSandboxAccess("agent-workspace-browser-abc12", "u1")).toEqual({
      allow: false,
      reason: "unknown-sandbox",
    });
    expect(state.findManyArgs).toMatchObject({ where: { refService: "CLAW", refId: "agent-workspace-browser-abc12" } });
  });

  it("allows the user whose run created the sandbox", async () => {
    state.rows = [{ conversationId: "c1", createdByUserId: "u1" }];
    expect(await resolveSandboxAccess("sbx-1", "u1")).toEqual({ allow: true, reason: "owner" });
  });

  it("allows a member of a conversation the sandbox was posted in", async () => {
    state.rows = [
      { conversationId: "c1", createdByUserId: "owner" },
      { conversationId: "c2", createdByUserId: "owner" },
    ];
    state.verdicts = { c1: "denied", c2: "ok" };
    expect(await resolveSandboxAccess("sbx-1", "u2")).toEqual({ allow: true, reason: "conversation" });
  });

  it("fails closed when Spaces cannot confirm conversation access", async () => {
    state.rows = [{ conversationId: "c1", createdByUserId: "owner" }];
    state.verdicts = { c1: "unknown" };
    expect(await resolveSandboxAccess("sbx-1", "u2")).toEqual({ allow: false, reason: "denied" });
  });
});
