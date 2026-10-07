import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env["ENCRYPTION_KEY"] = "00".repeat(32);

const state = vi.hoisted(() => ({
  config: {
    xyneClawS2sKey: "s2s-secret",
    spacesInternalUrl: "http://spaces.local",
    encryptionKey: Buffer.from("00".repeat(32), "hex"),
  },
}));

vi.mock("../config.js", () => ({ CONFIG: state.config }));

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
  // http/routes.ts deletes an inbound x-user-id for every non-S2S caller, and
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

  it("never limits a caller presenting a valid x-s2s-key", async () => {
    await startApp(3);
    const statuses: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      const res = await fetch(`${baseUrl}/ping`, { headers: { "x-s2s-key": "s2s-secret" } });
      statuses.push(res.status);
    }
    expect(statuses.every((s) => s === 200)).toBe(true);
  });

  it("still limits a caller presenting a wrong x-s2s-key", async () => {
    await startApp(2);
    const statuses: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      const res = await fetch(`${baseUrl}/ping`, { headers: { "x-s2s-key": "not-the-key" } });
      statuses.push(res.status);
    }
    expect(statuses).toEqual([200, 200, 429, 429]);
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
    if (req.headers["x-s2s-key"] !== "s2s-secret") delete req.headers["x-user-id"];
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

describe("isUnlimitedInternalS2S", () => {
  const INTERNAL_KEY = "internal-secret";

  // Mirrors http/routes.ts: the skip runs inside app.use(BASE), so req.path is base-relative.
  async function startBaseApp(max: number): Promise<void> {
    const { createRequesterLimiter, isUnlimitedInternalS2S } = await import("./rate-limiters.js");
    const limiter = createRequesterLimiter({ windowMs: 60_000, max });
    const app = express();
    app.use("/claw/api/v1", (req, res, next) => {
      if (isUnlimitedInternalS2S(req)) {
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

  async function statuses(path: string, key: string, n: number): Promise<number[]> {
    const out: number[] = [];
    for (let i = 0; i < n; i += 1) {
      const res = await fetch(`${baseUrl}/claw/api/v1${path}`, { headers: { "x-s2s-key": key } });
      out.push(res.status);
    }
    return out;
  }

  beforeEach(() => {
    process.env["INTERNAL_S2S_KEY"] = INTERNAL_KEY;
  });

  afterEach(() => {
    delete process.env["INTERNAL_S2S_KEY"];
  });

  it("never limits the agent check with a valid INTERNAL_S2S_KEY", async () => {
    await startBaseApp(2);
    const got = await statuses("/internal/agents/by-spaces-app/app-1", INTERNAL_KEY, 10);
    expect(got.every((s) => s === 200)).toBe(true);
  });

  it("still limits the agent check with a wrong key", async () => {
    await startBaseApp(2);
    expect(await statuses("/internal/agents/by-spaces-app/app-1", "not-the-key", 3)).toEqual([200, 200, 429]);
  });

  it("still limits other internal routes with a valid INTERNAL_S2S_KEY", async () => {
    await startBaseApp(2);
    expect(await statuses("/internal/app-connectors/tools", INTERNAL_KEY, 3)).toEqual([200, 200, 429]);
  });

  it("does not match a prefix that only starts with the same letters", async () => {
    await startBaseApp(2);
    expect(await statuses("/internal/agentsx", INTERNAL_KEY, 3)).toEqual([200, 200, 429]);
  });

  it("never limits the bare /internal/agents path with a valid INTERNAL_S2S_KEY", async () => {
    await startBaseApp(2);
    const got = await statuses("/internal/agents", INTERNAL_KEY, 5);
    expect(got.every((s) => s === 200)).toBe(true);
  });

  // Express routes case-insensitively, so this still reaches the agents router; it must stay limited.
  it("still limits a differently-cased path", async () => {
    await startBaseApp(2);
    expect(await statuses("/INTERNAL/AGENTS/by-spaces-app/app-1", INTERNAL_KEY, 3)).toEqual([200, 200, 429]);
  });

  it("still limits a duplicated x-s2s-key header", async () => {
    await startBaseApp(2);
    const out: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const headers = new Headers();
      headers.append("x-s2s-key", INTERNAL_KEY);
      headers.append("x-s2s-key", INTERNAL_KEY);
      out.push((await fetch(`${baseUrl}/claw/api/v1/internal/agents/by-spaces-app/app-1`, { headers })).status);
    }
    expect(out).toEqual([200, 200, 429]);
  });

  it("fails closed when INTERNAL_S2S_KEY is unset", async () => {
    delete process.env["INTERNAL_S2S_KEY"];
    await startBaseApp(2);
    expect(await statuses("/internal/agents/by-spaces-app/app-1", "", 3)).toEqual([200, 200, 429]);
  });

  it("fails closed for the old key once INTERNAL_S2S_KEY is unset", async () => {
    delete process.env["INTERNAL_S2S_KEY"];
    await startBaseApp(2);
    expect(await statuses("/internal/agents/by-spaces-app/app-1", INTERNAL_KEY, 3)).toEqual([200, 200, 429]);
  });

  // The cases above mirror the mount; this pins the real one in http/routes.ts.
  it("is wired into routes.ts ahead of apiLimiter", () => {
    const source = readFileSync(fileURLToPath(new URL("../http/routes.ts", import.meta.url)), "utf8");
    const mount = source.slice(source.indexOf("app.use(BASE, (req: Request, res: Response, next: NextFunction)"));
    const skip = mount.indexOf("if (isUnlimitedInternalS2S(req))");
    const limiter = mount.indexOf("apiLimiter(req, res, next)");
    expect(skip).toBeGreaterThan(0);
    expect(limiter).toBeGreaterThan(skip);
  });
});
