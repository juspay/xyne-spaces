import { agentRunRepository } from "../repositories/agentRunRepository.js";
import { createLogger } from "../logger.js";
import { errMsg } from "./errors.js";

const log = createLogger("tool-usage-rank");

export const TOOL_USAGE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const TOOL_USAGE_RANK_LIMIT = 100;
export const TOOL_USAGE_MAX_RUNS = 5000;
const CACHE_TTL_MS = 60 * 60 * 1000;
const LOOKUP_TIMEOUT_MS = 1500;

type Loader = (agentSlug: string, orgId: string, since: Date, limit: number) => Promise<string[]>;

interface CacheEntry {
  rank: string[];
  expiresAt: number;
}

export function createToolUsageRankCache(load: Loader, now: () => number = Date.now) {
  const cache = new Map<string, CacheEntry>();
  const inflight = new Map<string, Promise<string[]>>();

  async function lookup(agentSlug: string, orgId: string): Promise<string[]> {
    const key = `${orgId}:${agentSlug}`;
    const hit = cache.get(key);
    if (hit && hit.expiresAt > now()) return hit.rank;
    const pending = inflight.get(key);
    if (pending) return pending;

    const work = (async () => {
      let timer: NodeJS.Timeout | undefined;
      try {
        const rank = await Promise.race([
          load(agentSlug, orgId, new Date(now() - TOOL_USAGE_WINDOW_MS), TOOL_USAGE_RANK_LIMIT),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`timed out after ${LOOKUP_TIMEOUT_MS}ms`)), LOOKUP_TIMEOUT_MS);
          }),
        ]);
        cache.set(key, { rank, expiresAt: now() + CACHE_TTL_MS });
        return rank;
      } catch (err) {
        log.warn(`[tool-usage-rank] ${agentSlug}: ${errMsg(err)} — running without a usage rank`);
        return hit?.rank ?? [];
      } finally {
        if (timer) clearTimeout(timer);
        inflight.delete(key);
      }
    })();
    inflight.set(key, work);
    return work;
  }

  return { lookup, clear: () => cache.clear() };
}

export function rankToolsByRuns(toolLists: string[][], limit: number): string[] {
  const runs = new Map<string, number>();
  for (const tools of toolLists) {
    for (const tool of new Set(tools)) {
      if (tool) runs.set(tool, (runs.get(tool) ?? 0) + 1);
    }
  }
  return [...runs.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, limit)
    .map(([tool]) => tool);
}

const shared = createToolUsageRankCache(async (agentSlug, orgId, since, limit) =>
  rankToolsByRuns(await agentRunRepository.toolsUsedSince(agentSlug, orgId, since, TOOL_USAGE_MAX_RUNS), limit),
);

const CAP_KEY = "active_tool_cap";

function specRequestsCap(spec: unknown): boolean | undefined {
  if (typeof spec === "string") {
    let on: boolean | undefined;
    for (const token of spec.split(",").map((t) => t.trim().toLowerCase())) {
      if (token === "all") on = true;
      else if (token === "none") on = false;
      else if (token === CAP_KEY || token === `+${CAP_KEY}`) on = true;
      else if (token === `-${CAP_KEY}`) on = false;
    }
    return on;
  }
  if (spec && typeof spec === "object" && !Array.isArray(spec)) {
    const value = (spec as Record<string, unknown>)[CAP_KEY];
    return typeof value === "boolean" ? value : undefined;
  }
  return undefined;
}

export function wantsToolUsageRank(agentSpec: unknown, runSpec: unknown): boolean {
  return specRequestsCap(runSpec) ?? specRequestsCap(agentSpec) ?? false;
}

export function toolUsageRankFor(agentSlug: string, orgId: string): Promise<string[]> {
  return shared.lookup(agentSlug, orgId);
}
