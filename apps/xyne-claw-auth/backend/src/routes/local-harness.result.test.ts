import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import type { LocalHarnessRun } from "@prisma/client";

const state = vi.hoisted(() => ({
  run: null as LocalHarnessRun | null,
  cliSessionIds: [] as Array<{ runId: string; cliSessionId: string }>,
  awaiting: [] as string[],
  finished: [] as Array<{ runId: string; status: string }>,
  relayed: [] as Array<Record<string, unknown>>,
  ingested: [] as Array<Record<string, unknown>>,
}));

vi.mock("../config.js", () => ({
  CONFIG: { localHarnessEnabled: true, localHarnessPollTimeoutMs: 1000, internalUrl: "http://auth.local" },
}));

vi.mock("../logger.js", () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }),
}));

vi.mock("../middleware/agent-acl.js", () => ({
  getRequesterId: vi.fn(() => "user-1"),
  getOrgId: vi.fn(() => "org-1"),
  isOrgAdmin: vi.fn(async () => false),
}));

vi.mock("../repositories/localHarnessRepository.js", () => ({
  isDeviceOnline: vi.fn(() => true),
  authenticatedProviders: vi.fn(() => ["codex-cli"]),
  localHarnessRepository: {
    findDeviceByToken: vi.fn(async () => ({ id: "device-1", userId: "user-1", orgId: "org-1", lastSeenAt: new Date() })),
    touchDevice: vi.fn(async () => ({})),
    findOwnedRun: vi.fn(async () => state.run),
    setCliSessionId: vi.fn(async (runId: string, cliSessionId: string) => {
      state.cliSessionIds.push({ runId, cliSessionId });
    }),
    markAwaitingApproval: vi.fn(async (runId: string) => {
      state.awaiting.push(runId);
      return true;
    }),
    finishRun: vi.fn(async (runId: string, status: string) => {
      state.finished.push({ runId, status });
      return true;
    }),
    clearPendingAction: vi.fn(async () => undefined),
  },
}));

vi.mock("../lib/conversation-artifact-signals.js", () => ({
  ingestDeliveredArtifact: vi.fn(async (ctx: Record<string, unknown>, artifact: Record<string, unknown>) => {
    state.ingested.push({ ...ctx, ...artifact });
  }),
}));

vi.mock("../lib/local-harness.js", () => ({
  TURN_HANDOFF_SUMMARY_FALLBACK: "I paused this task to handle your new message.",
  isLocalHarnessInterruptRequested: vi.fn(async () => false),
  clearLocalHarnessInterrupt: vi.fn(async () => undefined),
  callToolForRun: vi.fn(async () => ({ ok: true, content: "" })),
  listToolsForRun: vi.fn(async () => []),
  localHarnessProviderLabel: vi.fn((p: string) => p),
  recoverFailedLocalRun: vi.fn(async () => true),
  relayProgress: vi.fn(async () => undefined),
  readDeliveredFiles: vi.fn(async () => []),
  clearDeliveredFiles: vi.fn(async () => undefined),
  stashDeliveredFiles: vi.fn(async () => 0),
  relayResult: vi.fn(async (_run: unknown, result: Record<string, unknown>) => {
    state.relayed.push(result);
  }),
}));

const pendingAction = {
  serverType: "xyne-spaces",
  tool: "spaces-create-ticket",
  params: {},
  userId: "user-1",
  signature: "sig-1",
};

function makeRun(overrides: Partial<LocalHarnessRun> = {}): LocalHarnessRun {
  return {
    id: "run-1",
    sessionId: "sess-1",
    userId: "user-1",
    orgId: "org-1",
    agentSlug: "assistant",
    provider: "codex-cli",
    model: null,
    status: "running",
    deviceId: "device-1",
    pendingAction: null,
    pendingActionId: null,
    envelope: { conversationId: "conv-1" },
    ...overrides,
  } as unknown as LocalHarnessRun;
}

function makeRequest(body: Record<string, unknown>): Request {
  return {
    method: "POST",
    url: "/runs/run-1/result",
    originalUrl: "/runs/run-1/result",
    baseUrl: "",
    headers: { authorization: "Bearer device-token" },
    query: {},
    params: {},
    body,
    ip: "127.0.0.1",
    ips: [],
    socket: { remoteAddress: "127.0.0.1" },
    app: { get: () => undefined },
    on: vi.fn(),
  } as unknown as Request;
}

function makeResponse(): { res: Response; done: Promise<void> } {
  let resolveDone: () => void = () => {};
  const done = new Promise<void>((r) => { resolveDone = r; });
  const res = {
    json: vi.fn(function json(this: Response) { resolveDone(); return this; }),
    status: vi.fn(function status(this: Response) { return this; }),
    setHeader: vi.fn(),
    getHeader: vi.fn(),
    removeHeader: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
    emit: vi.fn(),
    headersSent: false,
    locals: {},
  } as unknown as Response;
  return { res, done };
}

async function postResult(body: Record<string, unknown>): Promise<void> {
  const { localHarnessBridgeRouter } = await import("./local-harness.js");
  const { res, done } = makeResponse();
  (localHarnessBridgeRouter as unknown as { handle: (r: Request, s: Response, n: () => void) => void })
    .handle(makeRequest(body), res, (err?: unknown) => { if (err) throw err; });
  await done;
}

describe("local harness run result with a pending action", () => {
  beforeEach(() => {
    vi.resetModules();
    state.run = makeRun();
    state.cliSessionIds = [];
    state.awaiting = [];
    state.finished = [];
    state.relayed = [];
    state.ingested = [];
  });

  it("stores the CLI session id and finishes a plain run", async () => {
    await postResult({ status: "done", text: "all set", harnessSessionId: "cli-thread-1" });
    await vi.waitFor(() => expect(state.relayed.length).toBe(1));

    expect(state.cliSessionIds).toEqual([{ runId: "run-1", cliSessionId: "cli-thread-1" }]);
    expect(state.finished).toEqual([{ runId: "run-1", status: "done" }]);
    expect(state.awaiting).toHaveLength(0);
    expect(state.relayed[0]!["pendingActions"]).toBeUndefined();
  });

  it("parks the run on awaiting_approval and relays the pending action", async () => {
    state.run = makeRun({ pendingAction: pendingAction as never, pendingActionId: "sig-1" });
    await postResult({ status: "done", text: "waiting on you", harnessSessionId: "cli-thread-1" });
    await vi.waitFor(() => expect(state.relayed.length).toBe(1));

    expect(state.awaiting).toEqual(["run-1"]);
    expect(state.finished).toHaveLength(0);
    expect(state.relayed[0]!["pendingActions"]).toEqual([pendingAction]);
  });

  it("records a DIFF artifact and a patch attachment when the workspace changed", async () => {
    await postResult({
      status: "done",
      text: "done editing",
      workspaceDiff: { branch: "main", changedFiles: 3, stat: " 3 files changed", patch: "diff --git a/a b/a\n" },
    });
    await vi.waitFor(() => expect(state.relayed.length).toBe(1));

    const attachments = state.relayed[0]!["attachments"] as Array<Record<string, unknown>>;
    expect(attachments).toHaveLength(1);
    expect(attachments[0]!["fileName"]).toBe("changes.patch");
    expect(attachments[0]!["mimeType"]).toBe("text/x-patch");
    expect(Buffer.from(String(attachments[0]!["data"]), "base64").toString("utf8")).toContain("diff --git");

    expect(state.ingested).toHaveLength(1);
    expect(state.ingested[0]).toMatchObject({
      conversationId: "conv-1",
      kind: "DIFF",
      refId: "local:conv-1",
      title: "Changes on main (3 files)",
    });
  });

  it("substitutes the default reply text for an interrupted run with no text", async () => {
    await postResult({ status: "done", text: "", interrupted: true });
    await vi.waitFor(() => expect(state.relayed.length).toBe(1));

    expect(state.finished).toEqual([{ runId: "run-1", status: "done" }]);
    expect(state.relayed[0]!["text"]).toBe("I paused this task to handle your new message.");
    expect(state.relayed[0]!["interrupted"]).toBe(true);
  });

  it("keeps the harness text on an interrupted run that produced a summary", async () => {
    await postResult({ status: "done", text: "here is where I got to", interrupted: true });
    await vi.waitFor(() => expect(state.relayed.length).toBe(1));

    expect(state.relayed[0]!["text"]).toBe("here is where I got to");
  });

  it("records nothing when the workspace diff has no changed files", async () => {
    await postResult({
      status: "done",
      text: "nothing to do",
      workspaceDiff: { branch: "main", changedFiles: 0, stat: "", patch: "" },
    });
    await vi.waitFor(() => expect(state.relayed.length).toBe(1));

    expect(state.relayed[0]!["attachments"]).toBeUndefined();
    expect(state.ingested).toHaveLength(0);
  });
});
