import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const state = vi.hoisted(() => ({
  agents: new Map<string, { slug: string; config: Record<string, unknown> | null }>(),
  claimed: new Set<string>(),
  internalCalls: [] as Array<{ headers: Record<string, string>; body: unknown }>,
  warmed: [] as Array<[string, string]>,
}));

vi.mock("../config.js", () => ({ CONFIG: { internalUrl: "http://claw-auth.internal", xyneClawS2sKey: "s2s-key" } }));
vi.mock("../logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock("../middleware/agent-acl.js", () => ({
  getRequesterId: (req: { headers: Record<string, unknown> }) => req.headers["x-user-id"] as string | undefined,
  getOrgId: () => "org-1",
}));
vi.mock("../repositories/index.js", () => ({
  agentRepository: { findBySlugVisibleTo: vi.fn(async (slug: string) => state.agents.get(slug) ?? null) },
}));
vi.mock("../redis.js", () => ({
  redisService: {
    getConnection: () => ({
      set: vi.fn(async (key: string) => {
        if (state.claimed.has(key)) return null;
        state.claimed.add(key);
        return "OK";
      }),
    }),
  },
}));
vi.mock("./mcp.js", () => ({
  warmMcpToolLists: vi.fn(async (userId: string, agentSlug: string) => {
    state.warmed.push([userId, agentSlug]);
    return 3;
  }),
}));

const { agentWarmRouter, agentWarmInternalRouter, CLAW_USER_HEADER } = await import("./agent-warm.js");

const realFetch = globalThis.fetch;
let server: Server;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/agent-warm", agentWarmRouter);
  app.use("/internal/agent-warm", agentWarmInternalRouter);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith("http://claw-auth.internal")) {
        state.internalCalls.push({
          headers: init?.headers as Record<string, string>,
          body: JSON.parse(String(init?.body)),
        });
        return new Response(JSON.stringify({ success: true }), { status: 202 });
      }
      return realFetch(url, init);
    }),
  );
});

afterAll(() => {
  vi.unstubAllGlobals();
  server.close();
});

afterEach(() => {
  state.agents.clear();
  state.claimed.clear();
  state.internalCalls.length = 0;
  state.warmed.length = 0;
});

function warm(slug: string, userId?: string) {
  return fetch(`${base}/agent-warm/${slug}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(userId ? { "x-user-id": userId } : {}) },
  });
}

describe("agent warm-up", () => {
  it("re-sends the warm-up internally, pinned to the user", async () => {
    state.agents.set("ask-ai", { slug: "ask-ai", config: null });
    const res = await warm("ask-ai", "user-1");
    expect(res.status).toBe(202);
    await vi.waitFor(() => expect(state.internalCalls).toHaveLength(1));
    expect(state.internalCalls[0]!.headers[CLAW_USER_HEADER]).toBe("user-1");
    expect(state.internalCalls[0]!.headers["x-s2s-key"]).toBe("s2s-key");
    expect(state.internalCalls[0]!.body).toEqual({ userId: "user-1", agentSlug: "ask-ai" });
  });

  it("warms a user and agent at most once per interval", async () => {
    state.agents.set("ask-ai", { slug: "ask-ai", config: null });
    await warm("ask-ai", "user-1");
    await vi.waitFor(() => expect(state.internalCalls).toHaveLength(1));
    const again = await warm("ask-ai", "user-1");
    expect(again.status).toBe(202);
    await new Promise((r) => setTimeout(r, 20));
    expect(state.internalCalls).toHaveLength(1);
  });

  it("refuses unknown agents, restricted agents and anonymous callers", async () => {
    state.agents.set("locked", { slug: "locked", config: { privacy: { mode: "whitelist", whitelist: ["someone-else"] } } });
    expect((await warm("missing", "user-1")).status).toBe(404);
    expect((await warm("locked", "user-1")).status).toBe(404);
    expect((await warm("missing")).status).toBe(401);
    await new Promise((r) => setTimeout(r, 20));
    expect(state.internalCalls).toHaveLength(0);
  });

  it("internal warm-up loads the agent's tool lists", async () => {
    const res = await fetch(`${base}/internal/agent-warm/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "user-1", agentSlug: "ask-ai" }),
    });
    expect(res.status).toBe(202);
    await vi.waitFor(() => expect(state.warmed).toEqual([["user-1", "ask-ai"]]));
  });

  it("internal warm-up rejects a request without user or agent", async () => {
    const res = await fetch(`${base}/internal/agent-warm/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentSlug: "ask-ai" }),
    });
    expect(res.status).toBe(400);
  });
});
