import { beforeEach, describe, expect, it, vi } from "vitest";

const repo = vi.hoisted(() => ({
  active: null as Record<string, unknown> | null,
  sessions: new Map<string, { startedAt?: Date; status?: string }>(),
  updates: [] as Array<[string, Record<string, unknown>]>,
}));
const lib = vi.hoisted(() => ({ epochs: [] as Array<Record<string, unknown>>, checkers: [] as number[], notices: 0 }));

vi.mock("../../repositories/index.js", () => ({
  experimentRepository: {
    findActiveByConversation: vi.fn(async () => repo.active),
    update: vi.fn(async (id: string, data: Record<string, unknown>) => {
      repo.updates.push([id, data]);
      const base = repo.active ?? {};
      const epoch = (data["epoch"] as { increment?: number } | undefined)?.increment
        ? (base["epoch"] as number) + 1
        : base["epoch"];
      return { ...base, ...data, epoch };
    }),
  },
  agentRunRepository: { findBySessionId: vi.fn(async (id: string) => repo.sessions.get(id) ?? null) },
}));
vi.mock("../../lib/experiment.js", () => ({
  dispatchExperimentEpoch: vi.fn(async (run: Record<string, unknown>) => { lib.epochs.push(run); return { sessionId: "next" }; }),
  dispatchExperimentChecker: vi.fn(async (_run: unknown, epoch: number) => { lib.checkers.push(epoch); }),
  postExperimentNotice: vi.fn(async () => { lib.notices += 1; }),
}));
vi.mock("../../logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const { continueExperimentAfterResult, superviseExperiment, experimentLoop, EPOCH_LOOPS, epochLoopFor } = await import("./experiment.js");
const { validateLoopSpec } = await import("../engine.js");

const NOW = Date.parse("2026-10-22T12:00:00Z");
const minutes = (m: number) => new Date(NOW + m * 60_000);

function run(overrides: Record<string, unknown> = {}) {
  return {
    id: "exp-1",
    status: "running",
    kind: null,
    epoch: 3,
    currentSessionId: "s-3",
    deadlineAt: minutes(60),
    updatedAt: minutes(-1),
    finalReport: null,
    channelId: "c",
    conversationId: "conv",
    agentSlug: "a",
    orgId: "o",
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  repo.active = null;
  repo.sessions = new Map([["s-3", { startedAt: minutes(-20), status: "completed" }]]);
  repo.updates = [];
  lib.epochs = [];
  lib.checkers = [];
  lib.notices = 0;
});

describe("experiment loop spec", () => {
  it("is a valid graph", () => {
    expect(validateLoopSpec(experimentLoop as never)).toEqual([]);
  });

  it("has one valid spec per loop command, picked by the run's kind", () => {
    for (const spec of Object.values(EPOCH_LOOPS)) expect(validateLoopSpec(spec as never)).toEqual([]);
    expect(Object.keys(EPOCH_LOOPS).sort()).toEqual(["experiment", "framework", "repo-history", "security", "understanding"]);
    expect(epochLoopFor("security").id).toBe("security");
    expect(epochLoopFor(null).id).toBe("experiment");
    expect(epochLoopFor("repo-history").policy.maxPasses?.({} as never)).toBe(1000);
    expect(epochLoopFor("framework").policy.maxPasses?.({} as never)).toBeNull();
  });
});

describe("continueExperimentAfterResult", () => {
  it("ignores threads without an active run and results from another session", async () => {
    expect(await continueExperimentAfterResult("conv", "s-3")).toBe(false);
    repo.active = run({ currentSessionId: "other" });
    expect(await continueExperimentAfterResult("conv", "s-3")).toBe(false);
    expect(repo.updates).toEqual([]);
  });

  it("marks a finishing run done after its final epoch", async () => {
    repo.active = run({ status: "finishing" });
    expect(await continueExperimentAfterResult("conv", "s-3")).toBe(false);
    expect(repo.updates).toEqual([["exp-1", { status: "done", lastEpochEndedAt: expect.any(Date) }]]);
    expect(lib.epochs).toEqual([]);
  });

  it("defers to the supervisor when an epoch died within 30s", async () => {
    repo.active = run();
    repo.sessions.set("s-3", { startedAt: new Date(NOW - 5_000) });
    expect(await continueExperimentAfterResult("conv", "s-3")).toBe(true);
    expect(repo.updates).toEqual([["exp-1", { lastEpochEndedAt: expect.any(Date) }]]);
    expect(lib.checkers).toEqual([]);
    expect(lib.epochs).toEqual([]);
  });

  it("checks the finished epoch and starts the next one before the deadline", async () => {
    repo.active = run();
    expect(await continueExperimentAfterResult("conv", "s-3")).toBe(true);
    expect(lib.checkers).toEqual([3]);
    expect(repo.updates).toEqual([["exp-1", { epoch: { increment: 1 }, lastEpochEndedAt: expect.any(Date) }]]);
    expect(lib.epochs.map((e) => [e["epoch"], e["status"]])).toEqual([[4, "running"]]);
  });

  it("dispatches the final report epoch once the deadline passes", async () => {
    repo.active = run({ deadlineAt: minutes(-1) });
    expect(await continueExperimentAfterResult("conv", "s-3")).toBe(true);
    expect(lib.checkers).toEqual([3]);
    expect(repo.updates).toEqual([["exp-1", { status: "finishing", epoch: { increment: 1 }, lastEpochEndedAt: expect.any(Date) }]]);
    expect(lib.epochs.map((e) => e["status"])).toEqual(["finishing"]);
  });

  it("keeps a repo-history walk going past its deadline until the epoch backstop", async () => {
    repo.active = run({ kind: "repo-history", deadlineAt: minutes(-60), epoch: 999 });
    await continueExperimentAfterResult("conv", "s-3");
    expect(lib.epochs.map((e) => e["status"])).toEqual(["running"]);
    repo.active = run({ kind: "repo-history", deadlineAt: minutes(60), epoch: 1000 });
    await continueExperimentAfterResult("conv", "s-3");
    expect(lib.epochs.map((e) => e["status"])).toEqual(["running", "finishing"]);
  });
});

describe("superviseExperiment", () => {
  it("force-finishes a run 15 minutes past its deadline and posts the notice", async () => {
    await superviseExperiment(run({ deadlineAt: minutes(-16) }) as never, NOW);
    expect(repo.updates).toEqual([["exp-1", { status: "done", finalReport: "(experiment ended without final report)" }]]);
    expect(lib.notices).toBe(1);
  });

  it("leaves a run alone while its epoch session is live or it was touched recently", async () => {
    repo.sessions.set("s-3", { status: "running" });
    await superviseExperiment(run({ updatedAt: minutes(-30) }) as never, NOW);
    repo.sessions.set("s-3", { status: "completed" });
    await superviseExperiment(run({ updatedAt: minutes(-5) }) as never, NOW);
    expect(repo.updates).toEqual([]);
    expect(lib.epochs).toEqual([]);
  });

  it("rescues a stalled run with the next epoch, or the final one after the deadline", async () => {
    repo.active = run();
    await superviseExperiment(run({ updatedAt: minutes(-11) }) as never, NOW);
    await superviseExperiment(run({ updatedAt: minutes(-11), deadlineAt: minutes(-5) }) as never, NOW);
    expect(repo.updates.map(([, data]) => data["status"] ?? "running")).toEqual(["running", "finishing"]);
    expect(lib.checkers).toEqual([]);
  });

  it("does nothing for a stalled run that is already finishing", async () => {
    await superviseExperiment(run({ status: "finishing", updatedAt: minutes(-11) }) as never, NOW);
    expect(repo.updates).toEqual([]);
  });
});
