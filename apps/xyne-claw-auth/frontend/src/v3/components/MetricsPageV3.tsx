/**
 * MetricsPageV3 — workspace-wide agent observability.
 *
 * ── Structure ─────────────────────────────────────────────────────────────
 * A single flat scroll could not hold the per-tool and per-LLM-call data
 * without burying the run-level numbers, so the page is:
 *
 *   filters (sticky) → headline KPIs (always visible) → tabbed detail
 *
 * The KPI row sits ABOVE the tabs deliberately: "is anything wrong right now"
 * must be answerable without first choosing a tab, and it stays on screen while
 * the reader is deep inside a detail panel.
 *
 * The Overview tab keeps every card this page previously had, in the same
 * order. Only the status banner and the two hero durations moved — up into the
 * headline, where they are visible from every tab. The other four tabs are
 * additive and read the precomputed toolStats / llmTurnStats columns.
 *
 * ── Filters ───────────────────────────────────────────────────────────────
 * Range, agent, org scope and tab live in the URL. They used to be local state,
 * so a refresh or a shared link lost the view — the one thing a metrics page
 * gets asked for most ("send me what you're looking at").
 *
 * Each detail tab fetches only while it is open. Loading all five on mount
 * would multiply the request cost for panels the reader may never open.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ResponsiveContainer,
  BarChart, Bar,
  LineChart, Line,
  XAxis, YAxis as RcYAxis, CartesianGrid, Tooltip,
} from "recharts";
import {
  fetchGlobalMetrics, fetchAgentMetrics, listAgents,
  fetchAgentImprovements, applyImprovement, dismissImprovement,
  type GlobalMetrics, type GlobalMetricsDayBucket, type AgentMetrics,
  type SlowSession, type ToolLatencyRow, type AgentSentiment, type GlobalMetricsProviderRow,
  type ImprovementCandidate, type ImprovementBucket, type AdminOrgScope,
  type ToolPageRequest, type ToolSortKey,
} from "../../lib/api";
import { Skeleton } from "./ui/Skeleton";
import { Switch } from "./ui/Switch";
import { Tabs, type TabItem } from "./ui/Tabs";
import { useAdminStatus } from "../hooks/useAdminStatus";
import {
  useLlmCallMetrics,
  useToolCoverageMetrics,
  useToolFailures,
  useToolMetrics,
  useToolQualityMetrics,
  type MetricsDays,
} from "../hooks/useDeepMetrics";
import { HeadlineKpis } from "./metrics/HeadlineKpis";
import { MultiSelect } from "./metrics/MultiSelect";
import { ChartLegend, MetricsCard, UnitBadge, type ServerPaging } from "./metrics/MetricsPrimitives";
import { MetricsTooltip } from "./metrics/MetricsTooltip";
import {
  AXIS_LINE,
  AXIS_TICK,
  MetricsVizTokens,
  NEUTRAL,
  OUTCOME,
  SERIES,
} from "./metrics/metricsPalette";
import { ToolsPanel } from "./metrics/panels/ToolsPanel";
import { LlmCallsPanel } from "./metrics/panels/LlmCallsPanel";
import { QualityPanel } from "./metrics/panels/QualityPanel";
import { CoveragePanel } from "./metrics/panels/CoveragePanel";

interface MetricsPageV3Props {
  userId: string;
}

const DAY_OPTIONS: Array<{ label: string; days: MetricsDays }> = [
  { label: "1d", days: 1 },
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
];

type MetricsTab = "overview" | "tools" | "llm" | "quality" | "coverage";

const TABS: Array<TabItem<MetricsTab>> = [
  { id: "overview", label: "Overview" },
  { id: "tools", label: "Tools" },
  { id: "llm", label: "LLM calls" },
  { id: "quality", label: "Quality" },
  { id: "coverage", label: "Coverage" },
];

function fmtMs(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function fmtPct(p: number | null | undefined): string {
  if (p == null || Number.isNaN(p)) return "—";
  return `${(p * 100).toFixed(1)}%`;
}

function fmtSignedPct(p: number | null | undefined): { label: string; tone: "good" | "bad" | "flat" } {
  if (p == null || Number.isNaN(p)) return { label: "—", tone: "flat" };
  if (Math.abs(p) < 0.001) return { label: "≈0", tone: "flat" };
  const sign = p > 0 ? "+" : "";
  return { label: `${sign}${(p * 100).toFixed(1)}pp`, tone: p > 0 ? "bad" : "good" };
}

/**
 * The run-level view — every card this page carried before the tabs existed,
 * in the same order. Rendering only; the page owns the fetch so the headline
 * KPIs above the tabs can read the same response.
 */
function OverviewTab({
  userId,
  data,
  showLeaderboard,
  onAgentClick,
}: {
  userId: string;
  data: GlobalMetrics | AgentMetrics;
  showLeaderboard: boolean;
  /** Renders leaderboard agents as clickable so the page can pivot to one. */
  onAgentClick?: (agentSlug: string) => void;
}) {
  return (
    <div className="flex flex-col gap-[20px]">
      {showLeaderboard && "byTrigger" in data && (
        <Card title="By trigger" subtitle="User combines Spaces mentions, DMs, and dashboard chat. CLI is API-triggered runs." unit={<UnitBadge aggregation="cumulative" unit="runs" />}>
          <TriggerTiles rows={data.byTrigger} />
        </Card>
      )}
      <TotalsStrip data={data} />
      {showLeaderboard && "byTrigger" in data ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-[20px]">
          <Card title="How many runs each day" subtitle="Bar height = total runs. Stacked by outcome." unit={<UnitBadge aggregation="cumulative" unit="runs / day" />}>
            <SessionsBarChart perDay={data.perDay} />
          </Card>
          <Card title="Daily runs by trigger" subtitle="Same run volume, grouped by how the run started." unit={<UnitBadge aggregation="cumulative" unit="runs / day" />}>
            <TriggerBarChart perDay={data.perDay} />
          </Card>
        </div>
      ) : (
        <Card title="How many runs each day" subtitle="Bar height = total runs. Stacked by outcome." unit={<UnitBadge aggregation="cumulative" unit="runs / day" />}>
          <SessionsBarChart perDay={data.perDay} />
        </Card>
      )}
      {/* Two charts side-by-side so each line gets its own y-axis. When
          p50 and p95 share a scale (p95 is 10-20× larger), the p50 line
          flattens to the baseline and looks broken. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-[20px]">
        <Card title="Typical run time over time" subtitle="p50 — half of runs finished faster than this each day. Watch for upward drift." unit={<UnitBadge aggregation="median" unit="ms / day" />}>
          <SingleLineChart perDay={data.perDay} valueKey="p50TotalMs" color={SERIES[0]} displayName="Typical run (p50)" />
        </Card>
        <Card title="Slow-tail over time" subtitle="p95 — the slowest 5% each day. This is where pain lives." unit={<UnitBadge aggregation="p95" unit="ms / day" />}>
          <SingleLineChart perDay={data.perDay} valueKey="p95TotalMs" color={SERIES[1]} displayName="Slow tail (p95)" />
        </Card>
      </div>
      <Card title="LLM time vs Tool time" subtitle="Mean time per run, split by where it went. If the tool segment grows, tools are dragging things; if the LLM segment grows, the model itself is slow." unit={<UnitBadge aggregation="average" unit="ms / run" />}>
        <SplitChart perDay={data.perDay} />
      </Card>
      {showLeaderboard && "byProvider" in data && (
        <Card title="LLM latency by provider/model" subtitle="Compare provider+model pairs using the same window. Sort by any column to isolate slow tails or unstable providers.">
          <ProviderLatencyTable rows={data.byProvider} />
        </Card>
      )}
      {showLeaderboard && "topAgents" in data && (
        <Card title="Agents leaderboard" subtitle={`Top ${data.topAgents.length} by run count — click a row to drill into one agent`}>
          <AgentTable rows={data.topAgents} onAgentClick={onAgentClick} />
        </Card>
      )}
      {"sentiment" in data && data.sentiment.totalRuns > 0 && (
        <Card title="User sentiment & feedback" subtitle="Explicit ratings + behavioural signals from the same window. Lower bars are better.">
          <SentimentPanel sentiment={data.sentiment} />
        </Card>
      )}
      {"agentSlug" in data && (
        <ImprovementsCard userId={userId} agentSlug={data.agentSlug} />
      )}
      {"toolLatency" in data && data.toolLatency.length > 0 && (
        <Card title="Tool latency for this agent" subtitle={`Top ${data.toolLatency.length} tools by cumulative time — find the one dragging the agent down`}>
          <ToolLatencyTable rows={data.toolLatency} />
        </Card>
      )}
      {data.slowSessions.length > 0 && (
        <Card title="Slowest sessions" subtitle={`Top ${data.slowSessions.length} by total wall-clock — expand a row for the tool breakdown`}>
          <SlowSessionsTable rows={data.slowSessions} showAgent={showLeaderboard} />
        </Card>
      )}
    </div>
  );
}

function SlowSessionsTable({ rows, showAgent }: { rows: SlowSession[]; showAgent: boolean }) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <table className="w-full min-w-[720px] text-[13px]">
        <thead>
          <tr className="text-left text-xyne-fg-muted text-[11px] uppercase tracking-wider">
            <th className="py-2 pr-3 w-8"></th>
            <th className="py-2 pr-3">Session</th>
            {showAgent && <th className="py-2 pr-3">Agent</th>}
            <th className="py-2 pr-3 text-right">Total</th>
            <th className="py-2 pr-3 text-right">LLM</th>
            <th className="py-2 pr-3 text-right">Tool</th>
            <th className="py-2 pr-3 text-right">When</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const open = openId === r.sessionId;
            return (
              <React.Fragment key={r.sessionId}>
                <tr
                  className="border-t border-xyne-border cursor-pointer hover:bg-xyne-bg-secondary/40"
                  onClick={() => setOpenId(open ? null : r.sessionId)}
                >
                  <td className="py-2 pr-3 text-xyne-fg-muted">{open ? "▾" : "▸"}</td>
                  <td className="py-2 pr-3 font-mono text-[12px] text-xyne-fg-primary truncate max-w-[180px]">
                    {r.sessionId}
                  </td>
                  {showAgent && <td className="py-2 pr-3">{r.agentSlug}</td>}
                  <td className="py-2 pr-3 text-right tabular-nums font-medium">{fmtMs(r.totalMs)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{fmtMs(r.llmTotalMs)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{fmtMs(r.toolMs)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-xyne-fg-muted">
                    {new Date(r.completedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </td>
                </tr>
                {open && (
                  <tr className="bg-xyne-bg-secondary/30">
                    <td></td>
                    <td colSpan={showAgent ? 6 : 5} className="py-3 pr-3">
                      {r.task && (
                        <div className="mb-2 text-[12px] text-xyne-fg-muted line-clamp-2">
                          <span className="text-xyne-fg-primary">Task: </span>{r.task}
                        </div>
                      )}
                      <div className="text-[11px] uppercase tracking-wider text-xyne-fg-muted mb-1">Top tools by time</div>
                      {r.topTools.length === 0 ? (
                        <div className="text-[12px] text-xyne-fg-muted">No tool calls recorded.</div>
                      ) : (
                        <table className="w-full text-[12px]">
                          <thead>
                            <tr className="text-left text-xyne-fg-muted">
                              <th className="py-1 pr-3 font-normal">Tool</th>
                              <th className="py-1 pr-3 font-normal text-right">Cumulative</th>
                              <th className="py-1 pr-3 font-normal text-right">Calls</th>
                              <th className="py-1 pr-3 font-normal text-right">Avg</th>
                              <th className="py-1 pr-3 font-normal text-right">Error</th>
                            </tr>
                          </thead>
                          <tbody>
                            {r.topTools.map((t) => (
                              <tr key={t.tool} className="border-t border-xyne-border-subtle">
                                <td className="py-1 pr-3 font-mono text-[12px]">{t.tool}</td>
                                <td className="py-1 pr-3 text-right tabular-nums">{fmtMs(t.ms)}</td>
                                <td className="py-1 pr-3 text-right tabular-nums">{t.calls}</td>
                                <td className="py-1 pr-3 text-right tabular-nums">{fmtMs(Math.round(t.ms / Math.max(t.calls, 1)))}</td>
                                <td className="py-1 pr-3 text-right">
                                  {t.isError ? <span className="text-red-500">⚠</span> : <span className="text-xyne-fg-muted">—</span>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function MetricsPageV3({ userId }: MetricsPageV3Props) {
  const { isAdmin } = useAdminStatus();
  const [params, setParams] = useSearchParams();

  // Filters live in the URL so a refresh or a pasted link restores the exact
  // view. `agent` null = workspace-wide; the leaderboard writes it so a row
  // click pivots without scrolling back to the dropdown.
  const days = parseDays(params.get("range"));
  const selectedAgents = parseList(params.get("agent"));
  const selectedTools = parseList(params.get("tool"));
  // The run-level rollup endpoints are single-agent, so the overview and the
  // headline follow the selection only when exactly one agent is picked. Two or
  // more stays workspace-wide, and the overview says so rather than silently
  // showing numbers that ignore the filter.
  const selectedAgent = selectedAgents.length === 1 ? selectedAgents[0]! : null;
  const tab = parseTab(params.get("tab"));
  const allOrgs = isAdmin && params.get("orgScope") === "all";
  const includeSubagents = params.get("subagents") === "1";
  const exactCitations = params.get("exact") === "1";
  const adminOrgScope: AdminOrgScope = allOrgs ? "all" : "org";

  const setParam = useCallback(
    (key: string, value: string | null) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value === null || value === "") next.delete(key);
          else next.set(key, value);
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const [agentSlugs, setAgentSlugs] = useState<string[]>([]);
  const [data, setData] = useState<GlobalMetrics | AgentMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin && params.get("orgScope")) setParam("orgScope", null);
  }, [isAdmin, params, setParam]);

  // Populate the agent selector from the FULL agent roster (allAgents=true, so
  // admins get every user's agents) UNIONed with agents that have runs in the
  // last 30d. Using only /metrics/global.topAgents (the old behaviour) left out
  // every agent without recent runs — and, for admins, other users' private
  // agents — so the dropdown couldn't reach them. The union keeps run-only
  // slugs that might not be in the roster (e.g. deleted agents) as a fallback.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      listAgents(userId, true, adminOrgScope).then((rows) => rows.map((a) => a.slug)).catch(() => [] as string[]),
      fetchGlobalMetrics(userId, 30, adminOrgScope).then((g) => g.topAgents.map((a) => a.agentSlug)).catch(() => [] as string[]),
    ]).then(([all, withRuns]) => {
      if (cancelled) return;
      setAgentSlugs([...new Set([...all, ...withRuns])].sort());
    });
    return () => { cancelled = true; };
  }, [userId, adminOrgScope]);

  // Run-level metrics. Fetched at page level rather than inside the overview
  // tab so the headline KPIs above the tabs read the same response instead of
  // issuing a second identical request.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const load = selectedAgent
      ? fetchAgentMetrics(userId, selectedAgent, days, adminOrgScope)
      : fetchGlobalMetrics(userId, days, adminOrgScope);
    load
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) { setData(null); setError(e instanceof Error ? e.message : String(e)); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [userId, selectedAgent, days, adminOrgScope]);

  // MultiSelect unions in any selected value the roster has not loaded yet, so
  // the raw roster is enough here.
  const agentOptions = agentSlugs;

  // Server-driven table state. In the URL so a shared link restores the exact
  // page, sort and filter — the whole point of paging server-side.
  const toolPage: ToolPageRequest = {
    limit: PAGE_LIMIT,
    offset: parseIntParam(params.get("offset"), 0),
    sort: parseSort(params.get("sort")),
    dir: params.get("dir") === "asc" ? "asc" : "desc",
    ...(params.get("q") ? { search: params.get("q")! } : {}),
  };
  const failuresTool = params.get("failures");
  const failuresOffset = parseIntParam(params.get("foffset"), 0);

  const tools = useToolMetrics(userId, days, adminOrgScope, selectedAgents, toolPage, tab === "tools");
  const quality = useToolQualityMetrics(userId, days, adminOrgScope, selectedAgents, exactCitations, toolPage, tab === "quality");
  const failures = useToolFailures(userId, tab === "tools" ? failuresTool : null, days, adminOrgScope, selectedAgents, {
    limit: PAGE_LIMIT,
    offset: failuresOffset,
  });

  // Any change that reshuffles the ranking has to reset to page 1 — otherwise a
  // re-sort lands the reader on offset 400 of a set that may now be 12 long.
  const setSort = useCallback(
    (key: string) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          const sameKey = (next.get("sort") ?? "calls") === key;
          next.set("sort", key);
          next.set("dir", sameKey && next.get("dir") !== "asc" ? "asc" : "desc");
          next.delete("offset");
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const buildPaging = (
    page: { limit: number; offset: number; total: number; sort: ToolSortKey; dir: "asc" | "desc" } | undefined,
  ): ServerPaging => ({
    limit: page?.limit ?? PAGE_LIMIT,
    offset: page?.offset ?? 0,
    total: page?.total ?? 0,
    sort: page?.sort ?? toolPage.sort,
    dir: page?.dir ?? toolPage.dir,
    onSort: setSort,
    onOffset: (offset) => setParam("offset", offset > 0 ? String(offset) : null),
    search: toolPage.search ?? "",
    onSearch: (query) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (query) next.set("q", query);
          else next.delete("q");
          next.delete("offset");
          return next;
        },
        { replace: true },
      );
    },
    searchPlaceholder: "Filter tools by name…",
    unit: "tools",
  });
  const coverage = useToolCoverageMetrics(userId, days, adminOrgScope, selectedAgents, tab === "coverage");
  const llm = useLlmCallMetrics(userId, days, adminOrgScope, selectedAgents, includeSubagents, tab === "llm");

  // Tool options come from whichever response the open tab already fetched, so
  // the list only ever offers tools that exist in the current window and scope.
  const toolOptions = useMemo(() => {
    const names =
      tab === "tools" ? (tools.data?.tools ?? []).map((r) => r.tool)
      : tab === "quality" ? (quality.data?.quality ?? []).map((r) => r.tool)
      : tab === "coverage" ? (coverage.data?.argUsage ?? []).map((r) => r.tool)
      : [];
    return [...new Set(names)].sort();
  }, [tab, tools.data, quality.data, coverage.data]);

  const toolFilterApplies = tab === "tools" || tab === "quality" || tab === "coverage";

  return (
    <div className="metrics-viz flex-1 overflow-auto">
      <MetricsVizTokens />
      <div className="max-w-[1180px] mx-auto px-[40px] pt-[32px] pb-[56px] w-full min-w-[640px]">
        <div className="mb-[16px]">
          <h1 className="text-[22px] font-semibold text-xyne-fg-primary">
            {selectedAgent ? `Agent · ${selectedAgent}` : "Workspace Metrics"}
          </h1>
          <p className="text-[13px] text-xyne-fg-muted mt-1">
            {selectedAgent
              ? `Latency, throughput, tokens, tools, and per-call model performance for ${selectedAgent}.`
              : "Latency, throughput, errors, tool reliability, and model performance across all agents and users."}
          </p>
        </div>

        {/* One filter row, sticky, so the controls stay reachable while reading
            a long panel and the reader never scrolls back up to change range. */}
        <div className="sticky top-0 z-10 -mx-[40px] mb-[20px] border-b border-xyne-border bg-xyne-surface/95 px-[40px] py-3 backdrop-blur">
          <div className="flex flex-wrap items-center gap-3">
            <MultiSelect
              label="agents"
              allLabel="All agents"
              options={agentOptions}
              selected={selectedAgents}
              onChange={(next) => setParam("agent", next.join(",") || null)}
              emptyMessage="No agents with runs yet."
              searchPlaceholder="Search agents…"
            />

            {toolFilterApplies && (
              <MultiSelect
                label="tools"
                allLabel="All tools"
                options={toolOptions}
                selected={selectedTools}
                onChange={(next) => setParam("tool", next.join(",") || null)}
                emptyMessage="Tool list loads with this tab's data."
                searchPlaceholder="Search tools…"
              />
            )}

            <div className="flex items-center gap-1 rounded-full bg-xyne-surface-sunken p-1">
              {DAY_OPTIONS.map((opt) => (
                <button
                  key={opt.days}
                  onClick={() => setParam("range", String(opt.days))}
                  className={
                    "px-3 py-1 rounded-full text-[12px] font-medium transition-colors " +
                    (days === opt.days
                      ? "bg-xyne-fg-primary text-xyne-fg-inverse"
                      : "text-xyne-fg-muted hover:text-xyne-fg-primary")
                  }
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {isAdmin && (
              <label className="flex shrink-0 items-center gap-2 text-[12px] text-xyne-fg-muted">
                <Switch
                  checked={allOrgs}
                  onChange={(next) => setParam("orgScope", next ? "all" : null)}
                  ariaLabel="Show metrics across all organizations"
                />
                All orgs
              </label>
            )}

            <div className="ml-auto">
              <Tabs
                items={TABS}
                selected={tab}
                onSelect={(id) => setParam("tab", id === "overview" ? null : id)}
                className="border-b-0"
              />
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-[20px] rounded-xl border border-xyne-error-border bg-xyne-error-bg p-4 text-[13px] text-xyne-error-fg">
            Failed to load metrics: {error}
          </div>
        )}

        {loading || !data ? (
          <div className="flex flex-col gap-[20px]">
            <Skeleton className="h-[160px] w-full" />
            <Skeleton className="h-[260px] w-full" />
            <Skeleton className="h-[260px] w-full" />
          </div>
        ) : (
          <div className="flex flex-col gap-[20px]">
            {/* Headline health, above the tabs — answerable without a choice. */}
            <HeadlineKpis data={data} />

            {tab === "overview" && selectedAgents.length > 1 && (
              <div className="rounded-xl border border-xyne-info-border bg-xyne-info-bg px-4 py-3 text-[12px] text-xyne-info-fg">
                <span className="font-medium">Showing the whole workspace.</span> The run-level
                rollup below is computed per agent or across everything — it cannot yet be scoped
                to a subset. The Tools, LLM calls, Quality and Coverage tabs do respect all{" "}
                {selectedAgents.length} selected agents.
              </div>
            )}
            {tab === "overview" && (
              <OverviewTab
                userId={userId}
                data={data}
                showLeaderboard={!selectedAgent}
                onAgentClick={(slug) => setParam("agent", slug)}
              />
            )}
            {tab === "tools" && (
              <ToolsPanel
                data={tools.data}
                loading={tools.loading}
                error={tools.error}
                toolFilter={selectedTools}
                paging={buildPaging(tools.data?.page)}
                failures={
                  failuresTool
                    ? {
                        tool: failuresTool,
                        data: failures.data,
                        loading: failures.loading,
                        error: failures.error,
                        onOffset: (offset) => setParam("foffset", offset > 0 ? String(offset) : null),
                      }
                    : null
                }
                onDrillFailures={(tool) => {
                  setParams(
                    (prev) => {
                      const next = new URLSearchParams(prev);
                      if (tool) next.set("failures", tool);
                      else next.delete("failures");
                      next.delete("foffset");
                      return next;
                    },
                    { replace: true },
                  );
                }}
              />
            )}
            {tab === "llm" && (
              <LlmCallsPanel
                data={llm.data}
                loading={llm.loading}
                error={llm.error}
                includeSubagents={includeSubagents}
                onToggleSubagents={(next) => setParam("subagents", next ? "1" : null)}
              />
            )}
            {tab === "quality" && (
              <QualityPanel
                data={quality.data}
                loading={quality.loading}
                error={quality.error}
                exact={exactCitations}
                onToggleExact={(next) => setParam("exact", next ? "1" : null)}
                toolFilter={selectedTools}
                paging={buildPaging(quality.data?.page)}
              />
            )}
            {tab === "coverage" && (
              <CoveragePanel data={coverage.data} loading={coverage.loading} error={coverage.error} toolFilter={selectedTools} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function parseDays(raw: string | null): MetricsDays {
  const n = Number(raw);
  return n === 1 || n === 30 ? n : 7;
}

/** One page of tools. 50 keeps the payload small without constant paging. */
const PAGE_LIMIT = 50;

const TOOL_SORT_KEYS: readonly ToolSortKey[] = [
  "tool", "calls", "errors", "errorRate", "duplicateRate", "droppedEnd",
  "emptyResults", "recoveryRate", "citeRate", "avgMs", "p50Ms", "p95Ms",
  "maxMs", "totalMs", "resultBytes",
];

/** Falls back rather than trusting the URL — the value reaches an ORDER BY. */
function parseSort(raw: string | null): ToolSortKey {
  return TOOL_SORT_KEYS.includes(raw as ToolSortKey) ? (raw as ToolSortKey) : "calls";
}

function parseIntParam(raw: string | null, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : fallback;
}

/** Comma-separated URL list → deduped values. Empty string yields []. */
function parseList(raw: string | null): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(",").map((v) => v.trim()).filter(Boolean))];
}

function parseTab(raw: string | null): MetricsTab {
  return TABS.some((t) => t.id === raw) ? (raw as MetricsTab) : "overview";
}

/* ── building blocks ──────────────────────────────────────────────────── */

/** Thin alias over the shared card shell, so old and new sections cannot drift. */
function Card({ title, subtitle, unit, children }: {
  title: string;
  subtitle?: string;
  /** States how the numbers were aggregated — see UnitBadge. */
  unit?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <MetricsCard
      title={title}
      {...(subtitle ? { description: subtitle } : {})}
      {...(unit ? { action: unit } : {})}
    >
      {children}
    </MetricsCard>
  );
}

/**
 * The run-level breakdown: outcomes, where time goes, users, memory, tokens.
 *
 * The status banner and the two hero durations that used to open this strip now
 * live in HeadlineKpis above the tabs, so they stay visible from every tab. No
 * number was dropped — only promoted.
 */
function TotalsStrip({ data }: { data: GlobalMetrics | AgentMetrics }) {
  const errd = fmtSignedPct(data.delta.errorRate);
  const errPct = data.totals.errorRate;

  return (
    <div className="flex flex-col gap-3">
      {/* Supporting metrics in smaller tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile
          label="Total runs"
          value={String(data.totals.runs)}
          sub={`${data.delta.runs >= 0 ? "+" : ""}${data.delta.runs} vs previous`}
        />
        <Tile
          label="Where time goes"
          value={`${fmtMs(data.totals.avgLlmMs)} LLM`}
          sub={`${fmtMs(data.totals.avgToolMs)} in tools`}
        />
        <Tile
          label="Error rate"
          value={fmtPct(errPct)}
          sub={errd.label}
          subTone={errd.tone}
        />
        <Tile
          label="Outcomes"
          value={`${data.totals.completed}✓`}
          sub={`${data.totals.failed}✗ · ${data.totals.cancelled}⊘`}
        />
        {"uniqueUsers" in data.totals && data.totals.uniqueUsers != null && (
          <Tile
            label="Unique users"
            value={String(data.totals.uniqueUsers)}
            sub="distinct users in this window"
          />
        )}
        {/* The managed number for memory: % of runs that actually recalled
            from the bank. A growing bank with a flat rate here = dead weight. */}
        {"memoryRecall" in data.totals && data.totals.memoryRecall != null && (
          <Tile
            label="Memory usage"
            value={`${Math.round(data.totals.memoryRecall.rate * 100)}%`}
            sub={`${data.totals.memoryRecall.runsWithRecall} runs recalled memory`}
          />
        )}
      </div>

      {/* Token consumption for the window. IN counts fresh + cached input —
          cached context is replayed on every turn and dominates real volume
          on agentic loops; fresh-only "in" understates usage ~10x. Only the
          per-agent endpoint reports tokens, hence the narrowing guard. */}
      {"tokens" in data.totals && data.totals.tokens && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Tile
            label="Tokens in"
            value={fmtTokens(data.totals.tokens.in + data.totals.tokens.cacheRead + data.totals.tokens.cacheWrite)}
            sub={`${fmtTokens(data.totals.tokens.in)} fresh · ${fmtTokens(data.totals.tokens.cacheRead + data.totals.tokens.cacheWrite)} cached`}
          />
          <Tile
            label="Tokens out"
            value={fmtTokens(data.totals.tokens.out)}
          />
          <Tile
            label="Cache hit ratio"
            value={
              data.totals.tokens.in + data.totals.tokens.cacheRead > 0
                ? `${Math.round((data.totals.tokens.cacheRead / (data.totals.tokens.in + data.totals.tokens.cacheRead)) * 100)}%`
                : "—"
            }
            sub="of input context served from cache"
          />
          <Tile
            label="Tokens / run"
            value={
              data.totals.runs > 0
                ? fmtTokens(Math.round((data.totals.tokens.in + data.totals.tokens.cacheRead + data.totals.tokens.cacheWrite + data.totals.tokens.out) / data.totals.runs))
                : "—"
            }
            sub="total processed, avg per run"
          />
        </div>
      )}
    </div>
  );
}

/** 1234567 → "1.2M", 45600 → "45.6K" — token counts read better compact. */
function fmtTokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

function Tile({ label, value, sub, subTone = "flat" as "good" | "bad" | "flat" }: { label: string; value: string; sub?: string; subTone?: "good" | "bad" | "flat" }) {
  const toneClass =
    subTone === "good" ? "text-green-600 dark:text-green-400" :
    subTone === "bad"  ? "text-red-600 dark:text-red-400"   :
                         "text-xyne-fg-muted";
  return (
    <div className="rounded-xl bg-xyne-surface shadow-sm px-4 py-3 flex flex-col">
      <span className="text-[11px] uppercase tracking-wider text-xyne-fg-muted">{label}</span>
      <span className="text-[20px] font-semibold text-xyne-fg-primary mt-1 tabular-nums">{value}</span>
      {sub && <span className={`text-[11px] mt-0.5 ${toneClass}`}>{sub}</span>}
    </div>
  );
}

const TRIGGER_LABELS = {
  user: "User",
  automation: "Automation",
  scheduled: "Scheduled",
  api: "CLI",
} as const;

function TriggerTiles({ rows }: { rows: GlobalMetrics["byTrigger"] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      {rows.map((r) => (
        <div key={r.trigger} className="rounded-lg bg-xyne-bg-secondary/40 px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] uppercase tracking-wider text-xyne-fg-muted">{TRIGGER_LABELS[r.trigger]}</span>
            <span className="text-[11px] text-xyne-fg-muted tabular-nums">{r.runs} runs</span>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <MetricChip label="Error" value={fmtPct(r.errorRate)} />
            <MetricChip label="p50" value={fmtMs(r.p50TotalMs)} />
            <MetricChip label="p95" value={fmtMs(r.p95TotalMs)} />
          </div>
        </div>
      ))}
    </div>
  );
}

function MetricChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] text-xyne-fg-muted">{label}</div>
      <div className="text-[13px] font-medium text-xyne-fg-primary tabular-nums truncate">{value}</div>
    </div>
  );
}

/* ── Charts (recharts) ────────────────────────────────────────────────── */

/**
 * Same four charts, same data, same order as before — updated for chrome only,
 * so that these and the newer panels read as one system:
 *
 *   - colours come from the validated palette instead of hard-coded hexes. The
 *     old values were fixed light-mode greens and slates that did not adapt to
 *     the dark theme;
 *   - gridlines are solid hairlines rather than dashed. Dashing reads as
 *     "threshold" or "projection" when it is only a grid;
 *   - outcome colours are status roles (good / critical / neutral) rather than
 *     arbitrary series hues, because completed-vs-failed IS a status;
 *   - the legend sits outside the SVG so its text wears text tokens rather than
 *     the series colour.
 *
 * Stacked segments carry a 2px surface gap so neighbouring bands separate by
 * negative space rather than by a stroke.
 */

const CHART_HEIGHT = 240;

function SessionsBarChart({ perDay }: { perDay: GlobalMetricsDayBucket[] }) {
  const data = perDay.map((d) => ({
    day: d.day.slice(5),
    Completed: d.completed,
    Failed: d.failed,
    Cancelled: d.cancelled,
  }));
  return (
    <>
      <ChartLegend
        className="mb-2"
        items={[
          { color: OUTCOME.completed, label: "Completed" },
          { color: OUTCOME.failed, label: "Failed" },
          { color: OUTCOME.cancelled, label: "Cancelled" },
        ]}
      />
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <BarChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={NEUTRAL.grid} vertical={false} />
          <XAxis dataKey="day" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} />
          <RcYAxis tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} width={40} allowDecimals={false} />
          <Tooltip content={<MetricsTooltip />} cursor={{ fill: "currentColor", opacity: 0.05 }} />
          <Bar dataKey="Completed" stackId="s" fill={OUTCOME.completed} barSize={22} stroke={NEUTRAL.surface} strokeWidth={2} />
          <Bar dataKey="Failed" stackId="s" fill={OUTCOME.failed} barSize={22} stroke={NEUTRAL.surface} strokeWidth={2} />
          <Bar dataKey="Cancelled" stackId="s" fill={OUTCOME.cancelled} barSize={22} stroke={NEUTRAL.surface} strokeWidth={2} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </>
  );
}

function TriggerBarChart({ perDay }: { perDay: GlobalMetricsDayBucket[] }) {
  const data = perDay.map((d) => ({
    day: d.day.slice(5),
    User: d.user ?? 0,
    Automation: d.automation ?? 0,
    Scheduled: d.scheduled ?? 0,
    CLI: d.api ?? 0,
  }));
  return (
    <>
      <ChartLegend
        className="mb-2"
        items={[
          { color: SERIES[0], label: "User" },
          { color: SERIES[5], label: "Automation" },
          { color: SERIES[3], label: "Scheduled" },
          { color: SERIES[2], label: "CLI" },
        ]}
      />
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <BarChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={NEUTRAL.grid} vertical={false} />
          <XAxis dataKey="day" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} />
          <RcYAxis tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} width={40} allowDecimals={false} />
          <Tooltip content={<MetricsTooltip />} cursor={{ fill: "currentColor", opacity: 0.05 }} />
          <Bar dataKey="User" stackId="s" fill={SERIES[0]} barSize={22} stroke={NEUTRAL.surface} strokeWidth={2} />
          <Bar dataKey="Automation" stackId="s" fill={SERIES[5]} barSize={22} stroke={NEUTRAL.surface} strokeWidth={2} />
          <Bar dataKey="Scheduled" stackId="s" fill={SERIES[3]} barSize={22} stroke={NEUTRAL.surface} strokeWidth={2} />
          <Bar dataKey="CLI" stackId="s" fill={SERIES[2]} barSize={22} stroke={NEUTRAL.surface} strokeWidth={2} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </>
  );
}

function SingleLineChart({ perDay, valueKey, color, displayName }: {
  perDay: GlobalMetricsDayBucket[];
  valueKey: "p50TotalMs" | "p95TotalMs";
  color: string;
  displayName: string;
}) {
  const data = perDay.map((d) => ({
    day: d.day.slice(5),
    [displayName]: d[valueKey],
  }));
  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
      <LineChart data={data} margin={{ top: 16, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={NEUTRAL.grid} vertical={false} />
        <XAxis dataKey="day" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} />
        <RcYAxis tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} width={56} tickFormatter={(v) => fmtMs(Math.round(v))} />
        <Tooltip
          cursor={{ stroke: NEUTRAL.axis }}
          content={<MetricsTooltip format={(v) => fmtMs(Number(v))} />}
        />
        <Line
          type="monotone"
          dataKey={displayName}
          stroke={color}
          strokeWidth={2}
          dot={{ r: 4, fill: color, strokeWidth: 2, stroke: NEUTRAL.surface }}
          activeDot={{ r: 5 }}
          connectNulls
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

function SplitChart({ perDay }: { perDay: GlobalMetricsDayBucket[] }) {
  const data = perDay.map((d) => ({
    day: d.day.slice(5),
    "Avg LLM time":  d.avgLlmMs  ?? 0,
    "Avg Tool time": d.avgToolMs ?? 0,
  }));
  return (
    <>
      <ChartLegend
        className="mb-2"
        items={[
          { color: SERIES[5], label: "Avg LLM time" },
          { color: SERIES[3], label: "Avg Tool time" },
        ]}
      />
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <BarChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={NEUTRAL.grid} vertical={false} />
          <XAxis dataKey="day" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} />
          <RcYAxis tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} width={56} tickFormatter={(v) => fmtMs(Math.round(v))} />
          <Tooltip
            content={<MetricsTooltip format={(v) => fmtMs(Number(v))} />}
            cursor={{ fill: "currentColor", opacity: 0.05 }}
          />
          <Bar dataKey="Avg LLM time" stackId="s" fill={SERIES[5]} barSize={22} stroke={NEUTRAL.surface} strokeWidth={2} />
          <Bar dataKey="Avg Tool time" stackId="s" fill={SERIES[3]} barSize={22} stroke={NEUTRAL.surface} strokeWidth={2} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </>
  );
}

function AgentTable({ rows, onAgentClick }: {
  rows: GlobalMetrics["topAgents"];
  onAgentClick?: (slug: string) => void;
}) {
  const showOrgLabels = rows.some((r) => r.orgName || r.orgId);
  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <table className="w-full min-w-[640px] text-[13px]">
        <thead>
          <tr className="text-left text-xyne-fg-muted text-[11px] uppercase tracking-wider">
            <th className="py-2 pr-3">Agent</th>
            <th className="py-2 pr-3 text-right">Runs</th>
            <th className="py-2 pr-3 text-right">p50</th>
            <th className="py-2 pr-3 text-right">p95</th>
            <th className="py-2 pr-3 text-right">Avg LLM</th>
            <th className="py-2 pr-3 text-right">Avg Tool</th>
            <th className="py-2 pr-3 text-right">Errors</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={7} className="py-6 text-center text-xyne-fg-muted">No runs in window.</td></tr>
          )}
          {rows.map((r) => (
            <tr
              key={r.agentSlug}
              className={"border-t border-xyne-border " + (onAgentClick ? "cursor-pointer hover:bg-xyne-bg-secondary/40" : "")}
              onClick={onAgentClick ? () => onAgentClick(r.agentSlug) : undefined}
              title={onAgentClick ? `Drill into ${r.agentSlug}'s metrics` : undefined}
            >
              <td className="py-2 pr-3">
                <div className="font-medium text-xyne-fg-primary">{r.agentSlug}</div>
                {showOrgLabels && (
                  <div className="mt-0.5 text-[11px] text-xyne-fg-muted">{r.orgName ?? r.orgId ?? "unknown org"}</div>
                )}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">{r.runs}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{fmtMs(r.p50TotalMs)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{fmtMs(r.p95TotalMs)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{fmtMs(r.avgLlmMs)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{fmtMs(r.avgToolMs)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{fmtPct(r.errorRate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type ProviderSortKey =
  | "providerModel"
  | "runs"
  | "p50LlmMs"
  | "p95LlmMs"
  | "p50TtftMs"
  | "avgTokensPerSec"
  | "errorRate";

function ProviderLatencyTable({ rows }: { rows: GlobalMetricsProviderRow[] }) {
  const [sortKey, setSortKey] = useState<ProviderSortKey>("runs");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const sortedRows = [...rows].sort((a, b) => {
    const providerModelA = `${a.provider} · ${a.model ?? "unknown"}`;
    const providerModelB = `${b.provider} · ${b.model ?? "unknown"}`;
    const av = sortKey === "providerModel" ? providerModelA : a[sortKey];
    const bv = sortKey === "providerModel" ? providerModelB : b[sortKey];
    if (typeof av === "string" && typeof bv === "string") {
      return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    }
    const na = av ?? (sortDir === "asc" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
    const nb = bv ?? (sortDir === "asc" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
    return sortDir === "asc" ? Number(na) - Number(nb) : Number(nb) - Number(na);
  });

  const toggleSort = (nextKey: ProviderSortKey) => {
    if (sortKey === nextKey) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else {
      setSortKey(nextKey);
      setSortDir(nextKey === "providerModel" ? "asc" : "desc");
    }
  };

  const SortHeader = ({ label, sort }: { label: string; sort: ProviderSortKey }) => (
    <button
      type="button"
      onClick={() => toggleSort(sort)}
      className="inline-flex items-center gap-1 text-inherit hover:text-xyne-fg-primary"
    >
      <span>{label}</span>
      <span className="text-[10px] opacity-60">{sortKey === sort ? (sortDir === "desc" ? "↓" : "↑") : "↕"}</span>
    </button>
  );

  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <table className="w-full min-w-[860px] text-[13px]">
        <thead>
          <tr className="text-left text-xyne-fg-muted text-[11px] uppercase tracking-wider">
            <th className="py-2 pr-3"><SortHeader label="Provider · Model" sort="providerModel" /></th>
            <th className="py-2 pr-3 text-right"><SortHeader label="Runs" sort="runs" /></th>
            <th className="py-2 pr-3 text-right"><SortHeader label="p50 LLM" sort="p50LlmMs" /></th>
            <th className="py-2 pr-3 text-right"><SortHeader label="p95 LLM" sort="p95LlmMs" /></th>
            <th className="py-2 pr-3 text-right"><SortHeader label="p50 TTFT" sort="p50TtftMs" /></th>
            <th className="py-2 pr-3 text-right"><SortHeader label="TPS" sort="avgTokensPerSec" /></th>
            <th className="py-2 pr-3 text-right"><SortHeader label="Error %" sort="errorRate" /></th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={7} className="py-8 text-center text-xyne-fg-muted">No provider-tagged runs yet — populates as new runs complete.</td></tr>
          )}
          {sortedRows.map((r) => (
            <tr key={`${r.provider}:${r.model ?? "unknown"}`} className="border-t border-xyne-border">
              <td className="py-2 pr-3">
                <div className="font-medium text-xyne-fg-primary">{r.provider}</div>
                <div className="font-mono text-[12px] text-xyne-fg-muted">{r.model ?? "unknown"}</div>
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">{r.runs}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{fmtMs(r.p50LlmMs)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{fmtMs(r.p95LlmMs)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{fmtMs(r.p50TtftMs)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{r.avgTokensPerSec == null ? "—" : Math.round(r.avgTokensPerSec).toString()}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{fmtPct(r.errorRate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SentimentPanel({ sentiment }: { sentiment: AgentSentiment }) {
  const ratingPct = sentiment.ratingRatio != null ? sentiment.ratingRatio : null;
  // Tone the headline based on ratio + behavioural signals. The rules are
  // intentionally simple — we want the page to read in 3 seconds.
  const concerns: string[] = [];
  if (ratingPct != null && ratingPct < 0.5)    concerns.push(`thumbs-up rate ${(ratingPct * 100).toFixed(0)}% — users mostly unhappy`);
  if (sentiment.apologeticRate > 0.2)          concerns.push(`${(sentiment.apologeticRate * 100).toFixed(0)}% of replies sound apologetic ("I couldn't…")`);
  if (sentiment.failedRate > 0.1)              concerns.push(`${(sentiment.failedRate * 100).toFixed(0)}% of runs failed outright`);
  if (sentiment.cancelledRate > 0.1)           concerns.push(`${(sentiment.cancelledRate * 100).toFixed(0)}% of runs were cancelled (user gave up)`);
  if (sentiment.retriedRate > 0.2)             concerns.push(`${(sentiment.retriedRate * 100).toFixed(0)}% of runs needed an LLM retry`);
  const tone = concerns.length === 0 ? "good" : concerns.length >= 3 ? "bad" : "warn";
  const bannerStyle =
    tone === "good" ? "bg-green-500/10 text-green-700 dark:text-green-300 border-green-500/30" :
    tone === "bad"  ? "bg-red-500/10   text-red-700   dark:text-red-300   border-red-500/30"   :
                      "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30";
  const headline =
    sentiment.ratingTotal === 0 && concerns.length === 0
      ? `No ratings yet — ${sentiment.totalRuns} runs in window. Behavioural signals look normal.`
      : concerns.length === 0
      ? `Sentiment looks healthy across ${sentiment.totalRuns} runs (${sentiment.ratingTotal} rated, ${sentiment.ratingUp} 👍 vs ${sentiment.ratingDown} 👎).`
      : `${concerns.length} concern${concerns.length === 1 ? "" : "s"}: ${concerns.join(" · ")}`;

  return (
    <div className="flex flex-col gap-4">
      <div className={`rounded-xl border px-4 py-3 text-[13px] ${bannerStyle}`}>{headline}</div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <MiniTile label="Ratings 👍" value={String(sentiment.ratingUp)} sub={sentiment.ratingTotal > 0 ? `${((sentiment.ratingUp / sentiment.ratingTotal) * 100).toFixed(0)}% of rated` : "—"} />
        <MiniTile label="Ratings 👎" value={String(sentiment.ratingDown)} sub={sentiment.ratingTotal > 0 ? `${((sentiment.ratingDown / sentiment.ratingTotal) * 100).toFixed(0)}% of rated` : "—"} />
        <MiniTile label="Apologetic replies" value={`${(sentiment.apologeticRate * 100).toFixed(1)}%`} sub="of completed runs" />
        <MiniTile label="Cancelled" value={`${(sentiment.cancelledRate * 100).toFixed(1)}%`} sub="of all runs" />
        <MiniTile label="Needed retry" value={`${(sentiment.retriedRate * 100).toFixed(1)}%`} sub="LLM retries fired" />
      </div>

      {sentiment.recentComments.length > 0 && (
        <div>
          <div className="text-[11px] uppercase tracking-wider text-xyne-fg-muted mb-2">
            Recent rating comments ({sentiment.recentComments.length})
          </div>
          <div className="flex flex-col gap-2">
            {sentiment.recentComments.map((c) => (
              <div key={c.sessionId} className="flex items-start gap-3 rounded-lg bg-xyne-bg-secondary/40 p-3">
                <span className="text-[18px] leading-none mt-0.5" title={c.rating === "up" ? "thumbs up" : "thumbs down"}>
                  {c.rating === "up" ? "👍" : "👎"}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] text-xyne-fg-primary whitespace-pre-wrap break-words">{c.comment}</div>
                  <div className="text-[11px] text-xyne-fg-muted mt-1 flex items-center gap-2">
                    <span className="font-mono">{c.sessionId.slice(0, 16)}</span>
                    <span>·</span>
                    <span>{new Date(c.completedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Improvement suggestions surfaced by the hourly FailureCurator. Three
 * collapsible buckets (agent_unable_to_do_work / failure / user_frustrated)
 * each containing the curator's findings. Apply marks the candidate as
 * applied; Dismiss kicks off the 7-day cool-down. Both call admin-only
 * endpoints.
 */
function ImprovementsCard({ userId, agentSlug }: { userId: string; agentSlug: string }) {
  const [items, setItems] = useState<ImprovementCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openBucket, setOpenBucket] = useState<ImprovementBucket | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // candidate id currently mutating

  const reload = React.useCallback(() => {
    setError(null);
    fetchAgentImprovements(userId, agentSlug)
      .then(setItems)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [userId, agentSlug]);

  useEffect(() => { reload(); }, [reload]);

  if (error) {
    // Permission failures (admin / owner / contributor gate) — hide the
    // card entirely rather than show a scary banner for users who simply
    // aren't part of this agent's editor group.
    const isAuth = /403|admin|owner|contributor|forbidden/i.test(error);
    if (isAuth) return null;
    return <Card title="Improvement suggestions" subtitle="Auto-generated by the FailureCurator"><div className="text-[13px] text-red-500">Failed to load suggestions: {error}</div></Card>;
  }
  if (items === null) {
    return <Card title="Improvement suggestions" subtitle="Auto-generated by the FailureCurator"><Skeleton className="h-[80px] w-full" /></Card>;
  }
  if (items.length === 0) {
    return <Card title="Improvement suggestions" subtitle="Auto-generated by the FailureCurator hourly worker">
      <div className="text-[13px] text-xyne-fg-muted">No pending suggestions. The curator runs hourly; once it has enough negative-signal sessions to spot a pattern, findings will appear here.</div>
    </Card>;
  }

  const buckets: Array<{ key: ImprovementBucket; label: string; tone: "good" | "warn" | "bad" }> = [
    { key: "agent_unable_to_do_work", label: "Agent unable to do work", tone: "warn" },
    { key: "failure",                 label: "Failures",                tone: "bad" },
    { key: "user_frustrated",         label: "User frustrated",         tone: "bad" },
  ];

  const onApply = async (id: string) => {
    setBusy(id);
    try { await applyImprovement(userId, id); reload(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };
  const onDismiss = async (id: string) => {
    setBusy(id);
    try { await dismissImprovement(userId, id); reload(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  const itemsByBucket: Record<ImprovementBucket, ImprovementCandidate[]> = {
    agent_unable_to_do_work: items.filter((i) => i.bucket === "agent_unable_to_do_work"),
    failure:                 items.filter((i) => i.bucket === "failure"),
    user_frustrated:         items.filter((i) => i.bucket === "user_frustrated"),
  };

  return (
    <Card
      title="Improvement suggestions"
      subtitle={`${items.length} pending — auto-generated hourly from negative-signal sessions. Acting on a suggestion is manual: read the proposed fix, make the change in the agent editor (system prompt, tools, memory…), then click “Mark as handled.” Use “Dismiss” to silence the same root-cause finding for this agent for 7 days.`}
    >
      <div className="flex flex-col gap-2">
        {buckets.map((b) => {
          const rows = itemsByBucket[b.key];
          const open = openBucket === b.key;
          return (
            <div key={b.key} className="rounded-lg border border-xyne-border">
              <button
                onClick={() => setOpenBucket(open ? null : b.key)}
                className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-xyne-bg-secondary/40"
              >
                <span className="flex items-center gap-2">
                  <span className="text-xyne-fg-muted">{open ? "▾" : "▸"}</span>
                  <span className="font-medium text-xyne-fg-primary">{b.label}</span>
                  <span className="text-[12px] text-xyne-fg-muted">
                    {rows.length} finding{rows.length === 1 ? "" : "s"}
                  </span>
                </span>
              </button>
              {open && rows.length > 0 && (
                <div className="border-t border-xyne-border-subtle p-3 flex flex-col gap-3">
                  {rows.map((c) => (
                    <ImprovementRow
                      key={c.id}
                      c={c}
                      onApply={() => onApply(c.id)}
                      onDismiss={() => onDismiss(c.id)}
                      busy={busy === c.id}
                    />
                  ))}
                </div>
              )}
              {open && rows.length === 0 && (
                <div className="border-t border-xyne-border-subtle p-3 text-[12px] text-xyne-fg-muted">Nothing pending in this bucket.</div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function ImprovementRow({ c, onApply, onDismiss, busy }: {
  c: ImprovementCandidate;
  onApply: () => void;
  onDismiss: () => void;
  busy: boolean;
}) {
  const confTone =
    c.confidence === "high" ? "text-green-600 dark:text-green-400 bg-green-500/10" :
    c.confidence === "low"  ? "text-amber-700 dark:text-amber-300 bg-amber-500/10" :
                              "text-xyne-fg-muted bg-xyne-bg-secondary";
  return (
    <div className="rounded-lg bg-xyne-bg-secondary/30 p-3 flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap text-[11px]">
        <span className="font-mono px-2 py-0.5 rounded bg-xyne-bg-secondary text-xyne-fg-primary">{c.rootCause}</span>
        <span className={`px-2 py-0.5 rounded ${confTone}`}>{c.confidence}</span>
        <span className="text-xyne-fg-muted">·</span>
        <span className="text-xyne-fg-muted">{c.evidence.length} session{c.evidence.length === 1 ? "" : "s"} as evidence</span>
      </div>
      <div className="text-[13px] text-xyne-fg-primary">{c.finding}</div>
      <div className="rounded-md bg-xyne-bg-secondary px-3 py-2 text-[12px] flex items-start gap-2">
        <span className="font-mono text-xyne-fg-muted shrink-0">{c.proposedFix.type}:</span>
        <span className="text-xyne-fg-primary whitespace-pre-wrap break-words">{c.proposedFix.description}</span>
      </div>
      <div className="flex items-center gap-3 text-[11px]">
        <span className="text-xyne-fg-muted">Evidence:</span>
        <div className="flex flex-wrap gap-1">
          {c.evidence.slice(0, 8).map((sid) => (
            <span key={sid} className="font-mono px-1.5 py-0.5 rounded bg-xyne-bg-secondary text-xyne-fg-muted">{sid.slice(0, 14)}</span>
          ))}
          {c.evidence.length > 8 && <span className="text-xyne-fg-muted">+{c.evidence.length - 8} more</span>}
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 pt-1">
        <span className="text-[11px] text-xyne-fg-muted italic">
          “Mark as handled” records that you made this change manually — it does <em>not</em> auto-edit the agent.
        </span>
        <div className="flex gap-2">
          <button
            onClick={onDismiss}
            disabled={busy}
            title="Hide this finding and silence the same root cause for this agent for 7 days. Use when the finding isn't actionable."
            className="text-[12px] px-3 py-1 rounded-md bg-xyne-bg-secondary hover:bg-xyne-bg-secondary/70 text-xyne-fg-muted disabled:opacity-40"
          >
            Dismiss
          </button>
          <button
            onClick={onApply}
            disabled={busy}
            title="Mark as handled. Record-keeping only — does not apply the change. Make the edit yourself in the agent editor, then click this."
            className="text-[12px] px-3 py-1 rounded-md bg-xyne-fg-primary text-xyne-fg-inverse hover:opacity-90 disabled:opacity-40"
          >
            {busy ? "..." : "Mark as handled"}
          </button>
        </div>
      </div>
    </div>
  );
}

function MiniTile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg bg-xyne-bg-secondary/40 px-3 py-2 flex flex-col">
      <span className="text-[10px] uppercase tracking-wider text-xyne-fg-muted">{label}</span>
      <span className="text-[18px] font-semibold text-xyne-fg-primary tabular-nums mt-0.5">{value}</span>
      <span className="text-[10px] text-xyne-fg-muted mt-0.5">{sub}</span>
    </div>
  );
}

function ToolLatencyTable({ rows }: { rows: ToolLatencyRow[] }) {
  // Total of all tools' cumulative ms — drives the visual bar so the eye sees
  // proportional share at a glance instead of having to compare numbers.
  const grandTotal = rows.reduce((a, r) => a + (r.totalMs || 0), 0) || 1;
  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <table className="w-full min-w-[720px] text-[13px]">
        <thead>
          <tr className="text-left text-xyne-fg-muted text-[11px] uppercase tracking-wider">
            <th className="py-2 pr-3">Tool</th>
            <th className="py-2 pr-3 text-right">Calls</th>
            <th className="py-2 pr-3 text-right">Avg</th>
            <th className="py-2 pr-3 text-right">p50</th>
            <th className="py-2 pr-3 text-right">p95</th>
            <th className="py-2 pr-3 text-right">Cumulative</th>
            <th className="py-2 pr-3">Share</th>
            <th className="py-2 pr-3 text-right">Errors</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const share = r.totalMs / grandTotal;
            const isHot = share >= 0.25; // tools eating ≥25% of total tool time = headline offender
            return (
              <tr key={r.tool} className="border-t border-xyne-border">
                <td className={"py-2 pr-3 font-mono text-[12px] " + (isHot ? "text-amber-500" : "text-xyne-fg-primary")}>
                  {r.tool}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">{r.calls}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{fmtMs(r.avgMs)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{fmtMs(r.p50Ms)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{fmtMs(r.p95Ms)}</td>
                <td className="py-2 pr-3 text-right tabular-nums font-medium">{fmtMs(r.totalMs)}</td>
                <td className="py-2 pr-3">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-[120px] rounded-full bg-xyne-bg-secondary overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.max(2, share * 100)}%`,
                          background: isHot ? "#f59e0b" : "#6366f1",
                        }}
                      />
                    </div>
                    <span className="text-[11px] text-xyne-fg-muted tabular-nums w-[42px]">
                      {(share * 100).toFixed(1)}%
                    </span>
                  </div>
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {r.errors > 0 ? <span className="text-red-500">{r.errors}</span> : <span className="text-xyne-fg-muted">—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
