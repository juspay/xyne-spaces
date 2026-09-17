import { createServer, type Server } from "node:http";
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

/**
 * Wire optionalAuth + the requester-keyed limiter exactly like the public
 * design-shares mount in http/routes.ts:120:
 *   app.use(`${BASE}/public/design-shares`, optionalAuth, publicDesignSharesRouter)
 * with publicShareLimiter riding the route (design-shares.ts:392/:415), i.e.
 * the limiter runs AFTER optionalAuth has had its chance to resolve identity.
 */
async function startPublicShareApp(max: number): Promise<void> {
  const { optionalAuth } = await import("./require-auth.js");
  const { createRequesterLimiter } = await import("./rate-limiters.js");
  const app = express();
  const limiter = createRequesterLimiter({ windowMs: 60_000, max });
  app.use("/public/design-shares", optionalAuth, (req, res, next) => {
    limiter(req, res, next);
  });
  app.get("/public/design-shares/metadata", (_req, res) => {
    res.json({ ok: true });
  });
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/**
 * Wire the limiter at app level BEFORE any auth middleware, exactly like the
 * global apiLimiter mount in http/routes.ts:110 (`app.use(BASE, apiLimiter)`),
 * where requesterKey necessarily sees the raw client-controlled header.
 */
async function startPreAuthApp(max: number): Promise<void> {
  const { createRequesterLimiter } = await import("./rate-limiters.js");
  const app = express();
  app.use(createRequesterLimiter({ windowMs: 60_000, max }));
  app.get("/api/ping", (_req, res) => {
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

describe("requesterKey rate-limit buckets (security)", () => {
  it("public share limiter: rotating x-user-id values does not mint fresh buckets for one client", async () => {
    await startPublicShareApp(3);
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const res = await fetch(`${baseUrl}/public/design-shares/metadata`, {
        headers: { "x-user-id": `spoof-${i}` },
      });
      statuses.push(res.status);
    }
    // All six requests come from the same client IP; distinct spoofed header
    // values must NOT each get their own 60/min bucket.
    expect(statuses).toEqual([200, 200, 200, 429, 429, 429]);
  });

  it("app-level limiter (pre-auth mount): distinct x-user-id values share one bucket per client", async () => {
    await startPreAuthApp(3);
    const statuses: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const res = await fetch(`${baseUrl}/api/ping`, { headers: { "x-user-id": "spoof-a" } });
      statuses.push(res.status);
    }
    // Same client, DIFFERENT spoofed header value — must still be limited.
    const rotated = await fetch(`${baseUrl}/api/ping`, { headers: { "x-user-id": "spoof-b" } });
    statuses.push(rotated.status);
    expect(statuses).toEqual([200, 200, 200, 429]);
  });

  it("verified users resolved from a Spaces cookie still get separate buckets", async () => {
    const realFetch = globalThis.fetch;
    let currentUserId: string | null = null;
    vi.stubGlobal(
      "fetch",
      (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : String((input as URL).href ?? input);
        if (url.startsWith("http://spaces.local")) {
          return {
            ok: true,
            json: async () => ({
              success: true,
              user: currentUserId ? { id: currentUserId } : undefined,
            }),
          } as Response;
        }
        return realFetch(input, init);
      }) as typeof fetch,
    );
    try {
      await startPublicShareApp(3);
      const hit = () =>
        fetch(`${baseUrl}/public/design-shares/metadata`, { headers: { cookie: "sid=1" } });

      currentUserId = "user-a";
      const aInitial = [await hit(), await hit(), await hit()];
      expect(aInitial.map((r) => r.status)).toEqual([200, 200, 200]);

      // A different VERIFIED user must not be exhausted by user-a's burst.
      currentUserId = "user-b";
      const b = await hit();
      expect(b.status).toBe(200);

      // ...but user-a's own bucket stays exhausted.
      currentUserId = "user-a";
      const aAgain = await hit();
      expect(aAgain.status).toBe(429);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
