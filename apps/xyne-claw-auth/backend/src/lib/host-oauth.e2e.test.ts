/**
 * End-to-end: an agent is blocked on a host, the user clicks Sign in, and the
 * parked run resumes — over real HTTP, through the real routers.
 *
 * Why a mock authorization server rather than a real one: measured against the
 * hosts actually in reach, nothing supports this. `accounts.google.com`
 * publishes `registration_endpoint: null`; `bitbucket.juspay.net` answers 404
 * to all three well-known paths and challenges with OAuth 1.0a. Dynamic client
 * registration is a real and growing standard (every MCP server built to the
 * 2025 auth spec implements it) but it is not something a test can borrow.
 *
 * So the server here is a genuine, spec-shaped implementation of RFC 9728 +
 * 8414 + 7591 + PKCE, listening on a loopback hostname over real TCP. Only the
 * database and Redis are doubles. Everything the feature owns — discovery,
 * relatedness, DCR, the authorize URL, the Redis flow store, state signing, the
 * `iss` check, the token exchange, the verification fetch, the credential
 * write, and the parked-run resume — is the production code path.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import express from "express";
import type { AddressInfo } from "node:net";

process.env["NODE_ENV"] = "test";
process.env["HOST_OAUTH_ALLOW_LOOPBACK"] = "true";
process.env["ENCRYPTION_KEY"] ||= "00".repeat(32);
process.env["FRONTEND_URL"] = "http://localhost:5174/claw/";

const ENCRYPTION_KEY = Buffer.alloc(32, 7);

vi.mock("../config.js", () => ({
  CONFIG: {
    encryptionKey: Buffer.alloc(32, 7),
    oauthStateSigningKey: Buffer.alloc(32, 9),
    legacyOauthStateSigningKey: Buffer.alloc(32, 9),
    get internalUrl() { return process.env["TEST_INTERNAL_URL"] ?? "http://127.0.0.1:1"; },
    xyneClawS2sKey: "test-s2s",
    frontendUrl: "http://localhost:5174/claw/",
    spacesAppUrl: "http://localhost:3001",
  },
}));

// Rate limiting is real middleware with real global state; a deterministic test
// should not share a token bucket across its own requests.
vi.mock("../middleware/rate-limiters.js", () => ({
  oauthLimiter: (_req: unknown, _res: unknown, next: () => void) => { next(); },
}));

/* ------------------------------------------------------------------ doubles */

interface ClientRow {
  id: string; host: string; issuer: string; issuerHost: string;
  authorizationEndpoint: string; tokenEndpoint: string; registrationEndpoint: string;
  resource: string | null; scope: string | null; clientId: string;
  encryptedSecret: string | null; iv: string | null; authTag: string | null;
  redirectUri: string; discoveredAt: Date;
}
interface CredRow {
  id: string; userId: string; host: string; scheme: string; headerName: string | null;
  encryptedCred: string; iv: string; authTag: string; agentSlugs: string[];
  label: string | null; expiresAt: Date | null; lastUsedAt: Date | null;
}

const clients = new Map<string, ClientRow>();
const creds = new Map<string, CredRow>();

vi.mock("../db.js", () => ({
  prisma: {
    hostOAuthClient: {
      findUnique: async ({ where }: { where: { host: string } }) => clients.get(where.host) ?? null,
      findFirst: async ({ where }: { where: { issuer: string; redirectUri: string } }) =>
        [...clients.values()].find((c) => c.issuer === where.issuer && c.redirectUri === where.redirectUri) ?? null,
      upsert: async ({ where, create, update }: { where: { host: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const prev = clients.get(where.host);
        const row = { id: prev?.id ?? `c${clients.size}`, ...(prev ?? {}), ...(prev ? update : create) } as ClientRow;
        clients.set(where.host, row);
        return row;
      },
    },
    userHostCredential: {
      findUnique: async ({ where }: { where: { userId_host: { userId: string; host: string } } }) =>
        creds.get(`${where.userId_host.userId}|${where.userId_host.host}`) ?? null,
      upsert: async ({ where, create, update }: { where: { userId_host: { userId: string; host: string } }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const key = `${where.userId_host.userId}|${where.userId_host.host}`;
        const prev = creds.get(key);
        const row = {
          id: prev?.id ?? `k${creds.size}`, agentSlugs: [], headerName: null, label: null,
          expiresAt: null, lastUsedAt: null, ...(prev ?? {}), ...(prev ? update : create),
        } as CredRow;
        creds.set(key, row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        for (const [k, v] of creds) if (v.id === where.id) creds.set(k, { ...v, ...data } as CredRow);
        return null;
      },
    },
  },
}));

const redisStore = new Map<string, string>();
const redisSets = new Map<string, Set<string>>();
vi.mock("../redis.js", () => ({
  redisService: {
    getConnection: () => ({
      set: async (k: string, v: string, ...rest: unknown[]) => {
        if (rest.includes("NX") && redisStore.has(k)) return null;
        redisStore.set(k, v);
        return "OK";
      },
      getdel: async (k: string) => { const v = redisStore.get(k) ?? null; redisStore.delete(k); return v; },
      smembers: async (k: string) => [...(redisSets.get(k) ?? [])],
      sadd: async (k: string, ...m: string[]) => {
        const s = redisSets.get(k) ?? new Set<string>();
        m.forEach((x) => s.add(x));
        redisSets.set(k, s);
        return m.length;
      },
      expire: async () => 1,
      del: async (k: string) => { redisSets.delete(k); return 1; },
    }),
  },
}));

const { decrypt } = await import("../crypto.js");
const { hostOAuthRouter, hostOAuthCallbackRouter } = await import("../routes/host-access.js");
const { registerAuthGrant } = await import("./auth-grant-store.js");
const { resolveHostCredential } = await import("./host-credentials.js");

/* ------------------------------------------- a real, spec-shaped OAuth server */

interface Registered { clientId: string; redirectUris: string[] }
const registered = new Map<string, Registered>();
const pendingCodes = new Map<string, { challenge: string; clientId: string }>();
const issuedTokens = new Set<string>();
const resumeCalls: Array<Record<string, unknown>> = [];

let asServer: Server;
let asOrigin = "";
let appServer: Server;
let appOrigin = "";
/** Flip to make the resource reject the token the AS issues. */
let resourceAcceptsToken = true;

function json(res: import("node:http").ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

async function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString();
}

beforeAll(async () => {
  asServer = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", asOrigin || "http://x");

      // The protected resource: 401 pointing at its own metadata (RFC 9728 §5.1).
      if (url.pathname === "/api/data") {
        const auth = req.headers.authorization ?? "";
        const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
        if (!token || !issuedTokens.has(token) || !resourceAcceptsToken) {
          res.writeHead(401, {
            "WWW-Authenticate": `Bearer resource_metadata="${asOrigin}/.well-known/oauth-protected-resource"`,
          });
          res.end("unauthorized");
          return;
        }
        json(res, 200, { stargazers: ["alice", "bob"] });
        return;
      }

      if (url.pathname === "/.well-known/oauth-protected-resource") {
        json(res, 200, { resource: `${asOrigin}/`, authorization_servers: [asOrigin] });
        return;
      }

      if (url.pathname === "/.well-known/oauth-authorization-server") {
        json(res, 200, {
          issuer: asOrigin,
          authorization_endpoint: `${asOrigin}/authorize`,
          token_endpoint: `${asOrigin}/token`,
          registration_endpoint: `${asOrigin}/register`,
          code_challenge_methods_supported: ["S256"],
          scopes_supported: ["offline_access", "read"],
        });
        return;
      }

      if (url.pathname === "/register" && req.method === "POST") {
        const body = JSON.parse(await readBody(req)) as { redirect_uris?: string[]; token_endpoint_auth_method?: string };
        const clientId = `client-${registered.size + 1}`;
        registered.set(clientId, { clientId, redirectUris: body.redirect_uris ?? [] });
        json(res, 201, { client_id: clientId, token_endpoint_auth_method: body.token_endpoint_auth_method });
        return;
      }

      // A user who is already logged in: consent is instant.
      if (url.pathname === "/authorize") {
        const clientId = url.searchParams.get("client_id") ?? "";
        const redirectUri = url.searchParams.get("redirect_uri") ?? "";
        const challenge = url.searchParams.get("code_challenge") ?? "";
        const client = registered.get(clientId);
        if (!client || !client.redirectUris.includes(redirectUri) || url.searchParams.get("code_challenge_method") !== "S256") {
          json(res, 400, { error: "invalid_request" });
          return;
        }
        const code = randomBytes(12).toString("hex");
        pendingCodes.set(code, { challenge, clientId });
        const back = new URL(redirectUri);
        back.searchParams.set("code", code);
        back.searchParams.set("state", url.searchParams.get("state") ?? "");
        back.searchParams.set("iss", asOrigin);
        res.writeHead(302, { Location: back.toString() });
        res.end();
        return;
      }

      if (url.pathname === "/token" && req.method === "POST") {
        const form = new URLSearchParams(await readBody(req));
        if (form.get("grant_type") === "refresh_token") {
          const token = `at-${randomBytes(6).toString("hex")}`;
          issuedTokens.add(token);
          json(res, 200, { access_token: token, refresh_token: "rt-rotated", expires_in: 3600 });
          return;
        }
        const entry = pendingCodes.get(form.get("code") ?? "");
        if (!entry) { json(res, 400, { error: "invalid_grant" }); return; }
        pendingCodes.delete(form.get("code") ?? "");
        const verifier = form.get("code_verifier") ?? "";
        if (createHash("sha256").update(verifier).digest("base64url") !== entry.challenge) {
          json(res, 400, { error: "invalid_grant", error_description: "PKCE mismatch" });
          return;
        }
        const token = `at-${randomBytes(6).toString("hex")}`;
        issuedTokens.add(token);
        json(res, 200, { access_token: token, refresh_token: "rt-1", expires_in: 3600, scope: "offline_access" });
        return;
      }

      // Stands in for claw's /internal/run, so the resume is observable.
      if (url.pathname === "/claw/api/v1/internal/run" && req.method === "POST") {
        resumeCalls.push(JSON.parse(await readBody(req)) as Record<string, unknown>);
        json(res, 200, { ok: true });
        return;
      }

      res.writeHead(404, { "Content-Type": "text/html" });
      res.end("<html>not found</html>");
    })();
  });
  await new Promise<void>((r) => asServer.listen(0, "localhost", r));
  asOrigin = `http://oauth-e2e.localtest.me:${(asServer.address() as AddressInfo).port}`;
  process.env["TEST_INTERNAL_URL"] = asOrigin;

  const app = express();
  app.use(express.json());
  /*
   * MIRRORS PRODUCTION MOUNT ORDER, including the auth guard — because getting
   * this order wrong is not a hypothetical. `app.use` matches by prefix, so a
   * guard mounted at `/claw/api/v1/host-oauth` also covers
   * `/claw/api/v1/host-oauth/callback`; with the guard first, every real
   * sign-in died on a 401 at the callback while all the unit tests passed.
   * Keep the callback router first, and keep the guard here so a regression
   * fails loudly.
   */
  app.use("/claw/api/v1", hostOAuthCallbackRouter);
  app.use("/claw/api/v1/host-oauth", (req, res, next) => {
    if (!req.header("x-user-id")) { res.status(401).json({ error: "auth required" }); return; }
    next();
  }, hostOAuthRouter);
  appServer = createServer(app);
  await new Promise<void>((r) => appServer.listen(0, "localhost", r));
  appOrigin = `http://localhost:${(appServer.address() as AddressInfo).port}`;
  process.env["AUTH_SERVICE_URL"] = appOrigin;
});

afterAll(async () => {
  await new Promise<void>((r) => asServer.close(() => r()));
  await new Promise<void>((r) => appServer.close(() => r()));
});

beforeEach(() => {
  clients.clear(); creds.clear(); redisStore.clear(); redisSets.clear();
  registered.clear(); pendingCodes.clear(); issuedTokens.clear();
  resumeCalls.length = 0;
  resourceAcceptsToken = true;
});

const USER = "user-1";
const asHost = (): string => new URL(asOrigin).hostname;
const blockedUrl = (): string => `${asOrigin}/api/data`;

const api = (path: string, init: RequestInit = {}): Promise<Response> =>
  fetch(`${appOrigin}/claw/api/v1${path}`, {
    ...init,
    redirect: "manual",
    headers: { "Content-Type": "application/json", "x-user-id": USER, ...(init.headers ?? {}) },
  });

/** Click Sign in, follow the authorization server, land on our callback. */
async function completeSignIn(): Promise<Response> {
  const started = await api("/host-oauth/authorize", {
    method: "POST",
    body: JSON.stringify({ host: asHost(), url: blockedUrl(), returnTo: "http://localhost:5174/claw/v3/chat" }),
  });
  expect(started.status).toBe(200);
  const { data } = (await started.json()) as { data: { authUrl: string } };

  const redirected = await fetch(data.authUrl, { redirect: "manual" });
  expect(redirected.status).toBe(302);
  return fetch(redirected.headers.get("location") as string, { redirect: "manual" });
}

/* ---------------------------------------------------------------- the tests */

describe("host OAuth — the callback must not sit behind auth", () => {
  it("reaches the callback with no session at all", async () => {
    // The browser arrives here straight from the authorization server carrying
    // none of our cookies. A 401 means the whole feature is dead on arrival.
    const res = await fetch(`${appOrigin}/claw/api/v1/host-oauth/callback?code=x&state=y`, {
      redirect: "manual",
    });
    expect(res.status).not.toBe(401);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("host_oauth_error=invalid_state");
  });

  it("still requires a session for the authenticated routes", async () => {
    const res = await fetch(`${appOrigin}/claw/api/v1/host-oauth/discover?host=${asHost()}`);
    expect(res.status).toBe(401);
  });
});

describe("host OAuth — discovery", () => {
  it("finds the authorization server and registers a client dynamically", async () => {
    const res = await api(`/host-oauth/discover?host=${asHost()}&url=${encodeURIComponent(blockedUrl())}`);
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: { available: boolean; issuerHost: string } };

    expect(data.available).toBe(true);
    expect(data.issuerHost).toBe(asHost());
    // One registration, created by us, naming our fixed callback.
    expect(registered.size).toBe(1);
    expect([...registered.values()][0]?.redirectUris).toEqual([
      `${appOrigin}/claw/api/v1/host-oauth/callback`,
    ]);
  });

  it("reuses the cached registration instead of registering again", async () => {
    const q = `host=${asHost()}&url=${encodeURIComponent(blockedUrl())}`;
    await api(`/host-oauth/discover?${q}`);
    await api(`/host-oauth/discover?${q}`);
    await api("/host-oauth/authorize", {
      method: "POST",
      body: JSON.stringify({ host: asHost(), url: blockedUrl() }),
    });
    expect(registered.size).toBe(1);
  });

  it("reports unavailable for a host that publishes nothing", async () => {
    // Same server, a hostname whose well-knowns 404 — it answers HTML, not JSON.
    const res = await api(`/host-oauth/discover?host=example.com`);
    const { data } = (await res.json()) as { data: { available: boolean } };
    expect(data.available).toBe(false);
  });

  it("refuses to offer sign-in for an identity provider", async () => {
    const res = await api(`/host-oauth/discover?host=accounts.google.com`);
    expect(res.status).toBe(403);
  });
});

describe("host OAuth — the full loop", () => {
  it("signs in, stores a usable credential, and resumes the parked run", async () => {
    // A run is parked exactly as webfetch would have parked it.
    await registerAuthGrant({
      userId: USER,
      serverType: `webfetch-host:${asHost()}`,
      providerLabel: asHost(),
      host: asHost(),
      url: blockedUrl(),
      reasonText: "listing stargazers — got a login wall",
      redispatch: {
        userId: USER, task: "who starred the repo?", agentSlug: "orchestrator",
        orgId: "org-1", conversationId: "conv-1", channelId: "chan-1",
      },
    });

    const callback = await completeSignIn();

    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toContain("host_connected");

    // The credential is real, decryptable, and marked as OAuth-issued.
    const stored = creds.get(`${USER}|${asHost()}`);
    expect(stored).toBeTruthy();
    const blob = JSON.parse(
      decrypt(stored!.encryptedCred, stored!.iv, stored!.authTag, ENCRYPTION_KEY),
    ) as Record<string, unknown>;
    expect(blob["kind"]).toBe("oauth");
    expect(String(blob["credential"])).toMatch(/^at-/);
    expect(blob["refreshToken"]).toBe("rt-1");
    expect(stored!.scheme).toBe("bearer");
    expect(stored!.expiresAt).toBeInstanceOf(Date);

    // It resolves back out through the ordinary credential path...
    const resolved = await resolveHostCredential(USER, asHost());
    expect(resolved?.scheme).toBe("bearer");

    // ...and actually opens the door that was closed.
    const authed = await fetch(blockedUrl(), {
      headers: { Authorization: `Bearer ${resolved!.secret}` },
    });
    expect(authed.status).toBe(200);
    expect(((await authed.json()) as { stargazers: string[] }).stargazers).toEqual(["alice", "bob"]);

    // The parked run was dispatched, carrying the agent's own account of the goal.
    expect(resumeCalls).toHaveLength(1);
    expect(String(resumeCalls[0]?.["task"])).toContain("listing stargazers");
    expect(resumeCalls[0]?.["conversationId"]).toBe("conv-1");
  });

  it("never lets the PKCE verifier reach the browser", async () => {
    const started = await api("/host-oauth/authorize", {
      method: "POST",
      body: JSON.stringify({ host: asHost(), url: blockedUrl() }),
    });
    const { data } = (await started.json()) as { data: { authUrl: string } };
    const authUrl = new URL(data.authUrl);
    const state = authUrl.searchParams.get("state") as string;

    // `state` is signed, not encrypted — anything inside it is public.
    const payload = Buffer.from(state.slice(0, state.lastIndexOf(".")), "base64url").toString();
    const verifier = JSON.parse(
      redisStore.get([...redisStore.keys()].find((k) => k.startsWith("host-oauth-flow:")) as string) as string,
    ).codeVerifier as string;

    expect(verifier).toBeTruthy();
    expect(payload).not.toContain(verifier);
    expect(authUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authUrl.searchParams.get("code_challenge")).toBe(
      createHash("sha256").update(verifier).digest("base64url"),
    );
  });

  it("rejects a replayed callback", async () => {
    const started = await api("/host-oauth/authorize", {
      method: "POST",
      body: JSON.stringify({ host: asHost(), url: blockedUrl() }),
    });
    const { data } = (await started.json()) as { data: { authUrl: string } };
    const redirected = await fetch(data.authUrl, { redirect: "manual" });
    const back = redirected.headers.get("location") as string;

    const first = await fetch(back, { redirect: "manual" });
    expect(first.headers.get("location")).toContain("host_connected");

    creds.clear();
    const second = await fetch(back, { redirect: "manual" });
    expect(second.headers.get("location")).toContain("host_oauth_error=expired");
    expect(creds.size).toBe(0);
  });

  it("refuses a callback whose state was not signed by us", async () => {
    const forged = `${Buffer.from(JSON.stringify({ userId: USER, nonce: "n", ts: Date.now(), extra: { flowId: "x" } })).toString("base64url")}.${"0".repeat(64)}`;
    const res = await fetch(
      `${appOrigin}/claw/api/v1/host-oauth/callback?code=abc&state=${forged}`,
      { redirect: "manual" },
    );
    expect(res.headers.get("location")).toContain("host_oauth_error=invalid_state");
    expect(creds.size).toBe(0);
  });

  it("refuses a callback from a different issuer than the one we sent the user to", async () => {
    const started = await api("/host-oauth/authorize", {
      method: "POST",
      body: JSON.stringify({ host: asHost(), url: blockedUrl() }),
    });
    const { data } = (await started.json()) as { data: { authUrl: string } };
    const redirected = await fetch(data.authUrl, { redirect: "manual" });
    const back = new URL(redirected.headers.get("location") as string);
    back.searchParams.set("iss", "https://attacker.example");

    const res = await fetch(back.toString(), { redirect: "manual" });
    expect(res.headers.get("location")).toContain("host_oauth_error=issuer_mismatch");
    expect(creds.size).toBe(0);
  });

  it("does not store a token the resource itself refuses", async () => {
    // The authorization server happily issues one; the resource does not take it.
    // Overwriting a working credential with this is the silent downgrade the
    // verification step exists to prevent.
    resourceAcceptsToken = false;
    const callback = await completeSignIn();
    expect(callback.headers.get("location")).toContain("host_oauth_error=token_not_accepted");
    expect(creds.size).toBe(0);
  });
});

describe("host OAuth — one sign-in releases one conversation", () => {
  it("carries the conversation across the browser round trip and resumes only it", async () => {
    // Two chats blocked on the same host.
    for (const conv of ["conv-1", "conv-2"]) {
      await registerAuthGrant({
        userId: USER,
        serverType: `webfetch-host:${asHost()}`,
        providerLabel: asHost(),
        host: asHost(),
        url: blockedUrl(),
        redispatch: {
          userId: USER, task: `task in ${conv}`, agentSlug: "orchestrator",
          orgId: "org-1", conversationId: conv, channelId: "chan-1",
        },
      });
    }

    // Sign in from conv-2 only. The conversation has to survive the redirect to
    // the authorization server and back — it is the one piece of state that
    // cannot be re-derived at the callback.
    const started = await api("/host-oauth/authorize", {
      method: "POST",
      body: JSON.stringify({ host: asHost(), url: blockedUrl(), conversationId: "conv-2" }),
    });
    const { data } = (await started.json()) as { data: { authUrl: string } };
    const redirected = await fetch(data.authUrl, { redirect: "manual" });
    const back = await fetch(redirected.headers.get("location") as string, { redirect: "manual" });
    expect(back.headers.get("location")).toContain("host_connected");

    expect(resumeCalls).toHaveLength(1);
    expect(resumeCalls[0]?.["conversationId"]).toBe("conv-2");
    expect(String(resumeCalls[0]?.["task"])).not.toContain("task in conv-1");
  });
});

describe("host OAuth — renewal", () => {
  it("refreshes an already-expired token instead of giving up on it", async () => {
    await completeSignIn();
    const key = `${USER}|${asHost()}`;
    const before = creds.get(key)!;

    // The run was parked for longer than the token's lifetime.
    creds.set(key, { ...before, expiresAt: new Date(Date.now() - 60_000) });

    const resolved = await resolveHostCredential(USER, asHost());
    expect(resolved).not.toBeNull();

    const after = creds.get(key)!;
    expect(after.encryptedCred).not.toBe(before.encryptedCred);
    expect(after.expiresAt!.getTime()).toBeGreaterThan(Date.now());
    const blob = JSON.parse(decrypt(after.encryptedCred, after.iv, after.authTag, ENCRYPTION_KEY)) as Record<string, unknown>;
    expect(blob["refreshToken"]).toBe("rt-rotated");

    const authed = await fetch(blockedUrl(), { headers: { Authorization: `Bearer ${resolved!.secret}` } });
    expect(authed.status).toBe(200);
  });
});
