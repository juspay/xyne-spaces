import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { Prisma } from "@prisma/client";

/**
 * Drives the real chatProjectRepository against an in-memory prisma, so the
 * owner check these routes depend on is genuinely exercised rather than stubbed
 * out. Only `../db.js` and the identity middleware are faked.
 *
 * `../repositories/index.js` is replaced with just the one repository: the real
 * barrel pulls ~30 modules, some of which reach config.ts and die on a missing
 * ENCRYPTION_KEY at import.
 */

const state = vi.hoisted(() => ({
  projects: [] as Array<Record<string, any>>,
  items: [] as Array<Record<string, any>>,
  messages: [] as Array<Record<string, any>>,
  users: [] as Array<Record<string, any>>,
  knowledge: [] as Array<Record<string, any>>,
  attachments: [] as Array<Record<string, any>>,
}));

const matches = (filter: unknown, value: string): boolean => {
  if (filter === undefined) return true;
  if (typeof filter === "string") return filter === value;
  const asIn = filter as { in?: string[] };
  return Array.isArray(asIn.in) ? asIn.in.includes(value) : false;
};

const projectWhere = (where: Record<string, any> = {}) => (row: Record<string, any>) =>
  (where["id"] === undefined || row["id"] === where["id"]) &&
  (where["orgId"] === undefined || row["orgId"] === where["orgId"]) &&
  matches(where["ownerUserId"], row["ownerUserId"]);

const itemWhere = (where: Record<string, any> = {}) => (row: Record<string, any>) =>
  (where["conversationId"] === undefined ||
    (typeof where["conversationId"] === "string"
      ? row["conversationId"] === where["conversationId"]
      : (where["conversationId"].in as string[]).includes(row["conversationId"]))) &&
  (where["projectId"] === undefined || row["projectId"] === where["projectId"]) &&
  (where["orgId"] === undefined || row["orgId"] === where["orgId"]) &&
  matches(where["userId"], row["userId"]);

vi.mock("../db.js", () => ({
  prisma: {
    user: {
      findFirst: vi.fn(async (args: any) => {
        const ids = args?.where?.id?.in ?? [];
        return state.users.find((u) => ids.includes(u["id"])) ?? null;
      }),
    },
    chatProject: {
      findMany: vi.fn(async (args: any) => {
        const hits = state.projects.filter(projectWhere(args?.where));
        return [...hits].sort((a, b) => a["sortOrder"] - b["sortOrder"]);
      }),
      findFirst: vi.fn(async (args: any) => {
        const hits = state.projects.filter(projectWhere(args?.where));
        if (args?.orderBy?.sortOrder === "desc") {
          return [...hits].sort((a, b) => b["sortOrder"] - a["sortOrder"])[0] ?? null;
        }
        return hits[0] ?? null;
      }),
      findUnique: vi.fn(async (args: any) =>
        state.projects.find((p) => p["id"] === args.where.id) ?? null,
      ),
      create: vi.fn(async (args: any) => {
        const row = { id: `proj-${state.projects.length + 1}`, instructionsEnabled: true, ...args.data };
        state.projects.push(row);
        return row;
      }),
      update: vi.fn(async (args: any) => {
        const row = state.projects.find((p) => p["id"] === args.where.id);
        if (!row) throw new Error("not found");
        Object.assign(row, args.data);
        return row;
      }),
      updateMany: vi.fn(async (args: any) => {
        const hits = state.projects.filter(projectWhere(args?.where));
        hits.forEach((row) => Object.assign(row, args.data));
        return { count: hits.length };
      }),
      deleteMany: vi.fn(async (args: any) => {
        const hits = state.projects.filter(projectWhere(args?.where));
        const ids = new Set(hits.map((p) => p["id"]));
        state.projects = state.projects.filter((p) => !ids.has(p["id"]));
        state.items = state.items.filter((i) => !ids.has(i["projectId"])); // FK cascade
        return { count: hits.length };
      }),
    },
    chatProjectItem: {
      findFirst: vi.fn(async (args: any) => state.items.filter(itemWhere(args?.where))[0] ?? null),
      findMany: vi.fn(async (args: any) => state.items.filter(itemWhere(args?.where))),
      upsert: vi.fn(async (args: any) => {
        const { conversationId, userId } = args.where.conversationId_userId;
        const existing = state.items.find(
          (i) => i["conversationId"] === conversationId && i["userId"] === userId,
        );
        if (existing) {
          Object.assign(existing, args.update);
          return existing;
        }
        const row = { ...args.create };
        state.items.push(row);
        return row;
      }),
      deleteMany: vi.fn(async (args: any) => {
        const hits = state.items.filter(itemWhere(args?.where));
        state.items = state.items.filter((i) => !hits.includes(i));
        return { count: hits.length };
      }),
      groupBy: vi.fn(async (args: any) => {
        const hits = state.items.filter(itemWhere(args?.where));
        const counts = new Map<string, number>();
        hits.forEach((i) => counts.set(i["projectId"], (counts.get(i["projectId"]) ?? 0) + 1));
        return [...counts].map(([projectId, count]) => ({ projectId, _count: { projectId: count } }));
      }),
    },
    chatProjectKnowledge: {
      findMany: vi.fn(async (args: any) => {
        const where = args?.where ?? {};
        return state.knowledge.filter(
          (row) =>
            (where["projectId"] === undefined || row["projectId"] === where["projectId"]) &&
            (where["orgId"] === undefined || row["orgId"] === where["orgId"]),
        );
      }),
      create: vi.fn(async (args: any) => {
        const data = args.data;
        // Stands in for the [projectId, type, refId] unique index, which is
        // what turns a second attach into a 409 instead of a duplicate row.
        const clash = state.knowledge.some(
          (row) =>
            row["projectId"] === data.projectId &&
            row["type"] === data.type &&
            row["refId"] === data.refId,
        );
        if (clash) {
          // A real instance, not a shaped object: the repository identifies a
          // duplicate with `instanceof Prisma.PrismaClientKnownRequestError`,
          // which a look-alike from another import path would fail.
          throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
            code: "P2002",
            clientVersion: "test",
          });
        }
        const row = {
          id: `know-${state.knowledge.length + 1}`,
          storagePath: null,
          mimeType: null,
          size: null,
          metadata: null,
          createdAt: new Date(),
          ...data,
        };
        state.knowledge.push(row);
        return row;
      }),
      deleteMany: vi.fn(async (args: any) => {
        const where = args?.where ?? {};
        const hits = state.knowledge.filter(
          (row) =>
            (where["id"] === undefined || row["id"] === where["id"]) &&
            (where["projectId"] === undefined || row["projectId"] === where["projectId"]) &&
            (where["orgId"] === undefined || row["orgId"] === where["orgId"]),
        );
        state.knowledge = state.knowledge.filter((row) => !hits.includes(row));
        return { count: hits.length };
      }),
    },
    chatAttachment: {
      findFirst: vi.fn(async (args: any) => {
        const where = args?.where ?? {};
        const owners = where["uploaderUserId"]?.in ?? [where["uploaderUserId"]];
        return (
          state.attachments.find(
            (row) => row["id"] === where["id"] && owners.includes(row["uploaderUserId"]),
          ) ?? null
        );
      }),
    },
    chatMessage: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    $transaction: vi.fn(async (ops: Array<Promise<unknown>>) => Promise.all(ops)),
  },
}));

vi.mock("../repositories/index.js", async () => {
  const actual = await vi.importActual<typeof import("../repositories/chatProjectRepository.js")>(
    "../repositories/chatProjectRepository.js",
  );
  const knowledge = await vi.importActual<
    typeof import("../repositories/chatProjectKnowledgeRepository.js")
  >("../repositories/chatProjectKnowledgeRepository.js");
  return {
    chatProjectRepository: actual.chatProjectRepository,
    chatProjectKnowledgeRepository: knowledge.chatProjectKnowledgeRepository,
    chatAttachmentRepository: (
      await vi.importActual<typeof import("../repositories/chatAttachmentRepository.js")>(
        "../repositories/chatAttachmentRepository.js",
      )
    ).chatAttachmentRepository,
    isChatProjectKnowledgeType: knowledge.isChatProjectKnowledgeType,
    DuplicateKnowledgeError: knowledge.DuplicateKnowledgeError,
  };
});

vi.mock("../middleware/agent-acl.js", () => ({
  getRequesterId: (req: Request) => req.headers["x-user-id"],
  getOrgId: (req: Request) => req.headers["x-org-id"],
}));

vi.mock("../middleware/pin-user-id-param.js", () => ({
  getRequesterAliases: (req: Request) =>
    [req.headers["x-user-id"], req.headers["x-spaces-user-id"]].filter(
      (v): v is string => typeof v === "string" && !!v,
    ),
}));

vi.mock("../lib/users-jit.js", () => ({
  orgIdForSpacesUser: vi.fn(
    async (id: string) =>
      state.users.find((u) => u["id"] === id || u["spacesUserId"] === id)?.["orgId"],
  ),
  resolveClawUserIdForSpacesIdentity: vi.fn(
    async (id: string) => state.users.find((u) => u["spacesUserId"] === id)?.["id"],
  ),
}));

vi.mock("../logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { prisma } from "../db.js";

const CANONICAL = "user-canonical";
const SPACES_ALIAS = "user-spaces-alias";
const ORG = "org-1";

interface CallOptions {
  userId?: string | null;
  spacesUserId?: string;
  orgId?: string | null;
  body?: Record<string, unknown>;
}

async function requestJson(
  method: string,
  url: string,
  options: CallOptions = {},
): Promise<{ status: number; body: Record<string, any> }> {
  const { chatProjectsRouter } = await import("./chat-projects.js");

  return await new Promise((resolve, reject) => {
    let statusCode = 200;
    const headers: Record<string, string> = {};
    if (options.userId !== null) headers["x-user-id"] = options.userId ?? CANONICAL;
    if (options.spacesUserId) headers["x-spaces-user-id"] = options.spacesUserId;
    if (options.orgId !== null) headers["x-org-id"] = options.orgId ?? ORG;

    const req = {
      method,
      url,
      originalUrl: url,
      headers,
      body: options.body ?? {},
      query: {},
    } as unknown as Request;

    const res = {
      status(code: number) { statusCode = code; return this; },
      setHeader() { return this; },
      json(payload: Record<string, any>) { resolve({ status: statusCode, body: payload }); return this; },
      // A 204 answers with no body, so it ends the response rather than
      // sending JSON.
      end() { resolve({ status: statusCode, body: {} }); return this; },
    } as unknown as Response;

    (chatProjectsRouter as unknown as {
      handle: (req: Request, res: Response, next: (err?: unknown) => void) => void;
    }).handle(req, res, (err?: unknown) => {
      if (err) reject(err);
      else resolve({ status: 404, body: { success: false, error: "no route" } });
    });
  });
}

describe("chat project routes", () => {
  beforeEach(() => {
    state.projects = [
      { id: "proj-theirs", ownerUserId: "user-other", orgId: ORG, name: "Theirs", icon: null, instructions: "", instructionsEnabled: true, spacesProjectId: null, defaultAgentSlug: null, sortOrder: 0 },
      { id: "proj-otherorg", ownerUserId: CANONICAL, orgId: "org-2", name: "Other org", icon: null, instructions: "", instructionsEnabled: true, spacesProjectId: null, defaultAgentSlug: null, sortOrder: 0 },
    ];
    state.items = [];
    state.messages = [
      { conversationId: "conv-1", userId: CANONICAL, agentSlug: "assistant" },
      { conversationId: "conv-1", userId: CANONICAL, agentSlug: "researcher" },
    ];
    state.users = [{ id: CANONICAL, orgId: ORG }];
    state.knowledge = [];
    state.attachments = [
      { id: "att-1", uploaderUserId: CANONICAL, url: "chat-attachments/org-1/att-1.pdf", mimeType: "application/pdf", size: 2048, originalFilename: "Spec.pdf" },
      { id: "att-theirs", uploaderUserId: "user-other", url: "chat-attachments/org-1/att-theirs.pdf", mimeType: "application/pdf", size: 99, originalFilename: "Theirs.pdf" },
    ];
    vi.clearAllMocks();
  });

  describe("project knowledge", () => {
    const addProject = (): void => {
      state.projects.push({
        id: "proj-mine",
        ownerUserId: CANONICAL,
        orgId: ORG,
        name: "Mine",
        icon: null,
        instructions: "",
        instructionsEnabled: true,
        spacesProjectId: null,
        defaultAgentSlug: null,
        sortOrder: 1,
      });
    };

    const FILE_ITEM = { type: "file", refId: "att-1", title: "Spec.pdf" };

    it("attaches, lists and detaches an item", async () => {
      addProject();

      const created = await requestJson("POST", "/chat/projects/proj-mine/knowledge", {
        body: FILE_ITEM,
      });
      expect(created.status).toBe(201);
      expect(created.body["data"]).toMatchObject({
        projectId: "proj-mine",
        type: "file",
        refId: "att-1",
        storagePath: "chat-attachments/org-1/att-1.pdf",
      });

      const listed = await requestJson("GET", "/chat/projects/proj-mine/knowledge");
      expect(listed.status).toBe(200);
      expect(listed.body["data"]).toHaveLength(1);

      const id = created.body["data"]["id"] as string;
      const removed = await requestJson("DELETE", `/chat/projects/proj-mine/knowledge/${id}`);
      expect(removed.status).toBe(204);

      const after = await requestJson("GET", "/chat/projects/proj-mine/knowledge");
      expect(after.body["data"]).toHaveLength(0);
    });

    it("stamps orgId from the project row, never from the request body", async () => {
      addProject();

      const created = await requestJson("POST", "/chat/projects/proj-mine/knowledge", {
        body: { ...FILE_ITEM, orgId: "org-attacker" },
      });

      expect(created.status).toBe(201);
      expect(state.knowledge[0]!["orgId"]).toBe(ORG);
    });

    it("answers 409 when the same item is attached twice", async () => {
      addProject();
      await requestJson("POST", "/chat/projects/proj-mine/knowledge", { body: FILE_ITEM });

      const again = await requestJson("POST", "/chat/projects/proj-mine/knowledge", {
        body: FILE_ITEM,
      });

      expect(again.status).toBe(409);
      expect(state.knowledge).toHaveLength(1);
    });

    it("resolves a file's storage path from the attachment row, ignoring the request", async () => {
      addProject();

      const created = await requestJson("POST", "/chat/projects/proj-mine/knowledge", {
        body: {
          ...FILE_ITEM,
          storagePath: "local-harness-sessions/user-other/conv-9/claude.jsonl",
          mimeType: "text/evil",
          size: -1,
        },
      });

      expect(created.status).toBe(201);
      expect(created.body["data"]).toMatchObject({
        storagePath: "chat-attachments/org-1/att-1.pdf",
        mimeType: "application/pdf",
        size: 2048,
      });
    });

    it("answers 404 for a file the caller does not own", async () => {
      addProject();

      const got = await requestJson("POST", "/chat/projects/proj-mine/knowledge", {
        body: { type: "file", refId: "att-theirs", title: "Theirs" },
      });

      expect(got.status).toBe(404);
      expect(state.knowledge).toHaveLength(0);
    });

    it("answers 404 for a file id that does not exist", async () => {
      addProject();

      const got = await requestJson("POST", "/chat/projects/proj-mine/knowledge", {
        body: { type: "file", refId: "att-nope", title: "Ghost" },
      });

      expect(got.status).toBe(404);
    });

    it("refuses more than the per-project item cap", async () => {
      addProject();
      state.knowledge = Array.from({ length: 50 }, (_, i) => ({
        id: `know-${i}`,
        projectId: "proj-mine",
        orgId: ORG,
        type: "channel",
        refId: `chan-${i}`,
      }));

      const got = await requestJson("POST", "/chat/projects/proj-mine/knowledge", {
        body: { type: "channel", refId: "chan-extra", title: "One too many" },
      });

      expect(got.status).toBe(400);
      expect(got.body["error"]).toMatch(/at most 50/);
    });

    it("rejects an unknown type", async () => {
      addProject();

      const got = await requestJson("POST", "/chat/projects/proj-mine/knowledge", {
        body: { type: "spreadsheet", refId: "x", title: "X" },
      });

      expect(got.status).toBe(400);
    });

    it("answers 404 for another user's project", async () => {
      const listed = await requestJson("GET", "/chat/projects/proj-theirs/knowledge");
      const created = await requestJson("POST", "/chat/projects/proj-theirs/knowledge", {
        body: FILE_ITEM,
      });

      expect(listed.status).toBe(404);
      expect(created.status).toBe(404);
      expect(state.knowledge).toHaveLength(0);
    });

    it("answers 404 for a project in another org", async () => {
      const got = await requestJson("GET", "/chat/projects/proj-otherorg/knowledge");
      expect(got.status).toBe(404);
    });

    it("will not detach an item belonging to a different project", async () => {
      addProject();
      await requestJson("POST", "/chat/projects/proj-mine/knowledge", { body: FILE_ITEM });
      const id = state.knowledge[0]!["id"] as string;

      state.projects.push({
        id: "proj-second",
        ownerUserId: CANONICAL,
        orgId: ORG,
        name: "Second",
        icon: null,
        instructions: "",
        instructionsEnabled: true,
        spacesProjectId: null,
        defaultAgentSlug: null,
        sortOrder: 2,
      });

      const got = await requestJson("DELETE", `/chat/projects/proj-second/knowledge/${id}`);

      expect(got.status).toBe(404);
      expect(state.knowledge).toHaveLength(1);
    });
  });

  describe("full CRUD lifecycle", () => {
    it("creates, lists, reads, updates and deletes", async () => {
      const created = await requestJson("POST", "/chat/projects", {
        body: {
          name: "  Research  ",
          icon: "flask",
          instructions: "Cite sources.",
          instructionsEnabled: true,
          spacesProjectId: "spaces-proj-9",
          defaultAgentSlug: "assistant",
        },
      });
      expect(created.status).toBe(201);
      expect(created.body["data"]).toMatchObject({
        name: "Research",
        icon: "flask",
        instructions: "Cite sources.",
        instructionsEnabled: true,
        spacesProjectId: "spaces-proj-9",
        defaultAgentSlug: "assistant",
        ownerUserId: CANONICAL,
        orgId: ORG,
        chatCount: 0,
      });
      const id = created.body["data"]["id"] as string;

      const listed = await requestJson("GET", "/chat/projects");
      expect(listed.status).toBe(200);
      expect(listed.body["data"].map((p: any) => p.id)).toEqual([id]);

      const fetched = await requestJson("GET", `/chat/projects/${id}`);
      expect(fetched.status).toBe(200);
      expect(fetched.body["data"]).toMatchObject({ id, conversationIds: [], chatCount: 0 });

      const patched = await requestJson("PATCH", `/chat/projects/${id}`, {
        body: { name: "Research v2", instructionsEnabled: false },
      });
      expect(patched.status).toBe(200);
      expect(patched.body["data"]).toMatchObject({ name: "Research v2", instructionsEnabled: false });
      // A PATCH writes only what it was sent.
      expect(patched.body["data"]["instructions"]).toBe("Cite sources.");

      const deleted = await requestJson("DELETE", `/chat/projects/${id}`);
      expect(deleted.status).toBe(200);
      expect(deleted.body["data"]).toMatchObject({ id, deleted: true });

      expect((await requestJson("GET", `/chat/projects/${id}`)).status).toBe(404);
    });

    it("reports chat counts on the list", async () => {
      const created = await requestJson("POST", "/chat/projects", { body: { name: "Counted" } });
      const id = created.body["data"]["id"] as string;
      state.items.push(
        { conversationId: "conv-1", userId: CANONICAL, projectId: id, orgId: ORG },
        { conversationId: "conv-2", userId: CANONICAL, projectId: id, orgId: ORG },
      );

      const listed = await requestJson("GET", "/chat/projects");
      expect(listed.body["data"][0]).toMatchObject({ id, chatCount: 2 });
    });

    it("reorders the caller's projects", async () => {
      const a = (await requestJson("POST", "/chat/projects", { body: { name: "A" } })).body["data"]["id"];
      const b = (await requestJson("POST", "/chat/projects", { body: { name: "B" } })).body["data"]["id"];

      const reordered = await requestJson("PUT", "/chat/projects/reorder", {
        body: { projectIds: [b, a] },
      });
      expect(reordered.status).toBe(200);
      expect(reordered.body["data"]).toEqual({ reordered: 2 });

      const listed = await requestJson("GET", "/chat/projects");
      expect(listed.body["data"].map((p: any) => p.id)).toEqual([b, a]);
    });

    it("does not read 'reorder' as a project id", async () => {
      const got = await requestJson("PUT", "/chat/projects/reorder", { body: { projectIds: [] } });
      expect(got.status).toBe(200);
    });
  });

  describe("owner isolation", () => {
    it("returns 404, not 403, when reading another user's project", async () => {
      const got = await requestJson("GET", "/chat/projects/proj-theirs");
      expect(got.status).toBe(404);
      expect(got.body["error"]).toBe("Project not found");
    });

    it("returns 404, not 403, when patching another user's project", async () => {
      const got = await requestJson("PATCH", "/chat/projects/proj-theirs", { body: { name: "hijacked" } });
      expect(got.status).toBe(404);
      expect(state.projects.find((p) => p["id"] === "proj-theirs")?.["name"]).toBe("Theirs");
    });

    it("returns 404, not 403, when deleting another user's project", async () => {
      const got = await requestJson("DELETE", "/chat/projects/proj-theirs");
      expect(got.status).toBe(404);
      expect(state.projects.some((p) => p["id"] === "proj-theirs")).toBe(true);
    });

    it("never lists another user's project", async () => {
      const listed = await requestJson("GET", "/chat/projects");
      expect(listed.body["data"]).toEqual([]);
    });

    it("hides the caller's own project in another org", async () => {
      expect((await requestJson("GET", "/chat/projects/proj-otherorg")).status).toBe(404);
    });

    it("skips unowned ids in a reorder instead of failing the request", async () => {
      const mine = (await requestJson("POST", "/chat/projects", { body: { name: "Mine" } })).body["data"]["id"];
      const got = await requestJson("PUT", "/chat/projects/reorder", {
        body: { projectIds: ["proj-theirs", mine] },
      });
      expect(got.status).toBe(200);
      expect(got.body["data"]).toEqual({ reordered: 1 });
      expect(state.projects.find((p) => p["id"] === "proj-theirs")?.["sortOrder"]).toBe(0);
    });
  });

  describe("deleting a project preserves its chats", () => {
    it("drops membership rows and leaves every chat message in place", async () => {
      const id = (await requestJson("POST", "/chat/projects", { body: { name: "Doomed" } })).body["data"]["id"];
      state.items.push({ conversationId: "conv-1", userId: CANONICAL, projectId: id, orgId: ORG });

      const deleted = await requestJson("DELETE", `/chat/projects/${id}`);
      expect(deleted.status).toBe(200);

      expect(state.items.some((i) => i["projectId"] === id)).toBe(false);
      // The chat itself survives and falls back to the main list.
      expect(state.messages.filter((m) => m["conversationId"] === "conv-1")).toHaveLength(2);
      expect(prisma.chatMessage.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe("verified id aliases", () => {
    it("lists a project owned under the Spaces alias", async () => {
      state.projects.push({
        id: "proj-alias", ownerUserId: SPACES_ALIAS, orgId: ORG, name: "Alias-owned",
        icon: null, instructions: "", instructionsEnabled: true, spacesProjectId: null,
        defaultAgentSlug: null, sortOrder: 0,
      });

      const listed = await requestJson("GET", "/chat/projects", { spacesUserId: SPACES_ALIAS });
      expect(listed.body["data"].map((p: any) => p.id)).toEqual(["proj-alias"]);
    });

    it("counts membership rows held under either id", async () => {
      const id = (await requestJson("POST", "/chat/projects", { body: { name: "Mixed" } })).body["data"]["id"];
      state.items.push(
        { conversationId: "conv-a", userId: CANONICAL, projectId: id, orgId: ORG },
        { conversationId: "conv-b", userId: SPACES_ALIAS, projectId: id, orgId: ORG },
      );

      const listed = await requestJson("GET", "/chat/projects", { spacesUserId: SPACES_ALIAS });
      expect(listed.body["data"][0]).toMatchObject({ chatCount: 2 });
    });

    it("writes a new project under the canonical id, not the alias", async () => {
      const created = await requestJson("POST", "/chat/projects", {
        spacesUserId: SPACES_ALIAS,
        body: { name: "Owned" },
      });
      expect(created.body["data"]["ownerUserId"]).toBe(CANONICAL);
    });
  });

  describe("identity and org context", () => {
    it("rejects a request carrying no verified id", async () => {
      expect((await requestJson("GET", "/chat/projects", { userId: null })).status).toBe(401);
    });

    it("falls back to the caller's own org when the header is absent", async () => {
      const got = await requestJson("GET", "/chat/projects", { orgId: null });
      expect(got.status).toBe(200);
    });

    it("refuses when neither header nor user record yields an org", async () => {
      state.users = [];
      expect((await requestJson("GET", "/chat/projects", { orgId: null })).status).toBe(400);
    });

    // The proxy sends only the workspace-scoped Spaces id and no x-org-id, and
    // that id is not what `users.id` holds — so a direct match on it resolved
    // no org and every project route answered 400 for every caller.
    it("resolves the org from a Spaces id that is not the Claw user id", async () => {
      state.users = [{ id: CANONICAL, orgId: ORG, spacesUserId: SPACES_ALIAS }];
      const got = await requestJson("GET", "/chat/projects", {
        orgId: null,
        userId: SPACES_ALIAS,
      });
      expect(got.status).toBe(200);
    });

    it("prefers the org header over resolving one", async () => {
      state.users = [];
      expect((await requestJson("GET", "/chat/projects", { orgId: ORG })).status).toBe(200);
    });

    it("finds a project owned under the canonical id when called with the Spaces id", async () => {
      state.users = [{ id: CANONICAL, orgId: ORG, spacesUserId: SPACES_ALIAS }];
      state.projects = [
        { id: "p-1", ownerUserId: CANONICAL, orgId: ORG, name: "Owned", sortOrder: 0 },
      ];
      const got = await requestJson("GET", "/chat/projects", {
        orgId: null,
        userId: SPACES_ALIAS,
      });
      expect(got.status).toBe(200);
      expect((got.body as { data: Array<{ id: string }> }).data.map((p) => p.id)).toContain("p-1");
    });
  });

  describe("validation", () => {
    it("requires a name on create", async () => {
      const got = await requestJson("POST", "/chat/projects", { body: { icon: "flask" } });
      expect(got.status).toBe(400);
      expect(got.body["error"]).toBe("name is required");
    });

    it("rejects a blank name", async () => {
      expect((await requestJson("POST", "/chat/projects", { body: { name: "   " } })).status).toBe(400);
    });

    it("rejects an over-long name", async () => {
      const got = await requestJson("POST", "/chat/projects", { body: { name: "x".repeat(121) } });
      expect(got.status).toBe(400);
    });

    it("rejects instructions over the cap", async () => {
      const got = await requestJson("POST", "/chat/projects", {
        body: { name: "Big", instructions: "x".repeat(10_001) },
      });
      expect(got.status).toBe(400);
    });

    it("rejects a non-boolean instructionsEnabled", async () => {
      const got = await requestJson("POST", "/chat/projects", {
        body: { name: "Bad", instructionsEnabled: "yes" },
      });
      expect(got.status).toBe(400);
    });

    it("rejects an empty PATCH", async () => {
      const id = (await requestJson("POST", "/chat/projects", { body: { name: "P" } })).body["data"]["id"];
      const got = await requestJson("PATCH", `/chat/projects/${id}`, { body: {} });
      expect(got.status).toBe(400);
      expect(got.body["error"]).toBe("No updatable fields supplied");
    });

    it("clears a nullable field when sent empty", async () => {
      const id = (await requestJson("POST", "/chat/projects", {
        body: { name: "P", icon: "flask" },
      })).body["data"]["id"];
      const got = await requestJson("PATCH", `/chat/projects/${id}`, { body: { icon: "" } });
      expect(got.status).toBe(200);
      expect(got.body["data"]["icon"]).toBeNull();
    });

    it("rejects a reorder payload that is not an array of ids", async () => {
      const got = await requestJson("PUT", "/chat/projects/reorder", { body: { projectIds: "nope" } });
      expect(got.status).toBe(400);
    });
  });
});

const ALIASES = [CANONICAL, SPACES_ALIAS];
const load = () => import("./chat-projects.js");

describe("prepareProjectMove", () => {
  /** Validate then perform — the order the route now uses, so a rejected
   *  project never reaches a write. */
  const runMove = async (args: {
    conversationId: string;
    ownerUserId: string;
    ownerOrgId: string;
    aliases: string[];
    projectId: string | null;
  }) => {
    const { prepareProjectMove } = await load();
    const move = await prepareProjectMove(args);
    if (move.status === "ok") {
      await move.apply();
    }
    return move;
  };

  beforeEach(() => {
    state.projects = [
      { id: "proj-mine", ownerUserId: CANONICAL, orgId: ORG, name: "Mine", sortOrder: 0 },
      { id: "proj-theirs", ownerUserId: "user-other", orgId: ORG, name: "Theirs", sortOrder: 0 },
      { id: "proj-otherorg", ownerUserId: CANONICAL, orgId: "org-2", name: "Elsewhere", sortOrder: 0 },
    ];
    state.items = [];
    vi.clearAllMocks();
  });

  it("files a chat into a project the caller owns", async () => {
    const result = await runMove({
      conversationId: "conv-1", ownerUserId: CANONICAL, ownerOrgId: ORG,
      aliases: ALIASES, projectId: "proj-mine",
    });

    expect(result).toMatchObject({ status: "ok", projectId: "proj-mine" });
    expect(state.items).toHaveLength(1);
    expect(state.items[0]).toMatchObject({
      conversationId: "conv-1", userId: CANONICAL, projectId: "proj-mine",
    });
  });

  it("writes nothing until apply is called", async () => {
    const { prepareProjectMove } = await load();
    const move = await prepareProjectMove({
      conversationId: "conv-1", ownerUserId: CANONICAL, ownerOrgId: ORG,
      aliases: ALIASES, projectId: "proj-mine",
    });

    expect(move.status).toBe("ok");
    // The route runs the title and pin writes between prepare and apply. If
    // validating also wrote, a later rejection would leave a half-applied
    // PATCH — which is what let a bad project id save a title and then 404.
    expect(state.items).toHaveLength(0);

    if (move.status === "ok") {
      await move.apply();
    }
    expect(state.items).toHaveLength(1);
  });

  it("stamps the item's orgId from the project row", async () => {
    await runMove({
      conversationId: "conv-1", ownerUserId: CANONICAL, ownerOrgId: ORG,
      aliases: ALIASES, projectId: "proj-mine",
    });
    const project = state.projects.find((p) => p["id"] === "proj-mine");
    expect(state.items[0]?.["orgId"]).toBe(project?.["orgId"]);
  });

  it("writes membership under the conversation's own id, not the first alias", async () => {
    await runMove({
      conversationId: "conv-1", ownerUserId: SPACES_ALIAS, ownerOrgId: ORG,
      aliases: ALIASES, projectId: "proj-mine",
    });
    expect(state.items[0]?.["userId"]).toBe(SPACES_ALIAS);
  });

  it("sweeps a row filed earlier under the other alias, leaving one", async () => {
    state.items = [{ conversationId: "conv-1", userId: SPACES_ALIAS, projectId: "proj-mine", orgId: ORG }];
    await runMove({
      conversationId: "conv-1", ownerUserId: CANONICAL, ownerOrgId: ORG,
      aliases: ALIASES, projectId: "proj-mine",
    });
    expect(state.items.filter((i) => i["conversationId"] === "conv-1")).toHaveLength(1);
  });

  it("unfiles on null and writes nothing", async () => {
    state.items = [{ conversationId: "conv-1", userId: CANONICAL, projectId: "proj-mine", orgId: ORG }];
    const result = await runMove({
      conversationId: "conv-1", ownerUserId: CANONICAL, ownerOrgId: ORG,
      aliases: ALIASES, projectId: null,
    });

    expect(result).toMatchObject({ status: "ok", projectId: null });
    expect(state.items).toHaveLength(0);
  });

  it("refuses a project owned by someone else and files nothing", async () => {
    const result = await runMove({
      conversationId: "conv-1", ownerUserId: CANONICAL, ownerOrgId: ORG,
      aliases: ALIASES, projectId: "proj-theirs",
    });

    expect(result).toEqual({ status: "project-not-found" });
    expect(state.items).toHaveLength(0);
  });

  it("refuses a project in another org", async () => {
    const result = await runMove({
      conversationId: "conv-1", ownerUserId: CANONICAL, ownerOrgId: ORG,
      aliases: ALIASES, projectId: "proj-otherorg",
    });

    expect(result).toEqual({ status: "project-not-found" });
    expect(state.items).toHaveLength(0);
  });
});

describe("resolveProjectScope", () => {
  beforeEach(() => {
    state.projects = [
      { id: "proj-mine", ownerUserId: CANONICAL, orgId: ORG, name: "Mine", sortOrder: 0 },
      { id: "proj-empty", ownerUserId: CANONICAL, orgId: ORG, name: "Empty", sortOrder: 1 },
      { id: "proj-theirs", ownerUserId: "user-other", orgId: ORG, name: "Theirs", sortOrder: 0 },
    ];
    state.items = [
      { conversationId: "conv-a", userId: CANONICAL, projectId: "proj-mine", orgId: ORG },
      { conversationId: "conv-b", userId: SPACES_ALIAS, projectId: "proj-mine", orgId: ORG },
      { conversationId: "conv-theirs", userId: "user-other", projectId: "proj-theirs", orgId: ORG },
    ];
    vi.clearAllMocks();
  });

  it("does not filter when no project is requested", async () => {
    const { resolveProjectScope } = await load();
    const got = await resolveProjectScope({ projectParam: undefined, userIds: ALIASES, orgId: ORG });
    expect(got).toEqual({ status: "ok", scope: undefined });
  });

  it("narrows to the project's chats, across both aliases", async () => {
    const { resolveProjectScope } = await load();
    const got = await resolveProjectScope({ projectParam: "proj-mine", userIds: ALIASES, orgId: ORG });

    expect(got.status).toBe("ok");
    const only = got.status === "ok" ? got.scope?.only ?? [] : [];
    expect([...only].sort()).toEqual(["conv-a", "conv-b"]);
  });

  it("returns an EMPTY only-set for an empty project, never undefined", async () => {
    const { resolveProjectScope } = await load();
    const got = await resolveProjectScope({ projectParam: "proj-empty", userIds: ALIASES, orgId: ORG });

    expect(got).toEqual({ status: "ok", scope: { only: [] } });
    // The distinction that matters: an empty project lists nothing, whereas
    // `undefined` would list the caller's entire history.
    const scope = got.status === "ok" ? got.scope : undefined;
    expect(scope?.only).toBeDefined();
  });

  it("excludes every filed chat for ?projectId=none", async () => {
    const { resolveProjectScope } = await load();
    const got = await resolveProjectScope({ projectParam: "none", userIds: ALIASES, orgId: ORG });

    expect(got.status).toBe("ok");
    const exclude = got.status === "ok" ? got.scope?.exclude ?? [] : [];
    expect([...exclude].sort()).toEqual(["conv-a", "conv-b"]);
  });

  it("excludes nothing for ?projectId=none when the user has filed nothing", async () => {
    state.items = [];
    const { resolveProjectScope } = await load();
    const got = await resolveProjectScope({ projectParam: "none", userIds: ALIASES, orgId: ORG });
    expect(got).toEqual({ status: "ok", scope: { exclude: [] } });
  });

  it("refuses another user's project id", async () => {
    const { resolveProjectScope } = await load();
    const got = await resolveProjectScope({ projectParam: "proj-theirs", userIds: ALIASES, orgId: ORG });
    expect(got).toEqual({ status: "project-not-found" });
  });

  it("refuses when no org could be resolved", async () => {
    const { resolveProjectScope } = await load();
    const got = await resolveProjectScope({ projectParam: "proj-mine", userIds: ALIASES, orgId: undefined });
    expect(got).toEqual({ status: "project-not-found" });
  });
});
