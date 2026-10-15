import { beforeEach, describe, expect, it, vi } from "vitest";

// Focused tests for the user-row refresh routing in loadEffectiveCredentials:
// OAuth connectors with a registered provider but no hand-written refresh in
// credentials-refresh.ts (notion-remote, sentry-remote, …) refresh through the
// provider; everything else keeps going through getFreshCredentials.

const state = vi.hoisted(() => ({
  providers: {} as Record<string, { serverType: string; label: string }>,
  dedicated: new Set<string>(),
  resolveImpl: (async () => null) as (...args: any[]) => Promise<unknown>,
  stored: { accessToken: "stale", refreshToken: "r", expires: 0 } as Record<string, unknown>,
}));

vi.mock("../config.js", () => ({ CONFIG: { encryptionKey: Buffer.alloc(32, 7) } }));
vi.mock("../logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock("./errors.js", () => ({ errMsg: (e: unknown) => String(e) }));
vi.mock("../crypto.js", () => ({ decrypt: () => JSON.stringify(state.stored) }));
vi.mock("./oauth-server-types.js", () => ({ OAUTH_SERVER_TYPES: new Set<string>() }));
vi.mock("../routes/oauth-token.js", () => ({
  getOAuthProvider: (type: string) => state.providers[type],
}));
vi.mock("./oauth-token-endpoint.js", () => ({
  resolveFreshOAuthCreds: vi.fn((...a: any[]) => state.resolveImpl(...a)),
  TokenRefreshError: class extends Error {},
}));
vi.mock("./credentials-refresh.js", () => ({
  getFreshCredentials: vi.fn(async () => ({ from: "getFreshCredentials" })),
  hasDedicatedRefresh: (type: string) => state.dedicated.has(type),
}));
vi.mock("./spaces-db.js", () => ({
  getSpacesAuthForUser: vi.fn(async () => null),
  getWorkspaceIdForUser: vi.fn(async () => null),
}));
vi.mock("../db.js", () => ({
  prisma: {
    userMcpConnection: {
      findFirst: vi.fn(async () => ({ id: "conn-1", encryptedCreds: "e", iv: "i", authTag: "t", mcpServer: {} })),
    },
  },
}));

import { loadEffectiveCredentials } from "./credentials-loader.js";
import { getFreshCredentials } from "./credentials-refresh.js";
import { resolveFreshOAuthCreds } from "./oauth-token-endpoint.js";

beforeEach(() => {
  vi.clearAllMocks();
  state.providers = {};
  state.dedicated = new Set();
  state.resolveImpl = async () => null;
});

describe("loadEffectiveCredentials — OAuth refresh routing", () => {
  it("refreshes a provider-registered connector through its provider", async () => {
    state.providers["sentry-remote"] = { serverType: "sentry-remote", label: "Sentry" };
    state.resolveImpl = async () => ({ accessToken: "fresh", refreshToken: "r2", expires: Date.now() + 3_600_000 });

    const res = await loadEffectiveCredentials("user-1", "sentry-remote");

    expect(res?.source).toBe("user");
    expect(res?.connectionId).toBe("conn-1");
    expect(res?.credentials["accessToken"]).toBe("fresh");
    expect(resolveFreshOAuthCreds).toHaveBeenCalledWith(state.providers["sentry-remote"], "user-1");
    expect(getFreshCredentials).not.toHaveBeenCalled();
  });

  it("keeps the stored creds when the provider refresh fails", async () => {
    state.providers["mixpanel-remote"] = { serverType: "mixpanel-remote", label: "Mixpanel" };
    state.resolveImpl = async () => {
      throw new Error("invalid_grant");
    };

    const res = await loadEffectiveCredentials("user-1", "mixpanel-remote");

    expect(res?.credentials).toEqual(state.stored);
  });

  it("leaves types with a hand-written refresh on getFreshCredentials", async () => {
    state.providers["honeycomb"] = { serverType: "honeycomb", label: "Honeycomb" };
    state.dedicated.add("honeycomb");

    const res = await loadEffectiveCredentials("user-1", "honeycomb");

    expect(res?.credentials).toEqual({ from: "getFreshCredentials" });
    expect(resolveFreshOAuthCreds).not.toHaveBeenCalled();
  });

  it("leaves non-OAuth connectors on getFreshCredentials", async () => {
    const res = await loadEffectiveCredentials("user-1", "grafana");

    expect(res?.credentials).toEqual({ from: "getFreshCredentials" });
    expect(resolveFreshOAuthCreds).not.toHaveBeenCalled();
  });
});
