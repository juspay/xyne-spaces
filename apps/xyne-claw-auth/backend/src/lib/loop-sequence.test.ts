import { beforeEach, describe, expect, it, vi } from "vitest";

process.env["ENCRYPTION_KEY"] ??= "00".repeat(32);

const state = vi.hoisted(() => ({
  seqs: new Map<string, Record<string, unknown>>(),
  runs: [] as Array<Record<string, unknown>>,
  posts: [] as string[],
  dispatched: [] as string[],
  active: null as Record<string, unknown> | null,
  customRows: new Map<string, Record<string, unknown>>(),
  failDispatch: false,
}));

vi.mock("../db.js", () => ({
  prisma: {
    loopSequenceRun: {
      findFirst: vi.fn(async ({ where }: { where: { conversationId: string } }) => [...state.seqs.values()].find((s) => s["conversationId"] === where.conversationId && s["status"] === "running") ?? null),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => state.seqs.get(where.id) ?? null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `seq${state.seqs.size + 1}`, stepIndex: 0, currentRunId: null, status: "running", ...data };
        state.seqs.set(row.id, row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = { ...state.seqs.get(where.id)!, ...data };
        state.seqs.set(where.id, row);
        return row;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const row = state.seqs.get(where["id"] as string);
        if (!row || row["status"] !== where["status"] || row["currentRunId"] !== where["currentRunId"]) return { count: 0 };
        state.seqs.set(row["id"] as string, { ...row, ...data });
        return { count: 1 };
      }),
    },
    experimentRun: { findMany: vi.fn(async ({ where }: { where: { sequenceId: string } }) => state.runs.filter((r) => r["sequenceId"] === where.sequenceId)) },
  },
}));
vi.mock("../repositories/index.js", () => ({
  experimentRepository: {
    findActiveByConversation: vi.fn(async () => state.active),
    createRun: vi.fn(async (args: Record<string, unknown>) => {
      const run = { id: `run${state.runs.length + 1}`, status: "running", epoch: 1, finalReport: null, ...args };
      state.runs.push(run);
      return run;
    }),
    update: vi.fn(async (id: string, data: Record<string, unknown>) => Object.assign(state.runs.find((r) => r["id"] === id) ?? {}, data)),
  },
}));
vi.mock("./experiment.js", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  dispatchExperimentEpoch: vi.fn(async (run: { id: string }) => {
    if (state.failDispatch) throw new Error("claw is down");
    state.dispatched.push(run.id);
    return { sessionId: `s-${run.id}` };
  }),
  postThreadMarkdown: vi.fn(async (_t: unknown, text: string) => {
    state.posts.push(text);
  }),
}));
vi.mock("./loop-command-defs.js", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  findRunnableLoopCommand: vi.fn(async (_o: string, _u: string, word: string) => state.customRows.get(word) ?? null),
}));

const seqMod = await import("./loop-sequence.js");

const row = {
  id: "lc-rel",
  orgId: "o1",
  name: "release-check",
  version: 3,
  template: "sequence",
  steps: [
    { command: "/ui-test", args: "{focus}" },
    { command: "/security-scan", args: "30m auth" },
    { command: "/perf-hunt", args: "" },
  ],
};

const customPerf = { id: "lc-perf", orgId: "o1", name: "perf-hunt", version: 2, template: "deadline-checker", description: "d", instruction: "Profile the service and record each regression.", skills: [], subagents: [], deliverable: null, judgeQuestion: null, maxPasses: null, maxDurationMinutes: 45, provider: null, modelId: null };

const start = () => seqMod.startSequence({ row: row as never, conversationId: "conv", channelId: "ch", agentSlug: "architect", userId: "u1", focus: "/settings" });

beforeEach(() => {
  state.seqs.clear();
  state.runs.length = 0;
  state.posts.length = 0;
  state.dispatched.length = 0;
  state.active = null;
  state.failDispatch = false;
  state.customRows.clear();
  state.customRows.set("perf-hunt", customPerf);
});

describe("loop sequences", () => {
  it("starts step 1 with {focus} filled in and snapshots the steps", async () => {
    const r = await start();
    expect(r.ok).toBe(true);
    expect(state.runs[0]).toMatchObject({ kind: "ui-test", focus: "/settings", sequenceId: "seq1", sequenceStep: 0 });
    expect(state.dispatched).toEqual(["run1"]);
    expect(state.seqs.get("seq1")).toMatchObject({ currentRunId: "run1", stepIndex: 0, commandVersion: 3, focus: "/settings" });
    expect(state.posts[0]).toBe("**/release-check** · step 1/3: `/ui-test /settings` started");
  });

  it("refuses to start while another loop runs in the thread", async () => {
    state.active = { id: "busy" };
    expect(await start()).toEqual({ ok: false, error: expect.stringContaining("already running") });
    expect(state.runs).toEqual([]);
  });

  it("advances exactly once per finished step, then summarises", async () => {
    await start();
    await seqMod.onExperimentFinished({ id: "run1", sequenceId: "seq1" }, "done");
    await seqMod.onExperimentFinished({ id: "run1", sequenceId: "seq1" }, "done");
    expect(state.runs.map((r) => [r["kind"] ?? null, r["sequenceStep"]])).toEqual([["ui-test", 0], ["security", 1]]);
    await seqMod.onExperimentFinished({ id: "run2", sequenceId: "seq1" }, "done");
    expect(state.runs[2]).toMatchObject({ kind: "custom", commandId: "lc-perf", commandVersion: 2, sequenceStep: 2 });
    Object.assign(state.runs[0]!, { status: "done", epoch: 3, finalReport: "6 variations, 1 real defect on narrow widths\nmore" });
    Object.assign(state.runs[1]!, { status: "done", epoch: 2, finalReport: "No exploitable auth issues confirmed" });
    Object.assign(state.runs[2]!, { status: "done", epoch: 4, finalReport: "p95 down 30%" });
    await seqMod.onExperimentFinished({ id: "run3", sequenceId: "seq1" }, "done");
    expect(state.seqs.get("seq1")).toMatchObject({ status: "done", currentRunId: null });
    const summary = state.posts.at(-1)!;
    expect(summary).toContain("**/release-check finished** — all 3 steps ran.");
    expect(summary).toContain("1. `/ui-test /settings` · done · 3 passes — 6 variations, 1 real defect on narrow widths");
    expect(summary).toContain("3. `/perf-hunt` · done · 4 passes — p95 down 30%");
  });

  it("stops the whole sequence when a step is aborted", async () => {
    await start();
    await seqMod.onExperimentFinished({ id: "run1", sequenceId: "seq1" }, "aborted");
    expect(state.seqs.get("seq1")).toMatchObject({ status: "aborted" });
    expect(state.runs).toHaveLength(1);
    expect(state.posts.at(-1)).toContain("**/release-check stopped** before all steps ran.");
  });

  it("aborts with a reason when a step's command is gone or cannot start", async () => {
    state.customRows.clear();
    await start();
    await seqMod.onExperimentFinished({ id: "run1", sequenceId: "seq1" }, "done");
    await seqMod.onExperimentFinished({ id: "run2", sequenceId: "seq1" }, "done");
    expect(state.seqs.get("seq1")).toMatchObject({ status: "aborted" });
    expect(state.posts.at(-1)).toBe("**/release-check** stopped at step 3/3: /perf-hunt no longer exists or you cannot run it");
    state.seqs.clear();
    state.failDispatch = true;
    await start();
    expect(state.posts.at(-1)).toContain("stopped at step 1/3: step could not start: claw is down");
  });

  it("ignores runs that are not the sequence's current step", async () => {
    await start();
    await seqMod.onExperimentFinished({ id: "other", sequenceId: "seq1" }, "done");
    await seqMod.onExperimentFinished({ id: "run1", sequenceId: null }, "done");
    expect(state.runs).toHaveLength(1);
  });
});
