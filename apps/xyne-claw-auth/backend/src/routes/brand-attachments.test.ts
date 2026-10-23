import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

/**
 * The ACL and the validation boundary on the brand-extraction attachment
 * routes. `brand.json` is model-written inside a sandbox and its colours end
 * up as inline style values, so "a malformed payload is refused" is a security
 * property, not a nicety.
 */

const state = vi.hoisted(() => ({
  attachments: [] as Array<Record<string, any>>,
  objects: new Map<string, string>(),
  admins: new Set<string>(),
  updates: [] as Array<{ id: string; metadata: Record<string, unknown> }>,
  designSystems: [] as Array<Record<string, any>>,
  users: [] as Array<Record<string, any>>,
}));

vi.mock("../db.js", () => ({
  prisma: {
    user: {
      findFirst: vi.fn(async (args: any) =>
        state.users.find((u) => u["id"] === args?.where?.id) ?? null,
      ),
    },
    chatAttachment: {
      update: vi.fn(async (args: any) => {
        state.updates.push({ id: args.where.id, metadata: args.data.metadata });
        const row = state.attachments.find((a) => a["id"] === args.where.id);
        if (row) row["metadata"] = args.data.metadata;
        return row;
      }),
    },
  },
}));

vi.mock("../repositories/index.js", () => ({
  chatAttachmentRepository: {
    findById: vi.fn(async (id: string) => state.attachments.find((a) => a["id"] === id) ?? null),
  },
  designSystemRepository: {
    findById: vi.fn(async (id: string, orgId: string) =>
      state.designSystems.find((d) => d["id"] === id && d["orgId"] === orgId) ?? null,
    ),
  },
}));

vi.mock("../services/storageService.js", () => ({
  gcsService: {
    getFileBuffer: vi.fn(async (path: string) => Buffer.from(state.objects.get(path) ?? "", "utf8")),
    getMetadata: vi.fn(async (path: string) => ({
      size: Buffer.byteLength(state.objects.get(path) ?? ""),
      contentType: "application/json",
    })),
  },
}));

vi.mock("../middleware/agent-acl.js", () => ({
  getRequesterId: (req: Request) => req.headers["x-user-id"],
  getOrgId: (req: Request) => req.headers["x-org-id"],
  isClawAdmin: vi.fn(async (id: string) => state.admins.has(id)),
}));

vi.mock("../middleware/pin-user-id-param.js", () => ({
  matchesAuthenticatedUserId: (req: Request, id: string) => req.headers["x-user-id"] === id,
}));

vi.mock("../logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const OWNER = "user-owner";
const ORG = "org-1";
const ADMIN = "user-admin";
const STRANGER = "user-stranger";

const VALID_SUMMARY = JSON.stringify({
  version: 1,
  name: "Stripe",
  source: "url",
  sourceUrl: "https://stripe.com",
  extractedAt: "2026-10-21T00:00:00.000Z",
  colors: [{ hex: "#635BFF", token: "brand-primary", role: "primary" }],
  fonts: [{ family: "Inter", role: "body" }],
  typeScale: [{ name: "body", sizePx: 16 }],
});

async function call(
  method: "GET" | "POST",
  url: string,
  opts: { userId?: string | null; orgId?: string | null; body?: Record<string, unknown> } = {},
): Promise<{ status: number; body: Record<string, any> }> {
  const { brandAttachmentsRouter } = await import("./brand-attachments.js");
  return await new Promise((resolve, reject) => {
    let statusCode = 200;
    const headers: Record<string, string> = {};
    if (opts.userId !== null) headers["x-user-id"] = opts.userId ?? OWNER;
    if (opts.orgId !== null) headers["x-org-id"] = opts.orgId ?? ORG;

    const req = { method, url, originalUrl: url, headers, body: opts.body ?? {}, query: {} } as unknown as Request;
    const res = {
      status(code: number) { statusCode = code; return this; },
      setHeader() { return this; },
      json(payload: Record<string, any>) { resolve({ status: statusCode, body: payload }); return this; },
    } as unknown as Response;

    (brandAttachmentsRouter as unknown as {
      handle: (req: Request, res: Response, next: (err?: unknown) => void) => void;
    }).handle(req, res, (err?: unknown) => {
      if (err) reject(err);
      else resolve({ status: 404, body: { success: false, error: "no route" } });
    });
  });
}

beforeEach(() => {
  state.designSystems = [{ id: "ds-1", orgId: ORG, name: "Saved" }];
  state.users = [{ id: OWNER, orgId: ORG }];
  state.objects = new Map([
    ["gcs/valid.json", VALID_SUMMARY],
    ["gcs/invalid.json", JSON.stringify({ version: 1, name: "X", source: "url", colors: "nope" })],
    ["gcs/gaps-string.json", JSON.stringify({ ...JSON.parse(VALID_SUMMARY), gaps: "none" })],
  ]);
  state.attachments = [
    { id: "att-valid", uploaderUserId: OWNER, url: "gcs/valid.json", originalFilename: "brand.json", mimeType: "application/json", size: Buffer.byteLength(VALID_SUMMARY), metadata: null },
    { id: "att-invalid", uploaderUserId: OWNER, url: "gcs/invalid.json", originalFilename: "brand.json", mimeType: "application/json", size: 40, metadata: null },
    { id: "att-gaps", uploaderUserId: OWNER, url: "gcs/gaps-string.json", originalFilename: "brand.json", mimeType: "application/json", size: null, metadata: null },
    { id: "att-huge", uploaderUserId: OWNER, url: "gcs/valid.json", originalFilename: "brand.json", mimeType: "application/json", size: 900_000, metadata: null },
  ];
  state.admins = new Set([ADMIN]);
  state.updates = [];
  vi.clearAllMocks();
});

describe("GET /attachments/:id/brand-summary", () => {
  it("requires an authenticated user", async () => {
    expect((await call("GET", "/attachments/att-valid/brand-summary", { userId: null })).status).toBe(401);
  });

  it("404s an attachment that does not exist", async () => {
    expect((await call("GET", "/attachments/nope/brand-summary")).status).toBe(404);
  });

  it("403s a caller who is neither uploader nor admin", async () => {
    expect((await call("GET", "/attachments/att-valid/brand-summary", { userId: STRANGER })).status).toBe(403);
  });

  it("lets the uploader read it", async () => {
    const res = await call("GET", "/attachments/att-valid/brand-summary");
    expect(res.status).toBe(200);
    expect(res.body["data"]).toMatchObject({ name: "Stripe", source: "url" });
  });

  it("lets a claw admin read someone else's", async () => {
    expect((await call("GET", "/attachments/att-valid/brand-summary", { userId: ADMIN })).status).toBe(200);
  });

  it("422s a payload that is not a brand summary", async () => {
    const res = await call("GET", "/attachments/att-invalid/brand-summary");
    expect(res.status).toBe(422);
    expect(res.body["error"]).toBe("Not a valid brand summary");
  });

  it('422s `gaps: "none"` — the shape that used to crash the thread', async () => {
    // Passed the old validator, then threw inside render on every reload.
    expect((await call("GET", "/attachments/att-gaps/brand-summary")).status).toBe(422);
  });

  it("413s an attachment larger than the cap", async () => {
    expect((await call("GET", "/attachments/att-huge/brand-summary")).status).toBe(413);
  });

  it("still enforces the cap when size is null, via object metadata", async () => {
    // `att.size` is nullable and a null slipped past the old truthiness check,
    // skipping the cap entirely.
    const { gcsService } = await import("../services/storageService.js");
    vi.mocked(gcsService.getMetadata).mockResolvedValueOnce({ size: 900_000, contentType: "application/json" });
    expect((await call("GET", "/attachments/att-gaps/brand-summary")).status).toBe(413);
  });

  it("reports nothing saved for a fresh attachment", async () => {
    const res = await call("GET", "/attachments/att-valid/brand-summary");
    expect(res.body["savedDesignSystemId"]).toBeNull();
  });

  it("reports the saved id once one is recorded", async () => {
    state.attachments[0]!["metadata"] = { savedDesignSystemId: "ds-1" };
    const res = await call("GET", "/attachments/att-valid/brand-summary");
    expect(res.body["savedDesignSystemId"]).toBe("ds-1");
  });

  // XYNE-66828. The summary deliberately carries NO contrast audit. It used to,
  // computed from brand.json colours, but a saved system is audited from its
  // tokens.css and the two read a palette differently: a token named outside
  // the known slot list was flagged on the card via its ROLE and then clean
  // once saved, so the warning badge vanished at the moment it mattered. The
  // card audits the token CSS it is about to store instead.
  it("carries no contrast audit, so the card cannot disagree with the saved system", async () => {
    const res = await call("GET", "/attachments/att-valid/brand-summary");
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty("contrast");
    expect(res.body["data"]).toMatchObject({ name: "Stripe" });
  });
});

describe("POST /attachments/:id/brand-saved", () => {
  it("requires an authenticated user", async () => {
    expect((await call("POST", "/attachments/att-valid/brand-saved", { userId: null, body: { designSystemId: "ds-1" } })).status).toBe(401);
  });

  it("400s without a designSystemId", async () => {
    expect((await call("POST", "/attachments/att-valid/brand-saved", { body: {} })).status).toBe(400);
    expect((await call("POST", "/attachments/att-valid/brand-saved", { body: { designSystemId: "  " } })).status).toBe(400);
  });

  it("403s a stranger", async () => {
    const res = await call("POST", "/attachments/att-valid/brand-saved", { userId: STRANGER, body: { designSystemId: "ds-1" } });
    expect(res.status).toBe(403);
    expect(state.updates).toHaveLength(0);
  });

  it("records the id against the attachment", async () => {
    const res = await call("POST", "/attachments/att-valid/brand-saved", { body: { designSystemId: "ds-1" } });
    expect(res.status).toBe(200);
    expect(res.body["data"]).toMatchObject({ savedDesignSystemId: "ds-1", alreadySaved: false });
    expect(state.updates[0]?.metadata).toMatchObject({ savedDesignSystemId: "ds-1" });
  });

  it("keeps the FIRST id on a second save, so a double-click cannot duplicate", async () => {
    await call("POST", "/attachments/att-valid/brand-saved", { body: { designSystemId: "ds-1" } });
    state.updates = [];
    const res = await call("POST", "/attachments/att-valid/brand-saved", { body: { designSystemId: "ds-2" } });

    expect(res.body["data"]).toMatchObject({ savedDesignSystemId: "ds-1", alreadySaved: true });
    expect(state.updates).toHaveLength(0);
  });

  it("preserves unrelated metadata already on the attachment", async () => {
    state.attachments[0]!["metadata"] = { reactArtifact: { entry: "index.html" } };
    await call("POST", "/attachments/att-valid/brand-saved", { body: { designSystemId: "ds-1" } });
    expect(state.updates[0]?.metadata).toMatchObject({
      reactArtifact: { entry: "index.html" },
      savedDesignSystemId: "ds-1",
    });
  });
});

describe("hardening from the #3258 review", () => {
  it("refuses a design system id that is not in the caller's org", async () => {
    const got = await call("POST", "/attachments/att-valid/brand-saved", {
      body: { designSystemId: "ds-elsewhere" },
    });

    expect(got.status).toBe(404);
    expect(state.updates).toHaveLength(0);
  });

  it("refuses a design system from another org", async () => {
    state.designSystems = [{ id: "ds-other", orgId: "org-2", name: "Theirs" }];

    const got = await call("POST", "/attachments/att-valid/brand-saved", {
      body: { designSystemId: "ds-other" },
    });

    expect(got.status).toBe(404);
    expect(state.updates).toHaveLength(0);
  });

  it("refuses a summary whose size cannot be determined, rather than reading it whole", async () => {
    // A null size used to fall back to 0, which passed the cap and then read
    // the entire object into memory.
    const att = state.attachments.find((a) => a["id"] === "att-valid")!;
    att["size"] = null;
    const { gcsService } = await import("../services/storageService.js");
    vi.mocked(gcsService.getMetadata).mockRejectedValueOnce(new Error("no metadata"));

    const got = await call("GET", "/attachments/att-valid/brand-summary");

    expect(got.status).toBe(413);
  });
});
