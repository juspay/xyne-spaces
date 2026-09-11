import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

const state = vi.hoisted(() => ({
  share: null as null | Record<string, any>,
  attachmentId: "attachment-1",
  config: { encryptionKey: Buffer.alloc(32, 9), frontendUrl: "https://spaces.xyne.juspay.net/claw" },
}));

vi.mock("../config.js", () => ({ CONFIG: state.config }));
vi.mock("../logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock("../middleware/agent-acl.js", () => ({
  getRequesterId: (req: Request) => req.headers["x-user-id"],
  getOrgId: (req: Request) => req.headers["x-org-id"],
}));
vi.mock("../services/storageService.js", () => ({
  gcsService: { createReadStream: vi.fn() },
}));
vi.mock("../db.js", () => ({
  prisma: {
    chatAttachment: {
      findFirst: vi.fn(async (args: { where: { id: string; uploaderUserId: string } }) => {
        if (args.where.id !== state.attachmentId || args.where.uploaderUserId !== "user-1") return null;
        return {
          id: state.attachmentId,
          uploaderUserId: "user-1",
          mimeType: "text/html",
          originalFilename: "checkout.html",
          size: 4096,
          url: "designs/checkout.html",
          chatMessage: { conversationId: "conv-1", userId: "user-1", orgId: "org-1" },
        };
      }),
    },
    designArtifactShare: {
      findUnique: vi.fn(async (args: { where: Record<string, unknown>; include?: unknown }) => {
        if (!state.share) return null;
        const compound = args.where["ownerUserId_conversationId"] as { ownerUserId: string; conversationId: string } | undefined;
        if (compound) {
          return compound.ownerUserId === state.share["ownerUserId"] && compound.conversationId === state.share["conversationId"]
            ? state.share
            : null;
        }
        if (args.where["tokenHash"] !== state.share["tokenHash"]) return null;
        return args.include
          ? {
              ...state.share,
              attachment: {
                id: state.attachmentId,
                size: 4096,
                url: "designs/checkout.html",
                originalFilename: "checkout.html",
              },
            }
          : state.share;
      }),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        const now = new Date("2026-08-07T18:00:00.000Z");
        state.share = { id: "share-1", viewCount: 0, revokedAt: null, lastViewedAt: null, createdAt: now, updatedAt: now, ...args.data };
        return state.share;
      }),
      update: vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        if (!state.share || state.share["id"] !== args.where.id) throw new Error("not found");
        const nextData = { ...args.data };
        const viewCount = nextData["viewCount"] as { increment?: number } | number | undefined;
        if (viewCount && typeof viewCount === "object") nextData["viewCount"] = Number(state.share["viewCount"] ?? 0) + Number(viewCount.increment ?? 0);
        state.share = { ...state.share, ...nextData, updatedAt: new Date("2026-08-07T18:01:00.000Z") };
        return state.share;
      }),
      updateMany: vi.fn(async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        if (
          !state.share || state.share["id"] !== args.where["id"] ||
          state.share["ownerUserId"] !== args.where["ownerUserId"] ||
          state.share["orgId"] !== args.where["orgId"] || state.share["revokedAt"]
        ) return { count: 0 };
        state.share = { ...state.share, ...args.data };
        return { count: 1 };
      }),
    },
  },
}));

async function requestJson(
  routerName: "owner" | "public",
  method: "GET" | "POST" | "DELETE",
  url: string,
  options: { body?: unknown; token?: string } = {},
): Promise<{ status: number; body: Record<string, any>; headers: Record<string, string> }> {
  const { designSharesRouter, publicDesignSharesRouter } = await import("./design-shares.js");
  const router = routerName === "owner" ? designSharesRouter : publicDesignSharesRouter;
  return await new Promise((resolve, reject) => {
    let statusCode = 200;
    const headers: Record<string, string> = {};
    const req = {
      method,
      url,
      originalUrl: url,
      headers: {
        "x-user-id": "user-1",
        "x-org-id": "org-1",
        ...(options.token ? { "x-design-share-token": options.token } : {}),
      },
      body: options.body ?? {},
    } as unknown as Request;
    const res = {
      status(code: number) { statusCode = code; return this; },
      setHeader(name: string, value: string) { headers[name.toLowerCase()] = value; return this; },
      json(payload: Record<string, any>) { resolve({ status: statusCode, body: payload, headers }); return this; },
    } as unknown as Response;
    (router as unknown as { handle: (req: Request, res: Response, next: (err?: unknown) => void) => void })
      .handle(req, res, (err?: unknown) => {
        if (err) reject(err);
        else resolve({ status: 404, body: {}, headers });
      });
  });
}

describe("design artifact sharing", () => {
  beforeEach(() => {
    state.share = null;
    state.attachmentId = "attachment-1";
    vi.clearAllMocks();
  });

  it("publishes an owned HTML attachment and keeps the bearer out of the request path", async () => {
    const published = await requestJson("owner", "POST", "/", {
      body: { attachmentId: "attachment-1", conversationId: "conv-1", title: "Checkout" },
    });

    expect(published.status).toBe(200);
    const path = String(published.body["data"].sharePath);
    expect(path).toMatch(/^\/claw\/v3\/design\/shared#[A-Za-z0-9_%~-]+$/);
    expect(path.split("#")[0]).toBe("/claw/v3/design/shared");
    expect(state.share?.["tokenHash"]).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(state.share)).not.toContain(decodeURIComponent(path.split("#")[1]!));
  });

  it("keeps a stable link while advancing the published attachment", async () => {
    const first = await requestJson("owner", "POST", "/", {
      body: { attachmentId: "attachment-1", conversationId: "conv-1" },
    });
    const firstPath = first.body["data"].sharePath;
    state.attachmentId = "attachment-2";
    const second = await requestJson("owner", "POST", "/", {
      body: { attachmentId: "attachment-2", conversationId: "conv-1" },
    });

    expect(second.body["data"].sharePath).toBe(firstPath);
    expect(state.share?.["attachmentId"]).toBe("attachment-2");
  });

  it("reports whether an upsert created or rotated the stable link", async () => {
    const { upsertDesignShare } = await import("./design-shares.js");
    const first = await upsertDesignShare({
      ownerUserId: "user-1",
      orgId: "org-1",
      conversationId: "conv-1",
      attachmentId: "attachment-1",
      title: "Dashboard",
      expiresAt: null,
    });
    const refreshed = await upsertDesignShare({
      ownerUserId: "user-1",
      orgId: "org-1",
      conversationId: "conv-1",
      attachmentId: "attachment-2",
      title: "Dashboard",
      expiresAt: null,
    });
    expect(first.linkChanged).toBe(true);
    expect(refreshed.linkChanged).toBe(false);
    expect(refreshed.sharePath).toBe(first.sharePath);
  });

  it("does not duplicate the /claw prefix when building an external share URL", async () => {
    const { designShareUrl } = await import("./design-shares.js");
    expect(designShareUrl("/claw/v3/design/shared#token")).toBe(
      "https://spaces.xyne.juspay.net/claw/v3/design/shared#token",
    );
    state.config.frontendUrl = "https://spaces.xyne.juspay.net";
    expect(designShareUrl("/claw/v3/design/shared#token")).toBe(
      "https://spaces.xyne.juspay.net/claw/v3/design/shared#token",
    );
  });

  it("serves metadata only for the bearer and fails closed after revocation", async () => {
    const published = await requestJson("owner", "POST", "/", {
      body: { attachmentId: "attachment-1", conversationId: "conv-1", title: "Checkout" },
    });
    const token = decodeURIComponent(String(published.body["data"].sharePath).split("#")[1]!);

    expect((await requestJson("public", "GET", "/metadata")).status).toBe(404);
    const visible = await requestJson("public", "GET", "/metadata", { token });
    expect(visible.status).toBe(200);
    expect(visible.body["data"]).toMatchObject({ title: "Checkout" });
    expect(visible.headers["cache-control"]).toBe("no-store");

    expect((await requestJson("owner", "DELETE", "/share-1")).status).toBe(200);
    expect((await requestJson("public", "GET", "/metadata", { token })).status).toBe(404);
  });

  it("does not publish an attachment outside the signed-in user's conversation", async () => {
    const result = await requestJson("owner", "POST", "/", {
      body: { attachmentId: "attachment-1", conversationId: "someone-elses-conversation" },
    });
    expect(result.status).toBe(404);
    expect(state.share).toBeNull();
  });
});
