/**
 * GET /agents?spacesAppId= — Spaces stamps a new app user AGENT or APP from this
 * answer, once and for good. The cases that matter: agents the normal list hides
 * (personal/cloned, disabled) must still be found, and only S2S callers may ask.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

vi.hoisted(() => {
  // config.ts throws on missing required env at import time.
  process.env["ENCRYPTION_KEY"] ??= "0".repeat(64);
});

const findBySpacesAppId = vi.hoisted(() => vi.fn());
const listVisible = vi.hoisted(() => vi.fn(async () => []));
const S2S_KEY = "test-s2s-key";

vi.mock("../repositories/index.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    agentRepository: { ...(actual["agentRepository"] as object), findBySpacesAppId, listVisible },
  };
});
vi.mock("../middleware/require-auth.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, s2sKeyMatches: (provided: unknown) => provided === S2S_KEY };
});
vi.mock("../middleware/agent-acl.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, isClawAdmin: vi.fn(async () => false) };
});

const { agentsRouter } = await import("./agents.js");

function handlerFor(method: string, path: string): (req: Request, res: Response, next: (err?: unknown) => void) => void {
  type Layer = {
    route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: unknown }> };
  };
  const stack = (agentsRouter as unknown as { stack: Layer[] }).stack;
  const layer = stack.find((l) => l.route?.path === path && l.route?.methods[method]);
  if (!layer?.route) throw new Error(`no handler for ${method.toUpperCase()} ${path}`);
  const route = layer.route.stack;
  return route[route.length - 1]!.handle as (req: Request, res: Response, next: (err?: unknown) => void) => void;
}

function mockRes(): Response & { statusCode: number; body: unknown } {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

const list = handlerFor("get", "/");

/** Runs the asyncHandler-wrapped route; settles only when it responds (res.json) or errors (next). */
async function call(query: Record<string, string>, headers: Record<string, string> = {}) {
  const res = mockRes();
  const err = await new Promise<unknown>((resolve) => {
    const json = res.json.bind(res);
    res.json = ((payload: unknown) => { const r = json(payload); resolve(undefined); return r; }) as typeof res.json;
    const req = { query, headers, params: {} } as unknown as Request;
    list(req, res, (e?: unknown) => resolve(e ?? new Error("next() called without an error")));
  });
  return { res, err };
}

describe("GET /agents?spacesAppId=", () => {
  beforeEach(() => {
    findBySpacesAppId.mockReset();
    listVisible.mockClear();
  });

  it("returns the agent published as this app — even a personal, disabled one", async () => {
    findBySpacesAppId.mockResolvedValueOnce({ id: "a1", slug: "my-clone", scope: "personal", enabled: false, spacesAppId: "app-1" });
    const { res, err } = await call({ spacesAppId: "app-1" }, { "x-s2s-key": S2S_KEY });
    expect(err).toBeUndefined();
    expect(findBySpacesAppId).toHaveBeenCalledWith("app-1");
    expect(listVisible).not.toHaveBeenCalled();
    const body = res.body as { success: boolean; data: Array<Record<string, unknown>> };
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ slug: "my-clone", scope: "personal", enabled: false, spacesAppId: "app-1" });
  });

  it("returns an empty list when no agent points at the app", async () => {
    findBySpacesAppId.mockResolvedValueOnce(null);
    const { res, err } = await call({ spacesAppId: "plain-app" }, { "x-s2s-key": S2S_KEY });
    expect(err).toBeUndefined();
    expect(res.body).toMatchObject({ success: true, data: [] });
  });

  it("rejects a non-S2S caller without querying", async () => {
    const { err } = await call({ spacesAppId: "app-1" }, { "x-user-id": "u1" });
    expect(err).toMatchObject({ status: 403 });
    expect(findBySpacesAppId).not.toHaveBeenCalled();
  });

  it("surfaces a lookup failure as an error, never as 'not an agent'", async () => {
    findBySpacesAppId.mockRejectedValueOnce(new Error("db down"));
    const { res, err } = await call({ spacesAppId: "app-1" }, { "x-s2s-key": S2S_KEY });
    expect(err).toBeInstanceOf(Error);
    expect(res.body).toBeUndefined();
  });

  it("rejects an empty or repeated spacesAppId instead of falling through to the full list", async () => {
    for (const spacesAppId of ["", "  ", ["a", "b"]]) {
      const { res, err } = await call({ spacesAppId } as unknown as Record<string, string>, { "x-s2s-key": S2S_KEY });
      expect(err).toMatchObject({ status: 400 });
      expect(res.body).toBeUndefined();
    }
    expect(findBySpacesAppId).not.toHaveBeenCalled();
    expect(listVisible).not.toHaveBeenCalled();
  });

  it("leaves the normal list untouched when spacesAppId is absent", async () => {
    const { err } = await call({}, { "x-s2s-key": S2S_KEY });
    expect(err).toBeUndefined();
    expect(findBySpacesAppId).not.toHaveBeenCalled();
    expect(listVisible).toHaveBeenCalled();
  });
});
