import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../config.js", () => ({
  CONFIG: {
    encryptionKey: Buffer.alloc(32),
    oauthStateSigningKey: Buffer.alloc(32),
    legacyOauthStateSigningKey: Buffer.alloc(32),
  },
}));
vi.mock("../db.js", () => ({ prisma: {} }));
vi.mock("../crypto.js", () => ({ encrypt: () => ({ ciphertext: "c", iv: "i", authTag: "a" }) }));
vi.mock("../tool-sync.js", () => ({ syncToolsForServer: vi.fn() }));
vi.mock("../mcp/runner.js", () => ({ evictSession: vi.fn(async () => {}) }));

process.env["OAUTH_STATE_SECRET"] ||= "test-oauth-state-secret";
process.env["ENCRYPTION_KEY"] ||= "00".repeat(32);

const { createMcpOAuthProvider } = await import("./mcp-oauth-provider.js");

const server = { name: "T", url: "https://x/", description: "d", writeToolPolicy: {}, healthcheckSpec: {} };
const confidential = createMcpOAuthProvider({
  type: "conf", label: "Conf", registerUrl: "https://x/register", authUrl: "https://x/authorize", tokenUrl: "https://x/token",
  confidential: true, scope: "a b", server,
});
const publicClient = createMcpOAuthProvider({
  type: "pub", label: "Pub", registerUrl: "https://y/register", authUrl: "https://y/authorize", tokenUrl: "https://y/token",
  confidential: false, server,
});

function mockFetchOnce(json: unknown): void {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(json), { status: 200 })));
}

function lastFetchBody(): URLSearchParams {
  const f = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>);
  const init = f.mock.calls[0]![1] as RequestInit;
  return init.body as URLSearchParams;
}

afterEach(() => vi.unstubAllGlobals());

describe("createMcpOAuthProvider — exports", () => {
  it("returns a router, callbackRouter, and a provider keyed by type", () => {
    expect(typeof confidential.router).toBe("function");
    expect(typeof confidential.callbackRouter).toBe("function");
    expect(confidential.provider.serverType).toBe("conf");
    expect(confidential.provider.label).toBe("Conf");
    expect(publicClient.provider.serverType).toBe("pub");
  });
});

describe("provider.refresh — confidential client", () => {
  beforeEach(() => mockFetchOnce({ access_token: "AT2", refresh_token: "RT2", expires_in: 3600 }));

  it("sends client_secret in the refresh body and keeps it in the returned creds", async () => {
    const out = await confidential.provider.refresh({ clientId: "cid", clientSecret: "sec", refreshToken: "RT1" } as never);
    const body = lastFetchBody();
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("client_id")).toBe("cid");
    expect(body.get("client_secret")).toBe("sec");
    expect(body.get("refresh_token")).toBe("RT1");
    expect(out).toMatchObject({ clientId: "cid", clientSecret: "sec", accessToken: "AT2", refreshToken: "RT2" });
  });
});

describe("provider.refresh — public client", () => {
  beforeEach(() => mockFetchOnce({ access_token: "AT2", expires_in: 3600 }));

  it("NEVER sends client_secret and returns no clientSecret", async () => {
    const out = await publicClient.provider.refresh({ clientId: "cid", refreshToken: "RT1" } as never);
    const body = lastFetchBody();
    expect(body.get("client_secret")).toBeNull();
    expect(body.get("client_id")).toBe("cid");
    expect(out).not.toHaveProperty("clientSecret");
    expect(out.refreshToken).toBe("RT1");
  });
});

describe("provider.refresh — error path", () => {
  it("throws a 502 TokenRefreshError when the token endpoint fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 400 })));
    await expect(publicClient.provider.refresh({ clientId: "cid", refreshToken: "RT1" } as never)).rejects.toMatchObject({ status: 502 });
  });
});
