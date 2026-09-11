/**
 * Requirement 7: a heartbeat must see what the reflexes already did.
 *
 * Without this the heartbeat re-derives a period the reflexes have already
 * acted on and answers questions that were answered twenty minutes ago —
 * which reads, in the channel, as an agent that is not paying attention.
 *
 * Two details that are easy to get backwards and both matter:
 *
 *  1. OVERLAP, not containment. A reflex that started BEFORE the heartbeat's
 *     window and ran into it still consumed events the heartbeat is about to
 *     see. Selecting by containment (`startedAt` inside the window) silently
 *     misses exactly the runs most likely to have already handled something.
 *
 *  2. A FAILED reflex covers NOTHING. It woke, it read the events, and it
 *     produced no action — so the heartbeat must treat those events as
 *     untouched. Marking them covered because a run existed is how work
 *     silently disappears.
 */

import { prisma } from "../db.js";
import type { WindowEvent } from "./types.js";

export interface PriorRun {
  kind: string;
  windowStartMs: number;
  windowEndMs: number;
  outcome: string;
  eventCount: number;
  sessionId: string | null;
  startedAt: Date;
  completedAt: Date | null;
  /** The reflex's own answer, when it finished and produced one. */
  result: string | null;
  status: string | null;
  /** True when this run's events should be considered handled. */
  covers: boolean;
}

/** True when a prior run actually did something the heartbeat should not redo. */
function coversItsEvents(outcome: string, runStatus: string | null): boolean {
  // "shadow" runs reason but never post, so they cover nothing a human saw.
  if (outcome !== "ran") return false;
  // Still running counts as covering: the heartbeat must not race it.
  return runStatus === null || runStatus === "running" || runStatus === "completed";
}

/**
 * Load the awakened runs whose window OVERLAPS [startMs, endMs), newest last.
 * `excludeIdempotencyKey` drops the heartbeat's own in-progress row.
 */
export async function loadOverlappingRuns(
  agentId: string,
  startMs: number,
  endMs: number,
  excludeIdempotencyKey?: string,
): Promise<PriorRun[]> {
  const rows = await prisma.agentAwakeningRun.findMany({
    where: {
      agentId,
      windowStartMs: { lt: BigInt(endMs) },
      windowEndMs: { gt: BigInt(startMs) },
      ...(excludeIdempotencyKey ? { idempotencyKey: { not: excludeIdempotencyKey } } : {}),
    },
    orderBy: { startedAt: "asc" },
    take: 50,
  });
  if (rows.length === 0) return [];

  const sessionIds = rows.map((r) => r.sessionId).filter((s): s is string => !!s);
  const runs = sessionIds.length
    ? await prisma.agentRun.findMany({
        where: { sessionId: { in: sessionIds } },
        select: { sessionId: true, status: true, result: true },
      })
    : [];
  const bySession = new Map(runs.map((r) => [r.sessionId, r]));

  return rows.map((r) => {
    const run = r.sessionId ? bySession.get(r.sessionId) : undefined;
    const status = run?.status ?? null;
    return {
      kind: r.kind,
      windowStartMs: Number(r.windowStartMs),
      windowEndMs: Number(r.windowEndMs),
      outcome: r.outcome,
      eventCount: r.eventCount,
      sessionId: r.sessionId,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
      result: run?.result ?? null,
      status,
      covers: coversItsEvents(r.outcome, status),
    };
  });
}

/**
 * Stamp each event with whether a prior run already handled it.
 *
 * An event is covered when it falls inside the window of a run that actually
 * acted. Written onto the event so `grep '"covered":false'` answers "what is
 * genuinely new since the last reflex" in one command.
 */
export function markCoverage(events: WindowEvent[], priors: PriorRun[]): void {
  const covering = priors.filter((p) => p.covers);
  for (const e of events) {
    const by = covering.find((p) => e.atMs > p.windowStartMs && e.atMs <= p.windowEndMs);
    e.covered = Boolean(by);
    e.coveredBy = by ? `${by.kind}@${new Date(by.startedAt).toISOString().slice(11, 19)}` : null;
  }
}

/** The `prior-sessions.md` artifact: what already ran, and what it said. */
export function renderPriorRuns(priors: PriorRun[]): string {
  if (priors.length === 0) {
    return [
      "# Prior awakened runs in this window",
      "",
      "None. Everything in this window is new to you.",
      "",
    ].join("\n");
  }

  const lines = [
    "# Prior awakened runs in this window",
    "",
    "These runs already saw part of this window. Do not redo what they did.",
    "",
    "| # | kind | window | outcome | events | covers |",
    "|---|---|---|---|---:|---|",
  ];

  priors.forEach((p, i) => {
    const from = new Date(p.windowStartMs).toISOString().slice(11, 19);
    const to = new Date(p.windowEndMs).toISOString().slice(11, 19);
    const state = p.completedAt ? p.outcome : `${p.outcome} (IN FLIGHT)`;
    lines.push(`| ${i + 1} | ${p.kind} | ${from}–${to} | ${state} | ${p.eventCount} | ${p.covers ? "yes" : "no"} |`);
  });

  lines.push("");
  priors.forEach((p, i) => {
    lines.push(`## ${i + 1}. ${p.kind} — ${new Date(p.startedAt).toISOString()}`);
    if (!p.covers) {
      lines.push(
        "",
        p.outcome === "shadow"
          ? "_Shadow run: it reasoned but posted nothing, so nobody has seen this. Treat its events as unhandled._"
          : "_This run did not complete successfully. Treat its events as unhandled._",
      );
    }
    if (p.result) {
      lines.push("", "What it said:", "", "```", p.result.slice(0, 4000), "```");
    } else if (p.completedAt) {
      lines.push("", "_It produced no visible output._");
    } else {
      lines.push("", "_Still running. Leave the threads it is working on alone._");
    }
    lines.push("");
  });

  return lines.join("\n");
}
