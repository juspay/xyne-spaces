import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  runs: new Map<string, { userId: string; triggerSource: string; conversationId: string | null; orgId: string }>(),
  kv: new Map<string, string>(),
  published: [] as string[],
  devices: [] as Array<{ id: string; orgId: string; deviceName: string; lastSeenAt: Date | null; focusedAt: Date | null }>,
  calls: [] as Array<Record<string, unknown>>,
  artifacts: [] as Array<Record<string, unknown>>,
  answer: null as null | { status: string; ok: boolean; content: string; image: null },
}));

vi.mock("../db.js", () => ({
  prisma: {
    agentRun: {
      findUnique: vi.fn(async ({ where }: { where: { sessionId: string } }) => state.runs.get(where.sessionId) ?? null),
    },
    localHarnessDevice: { findMany: vi.fn(async () => state.devices) },
    surfaceCall: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.calls.push(data);
        return { id: `call-${state.calls.length}` };
      }),
      findUnique: vi.fn(async () => state.answer),
      delete: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
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
      del: vi.fn(async (k: string) => (state.kv.delete(k) ? 1 : 0)),
      exists: vi.fn(async (k: string) => (state.kv.has(k) ? 1 : 0)),
      publish: vi.fn(async (channel: string) => {
        state.published.push(channel);
        return 1;
      }),
      rpush: vi.fn(async () => 1),
      lpop: vi.fn(async () => null),
      expire: vi.fn(async () => 1),
      duplicate: () => ({ psubscribe: vi.fn(async () => 1), on: vi.fn() }),
    }),
  },
}));

vi.mock("./conversation-artifacts.js", () => ({
  normalizeExternalUrl: (url: string) => url,
  detectLinkProvider: () => "web",
  recordConversationArtifact: vi.fn(async (input: Record<string, unknown>) => {
    state.artifacts.push(input);
  }),
}));

import { callSurfaceTool } from "./surface-calls.js";

const online = () => [{ id: "dev-1", orgId: "org-1", deviceName: "mac", lastSeenAt: new Date(), focusedAt: new Date() }];
const capable = () => state.kv.set("claw:device-capabilities:dev-1", JSON.stringify(["page-tools", "open-url"]));

describe("browser tools over the device push channel", () => {
  beforeEach(() => {
    state.runs.clear();
    state.kv.clear();
    state.published.length = 0;
    state.calls.length = 0;
    state.artifacts.length = 0;
    state.devices = online();
    state.answer = { status: "DONE", ok: true, content: "Title: Example", image: null };
  });

  it("pushes a Xyne AI screen run's page call to the user's connected app", async () => {
    state.runs.set("run-chat", { userId: "u1", triggerSource: "chat", conversationId: "conv-1", orgId: "org-1" });
    capable();
    const result = await callSurfaceTool({ userId: "u1", sessionId: "run-chat", toolName: "page-read", args: {} });
    expect(result).toEqual({ ok: true, content: "Title: Example" });
    expect(state.calls[0]).toMatchObject({ toolName: "page-read", deviceId: "dev-1", args: { xyneSurface: "xyne-ai", xyneRunId: "run-chat" } });
    expect(state.published).toEqual(["claw:device-push:dev-1"]);
  });

  it("records the page and pushes open-url for a Xyne AI screen run", async () => {
    state.runs.set("run-chat", { userId: "u1", triggerSource: "chat", conversationId: "conv-1", orgId: "org-1" });
    capable();
    await callSurfaceTool({ userId: "u1", sessionId: "run-chat", toolName: "open-url", args: { url: "https://docs.google.com/" } });
    expect(state.artifacts[0]).toMatchObject({ conversationId: "conv-1", kind: "PAGE", url: "https://docs.google.com/" });
    expect(state.calls[0]).toMatchObject({ toolName: "open-url", args: { url: "https://docs.google.com/", xyneSurface: "xyne-ai" } });
  });

  it("pushes an SDLC hub thread run to the SDLC browser without recording a page", async () => {
    state.runs.set("run-sdlc", { userId: "u1", triggerSource: "spaces", conversationId: "thread-1", orgId: "org-1" });
    state.kv.set("sdlc-run:run-sdlc", "channel-1");
    capable();
    await callSurfaceTool({ userId: "u1", sessionId: "run-sdlc", toolName: "open-url", args: { url: "https://docs.google.com/" } });
    expect(state.artifacts).toHaveLength(0);
    expect(state.calls[0]).toMatchObject({ toolName: "open-url", args: { xyneSurface: "sdlc", xyneRunId: "run-sdlc" } });
  });

  it("refuses an SDLC run when the app has no browser support", async () => {
    state.runs.set("run-sdlc", { userId: "u1", triggerSource: "spaces", conversationId: "thread-1", orgId: "org-1" });
    state.kv.set("sdlc-run:run-sdlc", "channel-1");
    const result = await callSurfaceTool({ userId: "u1", sessionId: "run-sdlc", toolName: "page-click", args: { ref: "e1" } });
    expect(result.unavailable).toBe(true);
    expect(state.calls).toHaveLength(0);
  });

  it("refuses a plain thread run and another user's run", async () => {
    capable();
    state.runs.set("run-thread", { userId: "u1", triggerSource: "spaces", conversationId: "thread-1", orgId: "org-1" });
    state.runs.set("run-other", { userId: "u2", triggerSource: "chat", conversationId: "conv-2", orgId: "org-1" });
    expect((await callSurfaceTool({ userId: "u1", sessionId: "run-thread", toolName: "page-read", args: {} })).unavailable).toBe(true);
    expect((await callSurfaceTool({ userId: "u1", sessionId: "run-other", toolName: "page-read", args: {} })).unavailable).toBe(true);
    expect(state.calls).toHaveLength(0);
  });

  it("falls back to the Xyne AI screen poller when the app has no browser support", async () => {
    state.runs.set("run-chat", { userId: "u1", triggerSource: "chat", conversationId: "conv-1", orgId: "org-1" });
    const result = await callSurfaceTool({ userId: "u1", sessionId: "run-chat", toolName: "page-read", args: {} });
    expect(result.unavailable).toBe(true);
    expect(state.calls).toHaveLength(0);
  });

  it("keeps app tools on the device path for any run", async () => {
    state.runs.set("run-thread", { userId: "u1", triggerSource: "spaces", conversationId: "thread-1", orgId: "org-1" });
    state.answer = { status: "DONE", ok: true, content: "Opened", image: null };
    const result = await callSurfaceTool({ userId: "u1", sessionId: "run-thread", toolName: "app-navigate", args: { target: "chat" } });
    expect(result).toEqual({ ok: true, content: "Opened" });
    expect(state.calls[0]).toMatchObject({ toolName: "app-navigate", args: { target: "chat" } });
  });
});
