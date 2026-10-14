import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

const findUnique = vi.hoisted(() => vi.fn());
const createAgentQueueError = vi.hoisted(() => vi.fn());
const createAgentNotGranted = vi.hoisted(() => vi.fn());

vi.mock("../db.js", () => ({ prisma: { user: { findUnique } } }));
vi.mock("../logger.js", () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock("../lib/agent-draft-card.js", () => ({ createAgentQueueError, createAgentNotGranted }));

const { agentCreateCheckRouter } = await import("./agent-create-check.js");

type Layer = { route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: unknown }> } };
const layer = (agentCreateCheckRouter as unknown as { stack: Layer[] }).stack.find(
  (l) => l.route?.path === "/check" && l.route?.methods["post"],
);
const handler = layer!.route!.stack[0]!.handle as (req: Request, res: Response) => Promise<void>;

async function check(body: unknown): Promise<unknown> {
  let payload: unknown;
  const res = { json: (value: unknown) => { payload = value; return res; } } as unknown as Response;
  await handler({ body } as Request, res);
  return payload;
}

describe("POST /internal/agent-create/check", () => {
  beforeEach(() => {
    findUnique.mockReset();
    createAgentQueueError.mockReset();
    createAgentNotGranted.mockReset();
  });

  it("checks the draft against the user's org", async () => {
    findUnique.mockResolvedValue({ orgId: "org-1" });
    createAgentQueueError.mockResolvedValue("An agent called **Cricket Scores** already exists here.");

    expect(await check({ userId: "u1", params: { name: "Cricket Scores" } })).toEqual({
      success: true,
      known: true,
      error: "An agent called **Cricket Scores** already exists here.",
      notGranted: [],
    });
    expect(createAgentQueueError).toHaveBeenCalledWith({ name: "Cricket Scores" }, "org-1");
    expect(createAgentNotGranted).not.toHaveBeenCalled();
  });

  it("allows a free name and reports tools that do not exist", async () => {
    findUnique.mockResolvedValue({ orgId: "org-1" });
    createAgentQueueError.mockResolvedValue(null);
    createAgentNotGranted.mockResolvedValue(["sandbox-run-command"]);

    expect(await check({ userId: "u1", params: { name: "Web Scraper" } })).toEqual({
      success: true,
      known: true,
      error: null,
      notGranted: ["sandbox-run-command"],
    });
    expect(createAgentNotGranted).toHaveBeenCalledWith({ name: "Web Scraper" }, "org-1", "u1");
  });

  it("fails open when the user or params are missing, or the lookup throws", async () => {
    expect(await check({ params: {} })).toEqual({ success: true, known: false, error: null, notGranted: [] });
    expect(await check({ userId: "u1", params: ["x"] })).toEqual({ success: true, known: false, error: null, notGranted: [] });

    findUnique.mockResolvedValue(null);
    expect(await check({ userId: "u1", params: {} })).toEqual({ success: true, known: false, error: null, notGranted: [] });

    findUnique.mockRejectedValue(new Error("db down"));
    expect(await check({ userId: "u1", params: {} })).toEqual({ success: true, known: false, error: null, notGranted: [] });
  });
});
