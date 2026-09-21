import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

const state = vi.hoisted(() => ({
  artifacts: [] as Array<Record<string, any>>,
  messages: [] as Array<{ conversationId: string; userId: string }>,
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
      findMany: vi.fn(async () => state.artifacts),
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
  options: { userId?: string | null; body?: Record<string, unknown> } = {},
): Promise<{ status: number; body: Record<string, any> }> {
  const { conversationArtifactsRouter } = await import("./conversation-artifacts.js");
  return await new Promise((resolve, reject) => {
    let statusCode = 200;
    const req = {
      method,
      url,
      originalUrl: url,
      headers: options.userId === null ? {} : { "x-user-id": options.userId ?? "user-a" },
      body: options.body ?? {},
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
});
