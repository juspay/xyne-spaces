import { bankIdForAgent, getMemoryProvider } from "xyne-claw-shared";
import { prisma } from "../db.js";
import { createLogger, createTraceId } from "../logger.js";

const logger = createLogger("memory-retention", createTraceId());
const memory = getMemoryProvider();

const DAY_MS = 86_400_000;
const PAGE_SIZE = 500;
const DEFAULT_MIN_AGE_DAYS = 14;
const DEFAULT_MAX_INVALIDATIONS = 2_000;
// Every upload source must be listed, or its memories are permanently exempt
// from the zero-hit sweep and accumulate forever (PR #333 added opencode/codex
// uploads without extending this set).
const RETAINABLE_SOURCE_TAGS = new Set([
  "source:session-ingest",
  "source:claude-upload",
  "source:opencode-upload",
  "source:codex-upload",
]);
const WARMUP_TAG = "warmup-tuning";

/**
 * Hindsight 0.8.x "Curate memory unit" contract. The official API reference
 * documents lowercase `state: "invalidated"`; keeping it in one constant
 * makes a future provider contract change a one-line edit.
 * https://hindsight.vectorize.io/api-reference
 */
export const HINDSIGHT_INVALIDATE_BODY = Object.freeze({
  state: "invalidated",
  reason: "xyne memory retention: unused ingest fact",
});

export interface RetentionSweepOptions {
  dryRun: boolean;
  maxInvalidations?: number;
}

export interface RetentionSweepSummary {
  scanned: number;
  scored: number;
  invalidated: number;
  kept: number;
  skipped: number;
  examples: string[];
}

interface Utility {
  totalHits: number;
  score: number;
}

type ListedMemory = Awaited<ReturnType<typeof memory.listMemories>>["memories"][number];

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function maxForSweep(value: number | undefined): number {
  if (value === undefined) {
    return positiveInteger(process.env["MEMORY_RETENTION_MAX_PER_SWEEP"], DEFAULT_MAX_INVALIDATIONS);
  }
  if (!Number.isInteger(value) || value < 1) {
    throw new Error("maxInvalidations must be a positive integer");
  }
  return value;
}

function isOptedIn(config: unknown): boolean {
  return !!config && typeof config === "object" && (config as Record<string, unknown>)["memoryRetention"] === "on";
}

async function assertLiveSweepEnabled(agentSlug: string): Promise<void> {
  if (process.env["MEMORY_RETENTION_ENABLED"] !== "1") {
    throw new Error("Live memory retention is disabled (set MEMORY_RETENTION_ENABLED=1)");
  }
  const agents = await prisma.agent.findMany({ where: { slug: agentSlug }, select: { config: true } });
  if (agents.length === 0 || !agents.some((agent) => isOptedIn(agent.config))) {
    throw new Error(`Live memory retention is not opted in for agent '${agentSlug}'`);
  }
}

async function listAllMemories(bankId: string): Promise<ListedMemory[]> {
  const all: ListedMemory[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await memory.listMemories(bankId, { limit: PAGE_SIZE, offset });
    all.push(...page.memories);
    if (page.memories.length < PAGE_SIZE || (typeof page.total === "number" && all.length >= page.total)) break;
  }
  return all;
}

async function utilityByMemory(agentSlug: string, memoryIds: string[], now: Date): Promise<Map<string, Utility>> {
  const result = new Map<string, Utility>();
  const sevenDaysAgo = now.getTime() - 7 * DAY_MS;
  const thirtyDaysAgo = now.getTime() - 30 * DAY_MS;

  // Keep each SQL IN-list modest. The retention target can contain tens of
  // thousands of facts, while recall-hit rows are intentionally read raw so
  // the three recency weights can be applied exactly.
  for (let start = 0; start < memoryIds.length; start += 1_000) {
    const ids = memoryIds.slice(start, start + 1_000);
    const hits = await prisma.memoryRecallHit.findMany({
      where: { agentSlug, hindsightMemoryId: { in: ids } },
      select: { hindsightMemoryId: true, recalledAt: true },
    });
    for (const hit of hits) {
      const current = result.get(hit.hindsightMemoryId) ?? { totalHits: 0, score: 0 };
      const at = hit.recalledAt.getTime();
      current.totalHits += 1;
      current.score += at >= sevenDaysAgo ? 3 : at >= thirtyDaysAgo ? 1 : 0.25;
      result.set(hit.hindsightMemoryId, current);
    }
  }
  return result;
}

async function invalidateMemory(bankId: string, memoryId: string): Promise<void> {
  const baseUrl = (process.env["HINDSIGHT_URL"] ?? "").replace(/\/+$/, "");
  if (!baseUrl) throw new Error("HINDSIGHT_URL is required for a live retention sweep");
  const tenant = process.env["HINDSIGHT_TENANT"] ?? "default";
  const apiKey = process.env["HINDSIGHT_API_KEY"] ?? "";
  const url = `${baseUrl}/v1/${encodeURIComponent(tenant)}/banks/${encodeURIComponent(bankId)}/memories/${encodeURIComponent(memoryId)}`;
  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify(HINDSIGHT_INVALIDATE_BODY),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Hindsight invalidate ${response.status}: ${body.slice(0, 200)}`);
  }
}

/** Score and softly retire low-utility ingest facts. Safe by default at every caller. */
export async function runRetentionSweep(
  agentSlug: string,
  opts: RetentionSweepOptions = { dryRun: true },
): Promise<RetentionSweepSummary> {
  const bankId = bankIdForAgent(agentSlug);
  if (bankId === bankIdForAgent("digital-twin")) {
    throw new Error("Refusing memory retention sweep for the digital-twin bank");
  }
  if (!opts.dryRun) await assertLiveSweepEnabled(agentSlug);

  const now = new Date();
  const minAgeDays = positiveInteger(process.env["MEMORY_RETENTION_MIN_AGE_DAYS"], DEFAULT_MIN_AGE_DAYS);
  const maxInvalidations = maxForSweep(opts.maxInvalidations);
  const memories = await listAllMemories(bankId);
  const facts = memories.filter((item) => item.id && item.factType !== "observation");
  const utility = await utilityByMemory(agentSlug, facts.map((item) => item.id), now);
  const candidates: ListedMemory[] = [];

  for (const fact of facts) {
    const tags = fact.tags ?? [];
    if (tags.includes(WARMUP_TAG)) {
      candidates.push(fact);
      continue;
    }
    const createdAt = fact.createdAt ? Date.parse(fact.createdAt) : Number.NaN;
    const oldEnough = Number.isFinite(createdAt) && now.getTime() - createdAt >= minAgeDays * DAY_MS;
    const fromRetainableSource = tags.some((tag: string) => RETAINABLE_SOURCE_TAGS.has(tag));
    const hits = utility.get(fact.id)?.totalHits ?? 0;
    if (oldEnough && fromRetainableSource && hits === 0) candidates.push(fact);
  }

  // Lowest utility first. Normal candidates all score zero; this still makes
  // the intended utility policy explicit and leaves warmup facts at the front.
  candidates.sort((a, b) => {
    const warmupDelta = Number((b.tags ?? []).includes(WARMUP_TAG)) - Number((a.tags ?? []).includes(WARMUP_TAG));
    return warmupDelta || (utility.get(a.id)?.score ?? 0) - (utility.get(b.id)?.score ?? 0);
  });
  const selected = candidates.slice(0, maxInvalidations);
  const droppedByCap = candidates.length - selected.length;
  if (droppedByCap > 0) {
    logger.warn("[memory-retention] Candidates dropped by per-sweep cap", {
      agentSlug, candidates: candidates.length, maxInvalidations, droppedByCap,
    });
  }

  let invalidated = 0;
  for (const fact of selected) {
    if (!opts.dryRun) await invalidateMemory(bankId, fact.id);
    invalidated += 1;
  }

  const examples = selected.slice(0, 10).map((fact) => fact.content.replace(/\s+/g, " ").trim().slice(0, 120));
  const summary: RetentionSweepSummary = {
    scanned: memories.length,
    scored: facts.length,
    invalidated,
    kept: facts.length - invalidated,
    skipped: memories.length - facts.length,
    examples,
  };
  logger.info(opts.dryRun ? "[memory-retention] Dry-run sweep complete" : "[memory-retention] Live sweep complete", {
    agentSlug, minAgeDays, maxInvalidations, droppedByCap, ...summary,
  });
  return summary;
}
