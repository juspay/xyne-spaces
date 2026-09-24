import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalHarnessRun } from "@prisma/client";

const state = vi.hoisted(() => ({
  run: null as LocalHarnessRun | null,
  devices: [] as Array<{ id: string }>,
  dispatchArgs: [] as Array<Record<string, unknown>>,
  fallbackBody: null as Record<string, unknown> | null,
  fetchBodies: [] as Array<Record<string, unknown>>,
  finished: [] as string[],
  started: [] as Array<Record<string, unknown>>,
}));

vi.mock("../config.js", () => ({
  CONFIG: { internalUrl: "http://auth.local", xyneClawS2sKey: "s2s" },
}));

vi.mock("../logger.js", () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }),
}));

vi.mock("../repositories/index.js", () => ({
  agentRunRepository: {
    start: vi.fn(async (input: Record<string, unknown>) => {
      state.started.push(input);
      return {};
    }),
  },
}));

vi.mock("../repositories/localHarnessRepository.js", () => ({
  localHarnessRepository: {
    findRunByPendingActionId: vi.fn(async () => state.run),
    listOnlineDevicesForProvider: vi.fn(async () => state.devices),
    finishAwaitingApproval: vi.fn(async (runId: string) => {
      state.finished.push(runId);
    }),
  },
}));

vi.mock("./local-harness.js", () => ({
  isLocalHarnessProvider: (v: unknown) => v === "codex-cli" || v === "claude-code",
  readServerFallback: vi.fn(async () => state.fallbackBody),
  dispatchLocalHarnessRun: vi.fn(async (args: Record<string, unknown>) => {
    state.dispatchArgs.push(args);
    return { sessionId: "resumed-session", runId: "run-2" };
  }),
}));

vi.mock("../routes/webhook.js", () => ({
  getSession: vi.fn(async () => null),
  setSession: vi.fn(async () => undefined),
}));

function makeRun(overrides: Partial<LocalHarnessRun> = {}): LocalHarnessRun {
  return {
    id: "run-1",
    sessionId: "sess-1",
    userId: "user-1",
    orgId: "org-1",
    agentSlug: "assistant",
    provider: "codex-cli",
    model: "gpt-5",
    status: "awaiting_approval",
    cliSessionId: "cli-thread-1",
    progressUrl: "http://auth.local/claw/api/v1/internal/run-stream/s1/progress",
    callbackUrl: "http://auth.local/claw/api/v1/internal/run-stream/s1/callback?assistantMessageId=msg-1",
    pendingActionId: "sig-1",
    envelope: {
      conversationId: "conv-1",
      agentName: "Assistant",
      systemPrompt: "be helpful",
    },
    ...overrides,
  } as unknown as LocalHarnessRun;
}

describe("resumeLocalHarnessRunForAction", () => {
  beforeEach(() => {
    vi.resetModules();
    state.run = makeRun();
    state.devices = [{ id: "device-1" }];
    state.dispatchArgs = [];
    state.fetchBodies = [];
    state.finished = [];
    state.started = [];
    state.fallbackBody = { userId: "user-1", agentSlug: "assistant", task: "original", context: "prior" };
    vi.stubGlobal("fetch", vi.fn(async (_input: unknown, init?: RequestInit) => {
      if (typeof init?.body === "string") state.fetchBodies.push(JSON.parse(init.body) as Record<string, unknown>);
      return new Response(JSON.stringify({ success: true, sessionId: "server-session" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }));
  });

  it("does nothing when no harness run owns the action", async () => {
    state.run = null;
    const { resumeLocalHarnessRunForAction } = await import("./local-harness-approval.js");
    const outcome = await resumeLocalHarnessRunForAction({
      userId: "user-1", signature: "sig-1", tool: "spaces-create-ticket", approved: true, resultText: "done",
    });
    expect(outcome.handled).toBe(false);
    expect(state.dispatchArgs).toHaveLength(0);
  });

  it("re-dispatches to the same device with the CLI session id on approval", async () => {
    const { resumeLocalHarnessRunForAction } = await import("./local-harness-approval.js");
    const outcome = await resumeLocalHarnessRunForAction({
      userId: "user-1", signature: "sig-1", tool: "spaces-create-ticket", approved: true, resultText: "XYNE-42 created",
    });

    expect(outcome).toMatchObject({ handled: true, sessionId: "resumed-session" });
    expect(state.finished).toEqual(["run-1"]);
    expect(state.dispatchArgs).toHaveLength(1);
    const args = state.dispatchArgs[0]!;
    expect(args["resumeSessionId"]).toBe("cli-thread-1");
    expect(args["conversationId"]).toBe("conv-1");
    expect(args["task"]).toBe(
      "The user approved spaces-create-ticket. Tool result:\nXYNE-42 created\nContinue from where you stopped.",
    );
    expect(args["callbackUrl"]).not.toContain("assistantMessageId");
    expect(args["progressUrl"]).toBe(state.run!.progressUrl);
    expect(state.started[0]).toMatchObject({ sessionId: "resumed-session", conversationId: "conv-1" });
  });

  it("re-dispatches with the rejection text when the user declines", async () => {
    const { resumeLocalHarnessRunForAction, rejectionResultText } = await import("./local-harness-approval.js");
    await resumeLocalHarnessRunForAction({
      userId: "user-1", signature: "sig-1", tool: "spaces-send-message", approved: false,
      resultText: rejectionResultText("spaces-send-message"),
    });

    const args = state.dispatchArgs[0]!;
    expect(args["task"]).toContain("The user rejected spaces-send-message");
    expect(args["task"]).toContain("without retrying it");
  });

  it("falls back to a server run when no device is online", async () => {
    state.devices = [];
    const { resumeLocalHarnessRunForAction } = await import("./local-harness-approval.js");
    const outcome = await resumeLocalHarnessRunForAction({
      userId: "user-1", signature: "sig-1", tool: "spaces-create-ticket", approved: true, resultText: "XYNE-42 created",
    });

    expect(outcome).toMatchObject({ handled: true, fellBackToServer: true });
    expect(state.dispatchArgs).toHaveLength(0);
    expect(state.fetchBodies).toHaveLength(1);
    const body = state.fetchBodies[0]!;
    expect(body["task"]).toContain("The user approved spaces-create-ticket");
    expect(String(body["context"])).toContain("prior");
    expect(String(body["context"])).toContain("XYNE-42 created");
  });
});
