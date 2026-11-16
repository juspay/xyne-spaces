/**
 * Bot Framework request validation against a fake key set and a fake token
 * endpoint. Every id and secret here is invented; nothing reaches Microsoft.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK } from "jose";

vi.mock("../../logger.js", () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));

const { BotFrameworkAuth, sameServiceUrl } = await import("./auth.js");
type HttpFetch = import("./auth.js").HttpFetch;

const APP_ID = "00000000-0000-0000-0000-0000000000a1";
const SERVICE_URL = "https://smba.example.test/amer/";
const METADATA_URL = "https://login.example.test/v1/.well-known/openidconfiguration";
const JWKS_URL = "https://login.example.test/v1/.well-known/keys";
const NOW = Date.parse("2026-10-22T10:00:00.000Z");

let signingKey: CryptoKey;
let strangerKey: CryptoKey;
let publicJwk: JWK;
let unendorsedJwk: JWK;
let unendorsedKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  signingKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), kid: "key-1", endorsements: ["msteams", "skype"] } as JWK;
  const other = await generateKeyPair("RS256");
  unendorsedKey = other.privateKey;
  unendorsedJwk = { ...(await exportJWK(other.publicKey)), kid: "key-2", endorsements: ["webchat"] } as JWK;
  strangerKey = (await generateKeyPair("RS256")).privateKey;
});

function fakeHttp(): { http: HttpFetch; calls: string[] } {
  const calls: string[] = [];
  const http: HttpFetch = async (url) => {
    calls.push(url);
    const body = url === METADATA_URL ? { jwks_uri: JWKS_URL } : url === JWKS_URL ? { keys: [publicJwk, unendorsedJwk] } : null;
    return { ok: body !== null, status: body ? 200 : 404, json: async () => body };
  };
  return { http, calls };
}

async function token(
  over: { kid?: string; key?: CryptoKey; iss?: string; aud?: string; serviceUrl?: string | null; exp?: number } = {},
): Promise<string> {
  const claims: Record<string, unknown> = {};
  if (over.serviceUrl !== null) claims["serviceUrl"] = over.serviceUrl ?? SERVICE_URL;
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: over.kid ?? "key-1" })
    .setIssuer(over.iss ?? "https://api.botframework.com")
    .setAudience(over.aud ?? APP_ID)
    .setIssuedAt(Math.floor(NOW / 1000) - 60)
    .setExpirationTime(over.exp ?? Math.floor(NOW / 1000) + 3600)
    .sign(over.key ?? signingKey);
}

function auth(http: HttpFetch) {
  return new BotFrameworkAuth(http, () => NOW, METADATA_URL);
}

const verify = (a: InstanceType<typeof BotFrameworkAuth>, bearer: string, over: { channelId?: string; serviceUrl?: string } = {}) =>
  a.verifyInbound({
    authorization: `Bearer ${bearer}`,
    appId: APP_ID,
    channelId: over.channelId ?? "msteams",
    serviceUrl: over.serviceUrl ?? SERVICE_URL,
  });

describe("BotFrameworkAuth.verifyInbound", () => {
  it("accepts a token signed by an endorsed Bot Connector key for this app", async () => {
    const result = await verify(auth(fakeHttp().http), await token());
    expect(result.ok).toBe(true);
  });

  it("rejects a token for another app (audience)", async () => {
    const result = await verify(auth(fakeHttp().http), await token({ aud: "00000000-0000-0000-0000-0000000000ff" }));
    expect(result).toMatchObject({ ok: false });
  });

  it("rejects a token from another issuer", async () => {
    const result = await verify(auth(fakeHttp().http), await token({ iss: "https://sts.example.test/" }));
    expect(result).toMatchObject({ ok: false });
  });

  it("rejects an expired token, beyond the clock-skew allowance", async () => {
    const result = await verify(auth(fakeHttp().http), await token({ exp: Math.floor(NOW / 1000) - 10 * 60 }));
    expect(result).toMatchObject({ ok: false });
  });

  it("rejects a token signed by a key it does not publish", async () => {
    const result = await verify(auth(fakeHttp().http), await token({ key: strangerKey }));
    expect(result).toMatchObject({ ok: false });
  });

  it("rejects a token signed with a published kid but the wrong private key", async () => {
    const result = await verify(auth(fakeHttp().http), await token({ kid: "key-1", key: strangerKey }));
    expect(result).toMatchObject({ ok: false });
  });

  it("rejects a key that is not endorsed for Teams", async () => {
    const result = await verify(auth(fakeHttp().http), await token({ kid: "key-2", key: unendorsedKey }));
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining("not endorsed") });
  });

  it("rejects an activity whose serviceUrl differs from the token's", async () => {
    const result = await verify(auth(fakeHttp().http), await token(), { serviceUrl: "https://attacker.example.test/" });
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining("serviceUrl") });
  });

  it("rejects a token with no serviceUrl claim", async () => {
    const result = await verify(auth(fakeHttp().http), await token({ serviceUrl: null }));
    expect(result).toMatchObject({ ok: false });
  });

  it("rejects a missing or malformed Authorization header without fetching keys", async () => {
    const { http, calls } = fakeHttp();
    const a = auth(http);
    expect(await a.verifyInbound({ authorization: undefined, appId: APP_ID, channelId: "msteams", serviceUrl: SERVICE_URL })).toMatchObject({ ok: false });
    expect(await a.verifyInbound({ authorization: "Basic abc", appId: APP_ID, channelId: "msteams", serviceUrl: SERVICE_URL })).toMatchObject({ ok: false });
    expect(calls).toHaveLength(0);
  });

  it("caches the key set, and an unknown kid does not refetch on every request", async () => {
    const { http, calls } = fakeHttp();
    const a = auth(http);
    await verify(a, await token());
    await verify(a, await token());
    await verify(a, await token({ kid: "nope", key: strangerKey }));
    await verify(a, await token({ kid: "nope", key: strangerKey }));
    // metadata + jwks once; the unknown kid is inside the refetch backoff.
    expect(calls).toEqual([METADATA_URL, JWKS_URL]);
  });
});

describe("BotFrameworkAuth.connectorToken", () => {
  it("fetches a client-credentials token once and reuses it", async () => {
    const bodies: string[] = [];
    const urls: string[] = [];
    const http: HttpFetch = async (url, init) => {
      urls.push(url);
      bodies.push(init?.body ?? "");
      return { ok: true, status: 200, json: async () => ({ access_token: "fake-token", expires_in: 3600 }) };
    };
    const a = auth(http);
    const creds = { appId: APP_ID, appPassword: "fake-secret" };
    expect(await a.connectorToken(creds)).toBe("fake-token");
    expect(await a.connectorToken(creds)).toBe("fake-token");
    expect(urls).toEqual(["https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token"]);
    const form = new URLSearchParams(bodies[0]);
    expect(form.get("grant_type")).toBe("client_credentials");
    expect(form.get("scope")).toBe("https://api.botframework.com/.default");
  });

  it("uses the app's own tenant for a single-tenant registration", async () => {
    const urls: string[] = [];
    const http: HttpFetch = async (url) => {
      urls.push(url);
      return { ok: true, status: 200, json: async () => ({ access_token: "t", expires_in: 3600 }) };
    };
    await auth(http).connectorToken({ appId: APP_ID, appPassword: "s", tenantId: "11111111-2222-3333-4444-555555555555" });
    expect(urls[0]).toBe("https://login.microsoftonline.com/11111111-2222-3333-4444-555555555555/oauth2/v2.0/token");
  });

  it("reports a refused token by error code only", async () => {
    const http: HttpFetch = async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: "invalid_client", error_description: "secret fake-secret is wrong" }),
    });
    await expect(auth(http).connectorToken({ appId: APP_ID, appPassword: "fake-secret" })).rejects.toThrow(
      /invalid_client$/,
    );
  });
});

describe("sameServiceUrl", () => {
  it("ignores case and a trailing slash, nothing else", () => {
    expect(sameServiceUrl("https://SMBA.example.test/amer/", "https://smba.example.test/amer")).toBe(true);
    expect(sameServiceUrl("https://smba.example.test/amer/", "https://smba.example.test/emea/")).toBe(false);
  });
});
