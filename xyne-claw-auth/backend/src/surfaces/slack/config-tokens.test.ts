import { beforeEach, describe, expect, it, vi } from "vitest";

vi.stubEnv("ENCRYPTION_KEY", "00".repeat(32));

const state = vi.hoisted(() => ({
  connection: null as Record<string, any> | null,
  updates: [] as Array<Record<string, any>>,
  rotate: vi.fn(),
}));

vi.mock("../../logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

// Only the client factory is faked. slackErrorCode stays REAL: it is the
// accessor that reads Slack's code from `.data.error` (WebClient's own `.code`
// is the SDK category), and a regression there would silently stop every
// terminal-error branch from matching.
vi.mock("./api.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api.js")>()),
  slackClientWithoutToken: () => ({ tooling: { tokens: { rotate: state.rotate } } }),
}));

vi.mock("../../db.js", () => {
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

/** A WebClient platform error: Slack's code lives at `.data.error`. */
function slackPlatformError(code: string): Error & { data: { ok: false; error: string } } {
  return Object.assign(new Error(`An API error occurred: ${code}`), {
    data: { ok: false as const, error: code },
  });
}

async function storedConnection(refreshToken: string) {
  const { encryptSurfaceSecret } = await import("../../lib/surface-resolver.js");
  return {
    id: "connection-1",
    config: {
      configAccessToken: encryptSurfaceSecret("xoxe.xoxp-old-access"),
      configRefreshToken: encryptSurfaceSecret(refreshToken),
      configTokenStatus: "valid",
    },
  };
}

describe("Slack configuration token rotation", () => {
  beforeEach(() => {
    state.connection = null;
    state.updates = [];
    state.rotate.mockReset();
  });

  it("consumes one refresh token and atomically persists the replacement pair", async () => {
    const { decryptSurfaceSecret } = await import("../../lib/surface-resolver.js");
    state.connection = await storedConnection("xoxe-1-old-refresh");
    state.rotate.mockResolvedValue({
      ok: true,
      token: "xoxe.xoxp-new-access",
      refresh_token: "xoxe-1-new-refresh",
      exp: 1_800_000_000,
    });

    const { rotateStoredSlackConfigToken } = await import("./config-tokens.js");
    await expect(rotateStoredSlackConfigToken("connection-1")).resolves.toBe("xoxe.xoxp-new-access");

    expect(state.rotate).toHaveBeenCalledTimes(1);
    expect(state.rotate).toHaveBeenCalledWith({ refresh_token: "xoxe-1-old-refresh" });
    expect(state.updates).toHaveLength(1);
    const written = state.updates[0]!.data.config as Record<string, unknown>;
    expect(decryptSurfaceSecret(written["configAccessToken"] as string)).toBe("xoxe.xoxp-new-access");
    expect(decryptSurfaceSecret(written["configRefreshToken"] as string)).toBe("xoxe-1-new-refresh");
    expect(written["configTokenStatus"]).toBe("valid");
    // Persisted encrypted, never in the clear.
    expect(JSON.stringify(state.updates)).not.toContain("xoxe-1-new-refresh");
  });

  it("marks the pair expired when Slack rejects the single-use refresh token", async () => {
    state.connection = await storedConnection("xoxe-1-used-refresh");
    state.rotate.mockRejectedValue(slackPlatformError("invalid_refresh_token"));

    const { rotateStoredSlackConfigToken } = await import("./config-tokens.js");
    await expect(rotateStoredSlackConfigToken("connection-1")).rejects.toThrow("invalid_refresh_token");
    // Written INSIDE the transaction before the rethrow — a throw would have
    // rolled this back and left the system retrying a dead token forever.
    expect(state.updates.at(-1)?.data.config.configTokenStatus).toBe("expired");
  });

  it("leaves a valid stored pair untouched when rotation throws a network error", async () => {
    state.connection = await storedConnection("xoxe-1-retryable-refresh");
    state.rotate.mockRejectedValue(new TypeError("network unavailable"));

    const { rotateStoredSlackConfigToken } = await import("./config-tokens.js");
    await expect(rotateStoredSlackConfigToken("connection-1")).rejects.toThrow("network unavailable");
    expect(state.updates).toHaveLength(0);
    expect(state.connection!.config.configTokenStatus).toBe("valid");
  });

  it("rejects a malformed token pair rather than persisting it", async () => {
    state.connection = await storedConnection("xoxe-1-old-refresh");
    state.rotate.mockResolvedValue({ ok: true, token: "not-a-slack-token", refresh_token: "also-wrong" });

    const { rotateStoredSlackConfigToken } = await import("./config-tokens.js");
    await expect(rotateStoredSlackConfigToken("connection-1")).rejects.toThrow("invalid configuration token");
    expect(state.updates).toHaveLength(0);
  });
});
