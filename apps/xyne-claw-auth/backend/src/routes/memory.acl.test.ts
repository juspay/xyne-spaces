import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * ACL and request validation on the /memory routes.
 * Org "org-1" holds agent "alpha" (owner "owner", editor "editor", visible to
 * "viewer"); "stranger" is in the same org with no access; "admin" is a
 * CLAW_ADMIN. Org "org-2" holds a batch for an agent of its own.
 */

const state = vi.hoisted(() => ({
  agents: [] as Array<Record<string, any>>,
  shares: new Map<string, string>(),
  visible: new Set<string>(),
  admins: new Set<string>(),
  batches: [] as Array<Record<string, any>>,
  jobs: new Map<string, { data: { agentSlug: string } }>(),
  deleted: [] as string[],
}));

vi.mock("xyne-claw-shared", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getMemoryProvider: () => ({
      name: "fake",
      capabilities: { entityGraph: false },
      listMemories: vi.fn(async () => ({ memories: [], total: 0 })),
      recall: vi.fn(async () => []),
      deleteMemory: vi.fn(async (_bank: string, id: string) => {
        state.deleted.push(id);
      }),
      clearAll: vi.fn(async () => 0),
    }),
  };
});

vi.mock("../db.js", () => ({
  prisma: {
    pendingBatchReview: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; orgId: string } }) =>
        state.batches.find((b) => b["id"] === where.id && b["orgId"] === where.orgId) ?? null,
      ),
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        state.batches.filter((b) => Object.entries(where).every(([k, v]) => b[k] === v)),
      ),
      count: vi.fn(async () => 0),
    },
    pendingMemoryReview: { updateMany: vi.fn(async () => ({ count: 0 })) },
    memoryRecallHit: {
      groupBy: vi.fn(async () => []),
      count: vi.fn(async () => 0),
      createMany: vi.fn(async ({ data }: { data: unknown[] }) => ({ count: data.length })),
    },
    user: { findMany: vi.fn(async () => [{ id: "owner", orgId: "org-1" }]) },
  },
}));

vi.mock("../repositories/index.js", () => ({
  agentRepository: {
    findBySlugVisibleTo: vi.fn(async (slug: string, orgId: string, userId: string) =>
      state.visible.has(`${slug}|${orgId}|${userId}`) ? { slug, orgId } : null,
    ),
    update: vi.fn(async () => undefined),
  },
}));

vi.mock("../middleware/agent-acl.js", () => ({
  getRequesterId: (req: Request) => req.headers["x-user-id"],
  getOrgId: (req: Request) => req.headers["x-org-id"],
  isClawAdmin: vi.fn(async (userId: string) => state.admins.has(userId)),
  requireClawAdmin: (req: Request, res: Response, next: NextFunction) => {
    if (state.admins.has(req.headers["x-user-id"] as string)) next();
    else res.status(403).json({ success: false });
  },
  getAgentEditAccess: vi.fn(async (userId: string, slug: string, orgId: string) => {
    const agent = state.agents.find((a) => a["slug"] === slug && a["orgId"] === orgId);
    if (!agent) return null;
    const isOwner = agent["ownerUserId"] === userId;
    const isContributor = !isOwner && state.shares.get(`${slug}|${userId}`) === "EDITOR";
    return { agent, isOwner, isContributor, canEdit: isOwner || isContributor };
  }),
}));

vi.mock("../middleware/require-auth.js", () => ({
  requireUserAuth: (req: Request, res: Response, next: NextFunction) => {
    if (req.headers["x-user-id"]) next();
    else res.status(401).json({ success: false });
  },
}));

vi.mock("../lib/service-assertion.js", () => ({
  callerService: (req: Request) => req.headers["x-test-service"],
  requireService:
    (...allow: string[]) =>
    (req: Request, res: Response, next: NextFunction) => {
      if (allow.includes(req.headers["x-test-service"] as string)) next();
      else res.status(401).json({ success: false });
    },
}));

vi.mock("../middleware/pin-user-id-param.js", () => ({
  matchesAuthenticatedUserId: (req: Request, id: string) => req.headers["x-user-id"] === id,
}));
vi.mock("../lib/users-jit.js", () => ({ resolveClawUserIdForSpacesIdentity: vi.fn(async () => undefined) }));
vi.mock("../services/memoryCronService.js", () => ({
  curateApprovedTranscript: vi.fn(async () => []),
  persistSubsystemReviews: vi.fn(async () => []),
  readSessionTranscript: vi.fn(async (sessionId: string) => ({
    sessionId,
    task: `task of ${sessionId}`,
    toolsUsed: [],
    tokensIn: 1,
    tokensOut: 2,
  })),
}));
vi.mock("../services/sessionCurator.js", () => ({}));
vi.mock("../services/memoryRetentionService.js", () => ({ runRetentionSweep: vi.fn() }));
vi.mock("../services/twinMemoryBank.js", () => ({}));
vi.mock("../services/agentMemoryFiles.js", () => ({
  MAX_FILE_CHARS: 10_000,
  MEMORY_FILE_NAME_RE: /^[a-zA-Z0-9._-]{1,64}$/,
}));
vi.mock("../queue/agent-backfill-queue.js", () => ({
  enqueueAgentBackfill: vi.fn(async () => "job-1"),
  getAgentBackfillQueue: () => ({
    getJob: vi.fn(async (id: string) => {
      const job = state.jobs.get(id);
      return job ? { ...job, getState: async () => "completed", returnvalue: null } : null;
    }),
  }),
}));
vi.mock("../logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  createTraceId: () => "trace",
}));

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const { memoryRouter } = await import("./memory.js");
  const app = express();
  app.use(express.json());
  app.use("/memory", memoryRouter);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  state.agents = [
    { id: "a1", slug: "alpha", orgId: "org-1", ownerUserId: "owner", config: { memoryEnabled: true } },
    { id: "a2", slug: "beta", orgId: "org-2", ownerUserId: "other", config: {} },
  ];
  state.shares = new Map([["alpha|editor", "EDITOR"]]);
  state.visible = new Set(["alpha|org-1|viewer"]);
  state.admins = new Set(["admin"]);
  state.batches = [
    { id: "batch-1", orgId: "org-1", agentSlug: "alpha", status: "pending", sessionIds: ["s1"] },
    { id: "batch-2", orgId: "org-2", agentSlug: "beta", status: "pending", sessionIds: ["s2"] },
  ];
  state.jobs = new Map([["job-alpha", { data: { agentSlug: "alpha" } }], ["job-beta", { data: { agentSlug: "beta" } }]]);
  state.deleted = [];
});

async function call(
  method: string,
  path: string,
  opts: { user?: string; org?: string; service?: string; body?: unknown } = {},
): Promise<{ status: number; body: Record<string, any> }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.user) headers["x-user-id"] = opts.user;
  headers["x-org-id"] = opts.org ?? "org-1";
  if (opts.service) headers["x-test-service"] = opts.service;
  const res = await fetch(`${baseUrl}/memory${path}`, {
    method,
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

describe("GET /memory/batches/:id", () => {
  it("returns 404 to an org member who cannot maintain the agent", async () => {
    for (const user of ["stranger", "viewer"]) {
      const res = await call("GET", "/batches/batch-1", { user });
      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain("task of s1");
    }
  });

  it("returns the previews to the owner, an editor and an admin", async () => {
    for (const user of ["owner", "editor", "admin"]) {
      const res = await call("GET", "/batches/batch-1", { user });
      expect(res.status).toBe(200);
      expect(res.body["data"]["sessions"][0]["task"]).toBe("task of s1");
    }
  });

  it("returns 404 for a batch in another org, even to an admin", async () => {
    expect((await call("GET", "/batches/batch-2", { user: "admin" })).status).toBe(404);
  });
});

describe("GET /memory/batches", () => {
  it("lists one agent's batches only for someone who can maintain it", async () => {
    expect((await call("GET", "/batches?agentSlug=alpha", { user: "stranger" })).status).toBe(404);
    expect((await call("GET", "/batches?agentSlug=alpha", { user: "viewer" })).status).toBe(404);
    const res = await call("GET", "/batches?agentSlug=alpha", { user: "editor" });
    expect(res.status).toBe(200);
    expect(res.body["data"].map((b: { id: string }) => b.id)).toEqual(["batch-1"]);
  });

  it("keeps the org-wide list for admins", async () => {
    expect((await call("GET", "/batches", { user: "owner" })).status).toBe(403);
    expect((await call("GET", "/batches", { user: "admin" })).status).toBe(200);
  });
});

describe("/memory/banks/:agentSlug", () => {
  it("lets anyone who can see the agent read its memories, and no one else", async () => {
    expect((await call("GET", "/banks/alpha/memories", { user: "stranger" })).status).toBe(404);
    expect((await call("GET", "/banks/alpha/memories", { user: "viewer" })).status).toBe(200);
    expect((await call("GET", "/banks/alpha/status", { user: "viewer" })).status).toBe(200);
    expect((await call("GET", "/banks/beta/memories", { user: "viewer" })).status).toBe(404);
  });

  it("requires maintain access to delete a memory", async () => {
    expect((await call("DELETE", "/banks/alpha/memories/m1", { user: "viewer" })).status).toBe(403);
    expect((await call("DELETE", "/banks/alpha/memories/m1", { user: "stranger" })).status).toBe(404);
    expect(state.deleted).toEqual([]);
    expect((await call("DELETE", "/banks/alpha/memories/m1", { user: "editor" })).status).toBe(200);
    expect(state.deleted).toEqual(["m1"]);
  });

  it("keeps clear-all to the owner and admins", async () => {
    expect((await call("POST", "/banks/alpha/clear-all", { user: "editor" })).status).toBe(403);
    expect((await call("POST", "/banks/alpha/clear-all", { user: "owner" })).status).toBe(200);
    expect((await call("POST", "/banks/alpha/clear-all", { user: "admin" })).status).toBe(200);
  });

  it("only reports backfill jobs that belong to the agent in the path", async () => {
    expect((await call("GET", "/banks/alpha/backfill/job-alpha", { user: "viewer" })).status).toBe(403);
    expect((await call("GET", "/banks/alpha/backfill/job-alpha", { user: "owner" })).status).toBe(200);
    expect((await call("GET", "/banks/alpha/backfill/job-beta", { user: "owner" })).status).toBe(404);
  });
});

describe("request validation", () => {
  it("rejects malformed bodies and params with 400", async () => {
    expect((await call("POST", "/banks/alpha/recall", { user: "owner", body: { query: "  " } })).status).toBe(400);
    expect((await call("POST", "/banks/alpha/backfill", { user: "owner", body: { days: 31 } })).status).toBe(400);
    expect((await call("POST", "/banks/alpha/backfill", { user: "owner", body: { from: "2026-01-01" } })).status).toBe(400);
    expect((await call("DELETE", "/banks/alpha/subsystems/Bad Name!", { user: "owner" })).status).toBe(400);
    expect((await call("GET", "/banks/alpha/stats?range=1y", { user: "owner" })).status).toBe(400);
  });
});

describe("POST /memory/recall-hits", () => {
  const hit = {
    agentSlug: "alpha",
    hindsightMemoryId: "m1",
    userId: "owner",
    sessionId: "s1",
    scope: "shared",
    rank: 1,
    recalledAt: "2026-11-20T00:00:00.000Z",
  };

  it("accepts only the xyne-claw runtime", async () => {
    expect((await call("POST", "/recall-hits", { user: "owner", body: { hits: [hit] } })).status).toBe(401);
    expect((await call("POST", "/recall-hits", { service: "xyne-spaces", body: { hits: [hit] } })).status).toBe(401);
    const res = await call("POST", "/recall-hits", { service: "xyne-claw", body: { hits: [hit] } });
    expect(res.status).toBe(200);
    expect(res.body["data"]["inserted"]).toBe(1);
  });
});
