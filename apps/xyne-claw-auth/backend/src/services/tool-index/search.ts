import { parseToolsConfig, riskAtOrBelow, SUBAGENT_DEFINITIONS, type RecalledMemory, type TagGroup } from "xyne-claw-shared";
import { prisma } from "../../db.js";
import { ensureToolIndexBank, memory, memoryEnabled } from "./bank.js";
import { classifyToolRisk } from "xyne-claw-shared";
import { extractParams, integrationOf, readToolTag } from "./render.js";
import type { RiskLevel, ToolMatch } from "./types.js";

/**
 * Search stage: a need in natural language becomes a ranked shortlist of tools.
 * Ranking uses Hindsight's own fused `scores.final` directly — no re-ranking here.
 */

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

/**
 * Caps how much text recall returns, which sets the candidate pool size for ranking.
 * `budget` does not control this — only `maxTokens` widens the pool.
 */
const RECALL_MAX_TOKENS = (() => {
  const n = Number(process.env["TOOL_INDEX_RECALL_MAX_TOKENS"]);
  return Number.isFinite(n) && n > 0 ? n : 40_000;
})();

export interface SearchToolsOpts {
  /** Restrict to these integrations (`google`, `github`, …). */
  integrations?: string[];
  /** Ceiling, not an exact match: "write" admits read and write, never destructive. */
  maxRisk?: RiskLevel;
  /** Drops disabled tools by default — a disabled tool can't be called. */
  includeDisabled?: boolean;
  limit?: number;
  /** Counts how many of this org's agents already hold each match. */
  orgId?: string;
}

/**
 * Filters go in as tags for the provider, not applied as a post-filter here —
 * recall already truncates to its best N, so filtering after would misreport
 * a truncated set as "no tools match".
 */
function filterGroup(opts: SearchToolsOpts): TagGroup {
  const groups: TagGroup[] = [{ tags: ["kind:tool"], match: "any" }];
  if (opts.integrations?.length) {
    groups.push({ tags: opts.integrations.map((i) => `integration:${i}`), match: "any" });
  }
  if (opts.maxRisk) {
    groups.push({ tags: riskAtOrBelow(opts.maxRisk).map((r) => `risk:${r}`), match: "any" });
  }
  if (!opts.includeDisabled) {
    groups.push({ tags: ["enabled:true"], match: "any" });
  }
  return groups.length === 1 ? groups[0]! : { and: groups };
}

function rankScore(m: RecalledMemory): number {
  return m.scores?.final ?? m.score ?? 0;
}

/** Groups chunk hits into per-tool matches; a tool is scored by its best chunk,
 *  never the sum — summing would reward a long description for producing more
 *  chunks rather than for being a better answer. */
export function rankBySlug(results: RecalledMemory[]): Array<{ slug: string; score: number }> {
  const best = new Map<string, number>();
  for (const hit of results) {
    const slug = readToolTag(hit.tags);
    if (!slug) continue;
    const score = rankScore(hit);
    if (score > (best.get(slug) ?? -Infinity)) best.set(slug, score);
  }
  return [...best.entries()]
    .map(([slug, score]) => ({ slug, score }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Reads tool rows from Postgres rather than the bank — params are structure,
 * and reconstructing them by parsing the rendered document would be a
 * second, lossier source of truth.
 */
async function enrich(ranked: Array<{ slug: string; score: number }>, orgId?: string): Promise<ToolMatch[]> {
  const slugs = ranked.map((r) => r.slug);
  const rows = await prisma.tool.findMany({
    where: { slug: { in: slugs } },
    select: { slug: true, name: true, description: true, source: true, inputSchema: true },
  });
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  const grants = orgId ? await grantCounts(rows, orgId) : new Map<string, number>();

  return ranked.flatMap(({ slug, score }) => {
    const row = bySlug.get(slug);
    // Row deleted since the bank was last synced — drop rather than offer a dead tool.
    if (!row) return [];
    return [{
      slug: row.slug,
      name: row.name,
      integration: integrationOf(row.source),
      description: row.description,
      risk: classifyToolRisk(row.name),
      params: extractParams(row.inputSchema),
      score,
      ...(orgId ? { grantedToAgents: grants.get(slug) ?? 0 } : {}),
    }];
  });
}

/**
 * How many of the org's agents already hold each tool.
 *
 * Reads both the `agent_tools` join table and agent configs — the join table is
 * never written for MCP server tools, so a tool granted only via
 * `config.tools.subagents` would undercount to zero without also parsing configs.
 * Four grant paths: `subagents[]` (wrapper name or def-less serverType, covers
 * every tool that server exposes), `custom[]` (tool slug), `direct[]` (tool
 * name), and the join rows.
 *
 * A grant count, not a usage count.
 */
async function grantCounts(
  tools: Array<{ slug: string; name: string; source: string }>,
  orgId: string,
): Promise<Map<string, number>> {
  if (tools.length === 0) return new Map();

  const [agents, joins] = await Promise.all([
    prisma.agent.findMany({ where: { orgId }, select: { config: true } }),
    prisma.agentTool.findMany({
      where: { tool: { slug: { in: tools.map((t) => t.slug) } }, agent: { orgId } },
      select: { tool: { select: { slug: true } } },
    }),
  ]);

  // serverType -> every name that grants it. A def-less server is granted by its own type.
  const grantNames = new Map<string, Set<string>>();
  for (const def of SUBAGENT_DEFINITIONS) {
    const set = grantNames.get(def.serverType) ?? new Set<string>([def.serverType]);
    set.add(def.name);
    grantNames.set(def.serverType, set);
  }

  const counts = new Map<string, number>();
  const bump = (slug: string): void => {
    counts.set(slug, (counts.get(slug) ?? 0) + 1);
  };
  for (const join of joins) bump(join.tool.slug);

  for (const agent of agents) {
    const cfg = parseToolsConfig(agent.config as Record<string, unknown>);
    if (!cfg) continue;
    const subagents = new Set(cfg.subagents ?? []);
    const custom = new Set(cfg.custom ?? []);
    const direct = new Set(cfg.direct ?? []);

    for (const tool of tools) {
      const serverType = tool.source.startsWith("mcp:") ? tool.source.slice("mcp:".length) : null;
      const units = serverType ? (grantNames.get(serverType) ?? new Set([serverType])) : null;
      if ((units && [...units].some((u) => subagents.has(u))) || custom.has(tool.slug) || direct.has(tool.name)) {
        bump(tool.slug);
      }
    }
  }
  return counts;
}

/** Semantic search over the catalog. Empty when no memory backend is configured
 *  — callers fall back to a plain listing rather than failing the request. */
export async function searchTools(need: string, opts: SearchToolsOpts = {}): Promise<ToolMatch[]> {
  if (!memoryEnabled()) return [];
  const bankId = await ensureToolIndexBank();

  const results = await memory().recall(bankId, need, {
    budget: "high",
    maxTokens: RECALL_MAX_TOKENS,
    tagGroups: filterGroup(opts),
  });

  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  return enrich(rankBySlug(results).slice(0, limit), opts.orgId);
}

/**
 * The same shortlist without a query: the catalog, filtered.
 * Reads Postgres, not the bank — listing has no relevance to rank by, and this
 * keeps it working when the memory backend is down.
 */
export async function listTools(opts: SearchToolsOpts = {}): Promise<ToolMatch[]> {
  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const allowedRisk = opts.maxRisk ? new Set(riskAtOrBelow(opts.maxRisk)) : null;

  const rows = await prisma.tool.findMany({
    where: {
      ...(opts.includeDisabled ? {} : { enabled: true }),
      ...(opts.integrations?.length
        ? { OR: opts.integrations.flatMap((i) => [{ source: i }, { source: `custom:${i}` }, { source: `mcp:${i}` }]) }
        : {}),
    },
    select: { slug: true, name: true, description: true, source: true, inputSchema: true },
    orderBy: [{ source: "asc" }, { name: "asc" }],
  });

  const matches = rows
    .map((row) => ({
      slug: row.slug,
      name: row.name,
      integration: integrationOf(row.source),
      description: row.description,
      risk: classifyToolRisk(row.name),
      params: extractParams(row.inputSchema),
      score: 0,
    }))
    .filter((m) => !allowedRisk || allowedRisk.has(m.risk));

  const page = matches.slice(0, limit);
  if (!opts.orgId) return page;
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  const grants = await grantCounts(page.flatMap((m) => bySlug.get(m.slug) ?? []), opts.orgId);
  return page.map((m) => ({ ...m, grantedToAgents: grants.get(m.slug) ?? 0 }));
}
