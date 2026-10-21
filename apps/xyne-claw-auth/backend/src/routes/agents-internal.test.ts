/**
 * Spaces stamps a new app user AGENT or APP from this answer, once and for good,
 * so the cases that matter are the ones the `/agents` list gets wrong (personal,
 * disabled) and an error never reading as "not an agent".
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

const findBySpacesAppId = vi.hoisted(() => vi.fn());

vi.mock("../repositories/index.js", () => ({
  agentRepository: { findBySpacesAppId },
}));

const { agentsInternalRouter } = await import("./agents-internal.js");

function handlerFor(method: string, path: string): (req: Request, res: Response) => Promise<void> {
  type Layer = {
    route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: unknown }> };
  };
  const stack = (agentsInternalRouter as unknown as { stack: Layer[] }).stack;
  const layer = stack.find((l) => l.route?.path === path && l.route?.methods[method]);
  if (!layer?.route) throw new Error(`no handler for ${method.toUpperCase()} ${path}`);
  return layer.route.stack[0]!.handle as (req: Request, res: Response) => Promise<void>;
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

const lookup = handlerFor("get", "/by-spaces-app/:spacesAppId");

async function call(spacesAppId: string) {
  const res = mockRes();
  await lookup({ params: { spacesAppId } } as unknown as Request, res);
  return res;
}

describe("GET /internal/agents/by-spaces-app/:spacesAppId", () => {
  beforeEach(() => findBySpacesAppId.mockReset());

  it("is an agent when an agent is published as this app", async () => {
    findBySpacesAppId.mockResolvedValueOnce({ id: "a1", scope: "global", enabled: true });
    const res = await call("app-1");
    expect(findBySpacesAppId).toHaveBeenCalledWith("app-1");
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, data: { isAgent: true } });
  });

  it("counts personal (cloned) and disabled agents — no visibility or enabled filter", async () => {
    findBySpacesAppId.mockResolvedValueOnce({ id: "a2", scope: "personal", enabled: false });
    const res = await call("app-2");
    expect(res.body).toEqual({ success: true, data: { isAgent: true } });
  });

  it("is not an agent when no agent points at the app", async () => {
    findBySpacesAppId.mockResolvedValueOnce(null);
    const res = await call("plain-app");
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, data: { isAgent: false } });
  });

  it("fails with 500 rather than answering 'not an agent' when the lookup throws", async () => {
    findBySpacesAppId.mockRejectedValueOnce(new Error("db down"));
    const res = await call("app-3");
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ success: false, error: "Agent lookup failed" });
  });

  it("rejects a blank id without querying", async () => {
    const res = await call("  ");
    expect(res.statusCode).toBe(400);
    expect(findBySpacesAppId).not.toHaveBeenCalled();
  });
});
