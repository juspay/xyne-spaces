import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalHarnessRun } from "@prisma/client";

/**
 * Regression suite for the turn-handoff path.
 *
 * The bug these tests exist to prevent (prod 2026-09-28): both chat surfaces
 * write their own AgentRun row at status "running" BEFORE dispatch, so the
 * in-flight lookup — newest-startedAt-first — returned the caller's own row.
 * claw-auth then interrupted a session xyne-claw had never started (which
 * answers 200 {status:"not_running"}) and polled that row until the 30s
 * handoff timeout, on every single chat turn. 55/55 handoffs in a 3.5h window
 * ended `remote_timeout`; zero wrapped up.
 *
 * `findRunningByConversation` below is a faithful in-memory reimplementation of
 * the Prisma query (same where-clause, same `startedAt desc` ordering) so the
 * exclusion contract is exercised for real rather than asserted on call args
 * alone.
 */

interface RunRow {
  sessionId: string;
  userId: string;
  conversationId: string;
  status: string;
  startedAt: number;
}

const state = vi.hoisted(() => ({
  harnessRun: null as LocalHarnessRun | null,
  harnessStatuses: [] as string[],
  /** Rows the fake AgentRun table holds for the whole conversation. */
  rows: [] as RunRow[],
  /** Status sequence returned by successive findBySessionId polls. */
  remoteStatuses: [] as string[],
  findRunningCalls: [] as Array<{ conversationId: string; excludeSessionId: string | undefined }>,
  /** Every findBySessionId call — its count is how we prove we did NOT poll. */
  pollCount: 0,
  interrupts: [] as string[],
  cancelled: [] as string[],
  relayed: [] as Array<Record<string, unknown>>,
  fetches: [] as Array<{ url: string; headers: Record<string, string> }>,
  /** Body xyne-claw replies with to /interrupt-with-reply and /cancel. */
  clawBody: "{}" as string,
  clawStatus: 200,
  errors: [] as string[],
}));

vi.mock("../config.js", () => ({
  CONFIG: { internalUrl: "http://auth.local", xyneClawS2sKey: "s2s-secret" },
}));

vi.mock("../logger.js", () => ({
  createLogger: () => ({
    error: vi.fn((m: string) => state.errors.push(m)),
    warn: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock("../repositories/index.js", () => ({
  agentRunRepository: {
    findRunningByConversation: vi.fn(
      async (conversationId: string, excludeSessionId: string | undefined) => {
        state.findRunningCalls.push({ conversationId, excludeSessionId });
        return (
          state.rows
            .filter((r) => r.conversationId === conversationId && r.status === "running")
            .filter((r) => (excludeSessionId ? r.sessionId !== excludeSessionId : true))
            .sort((a, b) => b.startedAt - a.startedAt)[0] ?? null
        );
      },
    ),
    findBySessionId: vi.fn(async (sessionId: string) => {
      state.pollCount += 1;
      const status = state.remoteStatuses.shift() ?? "completed";
      return { sessionId, status };
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

function row(overrides: Partial<RunRow> & Pick<RunRow, "sessionId" | "startedAt">): RunRow {
  return {
    userId: "owner-1",
    conversationId: "conv-1",
    status: "running",
    ...overrides,
  };
}

/** The session id of the turn being started — what must never be selected. */
const SELF = "sess-self";

const args = {
  conversationId: "conv-1",
  agentSlug: "assistant",
  userId: "user-1",
  currentSessionId: SELF,
};

function actions(): string[] {
  return state.fetches.map((f) => f.url.split("/").pop() as string);
}

describe("awaitTurnHandoff", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useRealTimers();
    state.harnessRun = null;
    state.harnessStatuses = [];
    state.rows = [];
    state.remoteStatuses = [];
    state.findRunningCalls = [];
    state.pollCount = 0;
    state.interrupts = [];
    state.cancelled = [];
    state.relayed = [];
    state.fetches = [];
    state.clawBody = "{}";
    state.clawStatus = 200;
    state.errors = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: RequestInit) => {
        state.fetches.push({
          url: String(url),
          headers: (init?.headers ?? {}) as Record<string, string>,
        });
        return new Response(state.clawBody, { status: state.clawStatus });
      }),
    );
  });

  // ── The regression this suite exists for ─────────────────────────────────

  it("never selects the caller's own run row, even though it is the newest running row", async () => {
    // Exactly the production shape: beginChatRun just wrote SELF as "running",
    // and it is the newest row on the conversation.
    state.rows = [row({ sessionId: SELF, startedAt: 2_000 })];
    const { awaitTurnHandoff } = await import("./run-turn-handoff.js");
    const labels: string[] = [];

    const result = await awaitTurnHandoff({ ...args, onLabel: (l) => labels.push(l) });

    expect(result).toEqual({ handedOff: false, reason: "no_active_run" });
    // The three things that made the old behaviour a 30s stall:
    expect(state.fetches).toHaveLength(0); // no interrupt posted at self
    expect(state.pollCount).toBe(0); // no polling loop entered
    expect(labels).toHaveLength(0); // no "wrapping up" label shown
  });

  it("passes the current session id to the repository so the exclusion is applied", async () => {
    state.rows = [row({ sessionId: SELF, startedAt: 2_000 })];
    const { awaitTurnHandoff } = await import("./run-turn-handoff.js");

    await awaitTurnHandoff(args);

    expect(state.findRunningCalls).toEqual([
      { conversationId: "conv-1", excludeSessionId: SELF },
    ]);
  });

  it("interrupts the genuinely older run when the caller's own row is also present", async () => {
    // Both running. SELF is newer, so an unfiltered `startedAt desc` findFirst
    // would pick it and the real turn would never be interrupted.
    state.rows = [
      row({ sessionId: "sess-prev", userId: "owner-prev", startedAt: 1_000 }),
      row({ sessionId: SELF, startedAt: 2_000 }),
    ];
    state.remoteStatuses = ["running", "completed"];
    const { awaitTurnHandoff, TURN_HANDOFF_LABEL } = await import("./run-turn-handoff.js");
    const labels: string[] = [];

    const result = await awaitTurnHandoff({ ...args, onLabel: (l) => labels.push(l) });

    expect(result).toEqual({ handedOff: true, reason: "remote_wrapped_up" });
    expect(state.fetches).toHaveLength(1);
    expect(state.fetches[0]!.url).toBe(
      "http://auth.local/claw/api/v1/internal/run/sess-prev/interrupt-with-reply",
    );
    expect(state.fetches[0]!.url).not.toContain(SELF);
    // The interrupt is posted as the interrupted run's OWNER, not the new caller.
    expect(state.fetches[0]!.headers["x-user-id"]).toBe("owner-prev");
    expect(labels).toEqual([TURN_HANDOFF_LABEL]);
  });

  it("picks the newest of several genuinely-running rows, still excluding self", async () => {
    state.rows = [
      row({ sessionId: "sess-old", startedAt: 500 }),
      row({ sessionId: "sess-newer", startedAt: 1_500 }),
      row({ sessionId: SELF, startedAt: 2_000 }),
    ];
    state.remoteStatuses = ["completed"];
    const { awaitTurnHandoff } = await import("./run-turn-handoff.js");

    await awaitTurnHandoff(args);

    expect(state.fetches[0]!.url).toContain("sess-newer");
  });

  it("logs loudly if a JavaScript caller passes no currentSessionId", async () => {
    state.rows = [row({ sessionId: SELF, startedAt: 2_000 })];
    const { awaitTurnHandoff } = await import("./run-turn-handoff.js");

    await awaitTurnHandoff({ ...args, currentSessionId: "" });

    expect(state.errors.join("\n")).toContain("called without currentSessionId");
  });

  // ── Stale ("zombie") run rows ────────────────────────────────────────────

  it("dispatches immediately when xyne-claw reports the row's session is not running", async () => {
    // A run whose pod died leaves status "running" forever — there is no
    // sweeper for it. Polling it would burn the full timeout for nothing.
    state.rows = [row({ sessionId: "sess-zombie", startedAt: 1_000 })];
    state.clawBody = JSON.stringify({ success: true, sessionId: "sess-zombie", status: "not_running" });
    const { awaitTurnHandoff } = await import("./run-turn-handoff.js");
    const labels: string[] = [];

    const result = await awaitTurnHandoff({ ...args, onLabel: (l) => labels.push(l) });

    expect(result).toEqual({ handedOff: false, reason: "stale_run_row" });
    expect(actions()).toEqual(["interrupt-with-reply"]); // no follow-up cancel
    expect(state.pollCount).toBe(0);
    expect(labels).toHaveLength(0); // nothing to wrap up — don't say there is
  });

  it("still waits when xyne-claw forwarded the interrupt to another pod", async () => {
    state.rows = [row({ sessionId: "sess-prev", startedAt: 1_000 })];
    state.clawBody = JSON.stringify({ success: true, status: "forwarded", ownerPod: "pod-b" });
    state.remoteStatuses = ["running", "completed"];
    const { awaitTurnHandoff } = await import("./run-turn-handoff.js");

    const result = await awaitTurnHandoff(args);

    expect(result).toEqual({ handedOff: true, reason: "remote_wrapped_up" });
    expect(state.pollCount).toBe(2);
  });

  it("still waits when xyne-claw accepted the interrupt", async () => {
    state.rows = [row({ sessionId: "sess-prev", startedAt: 1_000 })];
    state.clawBody = JSON.stringify({ success: true, status: "interrupt_requested" });
    state.remoteStatuses = ["completed"];
    const { awaitTurnHandoff } = await import("./run-turn-handoff.js");

    const result = await awaitTurnHandoff(args);

    expect(result).toEqual({ handedOff: true, reason: "remote_wrapped_up" });
    expect(state.pollCount).toBe(1);
  });

  it("still waits when the interrupt response body is unreadable", async () => {
    // An unparseable body is not evidence the run is dead — stay conservative.
    state.rows = [row({ sessionId: "sess-prev", startedAt: 1_000 })];
    state.clawBody = "<html>502</html>";
    state.remoteStatuses = ["completed"];
    const { awaitTurnHandoff } = await import("./run-turn-handoff.js");

    const result = await awaitTurnHandoff(args);

    expect(result).toEqual({ handedOff: true, reason: "remote_wrapped_up" });
    expect(state.pollCount).toBe(1);
  });

  it("still waits when the interrupt POST is rejected", async () => {
    state.rows = [row({ sessionId: "sess-prev", startedAt: 1_000 })];
    state.clawStatus = 503;
    state.remoteStatuses = ["completed"];
    const { awaitTurnHandoff } = await import("./run-turn-handoff.js");

    const result = await awaitTurnHandoff(args);

    expect(result).toEqual({ handedOff: true, reason: "remote_wrapped_up" });
    expect(state.pollCount).toBe(1);
  });

  // ── Preserved behaviour ──────────────────────────────────────────────────

  it("returns handedOff false when nothing is running on the conversation", async () => {
    const { awaitTurnHandoff } = await import("./run-turn-handoff.js");
    const labels: string[] = [];
    const result = await awaitTurnHandoff({ ...args, onLabel: (l) => labels.push(l) });

    expect(result).toEqual({ handedOff: false, reason: "no_active_run" });
    expect(labels).toHaveLength(0);
    expect(state.interrupts).toHaveLength(0);
    expect(state.fetches).toHaveLength(0);
  });

  it("returns no_conversation without touching the repository", async () => {
    const { awaitTurnHandoff } = await import("./run-turn-handoff.js");
    const result = await awaitTurnHandoff({ ...args, conversationId: "" });

    expect(result).toEqual({ handedOff: false, reason: "no_conversation" });
    expect(state.findRunningCalls).toHaveLength(0);
  });

  it("POSTs interrupt-with-reply for a remote run and resolves when it stops running", async () => {
    state.rows = [row({ sessionId: "sess-remote", userId: "owner-1", startedAt: 1_000 })];
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
    state.rows = [row({ sessionId: "sess-remote", userId: "owner-1", startedAt: 1_000 })];
    state.remoteStatuses = Array.from({ length: 200 }, () => "running");
    const { awaitTurnHandoff } = await import("./run-turn-handoff.js");

    vi.useFakeTimers();
    const pending = awaitTurnHandoff(args);
    await vi.advanceTimersByTimeAsync(35_000);
    const result = await pending;
    vi.useRealTimers();

    expect(result).toEqual({ handedOff: true, reason: "remote_timeout" });
    expect(actions()).toEqual(["interrupt-with-reply", "cancel"]);
  });

  it("falls back to no_active_run when the repository lookup throws", async () => {
    const { agentRunRepository } = await import("../repositories/index.js");
    vi.mocked(agentRunRepository.findRunningByConversation).mockRejectedValueOnce(
      new Error("db down"),
    );
    const { awaitTurnHandoff } = await import("./run-turn-handoff.js");

    const result = await awaitTurnHandoff(args);

    expect(result).toEqual({ handedOff: false, reason: "no_active_run" });
    expect(state.fetches).toHaveLength(0);
  });

  // ── Local harness branch (must stay ahead of the AgentRun lookup) ────────

  it("prefers an active local-harness run and never reaches the AgentRun lookup", async () => {
    state.harnessRun = makeHarnessRun();
    state.harnessStatuses = ["running", "done"];
    // A remote row exists too — the harness branch must still win.
    state.rows = [row({ sessionId: "sess-prev", startedAt: 1_000 })];
    const { awaitTurnHandoff, TURN_HANDOFF_LABEL } = await import("./run-turn-handoff.js");
    const labels: string[] = [];

    const result = await awaitTurnHandoff({ ...args, onLabel: (l) => labels.push(l) });

    expect(result).toEqual({ handedOff: true, reason: "local_harness_wrapped_up" });
    expect(state.interrupts).toEqual(["run-1"]);
    expect(labels).toEqual([TURN_HANDOFF_LABEL]);
    expect(state.findRunningCalls).toHaveLength(0);
    expect(state.fetches).toHaveLength(0);
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
