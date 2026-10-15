import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  runs: new Map<string, { userId: string; triggerSource: string; conversationId: string | null; orgId: string }>(),
  artifacts: [] as Array<Record<string, unknown>>,
  kv: new Map<string, string>(),
  lists: new Map<string, string[]>(),
  /** The pod's pattern subscriber, which a publish reaches. */
  onPublished: null as ((pattern: string, channel: string, message: string) => void) | null,
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
      publish: vi.fn(async (channel: string, message: string) => {
        state.onPublished?.("*", channel, message);
        return 1;
      }),
      duplicate: () => ({
        psubscribe: vi.fn(async () => 1),
        on: vi.fn((event: string, handler: (pattern: string, channel: string, message: string) => void) => {
          if (event === "pmessage") state.onPublished = handler;
        }),
      }),
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
  servePagePanelStream,
} from "./page-panel-calls.js";
import { signalArtifacts } from "./panel-signals.js";

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

  it("streams a call to the panel holding the stream as soon as it is queued", async () => {
    const id = newRun("u1", "chat");
    const written: string[] = [];
    const stop = await servePagePanelStream({
      userId: "u1",
      runIds: [id],
      panelOpen: true,
      write: (chunk) => written.push(chunk),
      // No beat during the test: the wake alone has to bring the call.
      heartbeatMs: 60_000,
    });
    const answer = callPagePanelTool({ userId: "u1", sessionId: id, toolName: "page-tabs", args: {} });
    await vi.waitFor(() => expect(written.some((chunk) => chunk.startsWith("event: call"))).toBe(true));
    const sent = written.find((chunk) => chunk.startsWith("event: call")) ?? "";
    const call = JSON.parse(sent.slice(sent.indexOf("data: ") + 6)) as { id: string; toolName: string };
    expect(call.toolName).toBe("page-tabs");
    expect(await resolvePagePanelCall("u1", call.id, { ok: true, content: "- tab-1 (shown)" })).toBe(true);
    expect((await answer).content).toBe("- tab-1 (shown)");
    stop();
  });

  it("says down the stream when an artifact of the run's conversation changes, and no other's", async () => {
    const id = newRun("u1", "chat");
    const written: string[] = [];
    const stop = await servePagePanelStream({
      userId: "u1",
      runIds: [id],
      panelOpen: false,
      write: (chunk) => written.push(chunk),
      heartbeatMs: 60_000,
    });
    expect(written[0]).toBe(`event: ready\ndata: {"artifacts":true}\n\n`);
    signalArtifacts("conv-elsewhere");
    signalArtifacts(`conv-${id}`);
    await vi.waitFor(() => expect(written.some((chunk) => chunk.startsWith("event: artifacts"))).toBe(true));
    expect(written.filter((chunk) => chunk.startsWith("event: artifacts"))).toEqual([
      `event: artifacts\ndata: {"conversationId":"conv-${id}"}\n\n`,
    ]);
    stop();
  });

  it("leaves page tools unavailable to a screen streaming without pages", async () => {
    const id = newRun("u1", "chat");
    const stop = await servePagePanelStream({
      userId: "u1",
      runIds: [id],
      panelOpen: false,
      write: () => undefined,
      heartbeatMs: 60_000,
    });
    const result = await callPagePanelTool({ userId: "u1", sessionId: id, toolName: "page-read", args: {} });
    expect(result.unavailable).toBe(true);
    stop();
  });

  it("leaves a call to the panel with pages, not a screen following the run without", async () => {
    const id = newRun("u1", "chat");
    const desktop: string[] = [];
    const web: string[] = [];
    const stopDesktop = await servePagePanelStream({
      userId: "u1",
      runIds: [id],
      panelOpen: true,
      write: (chunk) => desktop.push(chunk),
      heartbeatMs: 60_000,
    });
    const stopWeb = await servePagePanelStream({
      userId: "u1",
      runIds: [id],
      panelOpen: false,
      write: (chunk) => web.push(chunk),
      heartbeatMs: 60_000,
    });
    const answer = callPagePanelTool({ userId: "u1", sessionId: id, toolName: "page-read", args: {} });
    await vi.waitFor(() => expect(desktop.some((chunk) => chunk.startsWith("event: call"))).toBe(true));
    expect(web.some((chunk) => chunk.startsWith("event: call"))).toBe(false);
    const sent = desktop.find((chunk) => chunk.startsWith("event: call")) ?? "";
    const call = JSON.parse(sent.slice(sent.indexOf("data: ") + 6)) as { id: string };
    await resolvePagePanelCall("u1", call.id, { ok: true, content: "read" });
    expect((await answer).ok).toBe(true);
    stopDesktop();
    stopWeb();
  });

  it("says a conversation changed when its run is found only after the stream opened", async () => {
    const id = `run-late-${++run}`;
    const written: string[] = [];
    const stop = await servePagePanelStream({
      userId: "u1",
      runIds: [id],
      panelOpen: false,
      write: (chunk) => written.push(chunk),
      heartbeatMs: 20,
    });
    expect(written.some((chunk) => chunk.startsWith("event: artifacts"))).toBe(false);
    // The run's row becomes visible after the stream opened.
    state.runs.set(id, { userId: "u1", triggerSource: "chat", conversationId: `conv-${id}`, orgId: "org-1" });
    await vi.waitFor(() =>
      expect(written).toContain(`event: artifacts\ndata: {"conversationId":"conv-${id}"}\n\n`),
    );
    const before = written.length;
    signalArtifacts(`conv-${id}`);
    await vi.waitFor(() => expect(written.length).toBeGreaterThan(before));
    stop();
  });

  it("streams nothing for someone else's run", async () => {
    const id = newRun("u2", "chat");
    const written: string[] = [];
    const stop = await servePagePanelStream({
      userId: "u1",
      runIds: [id],
      panelOpen: true,
      write: (chunk) => written.push(chunk),
      heartbeatMs: 60_000,
    });
    // Not present for u2's run, so the call is refused rather than queued.
    const result = await callPagePanelTool({ userId: "u2", sessionId: id, toolName: "page-read", args: {} });
    expect(result.ok).toBe(false);
    expect(written.some((chunk) => chunk.startsWith("event: call"))).toBe(false);
    stop();
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
