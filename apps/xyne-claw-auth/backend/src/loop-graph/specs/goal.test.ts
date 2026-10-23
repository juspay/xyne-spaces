import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  goal: null as Record<string, unknown> | null,
  verdict: { done: false, reason: "keep going" },
  calls: [] as string[],
}));

vi.mock("../../repositories/activeGoalRepository.js", () => ({
  activeGoalRepository: {
    findActiveByConversation: vi.fn(async () => state.goal),
    recordTurn: vi.fn(async (_c: string, turnOutput: string) => {
      state.calls.push("recordTurn");
      return { ...state.goal, turnCount: (state.goal!["turnCount"] as number) + 1, lastTurnResult: turnOutput };
    }),
    terminate: vi.fn(async (_c: string, status: string, reason: string) => { state.calls.push(`terminate:${status}:${reason}`); }),
    setAuditState: vi.fn(async (_c: string, s: string) => { state.calls.push(`audit:${s}`); }),
  },
}));
vi.mock("../../services/goalJudgeClient.js", () => ({
  judgeGoalViaClaw: vi.fn(async () => { state.calls.push("judge"); return state.verdict; }),
}));
vi.mock("../../logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const { recordTurnAndDecide, goalLoop } = await import("./goal.js");
const { validateLoopSpec } = await import("../engine.js");

const goal = (overrides: Record<string, unknown> = {}) => ({
  conversationId: "conv",
  condition: "ship it",
  turnCount: 1,
  maxTurns: 5,
  auditState: "none",
  lastTurnResult: null,
  runPayload: { agentSlug: "a" },
  ...overrides,
});
const decide = (lastTurnResult = "worked") => recordTurnAndDecide({ conversationId: "conv", lastTurnResult });

beforeEach(() => {
  state.goal = goal();
  state.verdict = { done: false, reason: "keep going" };
  state.calls = [];
});

describe("goal loop spec", () => {
  it("is a valid graph", () => {
    expect(validateLoopSpec(goalLoop as never)).toEqual([]);
  });
});

describe("recordTurnAndDecide", () => {
  it("does nothing without an active goal", async () => {
    state.goal = null;
    expect(await decide()).toEqual({ kind: "noActiveGoal" });
  });

  it("continues with the next turn while the judge says not met", async () => {
    const decision = await decide();
    expect(decision).toMatchObject({ kind: "continue", runPayload: { agentSlug: "a" }, replyToUser: "_Turn 2/5 — keep going_" });
    expect(decision.kind === "continue" && decision.nextTurnTask).toContain("Loop state: turn 2 of 5");
    expect(state.calls).toEqual(["recordTurn", "judge"]);
  });

  it("stops at the turn limit before asking the judge, even mid-audit", async () => {
    state.goal = goal({ turnCount: 4, auditState: "pending" });
    expect(await decide()).toEqual({ kind: "terminated", reason: "max_turns_reached:5", replyToUser: "**/goal stopped — turn limit (5) reached.**" });
    expect(state.calls).toEqual(["recordTurn", "terminate:failed:max_turns_reached:5"]);
  });

  it("runs one audit pass on the first done vote", async () => {
    state.verdict = { done: true, reason: "met" };
    const decision = await decide();
    expect(decision).toMatchObject({ kind: "continue", replyToUser: "_Turn 2/5 — judge says done, running audit pass_" });
    expect(decision.kind === "continue" && decision.nextTurnTask).toContain("AUDIT PASS");
    expect(state.calls).toEqual(["recordTurn", "judge", "audit:pending"]);
  });

  it("ends cleanly when the audit finds nothing", async () => {
    state.goal = goal({ auditState: "pending" });
    expect(await decide("all numbers re-checked")).toEqual({ kind: "terminated", reason: "audit_passed", replyToUser: "**/goal complete — audit verified the result.**" });
    expect(state.calls).toEqual(["recordTurn", "audit:done", "terminate:done:audit_passed"]);
  });

  it("reopens for a fix turn when the audit flags GOAL_REOPEN", async () => {
    state.goal = goal({ auditState: "pending" });
    const decision = await decide("GOAL_REOPEN: count was 27 not 58");
    expect(decision).toMatchObject({ kind: "continue", replyToUser: "_Turn 2/5 — audit flagged issues, fixing_" });
    expect(decision.kind === "continue" && decision.nextTurnTask).toContain("Your audit found errors");
    expect(state.calls).toEqual(["recordTurn", "audit:done"]);
  });

  it("terminates without a second audit once already audited", async () => {
    state.goal = goal({ auditState: "done" });
    state.verdict = { done: true, reason: "all PRs merged" };
    expect(await decide()).toEqual({ kind: "terminated", reason: "all PRs merged", replyToUser: "**/goal complete — all PRs merged**" });
    expect(state.calls).toEqual(["recordTurn", "judge", "terminate:done:all PRs merged"]);
  });
});
