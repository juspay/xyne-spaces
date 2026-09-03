import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../config.js", () => ({
  CONFIG: {
    encryptionKey: Buffer.alloc(32),
    oauthStateSigningKey: Buffer.alloc(32),
    legacyOauthStateSigningKey: Buffer.alloc(32),
  },
}));
vi.mock("../db.js", () => ({ prisma: {} }));
vi.mock("../crypto.js", () => ({ encrypt: () => ({ ciphertext: "c", iv: "i", authTag: "a" }) }));

process.env["G_ID"] = "gid";
process.env["G_SECRET"] = "gsec";

const { createClassicOAuthProvider } = await import("./classic-oauth-provider.js");

const server = { name: "G", url: "", description: "d" };
const nonRotating = createClassicOAuthProvider({
  type: "g", label: "G", clientIdEnv: "G_ID", clientSecretEnv: "G_SECRET",
  authUrl: "https://a/authorize", tokenUrl: "https://a/token", scope: "s", rotatesRefreshToken: false, server,
});
const rotating = createClassicOAuthProvider({
  type: "m", label: "M", clientIdEnv: "G_ID", clientSecretEnv: "G_SECRET",
  authUrl: "https://b/authorize", tokenUrl: "https://b/token", scope: "s", rotatesRefreshToken: true, server,
});

function mockToken(json: unknown): void {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(json), { status: 200 })));
}
function lastBody(): URLSearchParams {
  const f = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
  return (f.mock.calls[0]![1] as RequestInit).body as URLSearchParams;
}

afterEach(() => vi.unstubAllGlobals());

describe("createClassicOAuthProvider — exports + refresh", () => {
  it("exposes router/callbackRouter/provider keyed by type", () => {
    expect(typeof nonRotating.router).toBe("function");
    expect(typeof nonRotating.callbackRouter).toBe("function");
    expect(nonRotating.provider.serverType).toBe("g");
    expect(rotating.provider.serverType).toBe("m");
  });

  it("sends client_id + client_secret from env in the refresh body", async () => {
    mockToken({ access_token: "AT", refresh_token: "RTnew", expires_in: 3600 });
    await nonRotating.provider.refresh({ refreshToken: "RTold" } as never);
    const body = lastBody();
    expect(body.get("client_id")).toBe("gid");
    expect(body.get("client_secret")).toBe("gsec");
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("RTold");
  });

  it("does NOT rotate the refresh token when rotatesRefreshToken is false", async () => {
    mockToken({ access_token: "AT", refresh_token: "RTnew", expires_in: 3600 });
    const out = await nonRotating.provider.refresh({ refreshToken: "RTold" } as never);
    expect(out.refreshToken).toBe("RTold");
  });

  it("DOES rotate the refresh token when rotatesRefreshToken is true", async () => {
    mockToken({ access_token: "AT", refresh_token: "RTnew", expires_in: 3600 });
    const out = await rotating.provider.refresh({ refreshToken: "RTold" } as never);
    expect(out.refreshToken).toBe("RTnew");
  });

  it("throws a 502 on token endpoint failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 401 })));
    await expect(rotating.provider.refresh({ refreshToken: "x" } as never)).rejects.toMatchObject({ status: 502 });
  });
});
