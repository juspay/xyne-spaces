import { prisma } from "../../db.js";
import { hashContent } from "../agent-index/index.js";
import type { RunRating, RunStatus, ToolUsage, UsageCorpus, UsageSample, UsageWindow } from "./types.js";

/**
 * Extract stage: runs in a window become a bounded corpus.
 *
 * Only { task, status, rating, toolsUsed, totalMs } leaves the database.
 * `result`, `error` and `reasoning` are not trimmed later — they are never
 * selected, so the largest column and the one place retrieved customer data
 * lands cannot reach the model even by accident.
 *
 * Everything below the two queries is pure, so the shaping can be tested
 * without a database.
 */

/** Caps the prompt, and matches the curator's own sample cap on claw so the
 *  share it reports is a fraction of the same set we count. The newest runs are
 *  kept — an agent's recent use is what a routing artifact should describe. */
export const MAX_SAMPLES = 80;
/** Callers scanned for delegations. Delegation is rare per caller run, so this
 *  is a bound on work, not on findings. */
const MAX_CALLER_RUNS = 400;
/** A task is a request, not a document; the tail is context, not the ask. */
export const MAX_TASK_CHARS = 280;

/** Delegation leaves no run of its own, so this tool name is the only trace of
 *  it. The roster scan reads the same invocations to find agents that are
 *  reached ONLY through a caller. */
export const CALL_AGENT_TOOL = "call-agent";

/** A run still in flight has no outcome yet, and outcome is half the signal —
 *  including one would report an unfinished task as a success. */
const TERMINAL_STATUSES = ["completed", "failed", "cancelled"] as const;

const RUN_SELECT = {
  id: true,
  sessionId: true,
  userId: true,
  agentSlug: true,
  status: true,
  task: true,
  toolsUsed: true,
  rating: true,
  totalMs: true,
  startedAt: true,
} as const;

const CALLER_SELECT = {
  id: true,
  userId: true,
  startedAt: true,
  toolInvocations: true,
} as const;

export interface RunRow {
  id: string;
  sessionId: string;
  userId: string;
  agentSlug: string;
  status: string;
  task: string;
  toolsUsed: string[];
  rating: string | null;
  totalMs: number | null;
  startedAt: Date;
}

export interface CallerRow {
  id: string;
  userId: string;
  startedAt: Date;
  toolInvocations: unknown;
}

const STATUSES: readonly RunStatus[] = ["running", "completed", "failed", "cancelled"];

function asStatus(raw: string): RunStatus {
  return STATUSES.includes(raw as RunStatus) ? (raw as RunStatus) : "completed";
}

function asRating(raw: string | null): RunRating | null {
  return raw === "up" || raw === "down" ? raw : null;
}

/** Identity without the identifier — enough to count distinct people behind a
 *  pattern, useless to anyone reading a log line. */
export function userRef(userId: string): string {
  return hashContent(userId).slice(0, 8);
}

export function toSample(row: RunRow, ref: string): UsageSample {
  return {
    ref,
    task: row.task.trim().slice(0, MAX_TASK_CHARS),
    status: asStatus(row.status),
    rating: asRating(row.rating),
    toolsUsed: row.toolsUsed,
    totalMs: row.totalMs,
    userRef: userRef(row.userId),
    delegated: false,
  };
}

interface CallAgentInvocation {
  task: string;
  isError: boolean;
  durationMs: number | null;
}

function readCallAgent(entry: unknown, agentSlug: string): CallAgentInvocation | null {
  if (!entry || typeof entry !== "object") return null;
  const inv = entry as Record<string, unknown>;
  if (inv["toolName"] !== CALL_AGENT_TOOL) return null;

  const args = inv["args"];
  if (!args || typeof args !== "object") return null;
  const a = args as Record<string, unknown>;
  if (a["agentSlug"] !== agentSlug) return null;

  const task = typeof a["task"] === "string" ? a["task"].trim() : "";
  if (!task) return null;

  return {
    task: task.slice(0, MAX_TASK_CHARS),
    isError: inv["isError"] === true,
    durationMs: typeof inv["durationMs"] === "number" ? Math.round(inv["durationMs"]) : null,
  };
}

/**
 * Delegated work leaves no run of its own — the caller's `toolInvocations`
 * records `call-agent` with `{agentSlug, task}`. Without this scan an agent
 * reached only through the orchestrator would look unused, and a usage file
 * saying so would be worse than no file.
 *
 * `toolsUsed` on the delegated sample is empty on purpose: the caller's tool
 * list is the caller's, and attributing it here would invent capability.
 */
export function delegationSamples(rows: CallerRow[], agentSlug: string, firstRef: number): UsageSample[] {
  const samples: UsageSample[] = [];
  let n = firstRef;

  for (const row of rows) {
    const invocations = Array.isArray(row.toolInvocations) ? row.toolInvocations : [];
    for (const entry of invocations) {
      const call = readCallAgent(entry, agentSlug);
      if (!call) continue;
      samples.push({
        ref: `r${n++}`,
        task: call.task,
        status: call.isError ? "failed" : "completed",
        rating: null,
        toolsUsed: [],
        totalMs: call.durationMs,
        userRef: userRef(row.userId),
        delegated: true,
      });
    }
  }
  return samples;
}

/** Tool frequency in runs, not in calls — a loop that called one tool nine
 *  times is one run's worth of evidence about what the agent does. */
export function summarizeTools(samples: UsageSample[]): ToolUsage[] {
  const runs = new Map<string, number>();
  for (const sample of samples) {
    for (const tool of new Set(sample.toolsUsed)) {
      runs.set(tool, (runs.get(tool) ?? 0) + 1);
    }
  }
  return [...runs.entries()]
    .map(([tool, count]) => ({ tool, runs: count }))
    .sort((a, b) => b.runs - a.runs || a.tool.localeCompare(b.tool));
}

export function distinctUsers(samples: UsageSample[]): number {
  return new Set(samples.map((s) => s.userRef)).size;
}

export function assembleCorpus(
  agentSlug: string,
  window: UsageWindow,
  direct: RunRow[],
  callers: CallerRow[],
  windowRuns: number,
): UsageCorpus {
  const directSamples = direct.map((row, i) => toSample(row, `r${i + 1}`));
  const delegated = delegationSamples(callers, agentSlug, directSamples.length + 1);
  const samples = [...directSamples, ...delegated].filter((s) => s.task.length > 0).slice(0, MAX_SAMPLES);

  return {
    slug: agentSlug,
    window: { start: window.start.toISOString(), end: window.end.toISOString() },
    samples,
    runCount: samples.length,
    windowRuns: Math.max(windowRuns, samples.length),
    distinctUsers: distinctUsers(samples),
    delegatedCount: samples.filter((s) => s.delegated).length,
    toolUsage: summarizeTools(samples),
  };
}

/**
 * Runs that touched a user's private credentials are excluded outright. Their
 * task text is written against data only that user can see, and this file is
 * read by the whole org — the same rule the admin "All Runs" view applies.
 */
export async function extractCorpus(
  orgId: string,
  agentSlug: string,
  window: UsageWindow,
): Promise<UsageCorpus> {
  const startedAt = { gte: window.start, lt: window.end };

  const directWhere = { orgId, agentSlug, usedUserToken: false, startedAt, status: { in: [...TERMINAL_STATUSES] } };

  const [direct, callers, windowRuns] = await Promise.all([
    prisma.agentRun.findMany({
      where: directWhere,
      select: RUN_SELECT,
      orderBy: { startedAt: "desc" },
      take: MAX_SAMPLES,
    }),
    prisma.agentRun.findMany({
      where: {
        orgId,
        usedUserToken: false,
        startedAt,
        agentSlug: { not: agentSlug },
        toolsUsed: { has: CALL_AGENT_TOOL },
        status: { in: [...TERMINAL_STATUSES] },
      },
      select: CALLER_SELECT,
      orderBy: { startedAt: "desc" },
      take: MAX_CALLER_RUNS,
    }),
    prisma.agentRun.count({ where: directWhere }),
  ]);

  return assembleCorpus(agentSlug, window, direct as RunRow[], callers as CallerRow[], windowRuns);
}
