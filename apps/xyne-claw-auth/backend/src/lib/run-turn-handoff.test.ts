import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalHarnessRun } from "@prisma/client";

const state = vi.hoisted(() => ({
  harnessRun: null as LocalHarnessRun | null,
  harnessStatuses: [] as string[],
  remoteRun: null as { sessionId: string; userId: string } | null,
  remoteStatuses: [] as string[],
  interrupts: [] as string[],
  cancelled: [] as string[],
  relayed: [] as Array<Record<string, unknown>>,
  fetches: [] as Array<{ url: string; headers: Record<string, string> }>,
}));

vi.mock("../config.js", () => ({
  CONFIG: { internalUrl: "http://auth.local", xyneClawS2sKey: "s2s-secret" },
}));

vi.mock("../logger.js", () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }),
}));

vi.mock("../repositories/index.js", () => ({
  agentRunRepository: {
    findRunningByConversation: vi.fn(async () => state.remoteRun),
    findBySessionId: vi.fn(async () => {
      const status = state.remoteStatuses.shift() ?? "completed";
      return { sessionId: "sess-remote", status };
    }),
  },
}));

vi.mock("../repositories/localHarnessRepository.js", () => ({
  localHarnessRepository: {
    findActiveByConversation: vi.fn(async () => state.harnessRun),
    findById: vi.fn(async () => {
      const status = state.harnessStatuses.shift() ?? "done";
      return { ...(state.harnessRun as LocalHarnessRun), status };
    }),
    cancelRun: vi.fn(async (runId: string) => {
      state.cancelled.push(runId);
      return true;
    }),
  },
}));

vi.mock("./local-harness.js", () => ({
  TURN_HANDOFF_SUMMARY_FALLBACK: "I paused this task to handle your new message.",
  requestLocalHarnessInterrupt: vi.fn(async (runId: string) => {
    state.interrupts.push(runId);
  }),
  relayResult: vi.fn(async (_run: unknown, result: Record<string, unknown>) => {
    state.relayed.push(result);
  }),
}));

function makeHarnessRun(): LocalHarnessRun {
  return {
    id: "run-1",
    sessionId: "sess-1",
    userId: "user-1",
    orgId: "org-1",
    status: "running",
    envelope: { conversationId: "conv-1" },
  } as unknown as LocalHarnessRun;
}

const args = { conversationId: "conv-1", agentSlug: "assistant", userId: "user-1" };

describe("awaitTurnHandoff", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useRealTimers();
    state.harnessRun = null;
    state.harnessStatuses = [];
    state.remoteRun = null;
    state.remoteStatuses = [];
    state.interrupts = [];
    state.cancelled = [];
    state.relayed = [];
    state.fetches = [];
    vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: RequestInit) => {
      state.fetches.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> });
      return new Response("{}", { status: 200 });
    }));
  });

  it("returns handedOff false when nothing is running on the conversation", async () => {
    const { awaitTurnHandoff } = await import("./run-turn-handoff.js");
    const labels: string[] = [];
    const result = await awaitTurnHandoff({ ...args, onLabel: (l) => labels.push(l) });

    expect(result).toEqual({ handedOff: false, reason: "no_active_run" });
    expect(labels).toHaveLength(0);
    expect(state.interrupts).toHaveLength(0);
    expect(state.fetches).toHaveLength(0);
  });

  it("sets the interrupt flag and resolves once the harness run flips status", async () => {
    state.harnessRun = makeHarnessRun();
    state.harnessStatuses = ["running", "done"];
    const { awaitTurnHandoff, TURN_HANDOFF_LABEL } = await import("./run-turn-handoff.js");
    const labels: string[] = [];
    const result = await awaitTurnHandoff({ ...args, onLabel: (l) => labels.push(l) });

    expect(result).toEqual({ handedOff: true, reason: "local_harness_wrapped_up" });
    expect(state.interrupts).toEqual(["run-1"]);
    expect(labels).toEqual([TURN_HANDOFF_LABEL]);
    expect(state.cancelled).toHaveLength(0);
    expect(state.relayed).toHaveLength(0);
  });

  it("cancels the harness run and relays an interrupted result on timeout", async () => {
    state.harnessRun = makeHarnessRun();
    state.harnessStatuses = Array.from({ length: 200 }, () => "running");
    const { awaitTurnHandoff } = await import("./run-turn-handoff.js");

    vi.useFakeTimers();
    const pending = awaitTurnHandoff(args);
    await vi.advanceTimersByTimeAsync(35_000);
    const result = await pending;
    vi.useRealTimers();

    expect(result).toEqual({ handedOff: true, reason: "local_harness_timeout" });
    expect(state.cancelled).toEqual(["run-1"]);
    expect(state.relayed).toEqual([
      { status: "done", text: "I paused this task to handle your new message.", interrupted: true },
    ]);
  });

  it("POSTs interrupt-with-reply for a remote run and resolves when it stops running", async () => {
    state.remoteRun = { sessionId: "sess-remote", userId: "owner-1" };
    state.remoteStatuses = ["running", "completed"];
    const { awaitTurnHandoff } = await import("./run-turn-handoff.js");
    const result = await awaitTurnHandoff(args);

    expect(result).toEqual({ handedOff: true, reason: "remote_wrapped_up" });
    expect(state.fetches).toHaveLength(1);
    expect(state.fetches[0]!.url).toBe(
      "http://auth.local/claw/api/v1/internal/run/sess-remote/interrupt-with-reply",
    );
    expect(state.fetches[0]!.headers["x-s2s-key"]).toBe("s2s-secret");
    expect(state.fetches[0]!.headers["x-user-id"]).toBe("owner-1");
  });

  it("cancels the remote run when it never wraps up", async () => {
    state.remoteRun = { sessionId: "sess-remote", userId: "owner-1" };
    state.remoteStatuses = Array.from({ length: 200 }, () => "running");
    const { awaitTurnHandoff } = await import("./run-turn-handoff.js");

    vi.useFakeTimers();
    const pending = awaitTurnHandoff(args);
    await vi.advanceTimersByTimeAsync(35_000);
    const result = await pending;
    vi.useRealTimers();

    expect(result).toEqual({ handedOff: true, reason: "remote_timeout" });
    expect(state.fetches.map((f) => f.url.split("/").pop())).toEqual(["interrupt-with-reply", "cancel"]);
  });
});

describe("isTurnControlCommand", () => {
  it("matches stop-style control turns and nothing else", async () => {
    const { isTurnControlCommand } = await import("./run-turn-handoff.js");
    expect(isTurnControlCommand("/stop")).toBe(true);
    expect(isTurnControlCommand("  /cancel  ")).toBe(true);
    expect(isTurnControlCommand("Assistant /stop")).toBe(true);
    expect(isTurnControlCommand("please stop soon")).toBe(false);
    expect(isTurnControlCommand("/design a poster")).toBe(false);
  });
});
