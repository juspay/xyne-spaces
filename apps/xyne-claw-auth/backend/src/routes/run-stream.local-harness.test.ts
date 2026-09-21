import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

const state = vi.hoisted(() => ({
  target: null as null | { provider: string; device: { id: string } },
  dispatchArgs: [] as Array<Record<string, unknown>>,
  fetchBodies: [] as Array<Record<string, unknown>>,
  persisted: [] as Array<Record<string, unknown>>,
  stickyFolder: null as unknown,
  messageUpdates: [] as Array<Record<string, unknown>>,
  handoffs: [] as Array<Record<string, unknown>>,
  handoffResult: { handedOff: false, reason: "no_active_run" } as { handedOff: boolean; reason: string },
  config: {
    internalUrl: "http://auth.local",
    xyneClawS2sKey: "s2s-secret",
    clawSseTransport: false,
    localHarnessEnabled: true,
    localHarnessRunTimeoutMs: 600000,
    liveToolCallsEnabled: false,
    spacesAppUrl: "https://spaces.local",
  },
}));

vi.mock("../config.js", () => ({ CONFIG: state.config }));

vi.mock("../logger.js", () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }),
}));

vi.mock("../middleware/require-auth.js", () => ({
  requireAuth: vi.fn((_req: Request, _res: Response, next: () => void) => next()),
  requireNoAccessToken: vi.fn((_req: Request, _res: Response, next: () => void) => next()),
  requireResultToken: vi.fn(() => (_req: Request, _res: Response, next: () => void) => next()),
}));

vi.mock("../middleware/agent-acl.js", () => ({
  getRequesterId: vi.fn(() => "user-1"),
  getAgentEditAccess: vi.fn(async () => null),
  isClawAdmin: vi.fn(async () => false),
}));

vi.mock("../db.js", () => ({
  prisma: {
    agent: {
      findUnique: vi.fn(async () => ({
        id: "agent-id",
        orgId: "org-1",
        name: "Assistant",
        description: "",
        config: { providerOrder: ["codex-cli"] },
        systemPrompt: "agent prompt",
      })),
    },
    chatAttachment: { create: vi.fn(async () => ({})), findMany: vi.fn(async () => []) },
  },
}));

vi.mock("../repositories/index.js", () => ({
  chatMessageRepository: {
    create: vi.fn(async () => ({ id: "msg-1" })),
    update: vi.fn(async (_id: string, data: Record<string, unknown>) => {
      state.messageUpdates.push(data);
      return { id: "assistant-1" };
    }),
    findByConversation: vi.fn(async () => []),
    latestMessageId: vi.fn(async () => null),
    latestLocalFolderContext: vi.fn(async () => state.stickyFolder),
  },
  agentRunRepository: {
    start: vi.fn(async () => ({})),
    finalize: vi.fn(async () => ({})),
    findBySessionId: vi.fn(async () => null),
    appendToolInvocation: vi.fn(async () => ({})),
    updateProgress: vi.fn(async () => ({})),
  },
  chatAttachmentRepository: { linkToMessage: vi.fn(async () => ({})) },
  userAgentConfigRepository: { findByUserAndAgent: vi.fn(async () => null) },
}));

vi.mock("../services/storageService.js", () => ({
  gcsService: { uploadFile: vi.fn(async () => undefined), getFileBuffer: vi.fn(async () => Buffer.alloc(0)) },
}));

vi.mock("../lib/agent-provider-config.js", () => ({
  resolveAgentProviderConfigs: vi.fn(async () => ({ provider: undefined, providerConfigs: {}, providerOrder: [] })),
  agentDefaultSpeed: vi.fn(() => "standard"),
  parseFastModeProfile: vi.fn(() => ({ providers: "" })),
}));

vi.mock("../lib/fast-mode.js", () => ({ resolveFastMode: vi.fn(async () => false) }));

vi.mock("../lib/sdlc-repository-context.js", () => ({
  resolveSdlcRepositoryForUser: vi.fn(async () => ({ ok: true, repository: undefined })),
}));

vi.mock("../lib/artifact-app-session.js", () => ({ attachArtifactToSessionApp: vi.fn(async () => null) }));

vi.mock("../lib/live-conversation-bus.js", () => ({ publishLiveEvent: vi.fn() }));

vi.mock("../lib/live-delta-coalescer.js", () => ({ pushDelta: vi.fn(), endDeltaCoalescer: vi.fn() }));

vi.mock("../lib/consume-claw-stream.js", () => ({ consumeClawStream: vi.fn(async () => undefined) }));

vi.mock("./lib/branching.js", () => ({
  branchPiConversationId: vi.fn((id: string) => id),
  piSessionStoreKey: vi.fn(() => "pi-key"),
  resolvePiConversationIdForPath: vi.fn(() => "conv-1"),
  cloneBranchSession: vi.fn(async () => ({ ok: true })),
}));

vi.mock("../redis.js", () => ({
  redisService: {
    getConnection: () => ({
      publish: vi.fn(async () => 1),
      subscribe: vi.fn(async () => 1),
      on: vi.fn(),
      get: vi.fn(async () => null),
      set: vi.fn(async () => "OK"),
      del: vi.fn(async () => 1),
      expire: vi.fn(async () => 1),
      duplicate: () => ({ subscribe: vi.fn(async () => 1), on: vi.fn() }),
    }),
  },
}));

vi.mock("../lib/run-turn-handoff.js", () => ({
  isTurnControlCommand: vi.fn(() => false),
  awaitTurnHandoff: vi.fn(async (a: Record<string, unknown>) => {
    state.handoffs.push(a);
    if (state.handoffResult.handedOff) (a["onLabel"] as ((l: string) => void) | undefined)?.("Wrapping up the previous reply first…");
    return state.handoffResult;
  }),
}));

vi.mock("../lib/local-harness-continuation.js", () => ({
  planServerContinuation: vi.fn(async () => null),
  planHarnessContinuation: vi.fn(async () => ({ resumeSessionId: null, context: null })),
}));

vi.mock("../lib/local-harness.js", () => ({
  resolveLocalHarnessTarget: vi.fn(async () => state.target ?? undefined),
  resolveLocalHarnessTargetForProvider: vi.fn(async (_userId: string, provider: string) =>
    state.target && state.target.provider === provider ? state.target : undefined,
  ),
  dispatchLocalHarnessRun: vi.fn(async (args: Record<string, unknown>) => {
    state.dispatchArgs.push(args);
    return { sessionId: "harness-session", runId: "harness-run" };
  }),
  pinnedModelForProvider: vi.fn(() => null),
  resolveLocalSandbox: vi.fn(async (command: string) => ({
    command: `/${command}`,
    instruction: "sandbox instruction",
    skills: [{ name: "design-skills/design-brief/SKILL.md", content: "# brief" }],
  })),
  localHarnessProviderLabel: vi.fn((p: string) => (p === "codex-cli" ? "Codex CLI" : p)),
}));

interface Capture {
  frames: Array<{ event: string; data: Record<string, unknown> }>;
  ended: Promise<void>;
}

function makeResponse(): { res: Response; capture: Capture } {
  const frames: Array<{ event: string; data: Record<string, unknown> }> = [];
  let resolveEnded: () => void = () => {};
  const ended = new Promise<void>((r) => { resolveEnded = r; });
  const res = {
    writeHead: vi.fn(),
    write: vi.fn((chunk: string) => {
      const match = /^event: ([^\n]+)\ndata: ([\s\S]*)\n\n$/.exec(chunk);
      if (match?.[1] && match[2]) frames.push({ event: match[1], data: JSON.parse(match[2]) as Record<string, unknown> });
      return true;
    }),
    end: vi.fn(() => { resolveEnded(); }),
    status: vi.fn(function status(this: Response) { return this; }),
    json: vi.fn(function json(this: Response) { resolveEnded(); return this; }),
    headersSent: true,
    writableEnded: false,
    destroyed: false,
    locals: {},
  } as unknown as Response;
  return { res, capture: { frames, ended } };
}

function makeRequest(body: Record<string, unknown>, url = "/"): Request {
  return {
    method: "POST",
    url,
    originalUrl: url,
    baseUrl: "",
    headers: { "x-org-id": "org-1" },
    query: {},
    params: {},
    body,
    ip: "127.0.0.1",
    socket: { remoteAddress: "127.0.0.1" },
    on: vi.fn(),
  } as unknown as Request;
}

function handle(router: unknown, req: Request, res: Response): void {
  (router as { handle: (r: Request, s: Response, n: (e?: unknown) => void) => void }).handle(req, res, () => {});
}

const localFolder = {
  type: "local-folder",
  id: "/Users/ann/code/app",
  title: "app",
  metadata: { path: "/Users/ann/code/app", branch: "feature/x" },
};

const runBody = { userId: "user-1", task: "do a thing", agentSlug: "assistant", conversationId: "conv-1" };

describe("run/stream local harness", () => {
  beforeEach(() => {
    vi.resetModules();
    state.target = null;
    state.dispatchArgs = [];
    state.fetchBodies = [];
    state.stickyFolder = null;
    state.messageUpdates = [];
    state.handoffs = [];
    state.handoffResult = { handedOff: false, reason: "no_active_run" };
    vi.stubGlobal("fetch", vi.fn(async (_input: unknown, init?: RequestInit) => {
      if (typeof init?.body === "string") state.fetchBodies.push(JSON.parse(init.body) as Record<string, unknown>);
      return new Response(JSON.stringify({ success: true, sessionId: "server-session" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }));
  });

  it("leaves the server path untouched when no harness target resolves", async () => {
    const { runStreamRouter } = await import("./run-stream.js");
    const { res, capture } = makeResponse();
    handle(runStreamRouter, makeRequest(runBody), res);
    await vi.waitFor(() => expect(state.fetchBodies.length).toBeGreaterThan(0));

    expect(state.dispatchArgs).toHaveLength(0);
    expect(capture.frames.map((f) => f.event)).toContain("run");
    expect(capture.frames.find((f) => f.event === "run")?.data["sessionId"]).toBe("server-session");
  });

  it("dispatches to the harness with the forward body as server fallback", async () => {
    state.target = { provider: "codex-cli", device: { id: "device-1" } };
    const { runStreamRouter } = await import("./run-stream.js");
    const { res, capture } = makeResponse();
    handle(runStreamRouter, makeRequest(runBody), res);
    await vi.waitFor(() => expect(state.dispatchArgs).toHaveLength(1));

    const args = state.dispatchArgs[0]!;
    expect(state.fetchBodies).toHaveLength(0);
    expect(args["task"]).toBe("do a thing");
    expect(args["agentSlug"]).toBe("assistant");
    const fallback = args["serverFallbackBody"] as Record<string, unknown>;
    expect(fallback["task"]).toBe("do a thing");
    expect(fallback["callbackUrl"]).toBe(args["callbackUrl"]);
    expect(fallback["progressUrl"]).toBe(args["progressUrl"]);
    expect(String(args["callbackUrl"])).toContain("/internal/run-stream/");

    const runFrame = capture.frames.find((f) => f.event === "run");
    expect(runFrame?.data["sessionId"]).toBe("harness-session");
    expect(runFrame?.data["clawRunOrigin"]).toMatchObject({ kind: "local-harness", provider: "codex-cli" });
  });

  it("routes /design to the harness with a localSandbox envelope in local sandbox mode", async () => {
    state.target = { provider: "codex-cli", device: { id: "device-1" } };
    const { runStreamRouter } = await import("./run-stream.js");
    const { res } = makeResponse();
    handle(
      runStreamRouter,
      makeRequest({ ...runBody, task: "/design make a landing page", sandboxMode: "local" }),
      res,
    );
    await vi.waitFor(() => expect(state.dispatchArgs).toHaveLength(1));

    expect(state.fetchBodies).toHaveLength(0);
    const args = state.dispatchArgs[0]!;
    expect(args["task"]).toBe("/design make a landing page");
    expect(args["localSandbox"]).toMatchObject({ command: "/design", instruction: "sandbox instruction" });
    expect((args["localSandbox"] as { skills: unknown[] }).skills).toHaveLength(1);
  });

  it("marks the localSandbox envelope as container in container sandbox mode", async () => {
    state.target = { provider: "codex-cli", device: { id: "device-1" } };
    const { runStreamRouter } = await import("./run-stream.js");
    const { res } = makeResponse();
    handle(
      runStreamRouter,
      makeRequest({ ...runBody, task: "/design make a landing page", sandboxMode: "container" }),
      res,
    );
    await vi.waitFor(() => expect(state.dispatchArgs).toHaveLength(1));

    expect(state.fetchBodies).toHaveLength(0);
    const args = state.dispatchArgs[0]!;
    expect(args["localSandbox"]).toMatchObject({
      command: "/design",
      instruction: "sandbox instruction",
      container: true,
    });
  });

  it("keeps a /design task command on the server in remote sandbox mode", async () => {
    state.target = { provider: "codex-cli", device: { id: "device-1" } };
    const { runStreamRouter } = await import("./run-stream.js");
    const { res } = makeResponse();
    handle(
      runStreamRouter,
      makeRequest({ ...runBody, task: "/design make a landing page", sandboxMode: "remote" }),
      res,
    );
    await vi.waitFor(() => expect(state.fetchBodies.length).toBeGreaterThan(0));

    expect(state.dispatchArgs).toHaveLength(0);
    expect(state.fetchBodies[0]!["task"]).toBe("/design make a landing page");
  });

  it("keeps a /design task command on the server even with a harness pinned", async () => {
    state.target = { provider: "codex-cli", device: { id: "device-1" } };
    const { runStreamRouter } = await import("./run-stream.js");
    const { res } = makeResponse();
    handle(
      runStreamRouter,
      makeRequest({
        ...runBody,
        task: "/design make a landing page",
        providerOverride: { provider: "local-harness", model: "local-harness:codex-cli" },
      }),
      res,
    );
    await vi.waitFor(() => expect(state.fetchBodies.length).toBeGreaterThan(0));

    expect(state.dispatchArgs).toHaveLength(0);
    expect(state.fetchBodies[0]!["task"]).toBe("/design make a landing page");
  });

  it("skips the harness when the composer pins a litellm model", async () => {
    state.target = { provider: "codex-cli", device: { id: "device-1" } };
    const { runStreamRouter } = await import("./run-stream.js");
    const { res } = makeResponse();
    handle(runStreamRouter, makeRequest({ ...runBody, providerOverride: { provider: "litellm", model: "gpt-5" } }), res);
    await vi.waitFor(() => expect(state.fetchBodies.length).toBeGreaterThan(0));

    expect(state.dispatchArgs).toHaveLength(0);
    expect(state.fetchBodies[0]!["providerOverride"]).toMatchObject({ provider: "litellm", model: "gpt-5" });
  });

  it("routes a local-harness pin to the desktop without forwarding it as a model override", async () => {
    state.target = { provider: "codex-cli", device: { id: "device-1" } };
    const { runStreamRouter } = await import("./run-stream.js");
    const { res } = makeResponse();
    handle(
      runStreamRouter,
      makeRequest({ ...runBody, providerOverride: { provider: "local-harness", model: "local-harness:codex-cli" } }),
      res,
    );
    await vi.waitFor(() => expect(state.dispatchArgs).toHaveLength(1));

    expect(state.fetchBodies).toHaveLength(0);
    const fallback = state.dispatchArgs[0]!["serverFallbackBody"] as Record<string, unknown>;
    expect(fallback["providerOverride"]).toBeUndefined();
    expect(state.dispatchArgs[0]!["target"]).toMatchObject({ provider: "codex-cli" });
  });

  it("falls back to the order-based resolver when the pinned harness provider is offline", async () => {
    state.target = { provider: "codex-cli", device: { id: "device-1" } };
    const { runStreamRouter } = await import("./run-stream.js");
    const { res } = makeResponse();
    handle(
      runStreamRouter,
      makeRequest({ ...runBody, providerOverride: { provider: "local-harness", model: "local-harness:claude-code" } }),
      res,
    );
    await vi.waitFor(() => expect(state.dispatchArgs).toHaveLength(1));

    expect(state.dispatchArgs[0]!["target"]).toMatchObject({ provider: "codex-cli" });
  });

  it("routes an attached local folder to the harness with a workspace envelope", async () => {
    state.target = { provider: "codex-cli", device: { id: "device-1" } };
    const { runStreamRouter } = await import("./run-stream.js");
    const { res } = makeResponse();
    handle(runStreamRouter, makeRequest({ ...runBody, attachedContext: [localFolder] }), res);
    await vi.waitFor(() => expect(state.dispatchArgs).toHaveLength(1));

    expect(state.fetchBodies).toHaveLength(0);
    const args = state.dispatchArgs[0]!;
    expect(args["workspace"]).toEqual({ path: "/Users/ann/code/app", name: "app", branch: "feature/x" });
    expect(args["noServerFallback"]).toBe(true);
    const fallback = args["serverFallbackBody"] as Record<string, unknown>;
    expect(fallback["attachedContext"]).toEqual([]);
  });

  it("fails the turn instead of falling back to the server when no device is online", async () => {
    state.target = null;
    const { runStreamRouter } = await import("./run-stream.js");
    const { res, capture } = makeResponse();
    handle(runStreamRouter, makeRequest({ ...runBody, attachedContext: [localFolder] }), res);
    await vi.waitFor(() => expect(capture.frames.some((f) => f.event === "done")).toBe(true));

    expect(state.dispatchArgs).toHaveLength(0);
    expect(state.fetchBodies).toHaveLength(0);
    const done = capture.frames.find((f) => f.event === "done")!;
    expect(done.data["status"]).toBe("failed");
    expect(done.data["content"]).toBe(
      "This conversation is attached to a local folder (app), which needs the Xyne desktop app with a paired Codex or Claude CLI online.",
    );
    expect(state.messageUpdates.some((u) => u["status"] === "failed")).toBe(true);
  });

  it("reuses the folder attached on a previous turn", async () => {
    state.target = { provider: "codex-cli", device: { id: "device-1" } };
    state.stickyFolder = localFolder;
    const { runStreamRouter } = await import("./run-stream.js");
    const { res } = makeResponse();
    handle(runStreamRouter, makeRequest(runBody), res);
    await vi.waitFor(() => expect(state.dispatchArgs).toHaveLength(1));

    expect(state.fetchBodies).toHaveLength(0);
    expect(state.dispatchArgs[0]!["workspace"]).toEqual({
      path: "/Users/ann/code/app",
      name: "app",
      branch: "feature/x",
    });
  });

  it("hands the previous turn off before dispatching to the harness", async () => {
    state.target = { provider: "codex-cli", device: { id: "device-1" } };
    state.handoffResult = { handedOff: true, reason: "local_harness_wrapped_up" };
    const { runStreamRouter } = await import("./run-stream.js");
    const { res, capture } = makeResponse();
    handle(runStreamRouter, makeRequest(runBody), res);
    await vi.waitFor(() => expect(state.dispatchArgs).toHaveLength(1));

    expect(state.handoffs).toHaveLength(1);
    expect(state.handoffs[0]).toMatchObject({ conversationId: "conv-1", agentSlug: "assistant", userId: "user-1" });
    const label = capture.frames.find((f) => f.event === "label");
    expect(label?.data["toolLabel"]).toBe("Wrapping up the previous reply first…");
  });

  it("writes done and persists the message with clawRunOrigin when the harness result lands", async () => {
    state.target = { provider: "codex-cli", device: { id: "device-1" } };
    const { runStreamRouter, runStreamInternalRouter } = await import("./run-stream.js");
    const { chatMessageRepository } = await import("../repositories/index.js");
    const { res, capture } = makeResponse();
    handle(runStreamRouter, makeRequest(runBody), res);
    await vi.waitFor(() => expect(state.dispatchArgs).toHaveLength(1));

    const callbackUrl = new URL(String(state.dispatchArgs[0]!["callbackUrl"]));
    const streamId = callbackUrl.pathname.split("/").filter(Boolean).slice(-2)[0]!;

    const cbRes = makeResponse();
    const cbReq = makeRequest(
      {
        status: "completed",
        result: "answer from your laptop",
        sessionId: "harness-session",
        userId: "user-1",
        provider: "codex-cli",
        localHarness: { provider: "codex-cli", harnessName: "Codex CLI", label: "Ann's Codex CLI", ownerName: "Ann" },
      },
      `/${streamId}/callback`,
    );
    handle(runStreamInternalRouter, cbReq, cbRes.res);

    await vi.waitFor(() => expect(capture.frames.some((f) => f.event === "done")).toBe(true));

    const done = capture.frames.find((f) => f.event === "done")!;
    expect(done.data["content"]).toContain("answer from your laptop");
    expect(done.data["status"]).toBe("completed");
    expect(done.data["clawRunOrigin"]).toMatchObject({ kind: "local-harness", label: "Ann's Codex CLI" });
    expect(chatMessageRepository.update).toHaveBeenCalled();
  });
});
