import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

const state = vi.hoisted(() => ({
  adminOrgs: new Set<string>(),
  members: new Set<string>(),
  surface: { id: "surface-api", key: "api" } as { id: string; key: string } | null,
  tokens: [] as Array<Record<string, unknown>>,
  lastFindManyArgs: null as unknown,
  lastUpdateManyArgs: null as unknown,
}));

vi.mock("../logger.js", () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }),
}));

vi.mock("../middleware/agent-acl.js", () => ({
  getRequesterId: (req: Request) => req.headers["x-user-id"] as string | undefined,
  isOrgAdmin: vi.fn(async (_userId: string, orgId: string) => state.adminOrgs.has(orgId)),
  isOrgOwner: vi.fn(async () => true),
}));

vi.mock("../repositories/index.js", () => ({
  userRepository: { findById: vi.fn(async () => null) },
}));

vi.mock("../lib/service-tokens.js", () => ({
  SERVICE_TOKEN_SCOPES: ["agents:read", "runs:read", "runs:write"],
  generateServiceToken: vi.fn(() => ({
    raw: "xyne_svc_raw-secret",
    hashed: "stored-hash",
    prefix: "xyne_svc_raw",
  })),
}));

vi.mock("../db.js", () => ({
  prisma: {
    orgMember: {
      findUnique: vi.fn(async (args: { where: { userId_orgId: { userId: string; orgId: string } } }) => {
        const { userId, orgId } = args.where.userId_orgId;
        return state.members.has(`${orgId}:${userId}`) ? { leftAt: null } : null;
      }),
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 1),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    surface: {
      findUnique: vi.fn(async (args: { where: { key: string } }) => {
        return state.surface?.key === args.where.key ? state.surface : null;
      }),
    },
    surfaceAccessToken: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        const row = {
          id: "token-1",
          name: args.data.name,
          prefix: args.data.prefix,
          userId: args.data.userId,
          lastUsedAt: null,
          expiresAt: args.data.expiresAt,
          revokedAt: null,
          createdAt: new Date("2026-07-20T00:00:00.000Z"),
          tokenHash: args.data.tokenHash,
          orgId: args.data.orgId,
          client: args.data.client,
        };
        state.tokens.push(row);
        const { tokenHash: _tokenHash, orgId: _orgId, client: _client, ...selected } = row;
        return selected;
      }),
      findMany: vi.fn(async (args: unknown) => {
        state.lastFindManyArgs = args;
        return state.tokens.map(({ tokenHash: _tokenHash, orgId: _orgId, client: _client, ...row }) => row);
      }),
      updateMany: vi.fn(async (args: { where: { id: string; orgId: string; client: string } }) => {
        state.lastUpdateManyArgs = args;
        const match = state.tokens.find((token) => token.id === args.where.id
          && token.orgId === args.where.orgId && token.client === args.where.client);
        return { count: match ? 1 : 0 };
      }),
    },
    organization: { findUnique: vi.fn() },
    user: { findFirst: vi.fn(), update: vi.fn() },
  },
}));

async function request(
  method: "GET" | "POST" | "DELETE",
  url: string,
  body: Record<string, unknown> = {},
  requesterId = "admin-1",
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { organizationsRouter } = await import("./organizations.js");
  return await new Promise((resolve, reject) => {
    let statusCode = 200;
    const req = {
      method,
      url,
      originalUrl: url,
      baseUrl: "",
      headers: { "x-user-id": requesterId },
      body,
    } as unknown as Request;
    const res = {
      status(code: number) { statusCode = code; return this; },
      json(payload: Record<string, unknown>) { resolve({ status: statusCode, body: payload }); return this; },
    } as unknown as Response;
    (organizationsRouter as unknown as { handle: (req: Request, res: Response, next: (err?: unknown) => void) => void })
      .handle(req, res, (err?: unknown) => err ? reject(err) : resolve({ status: 404, body: {} }));
  });
}

describe("organization service tokens", () => {
  beforeEach(() => {
    state.adminOrgs = new Set(["org-1"]);
    state.members = new Set(["org-1:service-user"]);
    state.surface = { id: "surface-api", key: "api" };
    state.tokens = [];
    state.lastFindManyArgs = null;
    state.lastUpdateManyArgs = null;
  });

  it("mints a token for a current member and returns the raw value once", async () => {
    const response = await request("POST", "/org-1/service-tokens", {
      name: "Billing worker",
      userId: "service-user",
      expiresAt: null,
    });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      success: true,
      data: { id: "token-1", name: "Billing worker", userId: "service-user", token: "xyne_svc_raw-secret" },
    });
    expect(state.tokens[0]).toMatchObject({
      orgId: "org-1",
      client: "service",
      tokenHash: "stored-hash",
    });
  });

  it("rejects a non-admin", async () => {
    state.adminOrgs.clear();
    const response = await request("POST", "/org-1/service-tokens", {
      name: "Worker",
      userId: "service-user",
    });
    expect(response.status).toBe(403);
    expect(state.tokens).toHaveLength(0);
  });

  it("returns 403 when an admin targets another organization", async () => {
    const response = await request("GET", "/org-2/service-tokens");
    expect(response.status).toBe(403);
    expect(state.lastFindManyArgs).toBeNull();
  });

  it("rejects a non-member userId", async () => {
    const response = await request("POST", "/org-1/service-tokens", {
      name: "Worker",
      userId: "other-user",
    });
    expect(response.status).toBe(400);
    expect(response.body["error"]).toContain("current member");
  });

  it("lists only org-scoped service metadata without tokenHash", async () => {
    state.tokens = [{
      id: "token-1", name: "Worker", prefix: "xyne_svc_raw", userId: "service-user",
      lastUsedAt: null, expiresAt: null, revokedAt: null,
      createdAt: new Date("2026-07-20T00:00:00.000Z"), tokenHash: "secret-hash",
      orgId: "org-1", client: "service",
    }];
    const response = await request("GET", "/org-1/service-tokens");

    expect(response.status).toBe(200);
    expect(state.lastFindManyArgs).toMatchObject({ where: { orgId: "org-1", client: "service" } });
    expect(state.lastFindManyArgs).not.toHaveProperty("select.tokenHash");
    expect(response.body).not.toHaveProperty("data.0.tokenHash");
  });

  it("revokes only a service token in the requested org", async () => {
    state.tokens = [{ id: "token-1", orgId: "org-1", client: "service" }];
    const response = await request("DELETE", "/org-1/service-tokens/token-1");

    expect(response.status).toBe(200);
    expect(state.lastUpdateManyArgs).toMatchObject({
      where: { id: "token-1", orgId: "org-1", client: "service" },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it("returns 404 instead of revoking another org's token", async () => {
    state.tokens = [{ id: "token-2", orgId: "org-2", client: "service" }];
    const response = await request("DELETE", "/org-1/service-tokens/token-2");
    expect(response.status).toBe(404);
  });
});
