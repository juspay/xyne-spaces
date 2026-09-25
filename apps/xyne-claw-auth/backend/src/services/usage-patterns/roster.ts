import { prisma } from "../../db.js";
import { createLogger } from "../../logger.js";
import { CALL_AGENT_TOOL } from "./extract.js";
import type { UsageWindow } from "./types.js";

/**
 * Which agents are worth synthesizing this week.
 *
 * Walking the whole roster is the obvious implementation and the wrong one: an
 * org accumulates test agents, copies and abandoned drafts, and on the first
 * production run that was 556 agents to spend an LLM call on, the large
 * majority of which return `insufficient-corpus` after the work of asking. This
 * selects the agents that have enough evidence to clear the thresholds before
 * anything is enqueued, so the weekly cost tracks real usage rather than roster
 * size. Same idea as the failure curator's "active in the last 24h" scan.
 */

const log = createLogger("usage-patterns-roster");

/** Matches extract.ts: a run still in flight has no outcome to learn from. */
const TERMINAL_STATUSES = ["completed", "failed", "cancelled"] as const;

/**
 * Caller runs read when looking for delegation targets.
 *
 * Bounded because `toolInvocations` is a fat JSON column and this reads it in
 * bulk. Delegation targets repeat heavily across an orchestrator's runs, so the
 * most recent few hundred surface essentially every actively-delegated agent;
 * the count is reported so a truncated scan is visible rather than silent.
 */
const MAX_CALLER_SCAN = Number(process.env["USAGE_PATTERNS_CALLER_SCAN"] ?? 500);

export interface ActiveAgent {
  orgId: string;
  agentSlug: string;
  /** Terminal, non-user-token runs of this agent in the window. */
  directRuns: number;
  /** Times a caller delegated to it in the scanned slice. */
  delegatedRuns: number;
}

export interface ActiveRoster {
  agents: ActiveAgent[];
  /** Before `minRuns` and `limit` were applied. */
  considered: number;
  /** Dropped by `limit`, after sorting by evidence. Never silent. */
  droppedByLimit: number;
  callerRunsScanned: number;
  callerScanTruncated: boolean;
}

function key(orgId: string, agentSlug: string): string {
  return `${orgId} ${agentSlug}`;
}

/**
 * Count delegations per (org, agent) out of callers' recorded tool calls.
 *
 * An agent reached only through the orchestrator has no runs of its own, so a
 * roster built from `agent_runs` alone would skip exactly the agents the
 * delegation scan in extract.ts exists for, and those are the ones a routing
 * artifact most needs to describe.
 */
export function countDelegations(rows: Array<{ orgId: string; toolInvocations: unknown }>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const invocations = Array.isArray(row.toolInvocations) ? row.toolInvocations : [];
    for (const entry of invocations) {
      if (!entry || typeof entry !== "object") continue;
      const inv = entry as Record<string, unknown>;
      if (inv["toolName"] !== CALL_AGENT_TOOL) continue;
      const args = inv["args"];
      if (!args || typeof args !== "object") continue;
      const slug = (args as Record<string, unknown>)["agentSlug"];
      if (typeof slug !== "string" || !slug) continue;
      const k = key(row.orgId, slug);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * Merge direct run counts and delegation counts into one roster.
 *
 * Pure, so the selection rule can be tested without a database: the thresholds
 * and the ordering are the part worth pinning, not the two queries.
 */
export function mergeRoster(
  grouped: Array<{ orgId: string; agentSlug: string; runs: number }>,
  delegations: Map<string, number>,
): Map<string, ActiveAgent> {
  const merged = new Map<string, ActiveAgent>();
  for (const row of grouped) {
    merged.set(key(row.orgId, row.agentSlug), {
      orgId: row.orgId,
      agentSlug: row.agentSlug,
      directRuns: row.runs,
      delegatedRuns: 0,
    });
  }
  for (const [k, count] of delegations) {
    const existing = merged.get(k);
    if (existing) {
      existing.delegatedRuns = count;
      continue;
    }
    // Key format is "<orgId> <slug>"; slugs may contain spaces, org ids cannot.
    const gap = k.indexOf(" ");
    const orgId = k.slice(0, gap);
    const agentSlug = k.slice(gap + 1);
    if (!orgId || !agentSlug) continue;
    merged.set(k, { orgId, agentSlug, directRuns: 0, delegatedRuns: count });
  }
  return merged;
}

/** Busiest first, so a capped run spends the budget where the evidence is. */
export function rankRoster(agents: ActiveAgent[], minRuns: number): ActiveAgent[] {
  return agents
    .filter((a) => a.directRuns + a.delegatedRuns >= minRuns)
    .sort(
      (a, b) =>
        b.directRuns + b.delegatedRuns - (a.directRuns + a.delegatedRuns) ||
        a.agentSlug.localeCompare(b.agentSlug),
    );
}

/**
 * Agents with enough runs in the window to be worth a synthesis pass.
 *
 * `minRuns` is the same floor `synthesizeUsagePatterns` enforces, applied here
 * so an agent that cannot clear it never costs an LLM call. It is a necessary
 * condition, not a sufficient one: the distinct-user threshold still runs
 * inside the pass, because counting distinct users per agent is a second query
 * this does not need to pay for.
 */
export async function activeAgents(opts: {
  window: UsageWindow;
  /** Restrict to one org. Omitted by the weekly cron, which sweeps the fleet. */
  orgId?: string;
  minRuns: number;
  limit?: number;
}): Promise<ActiveRoster> {
  const startedAt = { gte: opts.window.start, lt: opts.window.end };
  const orgScope = opts.orgId ? { orgId: opts.orgId } : {};
  const common = { ...orgScope, usedUserToken: false, startedAt, status: { in: [...TERMINAL_STATUSES] } };

  const [grouped, callers] = await Promise.all([
    prisma.agentRun.groupBy({
      by: ["orgId", "agentSlug"],
      where: common,
      _count: { _all: true },
    }),
    prisma.agentRun.findMany({
      where: { ...common, toolsUsed: { has: CALL_AGENT_TOOL } },
      select: { orgId: true, toolInvocations: true },
      orderBy: { startedAt: "desc" },
      take: MAX_CALLER_SCAN,
    }),
  ]);

  const merged = mergeRoster(
    grouped.map((g) => ({ orgId: g.orgId, agentSlug: g.agentSlug, runs: g._count._all })),
    countDelegations(callers),
  );
  const considered = merged.size;

  // A slug that only exists in old runs is a deleted agent: synthesis would
  // reach the LLM and then have nothing to attach the result to.
  const live = await prisma.agent.findMany({
    where: {
      ...orgScope,
      slug: { in: [...new Set([...merged.values()].map((a) => a.agentSlug))] },
    },
    select: { orgId: true, slug: true },
  });
  const liveKeys = new Set(live.map((a) => key(a.orgId, a.slug)));

  const eligible = rankRoster(
    [...merged.entries()].filter(([k]) => liveKeys.has(k)).map(([, agent]) => agent),
    opts.minRuns,
  );

  const limit = opts.limit && opts.limit > 0 ? opts.limit : eligible.length;
  const agents = eligible.slice(0, limit);
  const droppedByLimit = eligible.length - agents.length;
  if (droppedByLimit > 0) {
    log.warn(`[usage-patterns-roster] limit=${limit} dropped ${droppedByLimit} eligible agent(s)`);
  }
  if (callers.length >= MAX_CALLER_SCAN) {
    log.warn(`[usage-patterns-roster] caller scan hit its ${MAX_CALLER_SCAN}-run cap; a rarely-delegated agent may be missed`);
  }

  return {
    agents,
    considered,
    droppedByLimit,
    callerRunsScanned: callers.length,
    callerScanTruncated: callers.length >= MAX_CALLER_SCAN,
  };
}

/**
 * Every agent in one org, ignoring activity.
 *
 * The escape hatch behind `all: true` on the bulk endpoint: useful roughly once
 * per org, to seed files for agents whose runs predate the feature. Expect most
 * of the resulting passes to skip on `insufficient-corpus`.
 */
export async function allOrgAgents(orgId: string): Promise<ActiveAgent[]> {
  const rows = await prisma.agent.findMany({ where: { orgId }, select: { slug: true }, orderBy: { slug: "asc" } });
  return rows.map((r) => ({ orgId, agentSlug: r.slug, directRuns: 0, delegatedRuns: 0 }));
}
