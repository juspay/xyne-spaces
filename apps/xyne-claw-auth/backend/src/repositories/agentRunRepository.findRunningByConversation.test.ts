import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Query-shape regression test for findRunningByConversation.
 *
 * This query is what awaitTurnHandoff uses to find the in-flight run it must
 * hand off from. Because both chat surfaces insert their OWN AgentRun row at
 * status "running" before dispatch, an unfiltered `startedAt desc` findFirst
 * returns the caller's own row — which is how every chat turn came to eat the
 * full 30s handoff timeout in prod on 2026-09-28.
 *
 * The `findFirst` args are captured verbatim AND executed against a small fake
 * table, so this fails both if the where-clause loses the exclusion and if the
 * exclusion is spelled in a way Prisma would not honour.
 */

interface Row {
  sessionId: string;
  userId: string;
  agentSlug: string;
  conversationId: string;
  status: string;
  startedAt: number;
}

const db = vi.hoisted(() => ({
  rows: [] as Row[],
  lastArgs: null as Record<string, any> | null,
}));

vi.mock("../db.js", () => ({
  prisma: {
    agentRun: {
      // A deliberately literal mini-executor: it understands only the clauses
      // this query is allowed to use, so an unexpected clause shape throws
      // instead of silently passing.
      findFirst: vi.fn(async (argsIn: Record<string, any>) => {
        db.lastArgs = argsIn;
        const where = argsIn["where"] as Record<string, any>;
        const order = argsIn["orderBy"] as Record<string, "asc" | "desc">;

        const known = new Set(["conversationId", "status", "sessionId"]);
        for (const key of Object.keys(where)) {
          if (!known.has(key)) throw new Error(`unexpected where key: ${key}`);
        }
        const notSessionId: string | undefined = where["sessionId"]?.not;
        if (where["sessionId"] !== undefined && typeof notSessionId !== "string") {
          throw new Error("sessionId filter must be spelled { not: <id> }");
        }

        const matched = db.rows
          .filter((r) => r.conversationId === where["conversationId"])
          .filter((r) => r.status === where["status"])
          .filter((r) => (notSessionId === undefined ? true : r.sessionId !== notSessionId))
          .sort((a, b) =>
            order["startedAt"] === "desc" ? b.startedAt - a.startedAt : a.startedAt - b.startedAt,
          );
        return matched[0] ?? null;
      }),
    },
  },
}));

vi.mock("@prisma/client", () => ({
  Prisma: { sql: () => ({}), empty: {}, PrismaClientKnownRequestError: class extends Error {} },
}));

vi.mock("../logger.js", () => ({
  createLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const { agentRunRepository } = await import("./agentRunRepository.js");

function row(sessionId: string, startedAt: number, over: Partial<Row> = {}): Row {
  return {
    sessionId,
    userId: "user-1",
    agentSlug: "assistant",
    conversationId: "conv-1",
    status: "running",
    startedAt,
    ...over,
  };
}

describe("agentRunRepository.findRunningByConversation", () => {
  beforeEach(() => {
    db.rows = [];
    db.lastArgs = null;
  });

  it("excludes the given session id from the where-clause", async () => {
    await agentRunRepository.findRunningByConversation("conv-1", "sess-self");

    expect(db.lastArgs?.["where"]).toEqual({
      conversationId: "conv-1",
      status: "running",
      sessionId: { not: "sess-self" },
    });
    expect(db.lastArgs?.["orderBy"]).toEqual({ startedAt: "desc" });
  });

  it("omits the sessionId filter entirely when no exclusion is given", async () => {
    await agentRunRepository.findRunningByConversation("conv-1", undefined);

    expect(db.lastArgs?.["where"]).toEqual({ conversationId: "conv-1", status: "running" });
  });

  it("does not return the excluded session even when it is the newest running row", async () => {
    db.rows = [row("sess-prev", 1_000), row("sess-self", 2_000)];

    const found = await agentRunRepository.findRunningByConversation("conv-1", "sess-self");

    expect(found?.sessionId).toBe("sess-prev");
  });

  it("returns null when the excluded session is the only thing running", async () => {
    db.rows = [row("sess-self", 2_000)];

    expect(await agentRunRepository.findRunningByConversation("conv-1", "sess-self")).toBeNull();
  });

  it("would have returned the caller's own row without the exclusion", async () => {
    // Pins the bug itself: this is precisely the old behaviour.
    db.rows = [row("sess-prev", 1_000), row("sess-self", 2_000)];

    const found = await agentRunRepository.findRunningByConversation("conv-1", undefined);

    expect(found?.sessionId).toBe("sess-self");
  });

  it("still returns the newest of several other running rows", async () => {
    db.rows = [row("sess-old", 500), row("sess-newer", 1_500), row("sess-self", 2_000)];

    const found = await agentRunRepository.findRunningByConversation("conv-1", "sess-self");

    expect(found?.sessionId).toBe("sess-newer");
  });

  it("ignores rows that are not running and rows on other conversations", async () => {
    db.rows = [
      row("sess-done", 1_800, { status: "completed" }),
      row("sess-other-conv", 1_900, { conversationId: "conv-2" }),
      row("sess-self", 2_000),
    ];

    expect(await agentRunRepository.findRunningByConversation("conv-1", "sess-self")).toBeNull();
  });
});
