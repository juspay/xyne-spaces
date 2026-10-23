import { getLoopTemplate } from "xyne-claw-shared";
import { prisma } from "../db.js";

const DAY_MS = 86_400_000;
const NO_FINAL_REPORT = "(experiment ended without final report)";
const RECENT = 10;

export interface StatsRun {
  id: string;
  commandId: string | null;
  commandVersion: number | null;
  status: string;
  epoch: number;
  createdAt: Date;
  lastEpochEndedAt: Date | null;
  updatedAt: Date;
  finalReport: string | null;
  epochSessionIds: string[];
  checkerSessionIds: string[];
  sequenceId: string | null;
}

export interface StatsSequence {
  id: string;
  commandId: string;
  commandVersion: number;
  status: string;
  stepIndex: number;
  steps: unknown;
  createdAt: Date;
  finishedAt: Date | null;
}

export interface StatsAgentRun {
  sessionId: string;
  model: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  tokensCacheRead: number | null;
  tokensCacheWrite: number | null;
}

export interface StatsCommand {
  id: string;
  name: string;
  template: string;
  version: number;
  published: boolean;
}

export interface CostRow {
  model: string | null;
  runs: number;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheWrite: number;
}

const pct = (n: number, d: number): number | null => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);
const pctile = (sorted: number[], p: number): number | null => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]! : null);

function runMs(r: Pick<StatsRun, "createdAt" | "lastEpochEndedAt" | "updatedAt">): number {
  return Math.max(0, (r.lastEpochEndedAt ?? r.updatedAt).getTime() - r.createdAt.getTime());
}

function outcome(status: string, report: string | null): "completed" | "no-report" | "stopped" | "running" {
  if (status === "running" || status === "finishing") return "running";
  if (status === "aborted") return "stopped";
  return report && report.trim() && report !== NO_FINAL_REPORT ? "completed" : "no-report";
}

function costRows(sessionIds: string[], bySession: Map<string, StatsAgentRun>): CostRow[] {
  const by = new Map<string, CostRow>();
  for (const id of sessionIds) {
    const a = bySession.get(id);
    if (!a) continue;
    const key = a.model ?? "";
    const c = by.get(key) ?? { model: a.model, runs: 0, tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0 };
    c.runs += 1;
    c.tokensIn += a.tokensIn ?? 0;
    c.tokensOut += a.tokensOut ?? 0;
    c.cacheRead += a.tokensCacheRead ?? 0;
    c.cacheWrite += a.tokensCacheWrite ?? 0;
    by.set(key, c);
  }
  return [...by.values()];
}

function summarise(runs: Array<{ status: string; report: string | null; ms: number; passes: number }>) {
  const finished = runs.filter((r) => r.status !== "running");
  const durations = finished.map((r) => r.ms).sort((a, b) => a - b);
  const counts = { completed: 0, "no-report": 0, stopped: 0, running: 0 };
  for (const r of runs) counts[outcome(r.status, r.report)] += 1;
  return {
    runs: runs.length,
    outcomes: counts,
    completionRate: pct(counts.completed, finished.length),
    avgPasses: finished.length ? Math.round((finished.reduce((n, r) => n + r.passes, 0) / finished.length) * 10) / 10 : null,
    p50Ms: pctile(durations, 50),
    p95Ms: pctile(durations, 95),
  };
}

export function aggregateLoopCommandStats(input: {
  commands: StatsCommand[];
  runs: StatsRun[];
  sequences: StatsSequence[];
  agentRuns: StatsAgentRun[];
  findings: Array<{ experimentId: string; status: string; count: number }>;
  days: number;
  now?: number;
}) {
  const now = input.now ?? Date.now();
  const bySession = new Map(input.agentRuns.map((a) => [a.sessionId, a]));
  const findingsByRun = new Map<string, Record<string, number>>();
  for (const f of input.findings) {
    const m = findingsByRun.get(f.experimentId) ?? {};
    m[f.status] = (m[f.status] ?? 0) + f.count;
    findingsByRun.set(f.experimentId, m);
  }
  return input.commands.map((cmd) => {
    const composite = getLoopTemplate(cmd.template)?.composite === true;
    const daily = (dates: Date[]) =>
      Array.from({ length: input.days }, (_, i) => {
        const start = now - (input.days - i) * DAY_MS;
        return { day: new Date(start).toISOString().slice(0, 10), runs: dates.filter((d) => d.getTime() >= start && d.getTime() < start + DAY_MS).length };
      });
    if (composite) {
      const seqs = input.sequences.filter((s) => s.commandId === cmd.id);
      const stepRuns = input.runs.filter((r) => r.sequenceId && seqs.some((s) => s.id === r.sequenceId));
      const items = seqs.map((s) => ({
        status: s.status === "running" ? "running" : s.status === "aborted" ? "aborted" : "done",
        report: s.status === "done" ? "sequence finished" : null,
        ms: Math.max(0, (s.finishedAt ?? new Date(now)).getTime() - s.createdAt.getTime()),
        passes: s.stepIndex + 1,
      }));
      const byVersion = [...new Set(seqs.map((s) => s.commandVersion))].sort((a, b) => b - a).map((v) => {
        const vs = seqs.filter((s) => s.commandVersion === v);
        return { version: v, ...summarise(items.filter((_, i) => seqs[i]!.commandVersion === v)), runs: vs.length };
      });
      return {
        ...cmd,
        composite: true,
        ...summarise(items),
        findings: { proved: 0, refuted: 0, conjecture: 0 },
        costRows: costRows(stepRuns.flatMap((r) => [...r.epochSessionIds, ...r.checkerSessionIds]), bySession),
        byVersion,
        daily: daily(seqs.map((s) => s.createdAt)),
        recent: seqs.slice(0, RECENT).map((s) => ({ id: s.id, version: s.commandVersion, status: s.status, passes: s.stepIndex + 1, ms: Math.max(0, (s.finishedAt ?? new Date(now)).getTime() - s.createdAt.getTime()), createdAt: s.createdAt, report: null as string | null })),
      };
    }
    const mine = input.runs.filter((r) => r.commandId === cmd.id);
    const items = mine.map((r) => ({ status: r.status === "finishing" ? "running" : r.status, report: r.finalReport, ms: runMs(r), passes: r.epoch }));
    const findings = { proved: 0, refuted: 0, conjecture: 0 };
    for (const r of mine) {
      const f = findingsByRun.get(r.id) ?? {};
      findings.proved += f["proved"] ?? 0;
      findings.refuted += f["refuted"] ?? 0;
      findings.conjecture += f["conjecture"] ?? 0;
    }
    const byVersion = [...new Set(mine.map((r) => r.commandVersion ?? 0))].sort((a, b) => b - a).map((v) => ({
      version: v,
      ...summarise(items.filter((_, i) => (mine[i]!.commandVersion ?? 0) === v)),
    }));
    return {
      ...cmd,
      composite: false,
      ...summarise(items),
      findings,
      costRows: costRows(mine.flatMap((r) => [...r.epochSessionIds, ...r.checkerSessionIds]), bySession),
      byVersion,
      daily: daily(mine.map((r) => r.createdAt)),
      recent: mine.slice(0, RECENT).map((r) => ({
        id: r.id,
        version: r.commandVersion,
        status: outcome(r.status, r.finalReport),
        passes: r.epoch,
        ms: runMs(r),
        createdAt: r.createdAt,
        report: r.finalReport?.trim().split("\n").find((l) => l.trim())?.slice(0, 200) ?? null,
      })),
    };
  });
}

export async function loadLoopCommandStats(orgId: string, userId: string, opts: { days: number; commandId?: string }) {
  const since = new Date(Date.now() - opts.days * DAY_MS);
  const commands = await prisma.loopCommandDefinition.findMany({
    where: { orgId, ...(opts.commandId ? { id: opts.commandId } : {}), OR: [{ published: true }, { createdByUserId: userId }] },
    select: { id: true, name: true, template: true, version: true, published: true },
    orderBy: { name: "asc" },
    take: 200,
  });
  const ids = commands.map((c) => c.id);
  if (ids.length === 0) return [];
  const sequences = await prisma.loopSequenceRun.findMany({
    where: { orgId, commandId: { in: ids }, createdAt: { gte: since } },
    select: { id: true, commandId: true, commandVersion: true, status: true, stepIndex: true, steps: true, createdAt: true, finishedAt: true },
    orderBy: { createdAt: "desc" },
    take: 2_000,
  });
  const runs = await prisma.experimentRun.findMany({
    where: {
      orgId,
      createdAt: { gte: since },
      OR: [{ commandId: { in: ids } }, ...(sequences.length ? [{ sequenceId: { in: sequences.map((s) => s.id) } }] : [])],
    },
    select: { id: true, commandId: true, commandVersion: true, status: true, epoch: true, createdAt: true, lastEpochEndedAt: true, updatedAt: true, finalReport: true, epochSessionIds: true, checkerSessionIds: true, sequenceId: true },
    orderBy: { createdAt: "desc" },
    take: 5_000,
  });
  const sessionIds = [...new Set(runs.flatMap((r) => [...r.epochSessionIds, ...r.checkerSessionIds]))];
  const agentRuns = sessionIds.length
    ? await prisma.agentRun.findMany({
        where: { sessionId: { in: sessionIds.slice(0, 20_000) } },
        select: { sessionId: true, model: true, tokensIn: true, tokensOut: true, tokensCacheRead: true, tokensCacheWrite: true },
      })
    : [];
  const findings = runs.length
    ? (await prisma.experimentFinding.groupBy({ by: ["experimentId", "status"], where: { experimentId: { in: runs.map((r) => r.id) } }, _count: { _all: true } })).map((f) => ({
        experimentId: f.experimentId,
        status: f.status,
        count: f._count._all,
      }))
    : [];
  return aggregateLoopCommandStats({ commands, runs, sequences, agentRuns, findings, days: opts.days });
}
