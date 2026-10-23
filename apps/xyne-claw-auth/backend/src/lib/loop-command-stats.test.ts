import { describe, expect, it, vi } from "vitest";

vi.mock("../db.js", () => ({ prisma: {} }));
const { aggregateLoopCommandStats } = await import("./loop-command-stats.js");

const NOW = Date.parse("2026-10-23T12:00:00Z");
const at = (hoursAgo: number) => new Date(NOW - hoursAgo * 3_600_000);
const run = (id: string, o: Record<string, unknown>) => ({
  id, commandId: "lc-perf", commandVersion: 2, status: "done", epoch: 3, createdAt: at(5), lastEpochEndedAt: at(4), updatedAt: at(4),
  finalReport: "p95 down 30%\nmore", epochSessionIds: [`${id}-e1`, `${id}-e2`], checkerSessionIds: [`${id}-c1`], sequenceId: null, ...o,
});

describe("aggregateLoopCommandStats", () => {
  const commands = [
    { id: "lc-perf", name: "perf-hunt", template: "deadline-checker", version: 2, published: true },
    { id: "lc-rel", name: "release-check", template: "sequence", version: 1, published: false },
  ];
  const runs = [
    run("r1", {}),
    run("r2", { commandVersion: 1, status: "aborted", epoch: 1, createdAt: at(30), lastEpochEndedAt: at(29), finalReport: null }),
    run("r3", { status: "done", finalReport: "(experiment ended without final report)", createdAt: at(50), lastEpochEndedAt: at(48) }),
    run("r4", { status: "running", epoch: 2, createdAt: at(1), lastEpochEndedAt: null, updatedAt: at(0.5) }),
    run("s1", { commandId: null, sequenceId: "seq1", epochSessionIds: ["s1-e1"], checkerSessionIds: [] }),
  ];
  const agentRuns = [
    { sessionId: "r1-e1", model: "private-large", tokensIn: 1000, tokensOut: 200, tokensCacheRead: 5000, tokensCacheWrite: 0 },
    { sessionId: "r1-e2", model: "private-large", tokensIn: 800, tokensOut: 100, tokensCacheRead: 4000, tokensCacheWrite: 0 },
    { sessionId: "r1-c1", model: "claude-opus-5-5", tokensIn: 300, tokensOut: 50, tokensCacheRead: 0, tokensCacheWrite: 10 },
    { sessionId: "s1-e1", model: "private-large", tokensIn: 50, tokensOut: 5, tokensCacheRead: 0, tokensCacheWrite: 0 },
  ];
  const sequences = [
    { id: "seq1", commandId: "lc-rel", commandVersion: 1, status: "done", stepIndex: 2, steps: [], createdAt: at(10), finishedAt: at(8) },
    { id: "seq2", commandId: "lc-rel", commandVersion: 1, status: "aborted", stepIndex: 0, steps: [], createdAt: at(3), finishedAt: at(2.5) },
  ];
  const findings = [{ experimentId: "r1", status: "proved", count: 4 }, { experimentId: "r1", status: "refuted", count: 2 }, { experimentId: "r3", status: "conjecture", count: 1 }];
  const [perf, rel] = aggregateLoopCommandStats({ commands, runs, sequences, agentRuns, findings, days: 7, now: NOW });

  it("counts outcomes, completion over finished runs, passes and durations", () => {
    expect(perf).toMatchObject({ name: "perf-hunt", runs: 4, outcomes: { completed: 1, "no-report": 1, stopped: 1, running: 1 }, completionRate: 33.3, avgPasses: 2.3 });
    expect(perf!.p50Ms).toBe(3_600_000);
    expect(perf!.p95Ms).toBe(7_200_000);
    expect(perf!.findings).toEqual({ proved: 4, refuted: 2, conjecture: 1 });
  });

  it("sums tokens per model from every epoch and checker session for pricing", () => {
    expect(perf!.costRows).toEqual(
      expect.arrayContaining([
        { model: "private-large", runs: 2, tokensIn: 1800, tokensOut: 300, cacheRead: 9000, cacheWrite: 0 },
        { model: "claude-opus-5-5", runs: 1, tokensIn: 300, tokensOut: 50, cacheRead: 0, cacheWrite: 10 },
      ]),
    );
  });

  it("splits by version and lists recent runs with the first report line", () => {
    expect(perf!.byVersion.map((v) => [v.version, v.runs])).toEqual([[2, 3], [1, 1]]);
    expect(perf!.recent[0]).toMatchObject({ id: "r1", version: 2, status: "completed", passes: 3, report: "p95 down 30%" });
    expect(perf!.daily).toHaveLength(7);
    expect(perf!.daily.at(-1)!.runs).toBe(2);
  });

  it("rolls a sequence up from its sequence runs and prices its step runs", () => {
    expect(rel).toMatchObject({ name: "release-check", composite: true, runs: 2, outcomes: { completed: 1, stopped: 1 }, completionRate: 50 });
    expect(rel!.costRows).toEqual([{ model: "private-large", runs: 1, tokensIn: 50, tokensOut: 5, cacheRead: 0, cacheWrite: 0 }]);
    expect(rel!.recent.map((r) => [r.id, r.passes])).toEqual([["seq1", 3], ["seq2", 1]]);
  });
});
