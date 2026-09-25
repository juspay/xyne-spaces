import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { oneLineDescription, type ToolCatalogItem } from "./tool-catalog.js";

export const ACTIVE_TOOL_CAP_DEFAULT = 25;
const ACTIVE_TOOL_CAP_FLOOR = 10;
const USAGE_RANK_MAX = 200;
const DEMOTED_CATALOG_FALLBACK = "agent-tools";

export interface ActiveToolCapPlan {
  outcome: "under-cap" | "no-usage" | "capped";
  cap: number;
  total: number;
  budget: number;
  keep: string[];
  demote: string[];
}

export function activeToolCap(agentConfig: Record<string, unknown> | undefined): number {
  const fromAgent = Number(agentConfig?.["activeToolCap"]);
  if (Number.isInteger(fromAgent) && fromAgent >= ACTIVE_TOOL_CAP_FLOOR) return fromAgent;
  const fromEnv = Number(process.env["XYNE_ACTIVE_TOOL_CAP"]);
  if (Number.isInteger(fromEnv) && fromEnv >= ACTIVE_TOOL_CAP_FLOOR) return fromEnv;
  return ACTIVE_TOOL_CAP_DEFAULT;
}

export function readToolUsageRank(agentConfig: Record<string, unknown> | undefined): string[] {
  const raw = agentConfig?.["toolUsageRank"];
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((n): n is string => typeof n === "string" && n.length > 0))].slice(0, USAGE_RANK_MAX);
}

export function planActiveToolCap(params: {
  activeNames: string[];
  demotable: ReadonlySet<string>;
  pinned: ReadonlySet<string>;
  usageRank: string[];
  cap: number;
  fixedExtra: number;
}): ActiveToolCapPlan {
  const activeNames = [...new Set(params.activeNames)];
  const total = activeNames.length + params.fixedExtra;
  const base = { cap: params.cap, total, keep: activeNames, demote: [] as string[] };
  if (total <= params.cap) return { ...base, outcome: "under-cap", budget: total };
  if (params.usageRank.length === 0) return { ...base, outcome: "no-usage", budget: total };

  const candidates = activeNames.filter((n) => params.demotable.has(n) && !params.pinned.has(n));
  const fixed = total - candidates.length;
  const budget = Math.max(0, params.cap - fixed);
  const rank = new Map(params.usageRank.map((name, i) => [name, i]));
  const ordered = candidates
    .map((name, i) => ({ name, i, r: rank.get(name) ?? Number.POSITIVE_INFINITY }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((c) => c.name);
  const kept = new Set(ordered.slice(0, budget));
  const demote = ordered.slice(budget);
  return {
    outcome: "capped",
    cap: params.cap,
    total,
    budget,
    keep: activeNames.filter((n) => !params.demotable.has(n) || params.pinned.has(n) || kept.has(n)),
    demote,
  };
}

export function demotedCatalogName(toolName: string): string {
  const idx = toolName.indexOf("__");
  return idx > 0 ? toolName.slice(0, idx) : DEMOTED_CATALOG_FALLBACK;
}

export function demotedCatalogItem(tool: ToolDefinition, isWrite: boolean): ToolCatalogItem {
  const catalog = demotedCatalogName(tool.name);
  return {
    tool,
    entry: {
      name: tool.name,
      oneLineDescription: oneLineDescription(tool),
      source: `agent:${catalog}`,
      catalog,
      ...(isWrite ? { isWrite: true } : {}),
    },
  };
}
