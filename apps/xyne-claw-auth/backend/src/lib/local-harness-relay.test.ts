import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalHarnessRun } from "@prisma/client";

const state = vi.hoisted(() => ({
  setPendingAction: vi.fn(async () => true),
  toolResponse: {} as Record<string, unknown>,
}));

vi.mock("../config.js", () => ({
  CONFIG: {
    internalUrl: "http://auth.local",
    xyneClawS2sKey: "s2s",
    localHarnessRunTimeoutMs: 600000,
    localHarnessEnabled: true,
  },
}));

vi.mock("../logger.js", () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }),
}));

vi.mock("../db.js", () => ({ prisma: { user: { findUnique: vi.fn(async () => null) } } }));

vi.mock("../redis.js", () => ({
  redisService: { getConnection: () => ({ get: vi.fn(async () => null), set: vi.fn(async () => "OK"), del: vi.fn(async () => 1) }) },
}));

vi.mock("./session-tokens.js", () => ({ mintSessionToken: vi.fn(() => "token") }));

vi.mock("../repositories/localHarnessRepository.js", () => ({
  authenticatedProviders: vi.fn(() => ["codex-cli"]),
  localHarnessRepository: {
    setPendingAction: state.setPendingAction,
    enqueueRun: vi.fn(async () => ({ id: "run-2" })),
  },
}));

function makeRun(overrides: Partial<LocalHarnessRun> = {}): LocalHarnessRun {
  return {
    id: "run-1",
    sessionId: "sess-1",
    userId: "user-1",
    orgId: "org-1",
    agentSlug: "assistant",
    provider: "codex-cli",
    model: null,
    pendingActionId: null,
    ...overrides,
  } as unknown as LocalHarnessRun;
}

describe("callToolForRun pending actions", () => {
  beforeEach(() => {
    vi.resetModules();
    state.setPendingAction.mockClear();
    state.setPendingAction.mockResolvedValue(true);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(state.toolResponse), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));
  });

  it("stores the pending action and tells the CLI to stop", async () => {
    state.toolResponse = {
      success: true,
      data: {
        content: "Action queued for approval: spaces-create-ticket",
        pendingAction: { serverType: "xyne-spaces", tool: "spaces-create-ticket", params: {}, userId: "user-1", signature: "sig-1" },
      },
    };
    const { callToolForRun } = await import("./local-harness.js");
    const result = await callToolForRun(makeRun(), { serverType: "xyne-spaces", toolName: "spaces-create-ticket", params: {} });

    expect(state.setPendingAction).toHaveBeenCalledWith("run-1", "sig-1", expect.objectContaining({ signature: "sig-1" }));
    expect(result.ok).toBe(true);
    expect(result.content).toContain("queued for the user's approval");
    expect(result.content).toContain("do not retry");
  });

  it("refuses a second write while one is already awaiting approval", async () => {
    state.toolResponse = {
      success: true,
      data: {
        content: "Action queued for approval: spaces-send-message",
        pendingAction: { serverType: "xyne-spaces", tool: "spaces-send-message", params: {}, userId: "user-1", signature: "sig-2" },
      },
    };
    const { callToolForRun } = await import("./local-harness.js");
    const result = await callToolForRun(makeRun({ pendingActionId: "sig-1" }), {
      serverType: "xyne-spaces",
      toolName: "spaces-send-message",
      params: {},
    });

    expect(state.setPendingAction).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.content).toContain("Another action is awaiting approval");
  });

  it("passes a normal tool result through untouched", async () => {
    state.toolResponse = { success: true, data: { content: "3 results" } };
    const { callToolForRun } = await import("./local-harness.js");
    const result = await callToolForRun(makeRun(), { serverType: "xyne-spaces", toolName: "spaces-search", params: {} });
    expect(result).toEqual({ ok: true, content: "3 results" });
  });
});
