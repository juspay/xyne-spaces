import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Covers the four things this repository must not get wrong:
 *   - every read and write is alias-aware (a caller may hold two verified ids);
 *   - owner-only access, with "not yours" indistinguishable from "not there";
 *   - deleting a project never touches a chat message;
 *   - membership is keyed by chat, not by the agent that answered a turn.
 */

const state = vi.hoisted(() => ({
  projects: [] as Array<Record<string, any>>,
  items: [] as Array<Record<string, any>>,
  messages: [] as Array<Record<string, any>>,
  chatMessageDeletes: 0,
}));

/** Mimics Prisma's `field: "x"` / `field: { in: [...] }` matching. */
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
    chatProject: {
      findMany: vi.fn(async (args: any) => state.projects.filter(projectWhere(args?.where))),
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
        // The FK is ON DELETE CASCADE, so membership rows go with the project.
        state.items = state.items.filter((i) => !ids.has(i["projectId"]));
        return { count: hits.length };
      }),
    },
    chatProjectItem: {
      findFirst: vi.fn(async (args: any) => {
        const row = state.items.filter(itemWhere(args?.where))[0];
        if (!row) return null;
        if (args?.select?.project) {
          const project = state.projects.find((p) => p["id"] === row["projectId"]);
          return { project: project ?? null };
        }
        return row;
      }),
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
    chatMessage: {
      deleteMany: vi.fn(async () => {
        state.chatMessageDeletes += 1;
        return { count: 0 };
      }),
    },
    $transaction: vi.fn(async (ops: Array<Promise<unknown>>) => Promise.all(ops)),
  },
}));

import { prisma } from "../db.js";
import { chatProjectRepository } from "./chatProjectRepository.js";

/** The two verified ids one caller can present. */
const CANONICAL = "user-canonical";
const SPACES_ALIAS = "user-spaces-alias";
const ALIASES = [CANONICAL, SPACES_ALIAS];
const ORG = "org-1";

describe("chatProjectRepository", () => {
  beforeEach(() => {
    state.projects = [
      { id: "proj-mine", ownerUserId: CANONICAL, orgId: ORG, name: "Mine", instructions: "# Mine", instructionsEnabled: true, sortOrder: 0 },
      { id: "proj-alias", ownerUserId: SPACES_ALIAS, orgId: ORG, name: "Under alias", instructions: "", instructionsEnabled: true, sortOrder: 1 },
      { id: "proj-theirs", ownerUserId: "user-other", orgId: ORG, name: "Theirs", instructions: "", instructionsEnabled: true, sortOrder: 0 },
      { id: "proj-otherorg", ownerUserId: CANONICAL, orgId: "org-2", name: "Other org", instructions: "", instructionsEnabled: true, sortOrder: 0 },
    ];
    state.items = [
      { conversationId: "conv-1", userId: CANONICAL, projectId: "proj-mine", orgId: ORG },
      { conversationId: "conv-alias", userId: SPACES_ALIAS, projectId: "proj-mine", orgId: ORG },
      { conversationId: "conv-theirs", userId: "user-other", projectId: "proj-theirs", orgId: ORG },
    ];
    state.messages = [
      { conversationId: "conv-1", userId: CANONICAL, agentSlug: "assistant" },
      { conversationId: "conv-1", userId: CANONICAL, agentSlug: "researcher" },
    ];
    state.chatMessageDeletes = 0;
    vi.clearAllMocks();
  });

  describe("alias handling", () => {
    it("lists projects owned under either verified id", async () => {
      const got = await chatProjectRepository.listForOwner(ALIASES, ORG);
      expect(got.map((p) => p.id).sort()).toEqual(["proj-alias", "proj-mine"]);
    });

    it("loses the alias-keyed project when only one id is passed", async () => {
      const got = await chatProjectRepository.listForOwner(CANONICAL, ORG);
      expect(got.map((p) => p.id)).toEqual(["proj-mine"]);
    });

    it("finds a project keyed under the Spaces alias", async () => {
      expect(await chatProjectRepository.findOwned("proj-alias", ALIASES, ORG)).not.toBeNull();
    });

    it("maps membership rows held under either id", async () => {
      const got = await chatProjectRepository.projectIdsForConversations(
        ["conv-1", "conv-alias", "conv-theirs"],
        ALIASES,
      );
      expect([...got.keys()].sort()).toEqual(["conv-1", "conv-alias"]);
    });

    it("removes a membership row keyed under the alias", async () => {
      expect(await chatProjectRepository.removeConversation("conv-alias", ALIASES)).toBe(true);
      expect(state.items.some((i) => i["conversationId"] === "conv-alias")).toBe(false);
    });
  });

  describe("owner-only access", () => {
    it("hides another user's project behind null, not an error", async () => {
      expect(await chatProjectRepository.findOwned("proj-theirs", ALIASES, ORG)).toBeNull();
    });

    it("does not reach across orgs", async () => {
      expect(await chatProjectRepository.findOwned("proj-otherorg", ALIASES, ORG)).toBeNull();
    });

    it("refuses to update a project the caller does not own", async () => {
      expect(await chatProjectRepository.update("proj-theirs", ALIASES, ORG, { name: "hijacked" })).toBeNull();
      expect(state.projects.find((p) => p["id"] === "proj-theirs")?.["name"]).toBe("Theirs");
    });

    it("refuses to delete a project the caller does not own", async () => {
      expect(await chatProjectRepository.remove("proj-theirs", ALIASES, ORG)).toBe(false);
      expect(state.projects.some((p) => p["id"] === "proj-theirs")).toBe(true);
    });

    it("renumbers only the caller's own projects", async () => {
      const moved = await chatProjectRepository.reorder(ALIASES, ORG, ["proj-alias", "proj-theirs", "proj-mine"]);
      expect(moved).toBe(2);
      expect(state.projects.find((p) => p["id"] === "proj-alias")?.["sortOrder"]).toBe(0);
      expect(state.projects.find((p) => p["id"] === "proj-mine")?.["sortOrder"]).toBe(2);
      expect(state.projects.find((p) => p["id"] === "proj-theirs")?.["sortOrder"]).toBe(0);
    });
  });

  describe("deleting a project keeps its chats", () => {
    it("drops the project and its membership rows only", async () => {
      expect(await chatProjectRepository.remove("proj-mine", ALIASES, ORG)).toBe(true);

      expect(state.projects.some((p) => p["id"] === "proj-mine")).toBe(false);
      expect(state.items.some((i) => i["projectId"] === "proj-mine")).toBe(false);
      // The chats themselves survive and fall back to the main list.
      expect(state.messages).toHaveLength(2);
      expect(state.chatMessageDeletes).toBe(0);
      expect(prisma.chatMessage.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe("instruction toggle", () => {
    it("returns the text while enabled", async () => {
      expect(await chatProjectRepository.getEnabledInstructions("proj-mine")).toBe("# Mine");
    });

    it("returns empty when switched off, keeping the text on the row", async () => {
      state.projects[0]!["instructionsEnabled"] = false;
      expect(await chatProjectRepository.getEnabledInstructions("proj-mine")).toBe("");
      expect(state.projects[0]!["instructions"]).toBe("# Mine");
    });

    it("trims and treats whitespace-only text as absent", async () => {
      state.projects[0]!["instructions"] = "   \n ";
      expect(await chatProjectRepository.getEnabledInstructions("proj-mine")).toBe("");
    });

    it("resolves instructions for a chat through its membership", async () => {
      expect(await chatProjectRepository.enabledInstructionsForConversation("conv-1", ALIASES)).toBe("# Mine");
    });

    it("returns empty for a chat that is in no project", async () => {
      expect(await chatProjectRepository.enabledInstructionsForConversation("conv-loose", ALIASES)).toBe("");
    });

    it("respects the toggle through the membership path too", async () => {
      state.projects[0]!["instructionsEnabled"] = false;
      expect(await chatProjectRepository.enabledInstructionsForConversation("conv-1", ALIASES)).toBe("");
    });
  });

  describe("membership follows the chat, not the agent", () => {
    it("keeps one row for a chat answered by several agents", async () => {
      await chatProjectRepository.moveConversation({
        conversationId: "conv-1",
        userId: CANONICAL,
        projectId: "proj-alias",
        orgId: ORG,
      });

      const rows = state.items.filter((i) => i["conversationId"] === "conv-1");
      expect(rows).toHaveLength(1);
      expect(rows[0]?.["projectId"]).toBe("proj-alias");
      // Two agents answered conv-1; membership is still a single row.
      expect(state.messages.filter((m) => m["conversationId"] === "conv-1")).toHaveLength(2);
    });

    it("sweeps a row held under another alias instead of leaving two", async () => {
      // conv-alias already sits in proj-mine, keyed under the Spaces id.
      await chatProjectRepository.moveConversation(
        { conversationId: "conv-alias", userId: CANONICAL, projectId: "proj-alias", orgId: ORG },
        ALIASES,
      );

      const rows = state.items.filter((i) => i["conversationId"] === "conv-alias");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ userId: CANONICAL, projectId: "proj-alias" });
    });

    it("leaves another user's row for the same chat untouched", async () => {
      state.items.push({
        conversationId: "conv-shared", userId: "user-other", projectId: "proj-theirs", orgId: ORG,
      });

      await chatProjectRepository.moveConversation(
        { conversationId: "conv-shared", userId: CANONICAL, projectId: "proj-mine", orgId: ORG },
        ALIASES,
      );

      const rows = state.items.filter((i) => i["conversationId"] === "conv-shared");
      expect(rows).toHaveLength(2);
      expect(rows.some((r) => r["userId"] === "user-other" && r["projectId"] === "proj-theirs")).toBe(true);
    });

    it("stores no agentSlug on the membership row", async () => {
      await chatProjectRepository.moveConversation({
        conversationId: "conv-new",
        userId: CANONICAL,
        projectId: "proj-mine",
        orgId: ORG,
      });
      const row = state.items.find((i) => i["conversationId"] === "conv-new");
      expect(row).toBeDefined();
      expect(row).not.toHaveProperty("agentSlug");
    });
  });

  describe("create", () => {
    it("appends after every project the owner holds under either id", async () => {
      // proj-alias sits at sortOrder 1 under the Spaces id. Numbering that
      // ignored it would hand the new project slot 1 and float it to the top.
      const created = await chatProjectRepository.create(CANONICAL, ORG, { name: "Last" }, ALIASES);
      expect(created.sortOrder).toBe(2);
    });

    it("collides with an alias-owned project when no aliases are passed", async () => {
      const created = await chatProjectRepository.create(CANONICAL, ORG, { name: "Naive" });
      // Same slot as proj-alias — documented here because it is exactly why
      // the route threads caller.aliases through.
      expect(created.sortOrder).toBe(1);
    });

    it("defaults instructions to empty and the toggle to on", async () => {
      const created = await chatProjectRepository.create(CANONICAL, ORG, { name: "Fresh" });
      expect(created.instructions).toBe("");
      expect(created.instructionsEnabled).toBe(true);
    });
  });
});
