/**
 * Agent-config introspection tools — read-only, claw-auth-executed (no upstream
 * connector / no credentials). Surfaced under the synthetic `claw-builtin`
 * server type alongside webfetch, and catalogued as System Tools
 * (source `custom:agent-introspect`) so an agent opts in by selecting them into
 * `config.tools.custom[]`. Execution is handled inline in /mcp/call.
 *
 * Purpose: lets an "agent-config advisor" agent inspect LIVE agents and the real
 * tool/subagent catalog so it can recommend what tools/subagents to add. Strictly
 * advisory — these tools never mutate config. Secrets (signing secrets, app/OAuth
 * tokens, encrypted creds) are never returned.
 */

import { prisma } from "../../db.js";
import type { McpToolInfo } from "../types.js";
import { AGENT_INTROSPECT_TOOL_DEFS } from "xyne-claw-shared";

import { createLogger } from "../../logger.js";
import { findAgents, INDEX_KINDS, type IndexKind } from "../../services/agent-index/index.js";
import { listTools, searchTools } from "../../services/tool-index/index.js";
const log = createLogger("agent-introspect");

// Slugs MUST match the `tools` rows seeded by the add_agent_introspect_tools
// migration AND the customGroups slug the frontend writes into tools.custom[]
// AND the runtime selectionKey gate. Keep name === selectionKey (like webfetch).
// Definitions live in the shared registry (single source of truth — the same
// catalog bootstrap-tools seeds into the `tool` table so the Toolbox picker
// can offer them). This adapter derives its wire shape from those defs and
// owns ONLY the execution handlers below.
export const AGENT_INTROSPECT_TOOLS: McpToolInfo[] = AGENT_INTROSPECT_TOOL_DEFS.map((d) => ({
  name: d.slug,
  description: d.description,
  inputSchema: d.inputSchema as unknown as McpToolInfo["inputSchema"],
  selectionKey: d.slug,
}));

export const AGENT_INTROSPECT_TOOL_NAMES = AGENT_INTROSPECT_TOOLS.map((t) => t.name);

function toolsSummary(config: unknown): Record<string, unknown> {
  const tools = (config as { tools?: Record<string, unknown> } | null)?.tools ?? {};
  const arr = (k: string) => (Array.isArray((tools as Record<string, unknown>)[k]) ? ((tools as Record<string, unknown>)[k] as unknown[]) : []);
  return {
    subagents: arr("subagents"),
    direct: arr("direct"),
    custom: arr("custom"),
    gateway: arr("gateway"),
  };
}

export async function handleListAgents(params: Record<string, unknown>, contextOrgId?: string): Promise<string> {
  const enabledOnly = params["enabledOnly"] === true;
  if (!contextOrgId) {
    log.warn("[agent-introspect] refusing list_agents without contextOrgId");
    return JSON.stringify({ count: 0, agents: [] });
  }
  const rows = await prisma.agent.findMany({
    where: enabledOnly ? { orgId: contextOrgId, enabled: true } : { orgId: contextOrgId },
    select: {
      slug: true,
      name: true,
      description: true,
      scope: true,
      enabled: true,
      modelId: true,
      kbScope: true,
      config: true,
      skills: { select: { skill: { select: { slug: true, name: true } } } },
      _count: { select: { collections: true } },
    },
    orderBy: { slug: "asc" },
  });
  const agents = rows.map((a) => ({
    slug: a.slug,
    name: a.name,
    description: a.description,
    scope: a.scope,
    enabled: a.enabled,
    modelId: a.modelId,
    kbScope: a.kbScope,
    tools: toolsSummary(a.config),
    skills: a.skills.map((s) => s.skill.slug),
    kbGrants: a._count.collections,
  }));
  return JSON.stringify({ count: agents.length, agents });
}

export async function handleGetAgentConfig(params: Record<string, unknown>, contextOrgId?: string): Promise<string> {
  const slug = String(params["slug"] ?? "").trim();
  if (!slug) return JSON.stringify({ error: "`slug` is required" });
  if (!contextOrgId) {
    log.warn(`[agent-introspect] refusing get_agent_config without contextOrgId slug=${slug}`);
    return JSON.stringify({ error: "contextOrgId is required" });
  }
  const select = {
    slug: true,
    name: true,
    description: true,
    scope: true,
    enabled: true,
    modelId: true,
    kbScope: true,
    systemPrompt: true,
    config: true,
    skills: { select: { skill: { select: { slug: true, name: true, description: true } } } },
    collections: { select: { collectionId: true, fileId: true } },
  } as const;
  const row = await prisma.agent.findUnique({
    where: { orgId_slug: { orgId: contextOrgId, slug } },
    select,
  });
  if (!row) {
    log.warn(`[agent-introspect/get-agent-config] agent org-scoped miss slug=${slug} orgId=${contextOrgId ?? "none"}`);
    return JSON.stringify({ error: `No agent with slug "${slug}"` });
  }
  // Secrets (signingSecret, spacesAppToken, provider creds) are intentionally
  // not selected, so they can never leak through this tool.
  return JSON.stringify({
    slug: row.slug,
    name: row.name,
    description: row.description,
    scope: row.scope,
    enabled: row.enabled,
    modelId: row.modelId,
    kbScope: row.kbScope,
    systemPrompt: row.systemPrompt,
    config: row.config,
    tools: toolsSummary(row.config),
    skills: row.skills.map((s) => s.skill),
    kbGrants: row.collections,
  });
}

const SEARCH_TOOLS_DEFAULT_LIMIT = 15;
const SEARCH_TOOLS_MAX_LIMIT = 50;
/** Enough to tell two subagents apart; the full text is a `get_agent_config` away. */
const SUBAGENT_DESCRIPTION_CHARS = 160;

function clampText(value: string | null | undefined, max: number): string {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * The catalog, searched or browsed. Replaces `list_available_tools`, which
 * dumped every integration's full tool list regardless of query and grew with
 * every integration connected.
 *
 * Subagent/integration indexes come back only when BROWSING (no query) —
 * folding them into every search response would reintroduce that bloat.
 */
export async function handleSearchTools(
  params: Record<string, unknown>,
  contextOrgId?: string,
): Promise<string> {
  if (!contextOrgId) {
    log.error("[agent-introspect/search-tools] orgId is required; refusing global tools catalog");
    return JSON.stringify({ error: "orgId is required" });
  }

  const query = typeof params["query"] === "string" ? params["query"].trim() : "";
  const rawLimit = Number(params["limit"]);
  const limit = Math.min(
    Math.max(Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : SEARCH_TOOLS_DEFAULT_LIMIT, 1),
    SEARCH_TOOLS_MAX_LIMIT,
  );
  const integration = typeof params["integration"] === "string" ? params["integration"].trim() : "";
  const rawRisk = typeof params["maxRisk"] === "string" ? params["maxRisk"] : "";
  const maxRisk = (["read", "write", "destructive"] as const).find((r) => r === rawRisk);

  const opts = {
    limit,
    orgId: contextOrgId,
    ...(integration ? { integrations: [integration] } : {}),
    ...(maxRisk ? { maxRisk } : {}),
  };

  // Empty search results are ambiguous (no match vs. nothing indexed yet), so
  // fall back to the full listing rather than reporting a catalog as empty.
  const tools = query ? await searchTools(query, opts) : await listTools(opts);
  const matches = query && tools.length === 0 ? await listTools(opts) : tools;

  const rendered = matches.map((t) => ({
    slug: t.slug,
    name: t.name,
    integration: t.integration,
    risk: t.risk,
    description: t.description.replace(/\s+/g, " ").slice(0, 300),
    requiredParams: t.params.filter((p) => p.required).map((p) => p.name),
    grantedToAgents: t.grantedToAgents ?? 0,
  }));

  if (query) {
    return JSON.stringify({
      mode: matches === tools ? "search" : "search-empty-fell-back-to-list",
      tools: rendered,
      note: "Call search_tools with no `query` to browse the full catalog, including subagents and the integration index.",
    });
  }

  // Lazy import: routes/tools imports mcp pieces, so a static import here is a load-order cycle.
  const { buildAvailableToolsCatalog } = await import("../../routes/tools.js");
  const catalog = await buildAvailableToolsCatalog(undefined, contextOrgId);

  return JSON.stringify({
    mode: "list",
    tools: rendered,
    subagents: (catalog.subagents ?? []).map((sa) => ({
      name: sa.name,
      description: clampText(sa.description, SUBAGENT_DESCRIPTION_CHARS),
      serverType: sa.serverType,
    })),
    integrations: (catalog.integrations ?? []).map((i) => ({
      slug: i.slug,
      label: i.label,
      connected: i.connected,
      tools: (i.readTools?.length ?? 0) + (i.writeTools?.length ?? 0),
    })),
  });
}

function parseSampleLimit(value: unknown): number {
  if (value === undefined || value === null) return 5;
  const n = Number(value);
  if (!Number.isFinite(n)) return 5;
  return Math.min(10, Math.max(0, Math.floor(n)));
}

function pct(count: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((count / total) * 1000) / 10;
}

function roundSeconds(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 10) / 10;
}

function percentile(values: number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * fraction;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex]!;
  const upper = sorted[upperIndex]!;
  return lower + (upper - lower) * (position - lowerIndex);
}

export async function handleGetAgentRuns(
  params: Record<string, unknown>,
  contextOrgId?: string,
  requestingUserId?: string,
): Promise<string> {
  const agentSlug = String(params["agentSlug"] ?? "").trim();
  const limit = parseSampleLimit(params["limit"]);
  if (!agentSlug) return JSON.stringify({ error: "`agentSlug` is required" });
  if (!contextOrgId) {
    log.warn(`[agent-introspect] refusing get_agent_runs without contextOrgId agentSlug=${agentSlug}`);
    return JSON.stringify({ error: "contextOrgId is required" });
  }
  if (!requestingUserId) {
    log.warn(`[agent-introspect] refusing get_agent_runs without requestingUserId agentSlug=${agentSlug}`);
    return JSON.stringify({ error: "requestingUserId is required" });
  }

  const agent = await prisma.agent.findUnique({
    where: { orgId_slug: { orgId: contextOrgId, slug: agentSlug } },
    select: { slug: true, name: true },
  });
  if (!agent) {
    log.warn(`[agent-introspect/get-agent-runs] agent org-scoped miss slug=${agentSlug} orgId=${contextOrgId}`);
    return JSON.stringify({ error: `No agent with slug "${agentSlug}"` });
  }

  const windowDays = Math.min(Math.max(Math.trunc(Number(params["days"]) || 30), 1), 90);
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const aggregateRows = await prisma.$queryRaw<Array<{
    total_runs: bigint;
    completed_runs: bigint;
    failed_runs: bigint;
    cancelled_runs: bigint;
    p50_duration_s: number | null;
    p95_duration_s: number | null;
    p50_llm_ms: number | null;
    p50_tool_ms: number | null;
  }>>`
    SELECT
      COUNT(*) AS total_runs,
      COUNT(*) FILTER (WHERE status = 'completed') AS completed_runs,
      COUNT(*) FILTER (WHERE status = 'failed') AS failed_runs,
      COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled_runs,
      PERCENTILE_CONT(0.5) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM ("completedAt" - "startedAt"))
      ) FILTER (WHERE status = 'completed' AND "completedAt" IS NOT NULL) AS p50_duration_s,
      PERCENTILE_CONT(0.95) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM ("completedAt" - "startedAt"))
      ) FILTER (WHERE status = 'completed' AND "completedAt" IS NOT NULL) AS p95_duration_s,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY "llmTotalMs")
        FILTER (WHERE "llmTotalMs" IS NOT NULL) AS p50_llm_ms,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY "toolMs")
        FILTER (WHERE "toolMs" IS NOT NULL) AS p50_tool_ms
    FROM "agent_runs"
    WHERE "agentSlug" = ${agentSlug}
      AND "orgId" = ${contextOrgId}
      AND "startedAt" >= ${since}
      AND (error IS NULL OR error <> 'interrupted (orphaned run)')
  `;
  const aggregate = aggregateRows[0];
  const totalRuns = aggregate ? Number(aggregate.total_runs) : 0;
  const completedRuns = aggregate ? Number(aggregate.completed_runs) : 0;
  const failedRuns = aggregate ? Number(aggregate.failed_runs) : 0;
  const cancelledRuns = aggregate ? Number(aggregate.cancelled_runs) : 0;

  const triggerRows = await prisma.$queryRaw<Array<{ trigger_source: string; count: bigint }>>`
    SELECT "triggerSource" AS trigger_source, COUNT(*) AS count
    FROM "agent_runs"
    WHERE "agentSlug" = ${agentSlug}
      AND "orgId" = ${contextOrgId}
      AND "startedAt" >= ${since}
      AND (error IS NULL OR error <> 'interrupted (orphaned run)')
    GROUP BY "triggerSource"
    ORDER BY count DESC, "triggerSource" ASC
  `;

  // Daily series so a dashboard can show drift; the aggregate above hides a
  // steady climb inside one number. Fetch through Prisma so the org boundary is
  // explicit in the query-builder contract rather than bypassing it with raw SQL.
  const perDaySourceRows = await prisma.agentRun.findMany({
    where: {
      agentSlug,
      orgId: contextOrgId,
      startedAt: { gte: since },
      OR: [
        { error: null },
        { error: { not: "interrupted (orphaned run)" } },
      ],
    },
    select: {
      startedAt: true,
      completedAt: true,
      status: true,
    },
    orderBy: { startedAt: "asc" },
  });

  const perDayBuckets = new Map<string, {
    runs: number;
    failed: number;
    completedDurationsS: number[];
  }>();
  for (const run of perDaySourceRows) {
    const day = run.startedAt.toISOString().slice(0, 10);
    const bucket = perDayBuckets.get(day) ?? { runs: 0, failed: 0, completedDurationsS: [] };
    bucket.runs += 1;
    if (run.status === "failed" || run.status === "cancelled") bucket.failed += 1;
    if (run.status === "completed" && run.completedAt) {
      bucket.completedDurationsS.push((run.completedAt.getTime() - run.startedAt.getTime()) / 1000);
    }
    perDayBuckets.set(day, bucket);
  }

  const sampleRows = await prisma.$queryRaw<Array<{
    task: string;
    status: string;
    started_at: Date;
    duration_s: number | null;
  }>>`
    SELECT
      LEFT(task, 200) AS task,
      status,
      "startedAt" AS started_at,
      CASE
        WHEN "completedAt" IS NOT NULL THEN EXTRACT(EPOCH FROM ("completedAt" - "startedAt"))
        WHEN "totalMs" IS NOT NULL THEN "totalMs" / 1000.0
        ELSE NULL
      END AS duration_s
    FROM "agent_runs"
    WHERE "agentSlug" = ${agentSlug}
      AND "orgId" = ${contextOrgId}
      AND COALESCE("usedUserToken", false) = false
      AND (
        "userId" = ${requestingUserId}
        OR "triggerSource" IN ('scheduled', 'automation')
      )
    ORDER BY "startedAt" DESC
    LIMIT ${limit}
  `;

  return JSON.stringify({
    agentSlug: agent.slug,
    agentName: agent.name,
    windowDays,
    aggregates: {
      totalRuns,
      completedPct: pct(completedRuns, totalRuns),
      failedPct: pct(failedRuns, totalRuns),
      cancelledPct: pct(cancelledRuns, totalRuns),
      p50DurationS: roundSeconds(aggregate?.p50_duration_s),
      p95DurationS: roundSeconds(aggregate?.p95_duration_s),
      p50LlmMs: aggregate?.p50_llm_ms == null ? null : Math.round(aggregate.p50_llm_ms),
      p50ToolMs: aggregate?.p50_tool_ms == null ? null : Math.round(aggregate.p50_tool_ms),
      byTriggerSource: triggerRows.map((r) => ({ triggerSource: r.trigger_source, count: Number(r.count) })),
    },
    perDay: Array.from(perDayBuckets, ([day, bucket]) => ({
      day,
      runs: bucket.runs,
      failed: bucket.failed,
      p50DurationS: roundSeconds(percentile(bucket.completedDurationsS, 0.5)),
      p95DurationS: roundSeconds(percentile(bucket.completedDurationsS, 0.95)),
    })),
    samples: sampleRows.map((r) => ({
      task: r.task,
      status: r.status,
      startedAt: r.started_at,
      durationS: roundSeconds(r.duration_s),
    })),
  });
}

/**
 * Semantic lookup over the agent index. Returns a shortlist with the matching
 * text so the caller can judge fit — a ranked list of bare slugs is the
 * affordance this tool exists to replace.
 */
export async function handleFindAgents(params: Record<string, unknown>, contextOrgId?: string): Promise<string> {
  const taskDescription = String(params["taskDescription"] ?? "").trim();
  if (!taskDescription) return JSON.stringify({ error: "`taskDescription` is required" });
  if (!contextOrgId) {
    log.warn("[agent-introspect] refusing find_agents without contextOrgId");
    return JSON.stringify({ count: 0, agents: [] });
  }

  const limit = Math.min(Math.max(Number(params["maxResults"]) || 5, 1), 20);
  const kinds = stringList(params["searchDocumentKinds"]).filter((k): k is IndexKind =>
    (INDEX_KINDS as readonly string[]).includes(k),
  );
  const requiredToolSlugs = stringList(params["requiredToolSlugs"]);

  try {
    const matches = await findAgents(contextOrgId, taskDescription, {
      limit,
      ...(kinds.length ? { kinds } : {}),
      ...(requiredToolSlugs.length ? { requiresCapability: requiredToolSlugs } : {}),
    });
    return JSON.stringify({
      count: matches.length,
      ...(requiredToolSlugs.length ? { requiredToolSlugs } : {}),
      agents: matches.map((m) => ({
        slug: m.slug,
        score: Number(m.score.toFixed(3)),
        matchedOn: m.matchedKinds,
        purpose: m.identity ?? null,
        usage: m.usage ?? null,
        capabilities: m.capabilities ?? [],
        excerpt: m.evidence,
      })),
    });
  } catch (err) {
    log.warn(`[agent-introspect] find_agents failed: ${err instanceof Error ? err.message : String(err)}`);
    return JSON.stringify({ error: "agent index unavailable", count: 0, agents: [] });
  }
}

function stringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === "string" && v.trim() !== "").map((v) => v.trim());
}

export async function handleAgentIntrospect(
  tool: string,
  params: Record<string, unknown>,
  contextOrgId?: string,
  requestingUserId?: string,
): Promise<string> {
  switch (tool) {
    case "list_agents":
      return handleListAgents(params, contextOrgId);
    case "get_agent_config":
      return handleGetAgentConfig(params, contextOrgId);
    case "search_tools":
      return handleSearchTools(params, contextOrgId);
    case "get_agent_runs":
      return handleGetAgentRuns(params, contextOrgId, requestingUserId);
    case "find_agents":
      return handleFindAgents(params, contextOrgId);
    default:
      log.warn(`[agent-introspect] unknown tool ${tool}`);
      throw new Error(`Unknown agent-introspect tool: ${tool}`);
  }
}
