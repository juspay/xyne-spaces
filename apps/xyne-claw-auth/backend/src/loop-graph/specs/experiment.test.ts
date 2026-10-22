import { beforeEach, describe, expect, it, vi } from "vitest";

const repo = vi.hoisted(() => ({
  active: null as Record<string, unknown> | null,
  sessions: new Map<string, { startedAt?: Date; status?: string }>(),
  updates: [] as Array<[string, Record<string, unknown>]>,
}));
const lib = vi.hoisted(() => ({ epochs: [] as Array<Record<string, unknown>>, checkers: [] as number[], notices: 0 }));
const xor = vi.hoisted(() => ({
  reply: null as null | { ok: true; answers: Record<string, unknown>; unavailable: boolean; ms: number } | { ok: false; status: number; error: string },
  asked: [] as string[],
}));

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
vi.mock("../../services/xorTryClient.js", () => ({
  tryChecksViaClaw: vi.fn(async (req: { item: { text: string } }) => {
    xor.asked.push(req.item.text);
    return xor.reply ?? { ok: false, status: 503, error: "xor is not configured" };
  }),
}));
const customDefs = vi.hoisted(() => ({ byId: new Map<string, unknown>() }));
vi.mock("../../lib/loop-command-defs.js", () => ({
  loopDefForRun: vi.fn(async (r: { kind?: string; commandId?: string }) => (r.kind === "custom" && r.commandId ? customDefs.byId.get(r.commandId) ?? null : null)),
}));
const seqHook = vi.hoisted(() => ({ finished: [] as Array<[string, string]> }));
vi.mock("../../lib/loop-sequence.js", () => ({
  onExperimentFinished: vi.fn(async (r: { id: string }, outcome: string) => { seqHook.finished.push([r.id, outcome]); }),
}));
vi.mock("../../logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const { continueExperimentAfterResult, superviseExperiment, experimentLoop, EPOCH_LOOPS, epochLoopFor } = await import("./experiment.js");
const sharedModule = await import("xyne-claw-shared");
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
  xor.reply = null;
  xor.asked = [];
});

describe("experiment loop spec", () => {
  it("is a valid graph", () => {
    expect(validateLoopSpec(experimentLoop as never)).toEqual([]);
  });

  it("has one valid spec per loop command, picked by the run's kind", () => {
    for (const spec of Object.values(EPOCH_LOOPS)) expect(validateLoopSpec(spec as never)).toEqual([]);
    expect(Object.keys(EPOCH_LOOPS).sort()).toEqual(["experiment", "framework", "repo-history", "security", "ui-test", "understanding"]);
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

describe("/ui-test fix-and-retry loop", () => {
  const answer = (value: boolean, confidence: number) => ({
    ok: true as const,
    answers: { fixtureErrors: { value, confidence, unsure: confidence < 0.7 } },
    unavailable: false,
    ms: 3,
  });
  const uiRun = (overrides: Record<string, unknown> = {}) => run({ kind: "ui-test", epoch: 1, focus: "/settings", ...overrides });

  it("judges the pass's own report and sends it back to fix fixtures, without a checker", async () => {
    repo.active = uiRun();
    xor.reply = answer(true, 0.92);
    expect(await continueExperimentAfterResult("conv", "s-3", "3 pass, 2 fail; 4 requests hit the fallback mock")).toBe(true);
    expect(xor.asked).toEqual(["3 pass, 2 fail; 4 requests hit the fallback mock"]);
    expect(lib.checkers).toEqual([]);
    expect(lib.epochs.map((e) => [e["epoch"], e["status"]])).toEqual([[2, "running"]]);
  });

  it("moves to the report when the judge finds no fixture problems", async () => {
    repo.active = uiRun();
    xor.reply = answer(false, 0.95);
    await continueExperimentAfterResult("conv", "s-3", "6 pass, 1 fail, no fallback requests");
    expect(lib.epochs.map((e) => e["status"])).toEqual(["finishing"]);
  });

  it("reports instead of looping when the judge is unsure or unavailable", async () => {
    repo.active = uiRun();
    xor.reply = answer(true, 0.4);
    await continueExperimentAfterResult("conv", "s-3", "unclear output");
    xor.reply = null;
    await continueExperimentAfterResult("conv", "s-3", "anything");
    expect(lib.epochs.map((e) => e["status"])).toEqual(["finishing", "finishing"]);
  });

  it("stops retrying after the retry budget or the deadline", async () => {
    xor.reply = answer(true, 0.9);
    repo.active = uiRun({ epoch: 5 });
    await continueExperimentAfterResult("conv", "s-3", "still broken");
    repo.active = uiRun({ epoch: 2, deadlineAt: minutes(-1) });
    await continueExperimentAfterResult("conv", "s-3", "still broken");
    expect(lib.epochs.map((e) => e["status"])).toEqual(["finishing", "finishing"]);
  });

  it("ends after the report pass and is a valid graph", async () => {
    repo.active = uiRun({ status: "finishing" });
    expect(await continueExperimentAfterResult("conv", "s-3", "final report")).toBe(false);
    expect(xor.asked).toEqual([]);
    expect(validateLoopSpec(epochLoopFor("ui-test") as never)).toEqual([]);
    expect(Object.keys(epochLoopFor("ui-test").nodes)).toContain("judge");
    expect(Object.keys(epochLoopFor("ui-test").nodes)).not.toContain("checker");
  });
});

describe("custom loop commands from templates", () => {
  const { buildCustomLoopDef } = sharedModule;
  const make = (template: string, extra: Record<string, unknown> = {}) =>
    buildCustomLoopDef({ id: `lc-${template}`, name: `my-${template}`, description: "d", template, instruction: "Do the thing carefully and record evidence.", skills: [], subagents: [], deliverable: "md", judgeQuestion: null, maxPasses: null, ...extra } as never);
  const customRun = (id: string, overrides: Record<string, unknown> = {}) => run({ kind: "custom", commandId: id, epoch: 1, ...overrides });
  const answer = (value: boolean, confidence = 0.95) => ({ ok: true as const, answers: { condition: { value, confidence, unsure: confidence < 0.7 } }, unavailable: false, ms: 2 });

  it("builds a valid graph for every template", async () => {
    const { customEpochLoop } = await import("./experiment.js");
    for (const t of ["deadline-checker", "frontier", "cursor-walk", "until-condition", "fix-retry"]) {
      const spec = customEpochLoop(make(t, t === "until-condition" || t === "fix-retry" ? { judgeQuestion: "Is it done yet?" } : {}));
      expect(validateLoopSpec(spec as never)).toEqual([]);
      expect(Object.keys(spec.nodes)).toContain(t.endsWith("retry") || t === "until-condition" ? "judge" : "checker");
    }
  });

  it("until-condition repeats while the judge says the condition is NOT met, then reports", async () => {
    const def = make("until-condition", { judgeQuestion: "Does the reply show p95 under 200 ms?" });
    customDefs.byId.set("lc-until-condition", def);
    repo.active = customRun("lc-until-condition");
    xor.reply = answer(false);
    expect(await continueExperimentAfterResult("conv", "s-3", "p95 is 340 ms after the index change")).toBe(true);
    expect(lib.epochs.map((e) => [e["epoch"], e["status"]])).toEqual([[2, "running"]]);
    lib.epochs.length = 0;
    repo.active = customRun("lc-until-condition", { epoch: 2 });
    xor.reply = answer(true);
    await continueExperimentAfterResult("conv", "s-3", "p95 is 180 ms");
    expect(lib.epochs.map((e) => e["status"])).toEqual(["finishing"]);
  });

  it("fix-retry loops back while problems remain and stops at its own pass limit", async () => {
    customDefs.byId.set("lc-fix-retry", make("fix-retry", { judgeQuestion: "Does the reply report failing tests?", maxPasses: 2 }));
    repo.active = customRun("lc-fix-retry", { epoch: 2 });
    xor.reply = answer(true);
    await continueExperimentAfterResult("conv", "s-3", "2 tests still failing");
    expect(lib.epochs.map((e) => e["epoch"])).toEqual([3]);
    lib.epochs.length = 0;
    repo.active = customRun("lc-fix-retry", { epoch: 3 });
    await continueExperimentAfterResult("conv", "s-3", "1 test still failing");
    expect(lib.epochs.map((e) => e["status"])).toEqual(["finishing"]);
  });

  it("a deadline loop runs the checker and the next pass, like /experiment", async () => {
    customDefs.byId.set("lc-deadline-checker", make("deadline-checker"));
    repo.active = customRun("lc-deadline-checker", { epoch: 3 });
    await continueExperimentAfterResult("conv", "s-3", "recorded 2 findings");
    expect(lib.checkers).toEqual([3]);
    expect(lib.epochs.map((e) => e["epoch"])).toEqual([4]);
  });
});

describe("sequence hook", () => {
  it("tells the sequence when a run reaches done", async () => {
    seqHook.finished.length = 0;
    repo.active = run({ status: "finishing", sequenceId: "seq1" });
    await continueExperimentAfterResult("conv", "s-3", "final report");
    expect(seqHook.finished).toEqual([["exp-1", "done"]]);
  });
});
