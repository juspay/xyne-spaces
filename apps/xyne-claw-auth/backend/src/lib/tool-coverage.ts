/**
 * Palette and schema hygiene: which granted tools are never called, and which
 * declared tool parameters the model never supplies.
 *
 * Both signals answer "is this agent's tool surface bigger than it needs to
 * be" — unused grants and dead parameters are the two forms of bloat that
 * degrade tool selection without ever showing up in a latency chart.
 *
 * ── Two deliberate implementation choices ─────────────────────────────────
 * 1. Dead-TOOL detection reads `agent_runs.toolsUsed`, a plain `text[]`
 *    column, NOT the `toolInvocations` JSONB blob. It carries exactly the
 *    observed tool names we need and costs no TOAST detoast, making this the
 *    cheapest signal in the metrics set.
 *
 * 2. Field presence comes from the precomputed `agent_runs.toolStats` column
 *    (see lib/tool-stats.ts), not from unnesting the invocations blob. Only
 *    the declared-schema join below still reads a table directly.
 *
 * 3. Grant matching happens in TypeScript via `findUnusedGrants` from
 *    xyne-claw-shared, not in SQL. The runtime grant matcher
 *    (tool-resolution.ts `matchesDirectPick`) is a five-convention fuzzy match
 *    explicitly marked "do not simplify"; reimplementing it as SQL string
 *    predicates would drift from the authorization path it is meant to
 *    describe. The shared helper keeps one implementation of the conventions.
 *
 * ── Coverage limit on dead FIELDS, stated rather than hidden ──────────────
 * The declared-schema join is restricted to `tools.source LIKE 'custom:%'`,
 * the only family where the recorded tool name equals `tools.slug` by exact
 * equality. MCP runtime names embed the mutable `McpServer.name` through a
 * lossy sanitisation regex while `tools.slug` embeds `McpServer.type`;
 * builtin rows carry an empty `{}` schema; subagent-wrapper, knowledge-base
 * and gateway tools have no `tools` row at all. Widening the join would
 * produce confident nonsense for those families, so callers surface the
 * covered subset explicitly instead.
 */

import { Prisma } from "@prisma/client";
import { findUnusedGrants, parseToolsConfig, type AgentToolsConfig } from "xyne-claw-shared";
import { prisma } from "../db.js";
import { runAnalytics, windowPredicate, type AnalyticsWindow } from "./tool-metrics.js";
import { fetchToolFieldUsage } from "./tool-stats-read.js";

export interface UnusedGrantRow {
  agentSlug: string;
  kind: keyof AgentToolsConfig;
  grant: string;
}

export interface DeadToolReport {
  /** Agents that declared a tools config and therefore can be analysed. */
  agentsAnalysed: number;
  /** Agents with no `config.tools` at all — every tool is allowed, so "unused" is undefined for them. */
  agentsUnscoped: number;
  unusedGrants: UnusedGrantRow[];
  /** Every agent that ran in the window — clean, dirty and unscoped alike. */
  agents: AgentToolCoverageRow[];
}

/**
 * Grants that never produced a tool call in the window.
 *
 * An agent with no `config.tools` is reported as unscoped rather than as
 * having zero dead grants: `authorize()` treats a missing config as
 * "everything allowed", so there is no declared palette to compare against.
 */
/**
 * One row per agent that ran in the window.
 *
 * The flat `unusedGrants` list alone could only ever show agents that HAVE an
 * unused grant, so an agent with a perfectly tight palette was indistinguishable
 * from one that never ran. This lists every analysed agent, including the clean
 * ones and the unscoped ones, which is what makes it a coverage report rather
 * than a problem list.
 */
export interface AgentToolCoverageRow {
  agentSlug: string;
  /** Distinct tools the agent actually called in the window. */
  observedTools: number;
  /**
   * False when the agent has no `tools` config — every tool is allowed, so
   * "granted" and "unused" are undefined for it rather than zero.
   */
  scoped: boolean;
  granted: number | null;
  used: number | null;
  unused: number | null;
  /** 0..1 share of grants exercised. Null when unscoped. */
  usedShare: number | null;
}

export async function fetchDeadTools(w: AnalyticsWindow): Promise<DeadToolReport> {
  const observedRows = await runAnalytics<{ agent_slug: string; observed: string[] }>(Prisma.sql`
    SELECT r."agentSlug" AS agent_slug, array_agg(DISTINCT t) AS observed
    FROM "agent_runs" r, LATERAL unnest(r."toolsUsed") t
    WHERE ${windowPredicate(w)}
    GROUP BY 1
  `);

  if (observedRows.length === 0) {
    return { agentsAnalysed: 0, agentsUnscoped: 0, unusedGrants: [], agents: [] };
  }

  const agents = await prisma.agent.findMany({
    where: { slug: { in: observedRows.map((r) => r.agent_slug) } },
    select: { slug: true, config: true },
  });
  const configBySlug = new Map(
    agents.map((a) => [a.slug, parseToolsConfig(a.config as Record<string, unknown> | null)]),
  );

  const unusedGrants: UnusedGrantRow[] = [];
  const agentRows: AgentToolCoverageRow[] = [];
  let agentsAnalysed = 0;
  let agentsUnscoped = 0;

  for (const row of observedRows) {
    const cfg = configBySlug.get(row.agent_slug);
    const observedTools = new Set(row.observed ?? []).size;

    if (!cfg) {
      agentsUnscoped += 1;
      agentRows.push({
        agentSlug: row.agent_slug,
        observedTools,
        scoped: false,
        granted: null,
        used: null,
        unused: null,
        usedShare: null,
      });
      continue;
    }

    agentsAnalysed += 1;
    const unused = findUnusedGrants(cfg, row.observed ?? []);
    for (const { kind, grant } of unused) {
      unusedGrants.push({ agentSlug: row.agent_slug, kind, grant });
    }
    const granted = GRANT_KINDS.reduce((total, kind) => total + (cfg[kind]?.length ?? 0), 0);
    agentRows.push({
      agentSlug: row.agent_slug,
      observedTools,
      scoped: true,
      granted,
      used: granted - unused.length,
      unused: unused.length,
      usedShare: granted > 0 ? (granted - unused.length) / granted : null,
    });
  }

  // Worst palette hygiene first — that is the row worth acting on.
  agentRows.sort((a, b) => (b.unused ?? -1) - (a.unused ?? -1) || a.agentSlug.localeCompare(b.agentSlug));

  return { agentsAnalysed, agentsUnscoped, unusedGrants, agents: agentRows };
}

const GRANT_KINDS = ["subagents", "direct", "custom", "gateway"] as const;

export interface ArgFieldRow {
  field: string;
  callsWithField: number;
  /** Share of this tool's calls that supplied the field, 0..1. */
  supplyRate: number;
  /** True when the field is declared in the tool's inputSchema. */
  declared: boolean;
  /** True when the tool's inputSchema marks it required. */
  required: boolean;
}

export interface ToolArgUsageRow {
  tool: string;
  calls: number;
  /** Null when the tool has no joinable declared schema — see the module header. */
  schemaCovered: boolean;
  fields: ArgFieldRow[];
  /** Declared fields the model never supplied once in the window. */
  deadFields: string[];
  /** Supplied fields absent from the declared schema. */
  undeclaredFields: string[];
}

interface SchemaShape {
  properties: Set<string>;
  required: Set<string>;
}

function readSchema(raw: unknown): SchemaShape | null {
  if (!raw || typeof raw !== "object") return null;
  const schema = raw as { properties?: unknown; required?: unknown };
  if (!schema.properties || typeof schema.properties !== "object") return null;
  const properties = new Set(Object.keys(schema.properties as Record<string, unknown>));
  if (properties.size === 0) return null;
  const required = new Set(
    Array.isArray(schema.required) ? schema.required.filter((r): r is string => typeof r === "string") : [],
  );
  return { properties, required };
}

/**
 * Per-tool argument field usage, and the declared fields the model never
 * supplies.
 *
 * Field presence now comes from the precomputed `toolStats.f` map rather than
 * from unnesting the invocations blob (~948ms before). The declared-schema side
 * is a small join against the `tools` catalog, unchanged.
 *
 * `schemaCovered` is false wherever no declared schema could be joined; those
 * rows still carry observed field rates but cannot report dead fields, and a
 * caller must not render their empty `deadFields` as "no dead fields".
 */
/**
 * Argument usage per tool, for the most-called `limit` tools.
 *
 * The cap is reported rather than applied silently: a list that says "all
 * tools" while showing 60 of 900 is a false clean bill of health for the 840 it
 * omitted. Ordered by call volume, so the omitted tail is the rarely-used end.
 */
export interface ToolArgUsagePage {
  rows: ToolArgUsageRow[];
  /** More tools have argument data than were returned. */
  truncated: boolean;
  limit: number;
}

export async function fetchToolArgUsage(w: AnalyticsWindow, limit = 60): Promise<ToolArgUsagePage> {
  const usage = await fetchToolFieldUsage(w, limit * 20);
  if (usage.length === 0) return { rows: [], truncated: false, limit };

  const observedTools = [...new Set(usage.map((u) => u.tool))];
  const catalog = await prisma.tool.findMany({
    where: { slug: { in: observedTools }, source: { startsWith: "custom:" } },
    select: { slug: true, inputSchema: true },
  });
  const schemaBySlug = new Map(catalog.map((t) => [t.slug, readSchema(t.inputSchema)]));

  const byTool = new Map<string, ToolArgUsageRow>();
  for (const row of usage) {
    const schema = schemaBySlug.get(row.tool) ?? null;
    let entry = byTool.get(row.tool);
    if (!entry) {
      entry = {
        tool: row.tool,
        calls: row.calls,
        schemaCovered: schema !== null,
        fields: [],
        deadFields: [],
        undeclaredFields: [],
      };
      byTool.set(row.tool, entry);
    }
    entry.fields.push({
      field: row.field,
      callsWithField: row.callsWithField,
      supplyRate: row.supplyRate,
      declared: schema ? schema.properties.has(row.field) : false,
      required: schema ? schema.required.has(row.field) : false,
    });
  }

  for (const entry of byTool.values()) {
    const schema = schemaBySlug.get(entry.tool) ?? null;
    if (!schema) continue;
    const supplied = new Set(entry.fields.map((f) => f.field));
    entry.deadFields = [...schema.properties].filter((p) => !supplied.has(p)).sort();
    entry.undeclaredFields = [...supplied].filter((sup) => !schema.properties.has(sup)).sort();
  }

  const all = [...byTool.values()];
  return { rows: all.slice(0, limit), truncated: all.length > limit, limit };
}
