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

async function startApp(max: number): Promise<void> {
  const { createRequesterLimiter } = await import("./rate-limiters.js");
  const app = express();
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

  it("emits standard RateLimit headers and no legacy X-RateLimit headers", async () => {
    await startApp(5);
    const res = await fetch(`${baseUrl}/ping`);
    expect(res.headers.get("ratelimit-limit")).toBe("5");
    expect(res.headers.get("x-ratelimit-limit")).toBeNull();
  });
});
