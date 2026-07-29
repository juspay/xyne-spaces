import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

const state = vi.hoisted(() => ({
  redis: new Map<string, string>(),
  user: { orgId: "org-1", email: "owner@example.com" } as { orgId: string | null; email: string } | null,
  surface: { id: "surface-cli" } as { id: string } | null,
  surfaceAccessTokens: [] as Array<Record<string, unknown>>,
  generatedCount: 0,
  config: {
    cliTokensEnabled: true,
    spacesAppUrl: "https://spaces.example",
  },
}));

vi.mock("../config.js", () => ({
  CONFIG: state.config,
}));

vi.mock("../logger.js", () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock("../lib/cli-tokens.js", () => ({
  generate: vi.fn(() => {
    state.generatedCount += 1;
    return {
      raw: `xyne_cli_raw_${state.generatedCount}`,
      hashed: `hashed_${state.generatedCount}`,
      prefix: "xyne_cli_raw",
    };
  }),
}));

vi.mock("../middleware/require-auth.js", () => ({
  requireUserAuth: vi.fn((req, _res, next) => {
    req.headers["x-user-id"] = "user-1";
    next();
  }),
}));

vi.mock("../middleware/agent-acl.js", () => ({
  getRequesterId: vi.fn((req) => req.headers["x-user-id"]),
}));

vi.mock("../db.js", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async () => state.user),
    },
    surface: {
      findUnique: vi.fn(async () => state.surface),
    },
    surfaceAccessToken: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        state.surfaceAccessTokens.push(args.data);
        return { id: `sat-${state.surfaceAccessTokens.length}`, ...args.data };
      }),
      findMany: vi.fn(async () => []),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
  },
}));

vi.mock("../redis.js", () => {
  const redis = {
    incr: vi.fn(async (key: string) => {
      const next = Number(state.redis.get(key) ?? "0") + 1;
      state.redis.set(key, String(next));
      return next;
    }),
    expire: vi.fn(async () => 1),
    get: vi.fn(async (key: string) => state.redis.get(key) ?? null),
    getdel: vi.fn(async (key: string) => {
      const value = state.redis.get(key) ?? null;
      state.redis.delete(key);
      return value;
    }),
    set: vi.fn(async (key: string, value: string, ...args: string[]) => {
      if (args.includes("NX") && state.redis.has(key)) return null;
      state.redis.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (...keys: string[]) => {
      let count = 0;
      for (const key of keys) {
        if (state.redis.delete(key)) count += 1;
      }
      return count;
    }),
    multi: vi.fn(() => {
      const writes: Array<[string, string]> = [];
      return {
        set(key: string, value: string) {
          writes.push([key, value]);
          return this;
        },
        async exec() {
          for (const [key, value] of writes) state.redis.set(key, value);
          return writes.map(() => ["OK"]);
        },
      };
    }),
  };
  return {
    redisService: {
      getConnection: () => redis,
    },
  };
});

async function requestJson(path: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const { cliAuthRouter } = await import("./cli-auth.js");
  return await new Promise((resolve, reject) => {
    let statusCode = 200;
    const req = {
      method: "POST",
      url: path,
      originalUrl: path,
      headers: {},
      body,
      ip: "127.0.0.1",
      socket: { remoteAddress: "127.0.0.1" },
    } as unknown as Request;
    const res = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(payload: Record<string, unknown>) {
        resolve({ status: statusCode, body: payload });
        return this;
      },
    } as unknown as Response;
    (cliAuthRouter as unknown as { handle: (req: Request, res: Response, next: (err?: unknown) => void) => void })
      .handle(req, res, (err?: unknown) => {
        if (err) reject(err);
        else resolve({ status: 404, body: {} });
      });
  });
}

describe("cli-auth routes", () => {
  beforeEach(() => {
    state.redis.clear();
    state.user = { orgId: "org-1", email: "owner@example.com" };
    state.surface = { id: "surface-cli" };
    state.surfaceAccessTokens = [];
    state.generatedCount = 0;
    state.config.cliTokensEnabled = true;
  });

  it("mints the CLI PAT only on the first successful token poll", async () => {
    const start = await requestJson("/auth/start", { clientId: "xyne-cli" });
    expect(start.status).toBe(200);
    const deviceCode = start.body["deviceCode"];
    const userCode = start.body["userCode"];
    expect(typeof deviceCode).toBe("string");
    expect(typeof userCode).toBe("string");

    const approve = await requestJson("/auth/approve", { userCode });
    expect(approve).toEqual({ status: 200, body: { success: true } });
    expect(state.generatedCount).toBe(0);
    expect(state.surfaceAccessTokens).toHaveLength(0);

    const approvedRaw = state.redis.get(`cli:auth:device:${deviceCode as string}`);
    expect(approvedRaw).toBeTruthy();
    expect(JSON.parse(approvedRaw!)).toMatchObject({
      status: "approved",
      userId: "user-1",
      orgId: "org-1",
      email: "owner@example.com",
    });
    expect(approvedRaw).not.toContain("xyne_cli_raw");
    expect(approvedRaw).not.toContain("\"token\"");

    const firstPoll = await requestJson("/auth/token", { clientId: "xyne-cli", deviceCode });
    expect(firstPoll).toEqual({
      status: 200,
      body: { token: "xyne_cli_raw_1", userId: "user-1", email: "owner@example.com" },
    });
    expect(state.surfaceAccessTokens).toHaveLength(1);
    expect(state.surfaceAccessTokens[0]).toMatchObject({
      userId: "user-1",
      orgId: "org-1",
      surfaceId: "surface-cli",
      client: "xyne-cli",
      tokenHash: "hashed_1",
      prefix: "xyne_cli_raw",
      scopes: ["agents:read", "runs:read", "runs:write"],
    });

    const secondPoll = await requestJson("/auth/token", { clientId: "xyne-cli", deviceCode });
    expect(secondPoll.status).toBe(400);
    expect(secondPoll.body["error"]).toBeTruthy();
    expect(state.generatedCount).toBe(1);
    expect(state.surfaceAccessTokens).toHaveLength(1);
  });

  it("returns 404 from /cli/auth/start and writes nothing when CLI tokens are disabled", async () => {
    state.config.cliTokensEnabled = false;

    const start = await requestJson("/auth/start", { clientId: "xyne-cli" });

    expect(start.status).toBe(404);
    expect(start.body).toEqual({ error: "not_found" });
    expect(state.redis.size).toBe(0);
    expect(state.surfaceAccessTokens).toHaveLength(0);
  });
});
