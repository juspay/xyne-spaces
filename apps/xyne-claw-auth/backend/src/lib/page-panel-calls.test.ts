import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  runs: new Map<string, { userId: string; triggerSource: string; conversationId: string | null; orgId: string }>(),
  artifacts: [] as Array<Record<string, unknown>>,
  kv: new Map<string, string>(),
  lists: new Map<string, string[]>(),
}));

vi.mock("../db.js", () => ({
  prisma: {
    agentRun: {
      findUnique: vi.fn(async ({ where }: { where: { sessionId: string } }) => state.runs.get(where.sessionId) ?? null),
    },
  },
}));

vi.mock("../redis.js", () => ({
  redisService: {
    getConnection: () => ({
      get: vi.fn(async (k: string) => state.kv.get(k) ?? null),
      set: vi.fn(async (k: string, v: string) => {
        state.kv.set(k, v);
        return "OK";
      }),
      del: vi.fn(async (...keys: string[]) => {
        for (const k of keys) state.kv.delete(k);
        return keys.length;
      }),
      rpush: vi.fn(async (k: string, v: string) => {
        const list = state.lists.get(k) ?? [];
        list.push(v);
        state.lists.set(k, list);
        return list.length;
      }),
      lpop: vi.fn(async (k: string) => state.lists.get(k)?.shift() ?? null),
      expire: vi.fn(async () => 1),
    }),
  },
}));

vi.mock("./conversation-artifacts.js", () => ({
  normalizeExternalUrl: (url: string) => url,
  detectLinkProvider: () => "google_docs",
  recordConversationArtifact: vi.fn(async (input: Record<string, unknown>) => {
    state.artifacts.push(input);
  }),
}));

import {
  callPagePanelTool,
  nextPagePanelCall,
  pagePanelAllowedForTrigger,
  resolvePagePanelCall,
} from "./page-panel-calls.js";

let run = 0;
const newRun = (userId: string, triggerSource: string) => {
  const id = `run-${++run}`;
  state.runs.set(id, { userId, triggerSource, conversationId: `conv-${id}`, orgId: "org-1" });
  return id;
};

describe("browser panel calls for Xyne AI screen runs", () => {
  beforeEach(() => {
    state.kv.clear();
    state.lists.clear();
    state.artifacts.length = 0;
  });

  it("only allows runs started from the Xyne AI screen", () => {
    expect(pagePanelAllowedForTrigger("chat")).toBe(true);
    for (const source of ["spaces", "slack", "automation", "scheduled", "api", null]) {
      expect(pagePanelAllowedForTrigger(source)).toBe(false);
    }
  });

  it("refuses a thread run without queueing anything", async () => {
    const id = newRun("u1", "spaces");
    const result = await callPagePanelTool({ userId: "u1", sessionId: id, toolName: "page-read", args: {} });
    expect(result.unavailable).toBe(true);
    expect(state.lists.size).toBe(0);
  });

  it("refuses another user's run", async () => {
    const id = newRun("u2", "chat");
    const result = await callPagePanelTool({ userId: "u1", sessionId: id, toolName: "page-read", args: {} });
    expect(result.unavailable).toBe(true);
  });

  it("is unavailable when no panel is polling for the run", async () => {
    const id = newRun("u1", "chat");
    const result = await callPagePanelTool({ userId: "u1", sessionId: id, toolName: "page-click", args: { ref: "e1" } });
    expect(result.unavailable).toBe(true);
    expect(state.lists.size).toBe(0);
  });

  it("hands the call to the polling panel and returns its answer", async () => {
    const id = newRun("u1", "chat");
    expect(await nextPagePanelCall("u1", [id])).toBeNull();

    const pending = callPagePanelTool({ userId: "u1", sessionId: id, toolName: "page-read", args: {} });
    await new Promise((r) => setTimeout(r, 20));
    const call = await nextPagePanelCall("u1", [id]);
    expect(call?.toolName).toBe("page-read");

    expect(await resolvePagePanelCall("u2", call!.id, { ok: true, content: "stolen" })).toBe(false);
    expect(await resolvePagePanelCall("u1", call!.id, { ok: true, content: "Title: Example" })).toBe(true);
    expect(await pending).toEqual({ ok: true, content: "Title: Example" });
  });

  it("does not let a user poll someone else's run", async () => {
    const id = newRun("u2", "chat");
    expect(await nextPagePanelCall("u1", [id])).toBeNull();
    expect(state.kv.size).toBe(0);
  });

  it("opens a URL in the panel of the run's Xyne AI screen and waits for it", async () => {
    const id = newRun("u1", "chat");
    const pending = callPagePanelTool({
      userId: "u1",
      sessionId: id,
      toolName: "open-url",
      args: { url: "https://docs.google.com/", title: "Google Docs" },
    });
    await new Promise((r) => setTimeout(r, 300));
    await nextPagePanelCall("u1", [id], true);
    const result = await pending;
    expect(result.ok).toBe(true);
    expect(result.content).toContain("browser panel");
    expect(state.artifacts[0]).toMatchObject({
      conversationId: `conv-${id}`,
      runId: id,
      kind: "PAGE",
      url: "https://docs.google.com/",
      title: "Google Docs",
      createdByUserId: "u1",
    });
  });

  it("falls back when no desktop panel opens the page in time", async () => {
    const id = newRun("u1", "chat");
    const result = await callPagePanelTool({ userId: "u1", sessionId: id, toolName: "open-url", args: { url: "https://docs.google.com/" } });
    expect(result.unavailable).toBe(true);
    expect(state.artifacts).toHaveLength(1);
  }, 15_000);

  it("does not open a URL for a thread run", async () => {
    const id = newRun("u1", "spaces");
    const result = await callPagePanelTool({ userId: "u1", sessionId: id, toolName: "open-url", args: { url: "https://docs.google.com/" } });
    expect(result.unavailable).toBe(true);
    expect(state.artifacts).toHaveLength(0);
  });
});
