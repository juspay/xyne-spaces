/**
 * The connected-hosts dashboard, and the ownership rule underneath it.
 *
 * These rows are the user's own logins to third-party services. The product
 * rule is that nobody else can read or change them — explicitly including
 * platform admins — so the tests that matter here are the negative ones: that
 * there is no parameter, no header and no role that reaches another user's row.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

process.env["ENCRYPTION_KEY"] ||= "00".repeat(32);

vi.mock("../config.js", () => ({
  CONFIG: { encryptionKey: Buffer.alloc(32, 3), internalUrl: "http://127.0.0.1:1", xyneClawS2sKey: "k" },
}));

interface Row {
  id: string; userId: string; host: string; scheme: string; headerName: string | null;
  encryptedCred: string; iv: string; authTag: string; agentSlugs: string[];
  label: string | null; expiresAt: Date | null; lastUsedAt: Date | null; createdAt: Date;
}
const rows = new Map<string, Row>();
const key = (userId: string, host: string): string => `${userId}|${host}`;

vi.mock("../db.js", () => ({
  prisma: {
    userHostCredential: {
      findUnique: async ({ where }: { where: { userId_host: { userId: string; host: string } } }) =>
        rows.get(key(where.userId_host.userId, where.userId_host.host)) ?? null,
      findMany: async ({ where }: { where: { userId: string } }) =>
        [...rows.values()].filter((r) => r.userId === where.userId),
      upsert: async ({ where, create }: { where: { userId_host: { userId: string; host: string } }; create: Record<string, unknown> }) => {
        const k = key(where.userId_host.userId, where.userId_host.host);
        const row = { id: k, agentSlugs: [], headerName: null, label: null, expiresAt: null,
          lastUsedAt: null, createdAt: new Date(), ...(rows.get(k) ?? {}), ...create } as Row;
        rows.set(k, row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        for (const [k, v] of rows) if (v.id === where.id) rows.set(k, { ...v, ...data } as Row);
        return null;
      },
      delete: async ({ where }: { where: { id: string } }) => {
        for (const [k, v] of rows) if (v.id === where.id) rows.delete(k);
        return null;
      },
    },
    hostOAuthClient: { findUnique: async () => null },
  },
}));

const revoked: string[] = [];
// Partial: the route also uses normalizeHostname/sameIssuer from this module.
vi.mock("../lib/host-oauth.js", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  refreshHostOAuthToken: vi.fn(async () => null),
  revokeHostOAuthToken: vi.fn(async ({ token }: { token: string }) => { revoked.push(token); return true; }),
  revocationDetailsFor: vi.fn(async () => ({
    revocationEndpoint: "https://as.example.com/revoke", clientId: "c1", clientSecret: null,
  })),
}));
vi.mock("../lib/auth-grant-store.js", () => ({ resolveAuthGrants: vi.fn(async () => 0) }));
vi.mock("../redis.js", () => ({ redisService: { getConnection: () => ({ set: async () => "OK" }) } }));

const { hostBindingsRouter } = await import("./host-access.js");
const { encrypt } = await import("../crypto.js");

const ME = "user-me";
const THEM = "user-them";

let server: Server;
let origin = "";

const app = express();
app.use(express.json());
// Mirrors the real mount: requireAuth has already pinned x-user-id from a
// verified session by the time the router sees the request.
app.use("/host-bindings", hostBindingsRouter);
server = createServer(app);
await new Promise<void>((r) => server.listen(0, "localhost", r));
origin = `http://localhost:${(server.address() as AddressInfo).port}`;

const call = (
  method: string,
  path: string,
  as: string,
  body?: unknown,
): Promise<Response> =>
  fetch(`${origin}/host-bindings${path}`, {
    method,
    headers: { "Content-Type": "application/json", "x-user-id": as },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

function seed(userId: string, host: string, secret: string, extra: Partial<Row> = {}): void {
  const enc = encrypt(JSON.stringify({ credential: secret }), Buffer.alloc(32, 3));
  rows.set(key(userId, host), {
    id: key(userId, host), userId, host, scheme: "bearer", headerName: null,
    encryptedCred: enc.ciphertext, iv: enc.iv, authTag: enc.authTag,
    agentSlugs: [], label: null, expiresAt: null, lastUsedAt: null, createdAt: new Date(),
    ...extra,
  });
}

beforeEach(() => { rows.clear(); revoked.length = 0; });

describe("dashboard listing", () => {
  it("returns only my hosts, and never a secret", async () => {
    seed(ME, "bitbucket.example.net", "my-cookie", { scheme: "cookie", label: "work" });
    seed(THEM, "jira.example.net", "their-token");

    const res = await call("GET", "/", ME);
    const body = await res.text();
    const { data } = JSON.parse(body) as { data: { hosts: Array<Record<string, unknown>> } };

    expect(data.hosts.map((h) => h["host"])).toEqual(["bitbucket.example.net"]);
    expect(data.hosts[0]?.["scheme"]).toBe("cookie");
    expect(data.hosts[0]?.["origin"]).toBe("manual");
    // The whole response, not just the fields we thought to check.
    expect(body).not.toContain("my-cookie");
    expect(body).not.toContain("their-token");
    expect(body).not.toContain("encryptedCred");
  });

  it("marks a lapsed credential as expired rather than hiding it", async () => {
    seed(ME, "old.example.net", "t", { expiresAt: new Date(Date.now() - 1000) });
    const { data } = (await (await call("GET", "/", ME)).json()) as { data: { hosts: Array<Record<string, unknown>> } };
    expect(data.hosts[0]?.["expired"]).toBe(true);
  });
});

describe("ownership", () => {
  it("will not let anyone read, change or delete another user's credential", async () => {
    seed(THEM, "jira.example.net", "their-token", { agentSlugs: ["theirs"] });

    // There is no admin listing to test, which is the point; the only listing
    // is scoped to the caller, so an admin session sees an admin's own hosts.
    const listed = (await (await call("GET", "/", ME)).json()) as { data: { hosts: unknown[] } };
    expect(listed.data.hosts).toEqual([]);

    expect((await call("PATCH", "/jira.example.net", ME, { credential: "hijack" })).status).toBe(404);
    expect((await call("DELETE", "/jira.example.net", ME)).status).toBe(404);

    // Untouched: same secret, same scope, still present.
    const theirs = rows.get(key(THEM, "jira.example.net"));
    expect(theirs).toBeTruthy();
    expect(theirs?.agentSlugs).toEqual(["theirs"]);
    expect(revoked).toEqual([]);
  });

  it("ignores a userId supplied in the body or query", async () => {
    seed(THEM, "jira.example.net", "their-token");
    // The acting user comes from the session header only; these are inert.
    expect((await call("DELETE", "/jira.example.net?userId=user-them", ME)).status).toBe(404);
    const res = await fetch(`${origin}/host-bindings/jira.example.net`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-user-id": ME },
      body: JSON.stringify({ userId: THEM, credential: "hijack" }),
    });
    expect(res.status).toBe(404);
    expect(rows.get(key(THEM, "jira.example.net"))).toBeTruthy();
  });

  it("refuses a request with no authenticated user at all", async () => {
    const res = await fetch(`${origin}/host-bindings`, { headers: { "Content-Type": "application/json" } });
    expect(res.status).toBe(400);
  });
});

describe("updating", () => {
  it("rotates the secret without disturbing the agent scope", async () => {
    seed(ME, "api.example.net", "old", { agentSlugs: ["orchestrator"], label: "keep me" });

    expect((await call("PATCH", "/api.example.net", ME, { credential: "new" })).status).toBe(200);

    const row = rows.get(key(ME, "api.example.net"))!;
    expect(row.agentSlugs).toEqual(["orchestrator"]);
    expect(row.label).toBe("keep me");
    const { decrypt } = await import("../crypto.js");
    expect(JSON.parse(decrypt(row.encryptedCred, row.iv, row.authTag, Buffer.alloc(32, 3)))["credential"]).toBe("new");
  });

  it("narrows the agent scope without needing the secret again", async () => {
    seed(ME, "api.example.net", "keep-this");
    const before = rows.get(key(ME, "api.example.net"))!.encryptedCred;

    expect((await call("PATCH", "/api.example.net", ME, { agentSlugs: ["orchestrator"] })).status).toBe(200);

    const row = rows.get(key(ME, "api.example.net"))!;
    expect(row.agentSlugs).toEqual(["orchestrator"]);
    expect(row.encryptedCred).toBe(before);
  });

  it("switches scheme and header name together", async () => {
    seed(ME, "api.example.net", "t");
    await call("PATCH", "/api.example.net", ME, { scheme: "header", headerName: "X-Auth" });
    expect(rows.get(key(ME, "api.example.net"))?.headerName).toBe("X-Auth");

    await call("PATCH", "/api.example.net", ME, { scheme: "bearer" });
    // A bearer credential must not keep a stale header name to send it under.
    expect(rows.get(key(ME, "api.example.net"))?.headerName).toBeNull();
  });

  it("rejects an unparseable expiry instead of storing a broken date", async () => {
    seed(ME, "api.example.net", "t");
    expect((await call("PATCH", "/api.example.net", ME, { expiresAt: "not-a-date" })).status).toBe(400);
  });
});

describe("removing", () => {
  it("deletes the row and revokes an OAuth credential at the provider", async () => {
    const enc = encrypt(
      JSON.stringify({
        credential: "at-live", kind: "oauth", refreshToken: "rt-live",
        clientId: "c1", clientSecret: null, tokenEndpoint: "https://as.example.com/token",
        issuer: "https://as.example.com", resource: null,
      }),
      Buffer.alloc(32, 3),
    );
    rows.set(key(ME, "api.example.net"), {
      id: key(ME, "api.example.net"), userId: ME, host: "api.example.net", scheme: "bearer",
      headerName: null, encryptedCred: enc.ciphertext, iv: enc.iv, authTag: enc.authTag,
      agentSlugs: [], label: null, expiresAt: null, lastUsedAt: null, createdAt: new Date(),
    });

    expect((await call("DELETE", "/api.example.net", ME)).status).toBe(200);
    expect(rows.has(key(ME, "api.example.net"))).toBe(false);

    await new Promise((r) => setTimeout(r, 20)); // revocation is fire-and-forget
    expect(revoked).toContain("rt-live");
    expect(revoked).toContain("at-live");
  });

  it("does not call revocation for a pasted credential", async () => {
    seed(ME, "api.example.net", "pasted");
    await call("DELETE", "/api.example.net", ME);
    await new Promise((r) => setTimeout(r, 20));
    expect(revoked).toEqual([]);
  });
});
