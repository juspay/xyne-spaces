import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  redis: new Map<string, string>(),
  redisDown: false,
  refreshes: 0,
  refreshToken: "" as string | null,
  refreshStatus: 200,
}));

vi.mock("@prisma/client", () => ({
  PrismaClient: class {
    $extends() {
      return { $queryRaw: async () => (state.row ? [state.row] : []) };
    }
  },
}));
vi.mock("../db.js", () => ({
  prisma: {
    user: { findUnique: vi.fn(async () => null) },
    userSurfaceIdentity: { findMany: vi.fn(async () => []) },
  },
}));
vi.mock("../retry.js", () => ({ withRetry: (fn: () => unknown) => fn() }));
vi.mock("../config.js", () => ({
  CONFIG: {
    spacesDbUrl: "postgres://spaces",
    spacesInternalUrl: "http://spaces.internal",
    encryptionKey: Buffer.alloc(32, 7),
  },
}));
vi.mock("../redis.js", () => ({
  redisService: {
    getConnection: () => ({
      get: async (key: string) => {
        if (state.redisDown) throw new Error("redis down");
        return state.redis.get(key) ?? null;
      },
      set: async (key: string, value: string) => {
        if (state.redisDown) throw new Error("redis down");
        state.redis.set(key, value);
        return "OK";
      },
    }),
  },
}));
vi.mock("../logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const { getSpacesAuthForUser, clearSpacesTokenMemo } = await import("./spaces-db.js");

const jwt = (expSecondsFromNow: number, tag: string) =>
  [
    Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url"),
    Buffer.from(JSON.stringify({ sub: "u1", tag, exp: Math.floor(Date.now() / 1000) + expSecondsFromNow })).toString("base64url"),
    "sig",
  ].join(".");

beforeEach(() => {
  clearSpacesTokenMemo();
  state.row = { id: "sess-1", refreshTokenExpiry: new Date(Date.now() + 86_400_000), status: "ACTIVE", lastActivity: new Date(), workspaceId: "ws-1" };
  state.redis = new Map();
  state.redisDown = false;
  state.refreshes = 0;
  state.refreshToken = jwt(86_400, "first");
  state.refreshStatus = 200;
  globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
    state.refreshes += 1;
    expect((init?.headers as Record<string, string>)["cookie"]).toBe("user_session_id=sess-1");
    const headers = new Headers();
    if (state.refreshToken) headers.append("set-cookie", `xyne_ws_ws-1_token=${state.refreshToken}; Path=/; HttpOnly`);
    return new Response("{}", { status: state.refreshStatus, headers });
  }) as never;
});

describe("getSpacesAuthForUser token cache", () => {
  it("never hands out the session row's Google token, and refreshes only once per session", async () => {
    const first = await getSpacesAuthForUser("u1", "mcp-runner");
    const second = await getSpacesAuthForUser("u1", "webhook");
    expect(first).toEqual({ token: state.refreshToken, sessionId: "sess-1", workspaceId: "ws-1" });
    expect(second?.token).toBe(first?.token);
    expect(state.refreshes).toBe(1);
  });

  it("shares one refresh between concurrent reads", async () => {
    const results = await Promise.all([1, 2, 3, 4].map(() => getSpacesAuthForUser("u1", "mcp-runner")));
    expect(new Set(results.map((r) => r?.token)).size).toBe(1);
    expect(state.refreshes).toBe(1);
  });

  it("serves another pod's token from Redis, encrypted at rest", async () => {
    await getSpacesAuthForUser("u1", "mcp-runner");
    const stored = [...state.redis.values()][0]!;
    expect(stored).not.toContain(state.refreshToken!);
    clearSpacesTokenMemo();
    expect((await getSpacesAuthForUser("u1", "mcp-runner"))?.token).toBe(state.refreshToken);
    expect(state.refreshes).toBe(1);
  });

  it("refreshes again once the cached token is within five minutes of expiring", async () => {
    state.refreshToken = jwt(120, "short");
    await getSpacesAuthForUser("u1", "mcp-runner");
    state.refreshToken = jwt(86_400, "next");
    expect((await getSpacesAuthForUser("u1", "mcp-runner"))?.token).toBe(state.refreshToken);
    expect(state.refreshes).toBe(2);
  });

  it("keeps serving a still-valid token when the refresh fails", async () => {
    const short = jwt(120, "short");
    state.refreshToken = short;
    await getSpacesAuthForUser("u1", "mcp-runner");
    state.refreshStatus = 503;
    state.refreshToken = null;
    expect((await getSpacesAuthForUser("u1", "mcp-runner"))?.token).toBe(short);
  });

  it("returns null when there is no token at all and the refresh fails", async () => {
    state.refreshStatus = 503;
    state.refreshToken = null;
    expect(await getSpacesAuthForUser("u1", "mcp-runner")).toBeNull();
  });

  it("still works on memory alone when Redis is down", async () => {
    state.redisDown = true;
    await getSpacesAuthForUser("u1", "mcp-runner");
    await getSpacesAuthForUser("u1", "mcp-runner");
    expect(state.refreshes).toBe(1);
  });
});
