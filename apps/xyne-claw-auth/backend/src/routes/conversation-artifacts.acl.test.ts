import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

const state = vi.hoisted(() => ({
  artifacts: [] as Array<Record<string, any>>,
  messages: [] as Array<{ conversationId: string; userId: string }>,
  // Spaces-side ACL: `${conversationId}|${spacesUserId}` pairs that may access.
  spacesAccess: new Set<string>(),
  accessChecks: [] as Array<{ conversationId: string; userId: string }>,
}));

// Keep the suite hermetic: these modules pull in the generated Prisma client
// and Redis at import time, neither of which the ACL logic needs.
vi.mock("../lib/users-jit.js", () => ({ orgIdForSpacesUser: vi.fn(async () => null) }));
vi.mock("../lib/panel-signals.js", () => ({ signalArtifacts: vi.fn() }));
// The liveness check (XYNE-66339) has its own tests; pass rows through here.
vi.mock("../lib/sandbox-liveness.js", () => ({ refreshSandboxLiveness: vi.fn(async () => undefined) }));
vi.mock("../lib/conversation-access.js", () => ({
  baseConversationId: (id: string | null | undefined) => (id ? id.split("__branch__")[0] : undefined),
  checkConversationAccess: vi.fn(async (conversationId: string, userId: string) => {
    state.accessChecks.push({ conversationId, userId });
    return state.spacesAccess.has(`${conversationId}|${userId}`) ? "ok" : "denied";
  }),
}));

vi.mock("../logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock("../middleware/agent-acl.js", () => ({
  getRequesterId: (req: Request) => req.headers["x-user-id"],
  getOrgId: (req: Request) => req.headers["x-org-id"],
}));
vi.mock("../db.js", () => ({
  prisma: {
    conversationArtifact: {
      findUnique: vi.fn(async (args: { where: { id: string } }) =>
        state.artifacts.find((a) => a["id"] === args.where.id) ?? null,
      ),
      findMany: vi.fn(async (args: { where: { conversationId?: string; createdByUserId?: { in: string[] } } }) =>
        state.artifacts.filter((a) =>
          (!args.where.conversationId || a["conversationId"] === args.where.conversationId) &&
          (!args.where.createdByUserId || args.where.createdByUserId.in.includes(a["createdByUserId"])),
        ),
      ),
      update: vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = state.artifacts.find((a) => a["id"] === args.where.id);
        if (!row) throw new Error("not found");
        Object.assign(row, args.data);
        return row;
      }),
    },
    chatMessage: {
      findFirst: vi.fn(async (args: { where: { conversationId: string; userId: string | { in: string[] } } }) => {
        const candidates = typeof args.where.userId === "string" ? [args.where.userId] : args.where.userId.in;
        const hit = state.messages.find(
          (m) => m.conversationId === args.where.conversationId && candidates.includes(m.userId),
        );
        return hit ? { id: "msg-1" } : null;
      }),
    },
  },
}));

async function requestJson(
  method: string,
  url: string,
  options: { userId?: string | null; spacesUserId?: string; body?: Record<string, unknown> } = {},
): Promise<{ status: number; body: Record<string, any> }> {
  const { conversationArtifactsRouter } = await import("./conversation-artifacts.js");
  return await new Promise((resolve, reject) => {
    let statusCode = 200;
    const req = {
      method,
      url,
      originalUrl: url,
      headers: options.userId === null
        ? {}
        : {
            "x-user-id": options.userId ?? "user-a",
            ...(options.spacesUserId ? { "x-spaces-user-id": options.spacesUserId } : {}),
          },
      body: options.body ?? {},
      // A bare Router has no query parser (the app adds it), so parse here.
      query: Object.fromEntries(new URL(url, "http://test").searchParams),
    } as unknown as Request;
    const res = {
      status(code: number) { statusCode = code; return this; },
      setHeader() { return this; },
      json(payload: Record<string, any>) { resolve({ status: statusCode, body: payload }); return this; },
    } as unknown as Response;
    (conversationArtifactsRouter as unknown as { handle: (req: Request, res: Response, next: (err?: unknown) => void) => void })
      .handle(req, res, (err?: unknown) => {
        if (err) reject(err);
        else resolve({ status: 404, body: {} });
      });
  });
}

describe("conversation artifact route authorization", () => {
  beforeEach(() => {
    state.artifacts = [
      {
        id: "art-1",
        conversationId: "conv-1",
        kind: "CANVAS",
        refService: "SPACES",
        refId: "cv-1",
        url: null,
        provider: null,
        latestVersionRef: null,
        title: "A's canvas",
        status: "ACTIVE",
        pinned: false,
        createdByUserId: "user-a",
        orgId: null,
      },
    ];
    state.messages = [
      { conversationId: "conv-1", userId: "user-a" },
      { conversationId: "conv-1", userId: "user-b" },
    ];
    state.spacesAccess = new Set();
    state.accessChecks = [];
    vi.clearAllMocks();
  });

  it("lets a participant GET an artifact they did not create", async () => {
    const got = await requestJson("GET", "/art-1", { userId: "user-b" });
    expect(got.status).toBe(200);
    expect(got.body["artifact"]).toMatchObject({ id: "art-1", title: "A's canvas" });
    expect(got.body["artifact"].openRef).toEqual({ kind: "CANVAS", service: "SPACES", refId: "cv-1" });
  });

  it("refuses a PATCH from a participant who did not create the artifact", async () => {
    const patched = await requestJson("PATCH", "/art-1", { userId: "user-b", body: { title: "hijacked" } });
    expect(patched.status).toBe(403);
    expect(state.artifacts[0]?.["title"]).toBe("A's canvas");
  });

  it("lets the creator PATCH their own artifact", async () => {
    const patched = await requestJson("PATCH", "/art-1", { userId: "user-a", body: { title: "Renamed", pinned: true } });
    expect(patched.status).toBe(200);
    expect(state.artifacts[0]).toMatchObject({ title: "Renamed", pinned: true });
  });

  it("404s a GET and a PATCH from someone outside the conversation", async () => {
    expect((await requestJson("GET", "/art-1", { userId: "user-c" })).status).toBe(404);
    expect((await requestJson("PATCH", "/art-1", { userId: "user-c", body: { pinned: true } })).status).toBe(404);
  });

  it("401s an unauthenticated PATCH", async () => {
    expect((await requestJson("PATCH", "/art-1", { userId: null, body: { pinned: true } })).status).toBe(401);
  });

  describe("collaborators who have not posted (XYNE-66344)", () => {
    beforeEach(() => {
      state.artifacts.push({
        ...state.artifacts[0],
        id: "art-thread",
        conversationId: "thread-1",
        refId: "pv-1",
        kind: "PREVIEW",
        title: "Owner's preview",
        createdByUserId: "user-a",
      });
      state.artifacts.push({
        ...state.artifacts[0],
        id: "art-chat",
        conversationId: "chat-abc",
        refId: "pv-2",
        kind: "PREVIEW",
        title: "Owner's direct-chat preview",
        createdByUserId: "user-a",
      });
      state.messages.push({ conversationId: "thread-1", userId: "user-a" });
      state.messages.push({ conversationId: "chat-abc", userId: "user-a" });
    });

    it("lists the owner's artifacts to a channel member who has never posted", async () => {
      state.spacesAccess.add("thread-1|spaces-d");
      const listed = await requestJson("GET", "/?conversationId=thread-1", { userId: "user-d", spacesUserId: "spaces-d" });
      expect(listed.status).toBe(200);
      expect(listed.body["artifacts"].map((a: { id: string }) => a.id)).toEqual(["art-thread"]);
      // Spaces' ACL is keyed by the workspace-scoped id, not the canonical one.
      expect(state.accessChecks).toEqual([{ conversationId: "thread-1", userId: "spaces-d" }]);
    });

    it("lets that member GET and comment-read the artifact directly", async () => {
      state.spacesAccess.add("thread-1|spaces-d");
      expect((await requestJson("GET", "/art-thread", { userId: "user-d", spacesUserId: "spaces-d" })).status).toBe(200);
    });

    it("still refuses that member a PATCH — writes stay creator-only", async () => {
      state.spacesAccess.add("thread-1|spaces-d");
      const patched = await requestJson("PATCH", "/art-thread", {
        userId: "user-d",
        spacesUserId: "spaces-d",
        body: { title: "hijacked" },
      });
      expect(patched.status).toBe(403);
    });

    it("hides the artifacts from a user Spaces denies", async () => {
      const listed = await requestJson("GET", "/?conversationId=thread-1", { userId: "user-e", spacesUserId: "spaces-e" });
      expect(listed.body["artifacts"]).toEqual([]);
      expect((await requestJson("GET", "/art-thread", { userId: "user-e", spacesUserId: "spaces-e" })).status).toBe(404);
    });

    it("does not consult Spaces for direct chats, so they keep the posted-or-created rule", async () => {
      state.spacesAccess.add("chat-abc|spaces-d");
      const listed = await requestJson("GET", "/?conversationId=chat-abc", { userId: "user-d", spacesUserId: "spaces-d" });
      expect(listed.body["artifacts"]).toEqual([]);
      expect(state.accessChecks).toEqual([]);
    });

    it("falls back to x-user-id when requireAuth stamped no separate Spaces id (legacy ids)", async () => {
      state.spacesAccess.add("thread-1|user-d");
      const listed = await requestJson("GET", "/?conversationId=thread-1", { userId: "user-d" });
      expect(listed.body["artifacts"].map((a: { id: string }) => a.id)).toEqual(["art-thread"]);
      expect(state.accessChecks).toEqual([{ conversationId: "thread-1", userId: "user-d" }]);
    });
  });
});
