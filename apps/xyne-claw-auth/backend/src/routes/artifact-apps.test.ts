/**
 * Authorization tests for saved & published artifact apps.
 *
 * These are the tests that matter: publishing widens who may read an app, and a
 * mistake here leaks a colleague's private work rather than merely breaking a
 * screen. Everything is mocked — the point is the decision logic, not Prisma.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

const OWNER = "user-owner";
const PEER = "user-peer";            // same workspace as OWNER
const OUTSIDER = "user-outsider";    // different workspace
const WS = "ws-1";

const state = vi.hoisted(() => ({
  apps: new Map<string, Record<string, unknown>>(),
  versions: new Map<string, Record<string, unknown>>(),
  workspaces: new Map<string, string | null>(),
  users: new Map<string, { name: string | null; email: string | null }>(),
  streamed: [] as string[],
}));

vi.mock("../db.js", () => ({
  prisma: {
    artifactApp: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => state.apps.get(where.id) ?? null),
      findMany: vi.fn(async () => []),
      create: vi.fn(),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const app = { ...(state.apps.get(where.id) as Record<string, unknown>), ...data };
        state.apps.set(where.id, app);
        return app;
      }),
    },
    artifactAppVersion: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => state.versions.get(where.id) ?? null),
      // Owner-with-no-pin falls back to the latest build, so the mock has to
      // actually order by versionNumber rather than return null.
      findFirst: vi.fn(async ({ where }: { where: { appId: string } }) => {
        const rows = [...state.versions.values()]
          .filter((v) => (v as { appId: string }).appId === where.appId)
          .sort((a, b) => (b as { versionNumber: number }).versionNumber - (a as { versionNumber: number }).versionNumber);
        return rows[0] ?? null;
      }),
      findMany: vi.fn(async () => []),
      create: vi.fn(),
      update: vi.fn(),
    },
    artifactAppRestore: {
      findMany: vi.fn(async () => []),
      create: vi.fn(),
    },
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => state.users.get(where.id) ?? null),
    },
  },
}));

vi.mock("../services/storageService.js", () => ({
  gcsService: {
    getFileBuffer: vi.fn(),
    uploadFile: vi.fn(),
    createReadStream: vi.fn((path: string) => {
      state.streamed.push(path);
      return { on: vi.fn(), pipe: vi.fn() };
    }),
  },
}));

vi.mock("../lib/spaces-db.js", () => ({
  getWorkspaceIdForUser: vi.fn(async (userId: string) => state.workspaces.get(userId) ?? null),
}));

vi.mock("../repositories/index.js", () => ({
  chatAttachmentRepository: { findById: vi.fn(async () => null) },
}));

vi.mock("../logger.js", () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }),
}));

vi.mock("xyne-claw-shared/tools/react-artifact", () => ({
  buildReactArtifact: vi.fn(),
}));

const { artifactAppsRouter } = await import("./artifact-apps.js");

/** Pull a handler off the router's stack so it can be invoked directly. */
function handlerFor(method: string, path: string): (req: Request, res: Response) => Promise<void> {
  type Layer = {
    route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: unknown }> };
  };
  const stack = (artifactAppsRouter as unknown as { stack: Layer[] }).stack;
  const layer = stack.find((l) => l.route?.path === path && l.route?.methods[method]);
  if (!layer?.route) throw new Error(`no handler for ${method.toUpperCase()} ${path}`);
  return layer.route.stack[0]!.handle as (req: Request, res: Response) => Promise<void>;
}

function mockRes(): Response & { statusCode: number; body: unknown; headers: Record<string, string> } {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
    setHeader(k: string, v: string) { this.headers[k] = v; },
    destroy: vi.fn(),
    headersSent: false,
  };
  return res as unknown as Response & { statusCode: number; body: unknown; headers: Record<string, string> };
}

function mockReq(userId: string | null, params: Record<string, string>, query: Record<string, string> = {}): Request {
  return {
    headers: userId ? { "x-user-id": userId } : {},
    params,
    query,
    body: {},
  } as unknown as Request;
}

beforeEach(() => {
  state.apps.clear();
  state.versions.clear();
  state.workspaces.clear();
  state.users.clear();
  state.streamed = [];

  state.workspaces.set(OWNER, WS);
  state.workspaces.set(PEER, WS);
  state.workspaces.set(OUTSIDER, "ws-other");

  state.users.set(OWNER, { name: "Ada Owner", email: "ada@example.com" });

  state.versions.set("v1", { id: "v1", appId: "app-1", versionNumber: 1, storagePath: "artifact-apps/app-1/v1.json" });
  state.versions.set("v2", { id: "v2", appId: "app-1", versionNumber: 2, storagePath: "artifact-apps/app-1/v2.json" });

  state.apps.set("app-1", {
    id: "app-1",
    workspaceId: WS,
    ownerUserId: OWNER,
    title: "Ticket dashboard",
    visibility: "PRIVATE",
    publishedVersionId: null,
    isArchived: false,
  });
});

function publish(versionId = "v1"): void {
  const app = state.apps.get("app-1") as Record<string, unknown>;
  state.apps.set("app-1", { ...app, visibility: "WORKSPACE", publishedVersionId: versionId });
}

describe("GET /:id/payload", () => {
  const call = (userId: string | null, query: Record<string, string> = {}) => {
    const res = mockRes();
    return handlerFor("get", "/:id/payload")(mockReq(userId, { id: "app-1" }, query), res).then(() => res);
  };

  it("rejects an unauthenticated caller", async () => {
    expect((await call(null)).statusCode).toBe(401);
  });

  it("serves the owner their latest build while the app is private", async () => {
    const res = await call(OWNER);
    expect(res.statusCode).toBe(200);
    // No pin yet, so the owner gets the newest version, not the first.
    expect(state.streamed).toEqual(["artifact-apps/app-1/v2.json"]);
  });

  it("refuses a workspace peer while the app is private", async () => {
    const res = await call(PEER);
    expect(res.statusCode).toBe(403);
    expect(state.streamed).toEqual([]);
  });

  it("serves a workspace peer once published", async () => {
    publish();
    const res = await call(PEER);
    expect(res.statusCode).toBe(200);
    expect(state.streamed).toEqual(["artifact-apps/app-1/v1.json"]);
  });

  it("refuses someone in another workspace even when published", async () => {
    publish();
    const res = await call(OUTSIDER);
    expect(res.statusCode).toBe(403);
    expect(state.streamed).toEqual([]);
  });

  // The leak this design is most exposed to: publishing v1 must not turn the
  // app into a readable index of the author's later, unpublished drafts.
  it("ignores a peer's versionId and serves only the pinned version", async () => {
    publish("v1");
    const res = await call(PEER, { versionId: "v2" });
    expect(res.statusCode).toBe(200);
    expect(state.streamed).toEqual(["artifact-apps/app-1/v1.json"]);
  });

  it("lets the owner request a specific version", async () => {
    publish("v1");
    const res = await call(OWNER, { versionId: "v2" });
    expect(res.statusCode).toBe(200);
    expect(state.streamed).toEqual(["artifact-apps/app-1/v2.json"]);
  });

  it("refuses an archived app even for its owner", async () => {
    const app = state.apps.get("app-1") as Record<string, unknown>;
    state.apps.set("app-1", { ...app, isArchived: true });
    expect((await call(OWNER)).statusCode).toBe(404);
  });
});

describe("publish / unpublish", () => {
  const post = (path: string, userId: string | null, body: Record<string, unknown> = {}) => {
    const res = mockRes();
    const req = mockReq(userId, { id: "app-1" });
    (req as unknown as { body: unknown }).body = body;
    return handlerFor("post", path)(req, res).then(() => res);
  };

  it("lets the owner publish a version", async () => {
    const res = await post("/:id/publish", OWNER, { versionId: "v1" });
    expect(res.statusCode).toBe(200);
    expect(state.apps.get("app-1")).toMatchObject({ visibility: "WORKSPACE", publishedVersionId: "v1" });
  });

  it("refuses a peer publishing someone else's app", async () => {
    const res = await post("/:id/publish", PEER, { versionId: "v1" });
    expect(res.statusCode).toBe(403);
    expect(state.apps.get("app-1")).toMatchObject({ visibility: "PRIVATE" });
  });

  it("refuses publishing a version belonging to another app", async () => {
    state.versions.set("v-other", { id: "v-other", appId: "app-2", versionNumber: 1, storagePath: "x" });
    const res = await post("/:id/publish", OWNER, { versionId: "v-other" });
    expect(res.statusCode).toBe(404);
    expect(state.apps.get("app-1")).toMatchObject({ visibility: "PRIVATE" });
  });

  it("rejects a publish with no versionId", async () => {
    expect((await post("/:id/publish", OWNER, {})).statusCode).toBe(400);
  });

  it("clears the pin on unpublish", async () => {
    publish();
    const res = await post("/:id/unpublish", OWNER);
    expect(res.statusCode).toBe(200);
    expect(state.apps.get("app-1")).toMatchObject({ visibility: "PRIVATE", publishedVersionId: null });
  });

  it("refuses a peer unpublishing", async () => {
    publish();
    const res = await post("/:id/unpublish", PEER);
    expect(res.statusCode).toBe(403);
    expect(state.apps.get("app-1")).toMatchObject({ visibility: "WORKSPACE" });
  });
});

describe("GET /:id metadata", () => {
  const call = (userId: string) => {
    const res = mockRes();
    return handlerFor("get", "/:id")(mockReq(userId, { id: "app-1" }), res).then(() => res);
  };

  it("hides a private app from a peer as 404, not 403", async () => {
    // 404 rather than 403 so listing cannot be used to probe for private apps.
    expect((await call(PEER)).statusCode).toBe(404);
  });

  it("shows a published app to a peer, marked not-owned", async () => {
    publish();
    const res = await call(PEER);
    expect(res.statusCode).toBe(200);
    expect((res.body as { app: { isOwner: boolean } }).app.isOwner).toBe(false);
  });

  // Settings names whoever built the app. A cuid answers nobody's question, and
  // the peer looking at a published app is exactly who needs the name.
  it("names the owner", async () => {
    publish();
    const res = await call(PEER);
    expect((res.body as { app: { ownerName: string | null } }).app.ownerName).toBe("Ada Owner");
  });

  it("falls back to the email local-part when the owner has no name", async () => {
    state.users.set(OWNER, { name: null, email: "ada@example.com" });
    publish();
    const res = await call(PEER);
    expect((res.body as { app: { ownerName: string | null } }).app.ownerName).toBe("ada");
  });
});
