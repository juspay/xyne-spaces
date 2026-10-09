import { describe, expect, it } from "vitest";
import {
  agentFacets,
  agentsOnPath,
  buildAgentHandoff,
  buildConversationList,
  conversationEntries,
  decodeCursor,
  entriesNeedingFallbackTitle,
  selectPage,
  conversationPath,
  sanitizeAgentHandoff,
  type ConversationAgentGroup,
  type HandoffMessage,
} from "./multi-agent-chat.js";

let clock = 0;
function msg(id: string, role: "user" | "assistant", agentSlug: string, content: string, parentId: string | null, extra: Partial<HandoffMessage> = {}): HandoffMessage {
  clock += 1;
  return { id, role, agentSlug, content, parentId, status: "completed", runProvider: "spaces", createdAt: new Date(clock * 1000), ...extra };
}

const serverTurn = (m: HandoffMessage): boolean => m.runProvider !== "local-harness:claude";

// u1→A, a1, u2→B, b2, u3→A (leaf = b2 when A answers u3)
const thread = [
  msg("u1", "user", "alpha", "my dog is Biscuit", null),
  msg("a1", "assistant", "alpha", "noted Biscuit", "u1"),
  msg("u2", "user", "beta", "my cat is Mochi", "a1"),
  msg("b2", "assistant", "beta", "noted Mochi", "u2"),
];

describe("conversationPath", () => {
  it("walks parent links root → leaf and ignores off-path siblings", () => {
    const sibling = msg("a1b", "assistant", "alpha", "regenerated", "u1");
    expect(conversationPath([...thread, sibling], "b2").map((m) => m.id)).toEqual(["u1", "a1", "u2", "b2"]);
    expect(conversationPath([...thread, sibling], "a1b").map((m) => m.id)).toEqual(["u1", "a1b"]);
  });

  it("is empty for a first turn", () => {
    expect(conversationPath(thread, null)).toEqual([]);
  });
});

describe("buildAgentHandoff", () => {
  it("returns null for a single-agent path — chats that never switched run unchanged", () => {
    const path = conversationPath(thread, "a1");
    expect(agentsOnPath(path, "alpha")).toEqual(["alpha"]);
    expect(buildAgentHandoff({ path, agentSlug: "alpha", isOwnSessionTurn: serverTurn })).toBeNull();
  });

  it("returns null for an empty path even when a new agent answers", () => {
    expect(buildAgentHandoff({ path: [], agentSlug: "beta", isOwnSessionTurn: serverTurn })).toBeNull();
  });

  it("gives a newly switched-in agent the whole path as fresh, with resume equal to it", () => {
    const handoff = buildAgentHandoff({ path: conversationPath(thread, "a1"), agentSlug: "beta", isOwnSessionTurn: serverTurn });
    expect(handoff?.fresh).toContain("[User]: my dog is Biscuit");
    expect(handoff?.fresh).toContain("[@alpha (another agent)]: noted Biscuit");
    expect(handoff?.fresh).toContain("You are @beta");
    expect(handoff?.resume).toBe(handoff?.fresh);
  });

  it("gives a returning agent only the turns after its last reply on resume", () => {
    const handoff = buildAgentHandoff({ path: conversationPath(thread, "b2"), agentSlug: "alpha", isOwnSessionTurn: serverTurn });
    expect(handoff?.resume).toContain("[User]: my cat is Mochi");
    expect(handoff?.resume).toContain("[@beta (another agent)]: noted Mochi");
    expect(handoff?.resume).not.toContain("Biscuit");
    // fresh still carries the agent's own earlier turn, labelled as its own
    expect(handoff?.fresh).toContain("[You (@alpha)]: noted Biscuit");
  });

  it("treats a harness reply as outside the server session", () => {
    const harness = [
      ...thread.slice(0, 1),
      msg("a1", "assistant", "alpha", "noted Biscuit", "u1", { runProvider: "local-harness:claude" }),
      ...thread.slice(2),
    ];
    const handoff = buildAgentHandoff({ path: conversationPath(harness, "b2"), agentSlug: "alpha", isOwnSessionTurn: serverTurn });
    expect(handoff?.resume).toContain("Biscuit");
  });

  it("skips running and failed rows", () => {
    const withFailed = [
      ...thread,
      msg("u3", "user", "beta", "again", "b2"),
      msg("b3", "assistant", "beta", "{\"error\":\"boom\"}", "u3", { status: "failed" }),
    ];
    const handoff = buildAgentHandoff({ path: conversationPath(withFailed, "b3"), agentSlug: "alpha", isOwnSessionTurn: serverTurn });
    expect(handoff?.resume).toContain("[User]: again");
    expect(handoff?.resume).not.toContain("boom");
  });

  it("caps long transcripts and says so", () => {
    const long: HandoffMessage[] = [];
    let parent: string | null = null;
    for (let i = 0; i < 60; i++) {
      const id = `m${i}`;
      long.push(msg(id, i % 2 === 0 ? "user" : "assistant", i < 2 ? "alpha" : "beta", `turn ${i} ${"x".repeat(1000)}`, parent));
      parent = id;
    }
    const handoff = buildAgentHandoff({ path: conversationPath(long, parent), agentSlug: "gamma", isOwnSessionTurn: serverTurn });
    expect(handoff?.fresh).toContain("(earlier messages omitted)");
    expect(handoff!.fresh!.length).toBeLessThan(26_000);
    expect(handoff?.fresh).toContain("turn 59");
  });
});

describe("sanitizeAgentHandoff", () => {
  it("accepts the built shape and rejects anything else", () => {
    expect(sanitizeAgentHandoff({ resume: "a", fresh: "b" })).toEqual({ resume: "a", fresh: "b" });
    expect(sanitizeAgentHandoff({ resume: "", fresh: null })).toBeNull();
    expect(sanitizeAgentHandoff("note")).toBeNull();
    expect(sanitizeAgentHandoff([{ resume: "a" }])).toBeNull();
    expect(sanitizeAgentHandoff({ resume: 5, fresh: "b" })).toEqual({ resume: null, fresh: "b" });
  });

  it("caps each variant", () => {
    const out = sanitizeAgentHandoff({ resume: "y".repeat(100_000), fresh: null });
    expect(out?.resume?.length).toBe(48_000);
  });
});

const at = (minute: number): Date => new Date(Date.UTC(2026, 9, 7, 10, minute));
const group = (conversationId: string, agentSlug: string, first: number, last: number, count = 2): ConversationAgentGroup => ({
  conversationId,
  agentSlug,
  firstAt: at(first),
  lastAt: at(last),
  count,
});

describe("conversation list", () => {
  const groups = [
    // a direct chat switched alpha → beta → alpha
    group("chat-1", "alpha", 0, 30, 4),
    group("chat-1", "beta", 10, 20, 2),
    // a single-agent direct chat
    group("chat-2", "beta", 40, 41),
    // a Spaces thread with the host agent and the user's twin
    group("thread-1", "alpha", 5, 6),
    group("thread-1", "digital-twin", 7, 8),
    // machine-initiated threads never appear
    group("scheduled_x", "alpha", 50, 51),
  ];
  const entries = conversationEntries(groups);
  const rows = (meta: Parameters<typeof buildConversationList>[0]["meta"] = [], firstUserMessages: Parameters<typeof buildConversationList>[0]["firstUserMessages"] = []) =>
    buildConversationList({ entries, meta, firstUserMessages });

  it("shows a switched direct chat once, with every agent and the conversation-wide totals", () => {
    const chat = rows().filter((r) => r.conversationId === "chat-1");
    expect(chat).toHaveLength(1);
    expect(chat[0]).toMatchObject({
      rowId: "chat-1",
      agentSlugs: ["alpha", "beta"],
      agentSlug: "alpha", // most recent activity
      messageCount: 6,
      lastMessageAt: at(30),
    });
  });

  it("keeps one row per agent for a non-direct conversation, with unique row ids", () => {
    const thread = rows().filter((r) => r.conversationId === "thread-1");
    expect(thread.map((r) => r.rowId).sort()).toEqual(["thread-1:alpha", "thread-1:digital-twin"]);
    expect(thread.every((r) => r.agentSlugs.length === 1)).toBe(true);
  });

  it("drops machine-initiated conversations and sorts by last activity", () => {
    expect(rows().map((r) => r.rowId)).toEqual(["chat-2", "chat-1", "thread-1:digital-twin", "thread-1:alpha"]);
  });

  it("takes a switched chat's title and pin from its home agent's meta row", () => {
    const list = rows([
      { conversationId: "chat-1", agentSlug: "alpha", title: "Pets", pinned: true },
      { conversationId: "chat-1", agentSlug: "beta", title: "stale", pinned: false },
    ]);
    expect(list.find((r) => r.rowId === "chat-1")).toMatchObject({ title: "Pets", titleGenerated: true, pinned: true });
  });

  it("falls back to the first user message — conversation-wide for a direct chat, per agent otherwise", () => {
    const byRow = new Map(rows([], [
      { conversationId: "chat-1", agentSlug: "alpha", content: "first ever" },
      { conversationId: "chat-1", agentSlug: "beta", content: "later" },
      { conversationId: "thread-1", agentSlug: "alpha", content: "to host" },
      { conversationId: "thread-1", agentSlug: "digital-twin", content: "to twin" },
    ]).map((r) => [r.rowId, r.title]));
    expect(byRow.get("chat-1")).toBe("first ever");
    expect(byRow.get("thread-1:alpha")).toBe("to host");
    expect(byRow.get("thread-1:digital-twin")).toBe("to twin");
  });

  it("asks for fallback titles only where the meta row has none", () => {
    const ids = entriesNeedingFallbackTitle(entries, [
      { conversationId: "chat-1", agentSlug: "alpha", title: "Pets", pinned: false },
    ]);
    expect(ids.sort()).toEqual(["chat-2", "thread-1"]);
  });

  it("offers every agent in the history, most recently active first, with counts", () => {
    expect(agentFacets(entries)).toEqual([
      { slug: "beta", count: 2 },
      { slug: "alpha", count: 2 },
      { slug: "digital-twin", count: 1 },
    ]);
  });
});

describe("selectPage", () => {
  // 7 rows; two share a timestamp so the row id has to break the tie.
  const items = ["a", "b", "c", "d", "e", "f", "g"].map((rowId, i) => ({
    rowId,
    lastMessageAt: at(i === 4 ? 3 : 10 - i),
  }));
  const sorted = [...items].sort((x, y) => y.lastMessageAt.getTime() - x.lastMessageAt.getTime() || (x.rowId < y.rowId ? 1 : -1));
  const ids = (list: Array<{ rowId: string }>): string[] => list.map((item) => item.rowId);

  it("walks every row exactly once across pages, newest first", () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: { items: Array<{ rowId: string }>; nextCursor: string | null } = selectPage(sorted, { isPinned: () => false, limit: 3, cursor: cursor ? decodeCursor(cursor) : null });
      seen.push(...ids(page.items));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual(ids(sorted));
  });

  it("puts every pinned row on the first page, however old, and never again", () => {
    const pinned = new Set(["g"]);
    const first = selectPage(sorted, { isPinned: (item) => pinned.has(item.rowId), limit: 2, cursor: null });
    expect(ids(first.items)).toContain("g");
    expect(first.items).toHaveLength(3);
    const rest: string[] = [];
    let cursor = first.nextCursor;
    while (cursor) {
      const page = selectPage(sorted, { isPinned: (item) => pinned.has(item.rowId), limit: 2, cursor: decodeCursor(cursor) });
      rest.push(...ids(page.items));
      cursor = page.nextCursor;
    }
    expect(rest).not.toContain("g");
    expect(new Set([...ids(first.items), ...rest]).size).toBe(sorted.length);
  });

  it("does not repeat a row when a newer one arrives between pages", () => {
    const first = selectPage(sorted, { isPinned: () => false, limit: 3, cursor: null });
    const withNew = [{ rowId: "new", lastMessageAt: at(59) }, ...sorted];
    const second = selectPage(withNew, { isPinned: () => false, limit: 3, cursor: decodeCursor(first.nextCursor!) });
    expect(ids(second.items).some((id) => ids(first.items).includes(id) || id === "new")).toBe(false);
  });

  it("rejects a cursor it did not mint", () => {
    expect(decodeCursor("not-a-cursor")).toBeNull();
    expect(decodeCursor(Buffer.from("yesterday|chat-1").toString("base64url"))).toBeNull();
  });
});
