import { beforeEach, describe, expect, it, vi } from "vitest";

process.env["ENCRYPTION_KEY"] = "00".repeat(32);

const state = vi.hoisted(() => ({
  connection: null as Record<string, any> | null,
  updates: [] as Array<Record<string, any>>,
}));

vi.mock("../logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock("../lib/cron-leader-lock.js", () => ({ acquireCronLeaderLock: vi.fn(async () => true) }));

vi.mock("../db.js", () => {
  const tx = {
    $executeRaw: vi.fn(async () => 1),
    connectedSurface: {
      findUnique: vi.fn(async () => state.connection),
      update: vi.fn(async (args: Record<string, any>) => {
        state.updates.push(args);
        if (state.connection) state.connection.config = args.data.config;
        return state.connection;
      }),
    },
  };
  return {
    prisma: {
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
      surface: { findUnique: vi.fn(async () => null) },
      connectedSurface: { findMany: vi.fn(async () => []) },
    },
  };
});

describe("Slack configuration token rotation", () => {
  beforeEach(() => {
    state.connection = null;
    state.updates = [];
    vi.unstubAllGlobals();
  });

  it("consumes one refresh token and atomically persists the replacement pair", async () => {
    const { decryptSurfaceSecret, encryptSurfaceSecret } = await import("../lib/surface-resolver.js");
    state.connection = {
      id: "connection-1",
      config: {
        configAccessToken: encryptSurfaceSecret("xoxe.xoxp-old-access"),
        configRefreshToken: encryptSurfaceSecret("xoxe-1-old-refresh"),
        configTokenStatus: "valid",
      },
    };
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = init.body as URLSearchParams;
      expect(body.get("refresh_token")).toBe("xoxe-1-old-refresh");
      return new Response(JSON.stringify({
        ok: true,
        token: "xoxe.xoxp-new-access",
        refresh_token: "xoxe-1-new-refresh",
        exp: 1_800_000_000,
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { rotateStoredSlackConfigToken } = await import("./slackConfigTokenService.js");
    await expect(rotateStoredSlackConfigToken("connection-1")).resolves.toBe("xoxe.xoxp-new-access");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(state.updates).toHaveLength(1);
    const written = state.updates[0]!.data.config as Record<string, unknown>;
    expect(decryptSurfaceSecret(written["configAccessToken"] as string)).toBe("xoxe.xoxp-new-access");
    expect(decryptSurfaceSecret(written["configRefreshToken"] as string)).toBe("xoxe-1-new-refresh");
    expect(written["configTokenStatus"]).toBe("valid");
    expect(JSON.stringify(state.updates)).not.toContain("xoxe-1-new-refresh");
  });

  it("marks the pair expired when Slack rejects the single-use refresh token", async () => {
    const { encryptSurfaceSecret } = await import("../lib/surface-resolver.js");
    state.connection = {
      id: "connection-1",
      config: {
        configAccessToken: encryptSurfaceSecret("xoxe.xoxp-old-access"),
        configRefreshToken: encryptSurfaceSecret("xoxe-1-used-refresh"),
        configTokenStatus: "valid",
      },
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      ok: false, error: "invalid_refresh_token",
    }), { status: 200, headers: { "Content-Type": "application/json" } })));
    const { rotateStoredSlackConfigToken } = await import("./slackConfigTokenService.js");
    await expect(rotateStoredSlackConfigToken("connection-1")).rejects.toThrow("invalid_refresh_token");
    expect(state.updates.at(-1)?.data.config.configTokenStatus).toBe("expired");
  });

  it("leaves a valid stored pair untouched when rotation throws a network error", async () => {
    const { encryptSurfaceSecret } = await import("../lib/surface-resolver.js");
    state.connection = {
      id: "connection-1",
      config: {
        configAccessToken: encryptSurfaceSecret("xoxe.xoxp-old-access"),
        configRefreshToken: encryptSurfaceSecret("xoxe-1-retryable-refresh"),
        configTokenStatus: "valid",
      },
    };
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("network unavailable");
    }));

    const { rotateStoredSlackConfigToken } = await import("./slackConfigTokenService.js");
    await expect(rotateStoredSlackConfigToken("connection-1")).rejects.toThrow("network unavailable");
    expect(state.updates).toHaveLength(0);
    expect(state.connection.config.configTokenStatus).toBe("valid");
  });
});
