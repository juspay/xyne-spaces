import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import express from "express";
import { randomUUID, sign as cryptoSign, type KeyObject } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env["ENCRYPTION_KEY"] = "00".repeat(32);

const keys = await vi.hoisted(async () => {
  const { generateKeyPairSync } = await import("node:crypto");
  const pair = () => generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return { spaces: pair(), runtime: pair(), claw: pair(), stranger: pair() };
});
const pem = (k: KeyObject, type: "pkcs8" | "spki") => k.export({ type, format: "pem" } as never).toString();

const state = vi.hoisted(() => ({
  config: {
    spacesInternalUrl: "http://spaces.local",
    encryptionKey: Buffer.from("00".repeat(32), "hex"),
    spacesDelegationPublicKeys: {} as Record<string, string>,
    clawRuntimePublicKeys: {} as Record<string, string>,
    clawServicePrivateKey: "",
    clawServiceKeyId: "claw-1",
  },
}));
state.config.spacesDelegationPublicKeys = { "spaces-1": pem(keys.spaces.publicKey, "spki") };
state.config.clawRuntimePublicKeys = { "runtime-1": pem(keys.runtime.publicKey, "spki") };
state.config.clawServicePrivateKey = pem(keys.claw.privateKey, "pkcs8");

vi.mock("../config.js", () => ({ CONFIG: state.config }));
vi.mock("../redis.js", () => ({ redisService: { getConnection: () => ({ set: vi.fn(async () => "OK") }) } }));

/** A service assertion as `iss` would sign it for `method path` (aud claw-auth). */
function assertion(iss: string, method: string, path: string, opts: { key?: KeyObject; kid?: string } = {}): string {
  const key = opts.key ?? (iss === "xyne-spaces" ? keys.spaces.privateKey : keys.runtime.privateKey);
  const kid = opts.kid ?? (iss === "xyne-spaces" ? "spaces-1" : "runtime-1");
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const input = `${b64({ alg: "ES256", typ: "xyne-service+jwt", kid })}.${b64({ iss, aud: "xyne-claw-auth", htm: method, htu: path, iat: now, exp: now + 60, jti: randomUUID() })}`;
  return `${input}.${cryptoSign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
}

vi.mock("../db.js", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    orgMember: { findUnique: vi.fn() },
  },
}));

vi.mock("../lib/cli-tokens.js", () => ({ verify: vi.fn(async () => null) }));
vi.mock("../lib/users-jit.js", () => ({ ensureUserExists: vi.fn(async () => undefined) }));
vi.mock("../logger.js", () => ({
  createLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

let server: Server;
let baseUrl: string;

async function startApp(max: number, stripUserId = false): Promise<void> {
  const { createRequesterLimiter } = await import("./rate-limiters.js");
  const app = express();
  // http/routes.ts deletes every inbound x-user-id, and
  // the limiter is mounted before any auth middleware puts it back. Tests that
  // set the header directly cannot see that, which is how the key silently
  // degraded to per IP in production.
  if (stripUserId) {
    app.use((req, _res, next) => {
      delete req.headers["x-user-id"];
      next();
    });
  }
  app.use(createRequesterLimiter({ windowMs: 60_000, max }));
  app.get("/ping", (_req, res) => {
    res.json({ ok: true });
  });
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("createRequesterLimiter", () => {
  it("returns 429 once one IP bursts past the limit", async () => {
    await startApp(3);
    const statuses: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const res = await fetch(`${baseUrl}/ping`);
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 3)).toEqual([200, 200, 200]);
    expect(statuses.slice(3)).toEqual([429, 429]);
  });

  it("never limits a caller presenting a valid service assertion", async () => {
    await startApp(3);
    const statuses: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      const res = await fetch(`${baseUrl}/ping`, { headers: { "x-service-assertion": assertion("xyne-claw", "GET", "/ping") } });
      statuses.push(res.status);
    }
    expect(statuses.every((s) => s === 200)).toBe(true);
  });

  it("still limits a caller whose assertion is signed by another key, or names another path", async () => {
    await startApp(2);
    const statuses: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      const bad = i % 2 === 0
        ? assertion("xyne-claw", "GET", "/ping", { key: keys.stranger.privateKey })
        : assertion("xyne-claw", "GET", "/other");
      const res = await fetch(`${baseUrl}/ping`, { headers: { "x-service-assertion": bad } });
      statuses.push(res.status);
    }
    expect(statuses).toEqual([200, 200, 429, 429]);
  });

  it("still limits a caller presenting the old shared-key header", async () => {
    await startApp(2);
    const statuses: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      statuses.push((await fetch(`${baseUrl}/ping`, { headers: { "x-s2s-key": "anything" } })).status);
    }
    expect(statuses).toEqual([200, 200, 429]);
  });

  it("keys separately per user id so one user cannot exhaust another", async () => {
    await startApp(2);
    for (let i = 0; i < 3; i += 1) {
      await fetch(`${baseUrl}/ping`, { headers: { "x-user-id": "user-a" } });
    }
    const other = await fetch(`${baseUrl}/ping`, { headers: { "x-user-id": "user-b" } });
    expect(other.status).toBe(200);
    const exhausted = await fetch(`${baseUrl}/ping`, { headers: { "x-user-id": "user-a" } });
    expect(exhausted.status).toBe(429);
  });


  it("keys on the session cookie once x-user-id has been stripped", async () => {
    await startApp(2, true);
    const hit = (cookie: string): Promise<number> =>
      fetch(`${baseUrl}/ping`, {
        headers: { "x-user-id": "ignored-because-stripped", cookie },
      }).then((r) => r.status);

    const alice = "GCLB=z; user_session_id=sess_alice";
    const bob = "GCLB=z; user_session_id=sess_bob";

    expect(await hit(alice)).toBe(200);
    expect(await hit(alice)).toBe(200);
    expect(await hit(alice)).toBe(429);
    // Same address, different session: must not inherit alice's exhausted budget.
    expect(await hit(bob)).toBe(200);
  });

  it("falls back to the address when there is no session cookie", async () => {
    await startApp(1, true);
    expect((await fetch(`${baseUrl}/ping`)).status).toBe(200);
    expect((await fetch(`${baseUrl}/ping`)).status).toBe(429);
  });
  it("emits standard RateLimit headers and no legacy X-RateLimit headers", async () => {
    await startApp(5);
    const res = await fetch(`${baseUrl}/ping`);
    expect(res.headers.get("ratelimit-limit")).toBe("5");
    expect(res.headers.get("x-ratelimit-limit")).toBeNull();
  });
});

async function startWith(pick: (mod: typeof import("./rate-limiters.js")) => express.RequestHandler): Promise<void> {
  const mod = await import("./rate-limiters.js");
  const app = express();
  app.use((req, _res, next) => {
    delete req.headers["x-user-id"];
    next();
  });
  app.use(pick(mod));
  app.get("/ping", (_req, res) => {
    res.json({ ok: true });
  });
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const fakeCookie = (i: number): string => `user_session_id=forged_${i}_${Math.random().toString(36).slice(2)}`;

describe("forged session cookies cannot mint fresh buckets", () => {
  it("public design-share limiter keys anonymous callers on the address, not the cookie", async () => {
    await startWith((m) => m.publicShareLimiter);
    const statuses: number[] = [];
    for (let i = 0; i < 61; i += 1) {
      statuses.push((await fetch(`${baseUrl}/ping`, { headers: { cookie: fakeCookie(i) } })).status);
    }
    expect(statuses.slice(0, 60).every((s) => s === 200)).toBe(true);
    expect(statuses[60]).toBe(429);
  });

  it("public design-share limiter still gives a verified viewer their own bucket", async () => {
    await startWith((m) => (req, res, next) => {
      const viewer = req.headers["x-test-viewer"];
      if (typeof viewer === "string") req.headers["x-user-id"] = viewer;
      return m.publicShareLimiter(req, res, next);
    });
    for (let i = 0; i < 60; i += 1) {
      await fetch(`${baseUrl}/ping`, { headers: { "x-test-viewer": "viewer-a" } });
    }
    expect((await fetch(`${baseUrl}/ping`, { headers: { "x-test-viewer": "viewer-a" } })).status).toBe(429);
    expect((await fetch(`${baseUrl}/ping`, { headers: { "x-test-viewer": "viewer-b" } })).status).toBe(200);
  });

  it("connector OAuth limiter gives each verified user their own bucket", async () => {
    await startWith((m) => (req, res, next) => {
      const user = req.headers["x-test-user"];
      if (typeof user === "string") req.headers["x-user-id"] = user;
      return m.oauthLimiter(req, res, next);
    });
    for (let i = 0; i < 10; i += 1) {
      await fetch(`${baseUrl}/ping`, { headers: { "x-test-user": "user-a" } });
    }
    expect((await fetch(`${baseUrl}/ping`, { headers: { "x-test-user": "user-a" } })).status).toBe(429);
    expect((await fetch(`${baseUrl}/ping`, { headers: { "x-test-user": "user-b" } })).status).toBe(200);
  });

  it("connector OAuth limiter is not reset by rotating forged cookies when no user is verified", async () => {
    await startWith((m) => m.oauthLimiter);
    const statuses: number[] = [];
    for (let i = 0; i < 11; i += 1) {
      statuses.push((await fetch(`${baseUrl}/ping`, { headers: { cookie: fakeCookie(i) } })).status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});

describe("isUnlimitedSpacesCall", () => {
  // Mirrors http/routes.ts: the skip runs inside app.use(BASE), so req.path is base-relative.
  async function startBaseApp(max: number): Promise<void> {
    const { createRequesterLimiter, isUnlimitedSpacesCall } = await import("./rate-limiters.js");
    const limiter = createRequesterLimiter({ windowMs: 60_000, max });
    const app = express();
    app.use("/claw/api/v1", (req, res, next) => {
      if (isUnlimitedSpacesCall(req)) {
        next();
        return;
      }
      limiter(req, res, next);
    });
    app.get("/claw/api/v1/*", (_req, res) => {
      res.json({ ok: true });
    });
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  /** n GETs, each with a fresh assertion from `sign(fullPath)` (or none). */
  async function statuses(path: string, n: number, sign: ((fullPath: string) => string | undefined) | null): Promise<number[]> {
    const out: number[] = [];
    for (let i = 0; i < n; i += 1) {
      const full = `/claw/api/v1${path}`;
      const token = sign ? sign(full) : undefined;
      const res = await fetch(`${baseUrl}${full}`, { headers: token ? { "x-service-assertion": token } : {} });
      out.push(res.status);
    }
    return out;
  }
  const fromSpaces = (full: string) => assertion("xyne-spaces", "GET", full);

  it("never limits the agent check called by Spaces", async () => {
    await startBaseApp(2);
    const got = await statuses("/internal/agents/by-spaces-app/app-1", 10, fromSpaces);
    expect(got.every((s) => s === 200)).toBe(true);
  });

  it("still limits the agent check with an assertion signed by another key", async () => {
    await startBaseApp(2);
    expect(await statuses("/internal/agents/by-spaces-app/app-1", 3, (f) => assertion("xyne-spaces", "GET", f, { key: keys.stranger.privateKey }))).toEqual([200, 200, 429]);
  });

  it("still limits other internal routes called by Spaces", async () => {
    await startBaseApp(2);
    expect(await statuses("/internal/app-connectors/tools", 3, fromSpaces)).toEqual([200, 200, 429]);
  });

  it("does not match a prefix that only starts with the same letters", async () => {
    await startBaseApp(2);
    expect(await statuses("/internal/agentsx", 3, fromSpaces)).toEqual([200, 200, 429]);
  });

  it("never limits the bare /internal/agents path called by Spaces", async () => {
    await startBaseApp(2);
    const got = await statuses("/internal/agents", 5, fromSpaces);
    expect(got.every((s) => s === 200)).toBe(true);
  });

  // Express routes case-insensitively, so this still reaches the agents router; it must stay limited.
  it("still limits a differently-cased path", async () => {
    await startBaseApp(2);
    expect(await statuses("/INTERNAL/AGENTS/by-spaces-app/app-1", 3, fromSpaces)).toEqual([200, 200, 429]);
  });

  it("still limits a duplicated assertion header", async () => {
    await startBaseApp(2);
    const out: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const full = "/claw/api/v1/internal/agents/by-spaces-app/app-1";
      const headers = new Headers();
      headers.append("x-service-assertion", fromSpaces(full));
      headers.append("x-service-assertion", fromSpaces(full));
      out.push((await fetch(`${baseUrl}${full}`, { headers })).status);
    }
    expect(out).toEqual([200, 200, 429]);
  });

  it("fails closed with no assertion, or the old shared-key header", async () => {
    await startBaseApp(2);
    expect(await statuses("/internal/agents/by-spaces-app/app-1", 3, null)).toEqual([200, 200, 429]);
  });

  it("fails closed when Spaces' public key is not configured", async () => {
    const saved = state.config.spacesDelegationPublicKeys;
    state.config.spacesDelegationPublicKeys = {};
    try {
      await startBaseApp(2);
      expect(await statuses("/internal/agents/by-spaces-app/app-1", 3, fromSpaces)).toEqual([200, 200, 429]);
    } finally {
      state.config.spacesDelegationPublicKeys = saved;
    }
  });

  // The cases above mirror the mount; this pins the real one in http/routes.ts.
  it("is wired into routes.ts ahead of apiLimiter", () => {
    const source = readFileSync(fileURLToPath(new URL("../http/routes.ts", import.meta.url)), "utf8");
    const mount = source.slice(source.indexOf("app.use(BASE, (req: Request, res: Response, next: NextFunction)"));
    const skip = mount.indexOf("if (isUnlimitedSpacesCall(req))");
    const limiter = mount.indexOf("apiLimiter(req, res, next)");
    expect(skip).toBeGreaterThan(0);
    expect(limiter).toBeGreaterThan(skip);
  });
});
