import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Two behaviours chat projects depend on:
 *   - the list aggregate narrows INSIDE the query, and honours empty arrays;
 *   - deleting a chat reclaims its ChatProjectItem, which no foreign key can
 *     do because a conversation is only an id shared by message rows.
 */

const state = vi.hoisted(() => ({
  messages: [] as Array<{ conversationId: string; agentSlug: string; userId: string; createdAt: Date }>,
  items: [] as Array<Record<string, any>>,
  meta: [] as Array<Record<string, any>>,
  lastGroupByWhere: null as Record<string, any> | null,
}));

const matches = (filter: unknown, value: string): boolean => {
  if (filter === undefined) return true;
  if (typeof filter === "string") return filter === value;
  const f = filter as { in?: string[]; notIn?: string[] };
  if (Array.isArray(f.in) && !f.in.includes(value)) return false;
  if (Array.isArray(f.notIn) && f.notIn.includes(value)) return false;
  return true;
};

const messageWhere = (where: Record<string, any> = {}) => (row: typeof state.messages[number]) =>
  matches(where["userId"], row.userId) &&
  matches(where["conversationId"], row.conversationId) &&
  (where["agentSlug"] === undefined || where["agentSlug"] === row.agentSlug);

vi.mock("../db.js", () => {
  const client = {
    chatMessage: {
      groupBy: vi.fn(async (args: any) => {
        state.lastGroupByWhere = args.where;
        const hits = state.messages.filter(messageWhere(args.where));
        const byKey = new Map<string, typeof state.messages>();
        for (const row of hits) {
          const key = `${row.conversationId}|${row.agentSlug}`;
          byKey.set(key, [...(byKey.get(key) ?? []), row]);
        }
        return [...byKey.entries()].map(([key, rows]) => {
          const [conversationId, agentSlug] = key.split("|");
          const times = rows.map((r) => r.createdAt.getTime());
          return {
            conversationId,
            agentSlug,
            _min: { createdAt: new Date(Math.min(...times)) },
            _max: { createdAt: new Date(Math.max(...times)) },
            _count: { _all: rows.length },
          };
        });
      }),
      deleteMany: vi.fn(async (args: any) => {
        const hits = state.messages.filter(messageWhere(args.where));
        state.messages = state.messages.filter((m) => !hits.includes(m));
        return { count: hits.length };
      }),
      count: vi.fn(async (args: any) => state.messages.filter(messageWhere(args.where)).length),
    },
    chatConversationMeta: {
      deleteMany: vi.fn(async () => {
        const count = state.meta.length;
        state.meta = [];
        return { count };
      }),
    },
    chatProjectItem: {
      deleteMany: vi.fn(async (args: any) => {
        const hits = state.items.filter(
          (i) =>
            i["conversationId"] === args.where.conversationId && matches(args.where["userId"], i["userId"]),
        );
        state.items = state.items.filter((i) => !hits.includes(i));
        return { count: hits.length };
      }),
    },
  };
  // Interactive transaction: the callback is handed the same client, so the
  // message delete and the membership sweep act on one in-memory store — and
  // the assertions below still see the very same mock functions.
  return {
    prisma: {
      ...client,
      $transaction: vi.fn(async (fn: (tx: typeof client) => Promise<unknown>) => fn(client)),
    },
  };
});

import { prisma } from "../db.js";
import { chatMessageRepository } from "./chatMessageRepository.js";

const USER = "user-1";
const ALIAS = "user-1-spaces";
const msg = (conversationId: string, agentSlug: string, minute: number, userId = USER) => ({
  conversationId,
  agentSlug,
  userId,
  createdAt: new Date(Date.UTC(2026, 9, 20, 10, minute)),
});

describe("conversationAgentGroupsForUser scope", () => {
  beforeEach(() => {
    state.messages = [
      msg("conv-a", "alpha", 1), msg("conv-a", "alpha", 2),
      msg("conv-b", "alpha", 3),
      msg("conv-c", "beta", 4),
    ];
    state.lastGroupByWhere = null;
    vi.clearAllMocks();
  });

  const ids = (rows: Array<{ conversationId: string }>) => [...new Set(rows.map((r) => r.conversationId))].sort();

  it("applies no conversation filter when no scope is given", async () => {
    const rows = await chatMessageRepository.conversationAgentGroupsForUser(USER);
    expect(ids(rows)).toEqual(["conv-a", "conv-b", "conv-c"]);
    expect(state.lastGroupByWhere).not.toHaveProperty("conversationId");
  });

  it("narrows to an `only` set inside the query", async () => {
    const rows = await chatMessageRepository.conversationAgentGroupsForUser(USER, { only: ["conv-a", "conv-c"] });
    expect(ids(rows)).toEqual(["conv-a", "conv-c"]);
    expect(state.lastGroupByWhere?.["conversationId"]).toEqual({ in: ["conv-a", "conv-c"] });
  });

  it("returns NOTHING for an empty `only` set — an empty project lists no chats", async () => {
    const rows = await chatMessageRepository.conversationAgentGroupsForUser(USER, { only: [] });
    expect(rows).toEqual([]);
    // The regression this guards: a truthiness check would drop the filter
    // here and list the caller's entire history instead.
    expect(state.lastGroupByWhere?.["conversationId"]).toEqual({ in: [] });
  });

  it("excludes a set for ?projectId=none", async () => {
    const rows = await chatMessageRepository.conversationAgentGroupsForUser(USER, { exclude: ["conv-a"] });
    expect(ids(rows)).toEqual(["conv-b", "conv-c"]);
  });

  it("returns EVERYTHING for an empty `exclude` set — nothing is filed yet", async () => {
    const rows = await chatMessageRepository.conversationAgentGroupsForUser(USER, { exclude: [] });
    expect(ids(rows)).toEqual(["conv-a", "conv-b", "conv-c"]);
  });

  it("still scopes to the caller's aliases alongside the project filter", async () => {
    state.messages.push(msg("conv-a", "alpha", 9, "someone-else"));
    const rows = await chatMessageRepository.conversationAgentGroupsForUser([USER, ALIAS], { only: ["conv-a"] });
    expect(state.lastGroupByWhere?.["userId"]).toEqual({ in: [USER, ALIAS] });
    expect(rows.every((r) => r.conversationId === "conv-a")).toBe(true);
  });
});

describe("deleting a chat reclaims its project membership", () => {
  beforeEach(() => {
    state.messages = [msg("conv-a", "alpha", 1), msg("conv-a", "beta", 2)];
    state.items = [{ conversationId: "conv-a", userId: USER, projectId: "proj-1", orgId: "org-1" }];
    state.meta = [{ conversationId: "conv-a" }];
    vi.clearAllMocks();
  });

  it("drops the membership once the last message is gone", async () => {
    await chatMessageRepository.deleteConversationAllAgents(USER, "conv-a");
    expect(state.messages).toHaveLength(0);
    expect(state.items).toHaveLength(0);
  });

  it("KEEPS the membership while another agent's turns remain", async () => {
    // Per-agent delete on a chat the user switched agents in: the conversation
    // still exists under beta, so it must stay in its project.
    await chatMessageRepository.deleteConversation(USER, "alpha", "conv-a");
    expect(state.messages.map((m) => m.agentSlug)).toEqual(["beta"]);
    expect(state.items).toHaveLength(1);
  });

  it("drops it on the per-agent path once that was the last agent", async () => {
    await chatMessageRepository.deleteConversation(USER, "alpha", "conv-a");
    await chatMessageRepository.deleteConversation(USER, "beta", "conv-a");
    expect(state.items).toHaveLength(0);
  });

  it("touches nothing when the caller owned no messages in the chat", async () => {
    await chatMessageRepository.deleteConversationAllAgents("stranger", "conv-a");
    expect(state.messages).toHaveLength(2);
    expect(state.items).toHaveLength(1);
    expect(prisma.chatProjectItem.deleteMany).not.toHaveBeenCalled();
  });

  it("matches membership under either verified id", async () => {
    state.items = [{ conversationId: "conv-a", userId: ALIAS, projectId: "proj-1", orgId: "org-1" }];
    await chatMessageRepository.deleteConversationAllAgents([USER, ALIAS], "conv-a");
    expect(state.items).toHaveLength(0);
  });
});
