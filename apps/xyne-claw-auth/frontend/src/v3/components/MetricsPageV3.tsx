/**
 * MetricsPageV3 — workspace-wide agent observability: sticky filters, headline KPIs, sticky tabs, one tab body.
 *
 * The page owns no metrics fetch: every card calls its own hook with the shared `scope`, and the
 * module-level cache in useDeepMetrics makes cards asking the same question share one request.
 * Range, agents, org scope, tab, card measures and drawers live in the query string; a range or
 * agent change clears the drill keys (`clearDrillParams`).
 */

import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AlarmClock,
  ArrowRight,
  BrainCircuit,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleMinus,
  Coins,
  Database,
  GitFork,
  History,
  MessageCircleReply,
  MessageSquare,
  RefreshCcwDot,
  RefreshCw,
  Terminal,
  ThumbsDown,
  ThumbsUp,
  UserRound,
  Workflow,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import {
  applyImprovement,
  dismissImprovement,
  fetchAgentImprovements,
  fetchAwakeningActivity,
  fetchAwakeningRuns,
  listAgents,
  type AdminOrgScope,
  type AgentLeaderRow,
  type AwakeningActivity,
  type AwakeningRun,
  type DailyPoint,
  type ImprovementBucket,
  type ImprovementCandidate,
  type MetricSessionsRequest,
  type RankPoint,
  type RouteRow,
  type SummaryFigures,
  type TriggerGroup,
  type TriggerRow,
} from "../../lib/api";
import type { AgentLight } from "../../lib/types";
import { cn } from "../../lib/utils";
import { Skeleton } from "./ui/Skeleton";
import { Tabs, type TabItem } from "./ui/Tabs";
import { useAdminStatus } from "../hooks/useAdminStatus";
import {
  invalidateMetrics,
  useActiveAgents,
  useAgentsTop,
  useMetricsResource,
  useRoutes,
  useRunDaily,
  useSentiment,
  useSummary,
  useTools,
  type MetricsDays,
  type MetricsScopeParams,
} from "../hooks/useDeepMetrics";
import { HeadlineKpis } from "./metrics/HeadlineKpis";
import {
  AXIS_LINE,
  AXIS_TICK,
  BAR_CURSOR,
  ChartLegend,
  ChartSkeleton,
  ChartTooltip,
  DataTable,
  Drawer,
  EmptyCardRow,
  InlineBar,
  KpiStrip,
  LINE_CURSOR,
  LazyCard,
  MeasureToggle,
  MetricsCard,
  MetricsVizStyle,
  MultiSelect,
  PanelError,
  RowsSkeleton,
  SAMPLE_FLOORS,
  SampleChip,
  SegmentedControl,
  SessionsList,
  StatusGlyph,
  StatusValue,
  TableSkeleton,
  ToggleField,
  ToolName,
  Unknown,
  VIZ,
  ZeroCell,
  clearDrillParams,
  floorFor,
  fmtCompact,
  fmtDateTime,
  fmtDay,
  fmtInt,
  fmtMs,
  fmtPct,
  fmtTokens,
  fmtTps,
  plural,
  statusFor,
  statusText,
  useMeasure,
  useMetricsParams,
  worstStatus,
  type Column,
  type Kpi,
  type MeasureOptions,
  type Status,
} from "./metrics/MetricsPrimitives";
import { ToolsPanel } from "./metrics/panels/ToolsPanel";
import { LlmCallsPanel } from "./metrics/panels/LlmCallsPanel";
import { QualityPanel } from "./metrics/panels/QualityPanel";
import { CoveragePanel } from "./metrics/panels/CoveragePanel";

interface MetricsPageV3Props {
  userId: string;
}

type MetricsTab = "overview" | "tools" | "llm" | "quality" | "coverage";

const TABS: Array<TabItem<MetricsTab>> = [
  { id: "overview", label: "Overview" },
  { id: "tools", label: "Tools" },
  { id: "llm", label: "LLM calls" },
  { id: "quality", label: "Quality" },
  { id: "coverage", label: "Coverage" },
];

const RANGE_OPTIONS = [
  { id: "1", label: "1d" },
  { id: "7", label: "7d" },
  { id: "30", label: "30d" },
] as const;

/** Per-day buckets follow the viewer's day, not UTC's. */
const VIEWER_TZ: string = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
})();

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function MetricsPageV3({ userId }: MetricsPageV3Props) {
  const { isAdmin, isAdminLoading } = useAdminStatus();
  const [params, setParams] = useSearchParams();

  const days = parseDays(params.get("range"));
  const agentParam = params.get("agent");
  const selectedAgents = useMemo(() => parseList(agentParam), [agentParam]);
  const tab = parseTab(params.get("tab"));
  const orgParam = params.get("orgScope");
  // orgScope is only honoured once admin status is known: reading it earlier
  // sent every all-orgs link out as "org" first and then again as "all".
  const scopeReady = !(orgParam && isAdminLoading);
  const allOrgs = !isAdminLoading && isAdmin && orgParam === "all";
  const orgScope: AdminOrgScope = allOrgs ? "all" : "org";

  const scope = useMemo<MetricsScopeParams>(
    () => ({ userId: scopeReady ? userId : "", days, orgScope, agentSlugs: selectedAgents, tz: VIEWER_TZ, isAdmin }),
    [scopeReady, userId, days, orgScope, selectedAgents, isAdmin],
  );

  const update = useCallback(
    (mutate: (next: URLSearchParams) => void) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          mutate(next);
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  // A non-admin who opens an all-orgs link gets their own org — but only once
  // admin status has resolved, or every admin's shared link would lose it.
  useEffect(() => {
    if (!isAdminLoading && !isAdmin && orgParam) update((n) => n.delete("orgScope"));
  }, [isAdmin, isAdminLoading, orgParam, update]);

  // "Updating…" follows the headline, the one request every tab makes.
  const summary = useSummary(scope);
  const updating = summary.data !== undefined && (summary.loading || summary.isPlaceholder);

  // The tab bar sticks under the filter bar; DataTable headers stick under both via --metrics-sticky-offset.
  const scrollRef = useRef<HTMLDivElement>(null);
  const filterBarRef = useRef<HTMLDivElement>(null);
  const tabsBarRef = useRef<HTMLDivElement>(null);
  const tabsAnchorRef = useRef<HTMLDivElement>(null);
  const [sticky, setSticky] = useState({ filter: 57, tabs: 41 });
  useLayoutEffect(() => {
    const filter = filterBarRef.current;
    const tabs = tabsBarRef.current;
    if (!filter || !tabs) return;
    const measure = (): void => setSticky({ filter: filter.offsetHeight, tabs: tabs.offsetHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(filter);
    observer.observe(tabs);
    return () => observer.disconnect();
  }, []);

  const setTab = (id: MetricsTab): void => {
    update((n) => {
      if (id === "overview") n.delete("tab");
      else n.set("tab", id);
      clearDrillParams(n, { keepMeasures: true });
    });
    // Switching tabs from deep in a long one would otherwise land mid-page.
    const container = scrollRef.current;
    const anchor = tabsAnchorRef.current;
    if (container && anchor) {
      const top = anchor.offsetTop - sticky.filter;
      if (container.scrollTop > top) container.scrollTop = top;
    }
  };

  const setAgents = useCallback(
    (next: string[]) =>
      update((n) => {
        if (next.length > 0) n.set("agent", next.join(","));
        else n.delete("agent");
        clearDrillParams(n);
      }),
    [update],
  );

  const single = selectedAgents.length === 1 ? selectedAgents[0]! : null;

  return (
    <div
      ref={scrollRef}
      className="relative flex-1 overflow-auto"
      style={{ ["--metrics-sticky-offset" as string]: `${sticky.filter + sticky.tabs}px` }}
    >
      <MetricsVizStyle />
      <div className="mx-auto w-full min-w-[640px] max-w-[1180px] px-[40px] pb-[56px] pt-[32px]">
        <div className="mb-[16px]">
          <h1 className="text-[22px] font-semibold text-xyne-fg-primary">{single ? `Agent · ${single}` : "Workspace Metrics"}</h1>
          <p className="mt-1 text-[13px] text-xyne-fg-muted">
            {single
              ? `Latency, reliability, tokens, tools and per-call model performance for ${single}.`
              : "Latency, reliability, tokens, tools and model performance across all agents and users."}
          </p>
        </div>

        {/* One filter row, sticky, so range and scope stay reachable from deep in a panel. */}
        <div
          ref={filterBarRef}
          className="sticky top-0 z-20 -mx-[40px] border-b border-xyne-border-subtle bg-xyne-surface/95 px-[40px] py-3 backdrop-blur"
        >
          <div className="flex flex-wrap items-center gap-3">
            <AgentPicker userId={scopeReady ? userId : ""} scope={scope} selected={selectedAgents} onChange={setAgents} />
            <SegmentedControl
              ariaLabel="Time range"
              options={RANGE_OPTIONS}
              value={String(days) as (typeof RANGE_OPTIONS)[number]["id"]}
              onChange={(id) =>
                update((n) => {
                  if (id === "7") n.delete("range");
                  else n.set("range", id);
                  clearDrillParams(n);
                })
              }
            />
            {isAdmin && (
              <ToggleField
                label="All orgs"
                checked={allOrgs}
                onChange={(next) =>
                  update((n) => {
                    if (next) n.set("orgScope", "all");
                    else n.delete("orgScope");
                    clearDrillParams(n);
                  })
                }
                hint="Show metrics across every organization"
              />
            )}
            <div className="ml-auto flex items-center gap-3">
              {updating && (
                <span className="inline-flex items-center gap-1.5 text-[12px] text-xyne-fg-muted" role="status">
                  <RefreshCw size={12} className="animate-spin" aria-hidden />
                  Updating…
                </span>
              )}
              <button
                type="button"
                onClick={() => invalidateMetrics()}
                title="Fetch every card again with the same filters"
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-xyne-border px-3 text-[12px] font-medium text-xyne-fg-secondary hover:border-xyne-border-strong hover:text-xyne-fg-primary"
              >
                <RefreshCw size={12} aria-hidden />
                Refresh
              </button>
            </div>
          </div>
        </div>

        <div className="mb-[20px] mt-[20px]">
          <HeadlineKpis scope={scope} />
        </div>

        <div ref={tabsAnchorRef} />
        <div
          ref={tabsBarRef}
          className="sticky z-10 -mx-[40px] mb-[20px] bg-xyne-surface/95 px-[40px] backdrop-blur"
          style={{ top: sticky.filter }}
        >
          <Tabs items={TABS} selected={tab} onSelect={setTab} />
        </div>

        {tab === "overview" && <OverviewTab scope={scope} onAgent={(slug) => setAgents([slug])} />}
        {tab === "tools" && <ToolsPanel scope={scope} />}
        {tab === "llm" && <LlmCallsPanel scope={scope} />}
        {tab === "quality" && <QualityPanel scope={scope} />}
        {tab === "coverage" && <CoveragePanel scope={scope} />}
      </div>

      <SessionsDrawer scope={scope} />
    </div>
  );
}

function parseDays(raw: string | null): MetricsDays {
  const n = Number(raw);
  return n === 1 || n === 30 ? n : 7;
}

/** Comma-separated URL list → deduped values. Empty yields []. */
function parseList(raw: string | null): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(",").map((v) => v.trim()).filter(Boolean))];
}

function parseTab(raw: string | null): MetricsTab {
  return TABS.some((t) => t.id === raw) ? (raw as MetricsTab) : "overview";
}

/* ── Agent picker ─────────────────────────────────────────────────────────── */

/** Agent filter options: the roster united with agents that ran in the last 30 days; the run list loads on first open. */
function AgentPicker({
  userId,
  scope,
  selected,
  onChange,
}: {
  userId: string;
  scope: MetricsScopeParams;
  selected: string[];
  onChange: (next: string[]) => void;
}): ReactElement {
  const [opened, setOpened] = useState(false);
  const rosterKey = userId ? `${userId} /agents?scope=all&orgScope=${scope.orgScope}` : null;
  const roster = useMetricsResource<AgentLight[]>(rosterKey, "/agents", () => listAgents(userId, true, scope.orgScope));
  const active = useActiveAgents(scope, undefined, { enabled: opened });
  const options = useMemo(() => {
    const slugs = new Set<string>();
    for (const a of roster.data ?? []) slugs.add(a.slug);
    for (const a of active.data?.agents ?? []) slugs.add(a.agentSlug);
    return [...slugs].sort();
  }, [roster.data, active.data]);
  const loading = roster.loading || (opened && active.loading);
  return (
    <MultiSelect
      noun="agents"
      allLabel="All agents"
      options={options}
      selected={selected}
      emptyMessage={loading ? "Loading agents…" : "No agents yet."}
      onChange={onChange}
      // The run list loads the first time the list opens and stays loaded.
      onOpenChange={(open) => {
        if (open) setOpened(true);
      }}
    />
  );
}

/* ── Sessions drawer (drill=failed|slow|model) ────────────────────────────── */

type DrillKind = "failed" | "slow" | "model";

function parseStatuses(raw: string | null): Array<"failed" | "cancelled"> {
  const out = parseList(raw).filter((s): s is "failed" | "cancelled" => s === "failed" || s === "cancelled");
  return out.length > 0 ? out : ["failed", "cancelled"];
}

/** Run-level drill-down (failed/slow/model); page-level and URL-driven, so Back closes it. */
function SessionsDrawer({ scope }: { scope: MetricsScopeParams }): ReactElement | null {
  const [params] = useSearchParams();
  const patch = useMetricsParams();
  const raw = params.get("drill");
  if (raw !== "failed" && raw !== "slow" && raw !== "model") return null;
  const kind: DrillKind = raw;
  const close = (): void => patch({ drill: null, status: null, minMs: null, model: null, provider: null });
  const widen = (): void => patch({ range: 30 }, { replace: true });

  let request: Omit<MetricSessionsRequest, "limit" | "cursor" | "count">;
  let title: string;
  let subject: ReactNode;
  let subtitle: ReactNode;
  if (kind === "failed") {
    const statuses = parseStatuses(params.get("status"));
    request = { kind, status: statuses };
    const both = statuses.length === 2;
    title = both ? "Failed and cancelled runs" : statuses[0] === "failed" ? "Failed runs" : "Cancelled runs";
    subject = both ? "the run failed or was cancelled" : statuses[0] === "failed" ? "the run failed" : "the run was cancelled";
    subtitle = "Newest first. Open a run to read its transcript and trace.";
  } else if (kind === "slow") {
    const minMs = Number(params.get("minMs"));
    const hasMin = Number.isFinite(minMs) && minMs > 0;
    request = hasMin ? { kind, minMs: Math.round(minMs) } : { kind };
    title = hasMin ? `Runs at or above ${fmtMs(minMs)}` : "Slowest runs";
    subject = hasMin ? `the run took at least ${fmtMs(minMs)} end to end` : "the run completed, slowest first";
    subtitle = "Completed runs by end-to-end time, slowest first. The bar splits each run into model, tool and other time.";
  } else {
    const model = params.get("model") ?? "";
    const provider = params.get("provider");
    request = provider ? { kind, model, provider } : { kind, model };
    title = `Runs on ${model || "unknown model"}`;
    subject = (
      <>
        the run used <code className="font-mono">{model}</code>
        {provider ? <> via {provider}</> : null}
      </>
    );
    subtitle = "Newest first, with each run's model-call figures where the per-call series was recorded.";
  }

  return (
    <Drawer title={title} heading={<span className="font-sans">{title}</span>} subtitle={subtitle} onClose={close} width={760}>
      <SessionsList scope={scope} request={request} subject={subject} onWiden={widen} />
    </Drawer>
  );
}

/* ── Overview ─────────────────────────────────────────────────────────────── */

/** Sections sharing the headline's requests come first; later ones are LazyCards that fetch on scroll. */
function OverviewTab({ scope, onAgent }: { scope: MetricsScopeParams; onAgent: (slug: string) => void }): ReactElement {
  const agent = scope.agentSlugs.length === 1 ? scope.agentSlugs[0]! : null;
  return (
    <div className="flex flex-col gap-[28px]">
      <Section question="Where does the time go?">
        <TimeSplitCard scope={scope} />
      </Section>

      <Section question="Is it getting slower?">
        <RunTimeCard scope={scope} />
      </Section>

      <Section question="How much is it used?">
        <RunsPerDayCard scope={scope} />
        <div className="grid grid-cols-1 items-start gap-[20px] lg:grid-cols-2">
          <TriggerMixCard scope={scope} />
          <TokensCard scope={scope} />
        </div>
      </Section>

      <Section question={agent ? "How do users feel, and what should change?" : "Which agents and models?"}>
        {agent ? (
          <>
            <LazyCard minHeight={260} placeholder={<CardPlaceholder title="User sentiment and feedback" skeleton={<RowsSkeleton rows={2} />} />}>
              <SentimentCard scope={scope} />
            </LazyCard>
            <LazyCard minHeight={120}>
              <ImprovementsCard userId={scope.userId} agentSlug={agent} />
            </LazyCard>
            <LazyCard minHeight={300} placeholder={<CardPlaceholder title="Slowest tools for this agent" skeleton={<TableSkeleton rows={5} cols={6} />} />}>
              <ToolLatencyCard scope={scope} />
            </LazyCard>
          </>
        ) : (
          <LazyCard minHeight={360} placeholder={<CardPlaceholder title="Agents leaderboard" skeleton={<TableSkeleton rows={6} cols={7} />} />}>
            <AgentsLeaderboardCard scope={scope} onAgent={onAgent} />
          </LazyCard>
        )}
        <LazyCard minHeight={260} placeholder={<CardPlaceholder title="Model time by route and model" skeleton={<TableSkeleton rows={4} cols={8} />} />}>
          <RoutesCard scope={scope} />
        </LazyCard>
      </Section>

      <Section question="What was slowest?">
        <LazyCard minHeight={400} placeholder={<CardPlaceholder title="Slowest runs" skeleton={<RowsSkeleton rows={4} />} />}>
          <SlowestRunsCard scope={scope} />
        </LazyCard>
        {!agent && (
          <LazyCard minHeight={56}>
            <AwakeningActivityCard scope={scope} />
          </LazyCard>
        )}
      </Section>
    </div>
  );
}

function Section({ question, children }: { question: string; children: ReactNode }): ReactElement {
  return (
    <section className="flex flex-col gap-[12px]" aria-label={question}>
      <h2 className="text-[13px] font-semibold text-xyne-fg-secondary">{question}</h2>
      <div className="flex flex-col gap-[20px]">{children}</div>
    </section>
  );
}

/** What a LazyCard shows before it mounts: the card's own frame and skeleton, so nothing jumps. */
function CardPlaceholder({ title, skeleton }: { title: string; skeleton: ReactNode }): ReactElement {
  return <MetricsCard title={title} loading skeleton={skeleton} />;
}

/* ── Shared chart bits ────────────────────────────────────────────────────── */

const CHART_HEIGHT = 220;

/** The y-axis "what": a muted caption above the plot, never rotated text that clips. */
function AxisCaption({ children }: { children: ReactNode }): ReactElement {
  return <p className="mb-1 text-[11px] text-xyne-fg-muted">{children}</p>;
}

/** One unit per chart, picked from its max, so ticks never mix "45.0s" with "1.0m". */
function timeUnit(maxMs: number): { div: number; suffix: string; label: string } {
  if (maxMs >= 2 * 3_600_000) return { div: 3_600_000, suffix: "h", label: "hours" };
  if (maxMs >= 120_000) return { div: 60_000, suffix: "m", label: "minutes" };
  return { div: 1000, suffix: "s", label: "seconds" };
}

function tickIn(unit: { div: number; suffix: string }): (v: number) => string {
  return (v: number) => {
    const x = v / unit.div;
    return `${x >= 10 || Number.isInteger(x) ? Math.round(x) : x.toFixed(1)}${unit.suffix}`;
  };
}

/** Diagonal-stripe fills for days that rest on too few runs; referenced as url(#id) from any chart. */
function HatchDefs({ id, colors }: { id: string; colors: Record<string, string> }): ReactElement {
  return (
    <svg aria-hidden width="0" height="0" className="absolute">
      <defs>
        {Object.entries(colors).map(([key, color]) => (
          <pattern key={key} id={`${id}-${key}`} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
            <rect width="6" height="6" fill={VIZ.neutralSoft} fillOpacity={0.35} />
            <line x1="0" y1="0" x2="0" y2="6" stroke={color} strokeWidth="3" />
          </pattern>
        ))}
      </defs>
    </svg>
  );
}

function useSvgId(prefix: string): string {
  return `${prefix}${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

/* ── 1. Where does the time go? ───────────────────────────────────────────── */

type SplitMeasure = "avg" | "total";
const SPLIT_OPTIONS: MeasureOptions<SplitMeasure> = [
  { id: "avg", label: "Average per run" },
  { id: "total", label: "Total per day" },
];

interface SplitDatum {
  day: string;
  llm: number | null;
  tool: number | null;
  n: number;
  runs: number;
}

function TimeSplitCard({ scope }: { scope: MetricsScopeParams }): ReactElement {
  const daily = useRunDaily(scope);
  const summary = useSummary(scope);
  const [measure] = useMeasure("split", SPLIT_OPTIONS, "avg");
  const hatch = useSvgId("split");
  const avg = measure === "avg";

  const data: SplitDatum[] = (daily.data?.days ?? []).map((d) => ({
    day: fmtDay(d.day),
    llm: d.agent.n === 0 ? null : avg ? d.agent.avgLlmMs : d.agent.totalLlmMs,
    tool: d.agent.n === 0 ? null : avg ? d.agent.avgToolMs : d.agent.totalToolMs,
    n: d.agent.n,
    runs: d.runs,
  }));
  const max = Math.max(0, ...data.map((d) => (d.llm ?? 0) + (d.tool ?? 0)));
  const unit = timeUnit(max);
  const cur = summary.data?.current;
  const anyThin = data.some((d) => d.n > 0 && d.n < SAMPLE_FLOORS.avg);

  const headline = cur ? <SplitHeadline cur={cur} /> : null;
  const empty = daily.data && data.every((d) => d.n === 0);

  return (
    <MetricsCard
      title="Where a run's time goes, per day"
      subtitle={
        avg
          ? "Bar = average time per run, split into model time and tool time (agent-reported)."
          : "Bar = all model and tool time added up across the day's runs (agent-reported)."
      }
      action={<MeasureToggle card="split" options={SPLIT_OPTIONS} defaultId="avg" ariaLabel="Average or total" />}
      loading={!daily.data && !daily.error}
      busy={daily.isPlaceholder}
      footnote={
        cur ? (
          <>
            Agent-reported time from {fmtInt(cur.agent.n)} of {fmtInt(cur.runs)} runs; end-to-end time is in the headline.
            {anyThin && avg && <> Striped days rest on fewer than {SAMPLE_FLOORS.avg} runs.</>}
          </>
        ) : undefined
      }
    >
      {daily.error ? (
        <PanelError error={daily.error} onRetry={daily.refetch} />
      ) : empty ? (
        <p className="py-10 text-center text-[13px] text-xyne-fg-muted">No run in this window reported its model or tool time.</p>
      ) : (
        <>
          {headline}
          <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
            <AxisCaption>{avg ? `${titleCase(unit.label)} per run` : `${titleCase(unit.label)} per day`}</AxisCaption>
            <ChartLegend
              items={[
                { label: "Model time", color: VIZ.accent },
                { label: "Tool time", color: VIZ.neutral },
              ]}
            />
          </div>
          <HatchDefs id={hatch} colors={{ llm: VIZ.accent, tool: VIZ.neutral }} />
          <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
            <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={VIZ.grid} vertical={false} />
              <XAxis dataKey="day" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} minTickGap={8} />
              <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={44} tickFormatter={tickIn(unit)} />
              <Tooltip
                cursor={BAR_CURSOR}
                content={
                  <ChartTooltip<SplitDatum>
                    rows={(d) =>
                      d.n === 0
                        ? [{ label: "no run reported its time", value: "—" }]
                        : [
                            { label: avg ? "model, per run" : "model, all runs", value: fmtMs(d.llm), color: VIZ.accent },
                            { label: avg ? "tools, per run" : "tools, all runs", value: fmtMs(d.tool), color: VIZ.neutral },
                            { label: `of ${fmtInt(d.runs)} ${plural(d.runs, "run")} reported time`, value: fmtInt(d.n) },
                          ]
                    }
                  />
                }
              />
              <Bar dataKey="llm" stackId="s" stroke={VIZ.surface} strokeWidth={2} maxBarSize={24} isAnimationActive={false}>
                {data.map((d) => (
                  <Cell key={d.day} fill={avg && d.n < SAMPLE_FLOORS.avg ? `url(#${hatch}-llm)` : VIZ.accent} />
                ))}
              </Bar>
              <Bar dataKey="tool" stackId="s" stroke={VIZ.surface} strokeWidth={2} maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false}>
                {data.map((d) => (
                  <Cell key={d.day} fill={avg && d.n < SAMPLE_FLOORS.avg ? `url(#${hatch}-tool)` : VIZ.neutral} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </>
      )}
    </MetricsCard>
  );
}

/** "Avg run: 20.0s model · 2.1s tools" — the window mean, with its n when thin. */
function SplitHeadline({ cur }: { cur: SummaryFigures }): ReactElement | null {
  const a = cur.agent;
  if (a.n === 0) return null;
  const thin = a.n < SAMPLE_FLOORS.avg;
  return (
    <p className={cn("mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] tabular-nums", thin ? "text-xyne-fg-muted" : "text-xyne-fg-primary")}>
      <span className="text-xyne-fg-muted">Avg run:</span>
      <span className="inline-flex items-center gap-1 font-semibold">
        <BrainCircuit size={13} className="text-xyne-fg-muted" aria-hidden />
        {fmtMs(a.avgLlmMs)} model
      </span>
      <span className="text-xyne-fg-muted">·</span>
      <span className="inline-flex items-center gap-1 font-semibold">
        <Wrench size={13} className="text-xyne-fg-muted" aria-hidden />
        {fmtMs(a.avgToolMs)} tools
      </span>
      {a.avgOtherMs != null && a.avgOtherMs > 0 && <span className="text-xyne-fg-muted">· {fmtMs(a.avgOtherMs)} other</span>}
      {thin && <SampleChip n={a.n} noun="runs with agent-reported time" floor={SAMPLE_FLOORS.avg} />}
    </p>
  );
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* ── 2. Is it getting slower? ─────────────────────────────────────────────── */

interface PctDatum {
  day: string;
  value: number | null;
  n: number;
  runs: number;
}

function RunTimeCard({ scope }: { scope: MetricsScopeParams }): ReactElement {
  const daily = useRunDaily(scope);
  const days = daily.data?.days ?? [];
  const p50: PctDatum[] = days.map((d) => ({ day: fmtDay(d.day), value: d.wall.n > 0 ? d.wall.p50Ms : null, n: d.wall.n, runs: d.runs }));
  const p95: PctDatum[] = days.map((d) => ({ day: fmtDay(d.day), value: d.wall.n > 0 ? d.wall.p95Ms : null, n: d.wall.n, runs: d.runs }));
  const empty = daily.data && days.every((d) => d.wall.n === 0);
  return (
    <MetricsCard
      title="Run time per day"
      subtitle="End-to-end time of the day's completed runs. Watch the slow tail for upward drift."
      loading={!daily.data && !daily.error}
      busy={daily.isPlaceholder}
      skeleton={<ChartSkeleton height={280} />}
      footnote={
        <>
          Hollow grey points rest on too few runs that day (under {SAMPLE_FLOORS.p50} for the typical run, under {SAMPLE_FLOORS.p95} for the slow
          tail); gaps are days with no completed run.
        </>
      }
    >
      {daily.error ? (
        <PanelError error={daily.error} onRetry={daily.refetch} />
      ) : empty ? (
        <p className="py-10 text-center text-[13px] text-xyne-fg-muted">No completed runs in this window.</p>
      ) : (
        <div className="flex flex-col gap-4">
          <PctMiniChart data={p50} label="Typical run (p50)" floor={SAMPLE_FLOORS.p50} showX={false} />
          <PctMiniChart data={p95} label="Slow tail (p95)" floor={SAMPLE_FLOORS.p95} showX />
        </div>
      )}
    </MetricsCard>
  );
}

function PctMiniChart({ data, label, floor, showX }: { data: PctDatum[]; label: string; floor: number; showX: boolean }): ReactElement {
  const unit = timeUnit(Math.max(0, ...data.map((d) => d.value ?? 0)));
  return (
    <div>
      <AxisCaption>
        <span className="font-medium text-xyne-fg-secondary">{label}</span> · {unit.label}
      </AxisCaption>
      <ResponsiveContainer width="100%" height={showX ? 130 : 110}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={VIZ.grid} vertical={false} />
          <XAxis dataKey="day" hide={!showX} tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} minTickGap={8} />
          <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={44} tickFormatter={tickIn(unit)} />
          <Tooltip
            cursor={LINE_CURSOR}
            content={
              <ChartTooltip<PctDatum>
                rows={(d) =>
                  d.value == null
                    ? [{ label: "no completed run", value: "—" }]
                    : [
                        { label, value: fmtMs(d.value), color: VIZ.accent },
                        { label: `completed ${plural(d.n, "run")}${d.n < floor ? " — too few to trust" : ""}`, value: fmtInt(d.n) },
                      ]
                }
              />
            }
          />
          <Line
            type="linear"
            dataKey="value"
            name={label}
            stroke={VIZ.accent}
            strokeWidth={2}
            connectNulls={false}
            isAnimationActive={false}
            dot={(props: { cx?: number; cy?: number; index?: number; payload?: PctDatum }) => {
              const { cx, cy, payload, index } = props;
              if (cx == null || cy == null || !payload || payload.value == null) return <g key={`d${index}`} />;
              const hollow = payload.n < floor;
              return (
                <circle
                  key={`d${index}`}
                  cx={cx}
                  cy={cy}
                  r={4}
                  fill={hollow ? VIZ.surface : VIZ.accent}
                  stroke={hollow ? VIZ.neutral : VIZ.surface}
                  strokeWidth={2}
                />
              );
            }}
            activeDot={{ r: 5, stroke: VIZ.surface, strokeWidth: 2 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ── 3. How much is it used? ──────────────────────────────────────────────── */

type RunsMeasure = "outcome" | "trigger";
const RUNS_OPTIONS: MeasureOptions<RunsMeasure> = [
  { id: "outcome", label: "By outcome" },
  { id: "trigger", label: "By trigger" },
];

const TRIGGER_META: Record<TriggerGroup, { label: string; icon: LucideIcon }> = {
  user: { label: "User", icon: UserRound },
  automation: { label: "Automation", icon: Workflow },
  scheduled: { label: "Scheduled", icon: CalendarClock },
  api: { label: "API / CLI", icon: Terminal },
  awakened: { label: "Awakened", icon: AlarmClock },
  delegation: { label: "Delegated", icon: GitFork },
  messaging: { label: "Messaging", icon: MessageSquare },
  other: { label: "Other", icon: Circle },
};
const TRIGGER_ORDER: TriggerGroup[] = ["user", "automation", "scheduled", "api", "awakened", "delegation", "messaging", "other"];
/** Fixed order, never cycled; groups past the third fold into "Other" (four colours is the palette). */
const TRIGGER_COLORS = [VIZ.accent, VIZ.accentSoft, VIZ.neutral] as const;

type RunsDatum = { day: string; runs: number; completed: number; failed: number; cancelled: number } & Record<string, number | string>;

function RunsPerDayCard({ scope }: { scope: MetricsScopeParams }): ReactElement {
  const daily = useRunDaily(scope);
  const [measure] = useMeasure("runs", RUNS_OPTIONS, "outcome");
  const days = daily.data?.days ?? [];
  const triggers = daily.data?.triggers ?? [];

  // Colour follows the trigger's rank in the WINDOW, so a day's bars never repaint.
  const ranked = [...triggers].sort((a, b) => b.runs - a.runs).map((t) => t.group);
  const shown = ranked.length <= TRIGGER_COLORS.length + 1 ? ranked : ranked.slice(0, TRIGGER_COLORS.length);
  const folded = ranked.filter((g) => !shown.includes(g));
  const series = [
    ...shown.map((g, i) => ({ key: g, label: TRIGGER_META[g].label, color: TRIGGER_COLORS[i] ?? VIZ.neutralSoft })),
    ...(folded.length > 0 ? [{ key: "__other", label: `Other (${folded.length})`, color: VIZ.neutralSoft }] : []),
  ];

  const data: RunsDatum[] = days.map((d) => {
    const row: RunsDatum = { day: fmtDay(d.day), runs: d.runs, completed: d.completed, failed: d.failed, cancelled: d.cancelled };
    for (const g of shown) row[g] = d.byTrigger[g] ?? 0;
    if (folded.length > 0) row.__other = folded.reduce((a, g) => a + (d.byTrigger[g] ?? 0), 0);
    return row;
  });

  const total = days.reduce((a, d) => a + d.runs, 0);
  const peak = days.reduce<DailyPoint | null>((best, d) => (!best || d.runs > best.runs ? d : best), null);
  const dominant = peak && total > 0 && days.length > 1 && peak.runs / total > 0.5 ? peak : null;
  const outcome = measure === "outcome";
  const stacks = outcome
    ? [
        { key: "completed", label: "Completed", color: VIZ.accent },
        { key: "failed", label: "Failed", color: VIZ.danger },
        { key: "cancelled", label: "Cancelled", color: VIZ.neutral },
      ]
    : series;

  return (
    <MetricsCard
      title="Runs per day"
      subtitle={outcome ? "Bar height = runs that finished that day, stacked by outcome." : "Bar height = runs that finished that day, stacked by what started them."}
      action={<MeasureToggle card="runs" options={RUNS_OPTIONS} defaultId="outcome" ariaLabel="Stack by" />}
      loading={!daily.data && !daily.error}
      busy={daily.isPlaceholder}
      footnote={dominant ? <>{fmtDay(dominant.day)} holds {fmtPct(dominant.runs / total)} of the window's runs.</> : undefined}
    >
      {daily.error ? (
        <PanelError error={daily.error} onRetry={daily.refetch} />
      ) : total === 0 ? (
        <p className="py-10 text-center text-[13px] text-xyne-fg-muted">No runs finished in this window.</p>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
            <AxisCaption>Runs</AxisCaption>
            <ChartLegend items={stacks.map((s) => ({ label: s.label, color: s.color }))} />
          </div>
          <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
            <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={VIZ.grid} vertical={false} />
              <XAxis dataKey="day" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} minTickGap={8} />
              <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={44} allowDecimals={false} tickFormatter={(v: number) => fmtCompact(v)} />
              <Tooltip
                cursor={BAR_CURSOR}
                content={
                  <ChartTooltip<RunsDatum>
                    rows={(d) => [
                      ...stacks.map((s) => ({ label: s.label.toLowerCase(), value: fmtInt(Number(d[s.key] ?? 0)), color: s.color })),
                      { label: "runs in total", value: fmtInt(d.runs) },
                      ...(d.runs > 0 ? [{ label: "failed or cancelled", value: fmtPct((d.failed + d.cancelled) / d.runs) }] : []),
                    ]}
                  />
                }
              />
              {stacks.map((s, i) => (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  stackId="s"
                  fill={s.color}
                  stroke={VIZ.surface}
                  strokeWidth={2}
                  maxBarSize={24}
                  radius={i === stacks.length - 1 ? [4, 4, 0, 0] : undefined}
                  isAnimationActive={false}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </>
      )}
    </MetricsCard>
  );
}

/** Only triggers that ran; the rest collapse into one muted line instead of empty tiles. */
function TriggerMixCard({ scope }: { scope: MetricsScopeParams }): ReactElement {
  const daily = useRunDaily(scope);
  const rows = [...(daily.data?.triggers ?? [])].filter((t) => t.runs > 0).sort((a, b) => b.runs - a.runs);
  const absent = TRIGGER_ORDER.filter((g) => g !== "other" && !rows.some((r) => r.group === g)).map((g) => TRIGGER_META[g].label);
  return (
    <MetricsCard
      title="What starts the runs"
      subtitle="Runs per trigger, with how often they succeed and how long they take end to end."
      loading={!daily.data && !daily.error}
      busy={daily.isPlaceholder}
      skeleton={<RowsSkeleton rows={3} />}
      footnote={absent.length > 0 && rows.length > 0 ? <>No {joinWords(absent.map((a) => a.toLowerCase()))} runs in this window.</> : undefined}
    >
      {daily.error ? (
        <PanelError error={daily.error} onRetry={daily.refetch} />
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-[13px] text-xyne-fg-muted">No runs finished in this window.</p>
      ) : (
        <ul className="flex flex-col">
          {rows.map((r) => (
            <TriggerRowView key={r.group} row={r} />
          ))}
        </ul>
      )}
    </MetricsCard>
  );
}

function TriggerRowView({ row }: { row: TriggerRow }): ReactElement {
  const meta = TRIGGER_META[row.group];
  const Icon = meta.icon;
  const success = statusFor("runSuccess", row.successRate, row.runs);
  const p50 = statusFor("runP50", row.wall.p50Ms, row.wall.n);
  const p95 = statusFor("runP95", row.wall.p95Ms, row.wall.n);
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-x-4 border-t border-xyne-border-subtle py-2.5 first:border-t-0">
      <span className="flex min-w-0 items-center gap-2">
        <Icon size={14} className="shrink-0 text-xyne-fg-muted" aria-hidden />
        <span className="truncate text-[13px] text-xyne-fg-primary">{meta.label}</span>
        <span className="text-[18px] font-semibold tabular-nums text-xyne-fg-primary">{fmtInt(row.runs)}</span>
      </span>
      <MiniFigure label="success">
        <StatusValue status={success} n={row.runs} noun="runs" floor={floorFor("runSuccess")}>
          {fmtPct(row.successRate)}
        </StatusValue>
      </MiniFigure>
      <MiniFigure label="p50">
        <StatusValue status={p50} n={row.wall.n} noun="timed runs" floor={SAMPLE_FLOORS.p50} naWhy="No completed run">
          {fmtMs(row.wall.p50Ms)}
        </StatusValue>
      </MiniFigure>
      <MiniFigure label="p95">
        {p95 === "thin" ? (
          <span className="text-xyne-fg-muted" title={`Only ${fmtInt(row.wall.n)} timed runs — p95 needs ${SAMPLE_FLOORS.p95}+`}>
            —
          </span>
        ) : (
          <StatusValue status={p95} naWhy="No completed run">
            {fmtMs(row.wall.p95Ms)}
          </StatusValue>
        )}
      </MiniFigure>
    </li>
  );
}

function MiniFigure({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <span className="flex min-w-[64px] flex-col items-end text-[13px] tabular-nums">
      {children}
      <span className="text-[10px] uppercase tracking-wider text-xyne-fg-muted">{label}</span>
    </span>
  );
}

function joinWords(words: string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} or ${words[words.length - 1]}`;
}

type TokensMeasure = "run" | "total";
const TOKENS_OPTIONS: MeasureOptions<TokensMeasure> = [
  { id: "run", label: "Per run" },
  { id: "total", label: "Window total" },
];

/** Same definition as the headline tile: prompt = fresh + cache read + cache write, over runs with tokens. */
function TokensCard({ scope }: { scope: MetricsScopeParams }): ReactElement {
  const summary = useSummary(scope);
  const [measure] = useMeasure("tokens", TOKENS_OPTIONS, "run");
  const tk = summary.data?.current.tokens;
  const runs = summary.data?.current.runs ?? 0;
  const perRun = measure === "run";
  // Same rule as the headline tile: under the average floor or under 10% capture.
  const thin = tk ? tk.n < SAMPLE_FLOORS.avg || statusFor("capture", tk.n / Math.max(1, runs), runs) === "thin" : false;

  let items: Kpi[] = [];
  if (tk) {
    const fresh = perRun ? tk.freshPerRun : tk.freshPerRun != null ? tk.freshPerRun * tk.n : null;
    const cached = perRun ? tk.cachedPerRun : tk.cachedPerRun != null ? tk.cachedPerRun * tk.n : null;
    const prompt = perRun ? tk.promptPerRun : tk.promptTotal;
    const output = perRun ? tk.outputPerRun : tk.outputTotal;
    const split = fresh != null && cached != null && fresh + cached > 0 ? cached / (fresh + cached) : null;
    const status: Status | undefined = tk.n === 0 ? "na" : thin ? "thin" : undefined;
    items = [
      {
        key: "prompt",
        label: "Prompt",
        icon: Coins,
        value: fmtTokens(prompt),
        status,
        n: tk.n,
        nLabel: "runs with tokens",
        floor: SAMPLE_FLOORS.avg,
        naWhy: "No run recorded tokens",
        hint: "Every token sent to the model: fresh input plus cache reads and writes.",
        line:
          split != null ? (
            <span className="flex items-center gap-1.5">
              <InlineBar value={split} color={VIZ.accent} width={48} />
              {fmtTokens(fresh)} fresh · {fmtTokens(cached)} cached
            </span>
          ) : undefined,
      },
      {
        key: "output",
        label: "Output",
        icon: Coins,
        value: fmtTokens(output),
        status,
        n: tk.n,
        nLabel: "runs with tokens",
        floor: SAMPLE_FLOORS.avg,
        naWhy: "No run recorded tokens",
        line: perRun ? "Generated by the model, per run." : "Generated by the model in this window.",
      },
      {
        key: "cache",
        label: "Cache hit",
        icon: Database,
        value: fmtPct(tk.cacheHitRate),
        status: tk.n === 0 ? "na" : statusFor("cacheHit", tk.cacheHitRate, tk.n),
        n: tk.n,
        nLabel: "runs with tokens",
        floor: floorFor("cacheHit"),
        naWhy: "No run recorded tokens",
        hint: "Cache-read ÷ every prompt token. Higher is cheaper and faster.",
        line: "Of prompt tokens served from cache.",
      },
    ];
  }

  return (
    <MetricsCard
      title="Tokens"
      subtitle={perRun ? "Averaged over runs that recorded tokens." : "Added up across the window."}
      action={<MeasureToggle card="tokens" options={TOKENS_OPTIONS} defaultId="run" ariaLabel="Per run or window total" />}
      loading={!summary.data && !summary.error}
      skeleton={<RowsSkeleton rows={2} />}
      busy={summary.isPlaceholder}
      footnote={tk && runs > 0 && tk.n / runs < 0.9 ? <>Tokens recorded for {fmtInt(tk.n)} of {fmtInt(runs)} runs.</> : undefined}
    >
      {summary.error ? <PanelError error={summary.error} onRetry={summary.refetch} /> : <KpiStrip items={items} cols="grid-cols-1 @min-[420px]:grid-cols-3" />}
    </MetricsCard>
  );
}

/* ── 4. Which agents and models? ──────────────────────────────────────────── */

function AgentsLeaderboardCard({ scope, onAgent }: { scope: MetricsScopeParams; onAgent: (slug: string) => void }): ReactElement {
  const top = useAgentsTop(scope, { limit: 20 });
  const rows = top.data?.rows ?? [];
  const maxRuns = Math.max(1, ...rows.map((r) => r.runs));
  const showOrg = scope.orgScope === "all";

  const columns: Array<Column<AgentLeaderRow>> = [
    {
      key: "agent",
      header: "Agent",
      sortValue: (r) => r.agentSlug,
      render: (r) => {
        const worst = worstStatus([statusFor("runSuccess", r.successRate, r.runs), statusFor("runP95", r.wall.p95Ms, r.wall.n)]);
        return (
          <span className="flex min-w-0 items-center gap-1.5">
            <StatusGlyph status={worst} />
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-mono text-[12px] font-medium">{r.agentSlug}</span>
              {showOrg && <span className="truncate text-[11px] text-xyne-fg-muted">{r.orgName ?? "Unnamed org"}</span>}
            </span>
          </span>
        );
      },
    },
    {
      key: "runs",
      header: "Runs",
      numeric: true,
      sortValue: (r) => r.runs,
      render: (r) => (
        <span className="inline-flex items-center justify-end gap-2">
          <InlineBar value={r.runs / maxRuns} color={VIZ.accentSoft} width={40} />
          <span className="min-w-[40px] font-medium">{fmtInt(r.runs)}</span>
        </span>
      ),
    },
    {
      key: "success",
      header: "Success",
      numeric: true,
      sortValue: (r) => r.successRate,
      hint: "Completed ÷ finished runs",
      render: (r) => (
        <StatusValue status={statusFor("runSuccess", r.successRate, r.runs)} n={r.runs} noun="runs" floor={floorFor("runSuccess")}>
          {fmtPct(r.successRate)}
        </StatusValue>
      ),
    },
    {
      key: "p50",
      header: "p50",
      group: "End-to-end",
      numeric: true,
      sortValue: (r) => r.wall.p50Ms,
      render: (r) => (
        <StatusValue status={statusFor("runP50", r.wall.p50Ms, r.wall.n)} n={r.wall.n} noun="timed runs" floor={SAMPLE_FLOORS.p50} naWhy="No completed run">
          {fmtMs(r.wall.p50Ms)}
        </StatusValue>
      ),
    },
    {
      key: "p95",
      header: "p95",
      group: "End-to-end",
      numeric: true,
      sortValue: (r) => (r.wall.n >= SAMPLE_FLOORS.p95 ? r.wall.p95Ms : null),
      render: (r) => <P95Cell p95={r.wall.p95Ms} n={r.wall.n} />,
    },
    {
      key: "llm",
      header: "Model",
      group: "Avg per run",
      numeric: true,
      sortValue: (r) => r.agent.avgLlmMs,
      hint: "Agent-reported model time per run",
      render: (r) => <AvgCell ms={r.agent.avgLlmMs} n={r.agent.n} />,
    },
    {
      key: "tool",
      header: "Tools",
      group: "Avg per run",
      numeric: true,
      sortValue: (r) => r.agent.avgToolMs,
      hint: "Agent-reported tool time per run",
      render: (r) => <AvgCell ms={r.agent.avgToolMs} n={r.agent.n} />,
    },
    {
      key: "open",
      header: "",
      render: () => <ChevronRight size={14} className="text-xyne-fg-muted" aria-hidden />,
    },
  ];

  return (
    <MetricsCard
      title="Agents leaderboard"
      subtitle="By runs in the window. Click a row to scope the page to that agent."
      loading={!top.data && !top.error}
      skeleton={<TableSkeleton rows={6} cols={7} />}
      busy={top.isPlaceholder}
    >
      {top.error ? (
        <PanelError error={top.error} onRetry={top.refetch} />
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(r) => `${r.orgId}\u0000${r.agentSlug}`}
          initialSort={{ key: "runs", dir: "desc" }}
          onRowClick={(r) => onAgent(r.agentSlug)}
          rowTitle={(r) => `Scope the page to ${r.agentSlug}`}
          rowStatus={(r) => worstStatus([statusFor("runSuccess", r.successRate, r.runs), statusFor("runP95", r.wall.p95Ms, r.wall.n)])}
          emptyMessage="No runs in this window."
          // Ten rows plus the grouped header; the org line makes each row taller.
          maxHeight={showOrg ? 560 : 440}
          minWidth={720}
          maxRows={10}
        />
      )}
    </MetricsCard>
  );
}

/** p95 is hidden under its floor (a p95 of 3 runs is just the slowest run), with the n beside the dash. */
function P95Cell({ p95, n }: { p95: number | null; n: number }): ReactElement {
  if (n === 0 || p95 == null) return <Unknown why="No timed run" />;
  if (n < SAMPLE_FLOORS.p95) {
    return (
      <span className="inline-flex items-center justify-end gap-1">
        <Unknown why={`Only ${fmtInt(n)} timed ${plural(n, "run")} — p95 needs ${SAMPLE_FLOORS.p95}+`} />
        <SampleChip n={n} noun="timed runs" floor={SAMPLE_FLOORS.p95} />
      </span>
    );
  }
  return <StatusValue status={statusFor("runP95", p95, n)}>{fmtMs(p95)}</StatusValue>;
}

function AvgCell({ ms, n }: { ms: number | null; n: number }): ReactElement {
  if (n === 0 || ms == null) return <Unknown why="No run reported this time" />;
  if (ms === 0) return <ZeroCell />;
  const thin = n < SAMPLE_FLOORS.avg;
  return (
    <StatusValue status={thin ? "thin" : "ok"} n={n} noun="runs" floor={SAMPLE_FLOORS.avg}>
      {fmtMs(ms)}
    </StatusValue>
  );
}

/** Route = the run-level `provider` column; "Timed" shows how many runs carry LLM timing. */
function RoutesCard({ scope }: { scope: MetricsScopeParams }): ReactElement {
  const routes = useRoutes(scope);
  const patch = useMetricsParams();
  const rows = routes.data?.rows ?? [];
  const columns: Array<Column<RouteRow>> = [
    {
      key: "model",
      header: "Model",
      sortValue: (r) => `${r.model ?? ""} ${r.route}`,
      render: (r) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-mono text-[12px] font-medium">{r.model ?? "unknown model"}</span>
          <span className="truncate text-[11px] text-xyne-fg-muted">{r.route}</span>
        </span>
      ),
    },
    { key: "runs", header: "Runs", numeric: true, sortValue: (r) => r.runs, render: (r) => fmtInt(r.runs) },
    {
      key: "timed",
      header: "Timed",
      numeric: true,
      sortValue: (r) => r.timed,
      hint: "Runs carrying LLM timing — the n behind the next columns",
      render: (r) => (r.timed === 0 ? <ZeroCell title="No run on this route carried LLM timing" /> : <span className="text-xyne-fg-secondary">{fmtInt(r.timed)}</span>),
    },
    {
      key: "p50",
      header: "p50",
      group: "Model time per run",
      numeric: true,
      sortValue: (r) => r.llm.p50Ms,
      render: (r) => (
        <StatusValue status={r.llm.n === 0 ? "na" : statusFor("runP50", r.llm.p50Ms, r.llm.n)} n={r.llm.n} noun="timed runs" floor={SAMPLE_FLOORS.p50} naWhy="No timed run">
          {fmtMs(r.llm.p50Ms)}
        </StatusValue>
      ),
    },
    {
      key: "p95",
      header: "p95",
      group: "Model time per run",
      numeric: true,
      sortValue: (r) => (r.llm.n >= SAMPLE_FLOORS.p95 ? r.llm.p95Ms : null),
      render: (r) =>
        r.llm.n === 0 || r.llm.p95Ms == null ? (
          <Unknown why="No timed run" />
        ) : r.llm.n < SAMPLE_FLOORS.p95 ? (
          <span className="inline-flex items-center justify-end gap-1">
            <Unknown why={`Only ${fmtInt(r.llm.n)} timed ${plural(r.llm.n, "run")} — p95 needs ${SAMPLE_FLOORS.p95}+`} />
            <SampleChip n={r.llm.n} noun="timed runs" floor={SAMPLE_FLOORS.p95} />
          </span>
        ) : (
          fmtMs(r.llm.p95Ms)
        ),
    },
    {
      key: "reply",
      header: "Reply starts",
      numeric: true,
      sortValue: (r) => r.replyStart.p50Ms,
      hint: "p50 time until the run's first model reply starts streaming",
      render: (r) => (
        <StatusValue status={r.replyStart.n === 0 ? "na" : statusFor("runP50", r.replyStart.p50Ms, r.replyStart.n)} n={r.replyStart.n} noun="runs" floor={SAMPLE_FLOORS.p50} naWhy="Not captured">
          {fmtMs(r.replyStart.p50Ms)}
        </StatusValue>
      ),
    },
    {
      key: "tps",
      header: "tok/s",
      numeric: true,
      sortValue: (r) => r.tokensPerSec,
      hint: "Output tokens ÷ decode seconds, weighted",
      render: (r) => (r.tokensPerSec == null ? <Unknown why="No decode timing" /> : fmtTps(r.tokensPerSec).replace(" tok/s", "")),
    },
    {
      key: "errors",
      header: "Failed",
      numeric: true,
      sortValue: (r) => r.errorRate,
      hint: "Failed runs ÷ runs on this route and model",
      render: (r) => {
        if (r.failed === 0) return <ZeroCell />;
        const status = statusFor("runSuccess", r.errorRate == null ? null : 1 - r.errorRate, r.runs);
        return (
          <StatusValue status={status} title={`${fmtInt(r.failed)} of ${fmtInt(r.runs)} runs failed`}>
            {fmtPct(r.errorRate)}
          </StatusValue>
        );
      },
    },
  ];
  return (
    <MetricsCard
      title="Model time by route and model"
      subtitle="One row per route and model. Click a row to list its runs."
      loading={!routes.data && !routes.error}
      skeleton={<TableSkeleton rows={4} cols={8} />}
      busy={routes.isPlaceholder}
    >
      {routes.error ? (
        <PanelError error={routes.error} onRetry={routes.refetch} />
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(r) => `${r.route}\u0000${r.model ?? ""}`}
          initialSort={{ key: "runs", dir: "desc" }}
          onRowClick={(r) => {
            if (r.model) patch({ drill: "model", model: r.model, provider: null, status: null, minMs: null });
          }}
          rowTitle={(r) => (r.model ? `List the runs on ${r.model}` : "No model recorded")}
          emptyMessage="No runs with a route in this window."
          maxHeight={420}
          minWidth={820}
          maxRows={8}
        />
      )}
    </MetricsCard>
  );
}

type ToolMeasure = "avg" | "total";
const TOOL_OPTIONS: MeasureOptions<ToolMeasure> = [
  { id: "avg", label: "Avg per call" },
  { id: "total", label: "Total time" },
];

/** Top 5 only — the Tools tab has the full table. Avg ranks tools with 5+ calls (server-side floor). */
function ToolLatencyCard({ scope }: { scope: MetricsScopeParams }): ReactElement {
  const tools = useTools(scope, { limit: 5 });
  const [measure] = useMeasure("toollat", TOOL_OPTIONS, "avg");
  const [params] = useSearchParams();
  const set = tools.data?.ranking.time;
  const rows = (measure === "avg" ? set?.byAvg : set?.byTotal)?.slice(0, 5) ?? [];
  const totalMs = tools.data?.totals.totalMs ?? 0;
  const toolsHref = (() => {
    const next = clearDrillParams(new URLSearchParams(params), { keepMeasures: true });
    next.set("tab", "tools");
    return `/v3/metrics?${next.toString()}`;
  })();
  const columns: Array<Column<RankPoint>> = [
    { key: "tool", header: "Tool", render: (r) => <ToolName name={r.tool} className="max-w-[300px]" /> },
    { key: "calls", header: "Calls", numeric: true, render: (r) => fmtInt(r.calls) },
    { key: "avg", header: "Avg", numeric: true, render: (r) => fmtMs(r.avg) },
    {
      key: "p95",
      header: "p95",
      numeric: true,
      hint: "Slow tail per call, estimated from duration buckets",
      render: (r) => <StatusValue status={statusFor("toolP95", r.p95Ms, r.calls)} n={r.calls} noun="calls" floor={SAMPLE_FLOORS.p95} naWhy="No timed call">{fmtMs(r.p95Ms)}</StatusValue>,
    },
    {
      key: "share",
      header: "Share",
      numeric: true,
      hint: "Share of all tool time in the window",
      // The avg ranking carries no share of its own (its value is a per-call mean).
      render: (r) => fmtPct(r.share ?? (r.avg != null && totalMs > 0 ? (r.avg * r.calls) / totalMs : null)),
    },
    {
      key: "errors",
      header: "Errors",
      numeric: true,
      render: (r) =>
        r.errorRate === 0 ? (
          <ZeroCell />
        ) : (
          <StatusValue status={statusFor("toolErrorRate", r.errorRate, r.calls, { row: true })} n={r.calls} noun="calls" floor={floorFor("toolErrorRate", { row: true })}>
            {fmtPct(r.errorRate)}
          </StatusValue>
        ),
    },
  ];
  return (
    <MetricsCard
      title={measure === "avg" ? "Slowest tools for this agent" : "Where this agent's tool time goes"}
      subtitle={measure === "avg" ? "Top 5 by average time per call, among tools with 5+ calls." : "Top 5 by time spent in the window."}
      action={
        <>
          <MeasureToggle card="toollat" options={TOOL_OPTIONS} defaultId="avg" ariaLabel="Average or total" />
          <Link to={toolsHref} className="inline-flex items-center gap-1 text-[12px] font-medium text-xyne-fg-muted hover:text-xyne-fg-primary">
            Open in Tools tab
            <ArrowRight size={12} aria-hidden />
          </Link>
        </>
      }
      loading={!tools.data && !tools.error}
      skeleton={<TableSkeleton rows={5} cols={6} />}
      busy={tools.isPlaceholder}
    >
      {tools.error ? (
        <PanelError error={tools.error} onRetry={tools.refetch} />
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(r) => r.tool}
          emptyMessage={measure === "avg" ? "No tool with 5 or more calls in this window." : "No tool calls in this window."}
          maxHeight={320}
          minWidth={640}
        />
      )}
    </MetricsCard>
  );
}

const BANNER_TONE = {
  good: "border-xyne-success-border bg-xyne-success-bg text-xyne-success-fg",
  warn: "border-xyne-warning-border bg-xyne-warning-bg text-xyne-warning-fg",
  neutral: "border-xyne-neutral-border bg-xyne-neutral-bg text-xyne-neutral-fg",
} as const;

/** Explicit ratings plus behavioural signals; neutral with no ratings, each rate judged only over enough runs. */
function SentimentCard({ scope }: { scope: MetricsScopeParams }): ReactElement {
  const state = useSentiment(scope);
  const s = state.data?.sentiment;
  const mem = state.data?.memoryRecall;

  let body: ReactNode = null;
  if (s && mem) {
    const judged = s.totalRuns >= SAMPLE_FLOORS.rate;
    const concerns: string[] = [];
    if (s.ratingTotal >= 5 && s.ratingRatio != null && s.ratingRatio < 0.5) concerns.push(`thumbs-up rate ${fmtPct(s.ratingRatio)}`);
    if (judged && s.apologeticRate > 0.2) concerns.push(`${fmtPct(s.apologeticRate)} of replies sound apologetic`);
    if (judged && s.failedRate > 0.1) concerns.push(`${fmtPct(s.failedRate)} of runs failed`);
    if (judged && s.cancelledRate > 0.1) concerns.push(`${fmtPct(s.cancelledRate)} of runs cancelled`);
    if (s.retriesKnown >= SAMPLE_FLOORS.rate && s.retriedRate > 0.2) concerns.push(`${fmtPct(s.retriedRate)} of runs needed a model retry`);
    const tone: keyof typeof BANNER_TONE = concerns.length > 0 ? "warn" : s.ratingTotal > 0 && judged ? "good" : "neutral";
    const headline =
      concerns.length > 0
        ? `${concerns.length} ${plural(concerns.length, "concern")}: ${concerns.join(" · ")}`
        : s.ratingTotal === 0
          ? `No ratings yet — ${fmtInt(s.totalRuns)} ${plural(s.totalRuns, "run")} in this window.`
          : judged
            ? `No concerns across ${fmtInt(s.totalRuns)} runs (${fmtInt(s.ratingTotal)} rated: ${fmtInt(s.ratingUp)} up, ${fmtInt(s.ratingDown)} down).`
            : `Too few runs to judge — ${fmtInt(s.totalRuns)} in this window, ${fmtInt(s.ratingTotal)} rated.`;
    const rateOf = (rate: number, n: number, floor: number): ReactNode =>
      n < floor ? (
        <span className="inline-flex items-center gap-1 font-normal text-xyne-fg-muted">
          {fmtPct(rate)}
          <SampleChip n={n} noun="runs" floor={floor} />
        </span>
      ) : rate === 0 ? (
        <span className="text-xyne-fg-muted">0</span>
      ) : (
        fmtPct(rate)
      );
    body = (
      <div className="flex flex-col gap-4">
        <div className={cn("rounded-xl border px-4 py-3 text-[13px]", BANNER_TONE[tone])}>{headline}</div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <MiniStat
            label="Rated up"
            icon={ThumbsUp}
            value={s.ratingUp === 0 ? <span className="text-xyne-fg-muted">0</span> : fmtInt(s.ratingUp)}
            sub={s.ratingTotal > 0 ? `${fmtPct(s.ratingUp / s.ratingTotal)} of rated` : "no ratings"}
          />
          <MiniStat
            label="Rated down"
            icon={ThumbsDown}
            value={s.ratingDown === 0 ? <span className="text-xyne-fg-muted">0</span> : fmtInt(s.ratingDown)}
            sub={s.ratingTotal > 0 ? `${fmtPct(s.ratingDown / s.ratingTotal)} of rated` : "no ratings"}
          />
          <MiniStat label="Apologetic" icon={MessageCircleReply} value={rateOf(s.apologeticRate, s.totalRuns, SAMPLE_FLOORS.rate)} sub="of completed runs" />
          <MiniStat label="Cancelled" icon={CircleMinus} value={rateOf(s.cancelledRate, s.totalRuns, SAMPLE_FLOORS.rate)} sub="of all runs" />
          <MiniStat
            label="Needed retry"
            icon={RefreshCcwDot}
            value={s.retriesKnown === 0 ? <Unknown why="Retries not captured for this agent's runs" /> : rateOf(s.retriedRate, s.retriesKnown, SAMPLE_FLOORS.rate)}
            sub={s.retriesKnown > 0 ? `of ${fmtInt(s.retriesKnown)} runs with retry data` : "not captured"}
          />
          <MiniStat
            label="Memory recall"
            icon={History}
            value={!mem.captured || mem.rate == null ? <Unknown why="Memory recall is not instrumented for these runs" /> : rateOf(mem.rate, mem.runs, SAMPLE_FLOORS.rate)}
            sub={mem.captured ? `${fmtInt(mem.recalled)} of ${fmtInt(mem.runs)} runs recalled` : "not captured"}
          />
        </div>
        {s.recentComments.length > 0 && (
          <div>
            <div className="mb-2 text-[11px] uppercase tracking-wider text-xyne-fg-muted">Recent rating comments ({s.recentComments.length})</div>
            <div className="flex flex-col gap-2">
              {s.recentComments.map((c) => (
                <div key={c.sessionId} className="flex items-start gap-3 rounded-lg bg-xyne-surface-subtle p-3">
                  <span className="mt-0.5 shrink-0 text-xyne-fg-muted" title={c.rating === "up" ? "Rated up" : "Rated down"}>
                    {c.rating === "up" ? <ThumbsUp size={15} aria-label="Rated up" /> : <ThumbsDown size={15} aria-label="Rated down" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="whitespace-pre-wrap break-words text-[13px] text-xyne-fg-primary">{c.comment}</div>
                    <div className="mt-1 text-[11px] text-xyne-fg-muted">{fmtDateTime(c.completedAt)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <MetricsCard
      title="User sentiment and feedback"
      subtitle="Explicit ratings plus behavioural signals from the same window. Lower is better for every rate."
      loading={!state.data && !state.error}
      skeleton={<RowsSkeleton rows={2} />}
      busy={state.isPlaceholder}
    >
      {state.error ? <PanelError error={state.error} onRetry={state.refetch} /> : body}
    </MetricsCard>
  );
}

function MiniStat({ label, value, sub, icon: Icon }: { label: string; value: ReactNode; sub?: string; icon?: LucideIcon }): ReactElement {
  return (
    <div className="flex min-w-0 flex-col rounded-lg bg-xyne-surface-subtle px-3 py-2">
      <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-xyne-fg-muted">
        {Icon && <Icon size={11} aria-hidden />}
        {label}
      </span>
      <span className="mt-0.5 text-[18px] font-semibold tabular-nums text-xyne-fg-primary">{value}</span>
      {sub && <span className="mt-0.5 text-[10px] text-xyne-fg-muted">{sub}</span>}
    </div>
  );
}

/**
 * Improvement suggestions surfaced by the hourly FailureCurator, in three
 * collapsible buckets. Apply marks a candidate handled; Dismiss starts the
 * 7-day cool-down. Read through the metrics cache so StrictMode and a tab
 * revisit do not refetch.
 */
function ImprovementsCard({ userId, agentSlug }: { userId: string; agentSlug: string }) {
  const url = `/metrics/agent/${encodeURIComponent(agentSlug)}/improvements`;
  const state = useMetricsResource<ImprovementCandidate[]>(userId ? `${userId} ${url}` : null, url, () =>
    fetchAgentImprovements(userId, agentSlug),
  );
  const [openBucket, setOpenBucket] = useState<ImprovementBucket | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const error = actionError ?? state.error;
  if (error) {
    // Permission failures (admin / owner / contributor gate): hide the card
    // for users who are simply not part of this agent's editor group.
    if (/403|admin|owner|contributor|forbidden/i.test(error)) return null;
    return (
      <MetricsCard title="Improvement suggestions" subtitle="Auto-generated by the FailureCurator">
        <PanelError error={error} onRetry={() => { setActionError(null); state.refetch(); }} />
      </MetricsCard>
    );
  }
  const items = state.data;
  if (!items) {
    return (
      <MetricsCard title="Improvement suggestions" subtitle="Auto-generated by the FailureCurator">
        <Skeleton className="h-[60px] w-full" />
      </MetricsCard>
    );
  }
  if (items.length === 0) {
    return <EmptyCardRow title="Improvement suggestions" message="nothing pending. The curator runs hourly and adds findings once it spots a pattern." />;
  }

  const buckets: Array<{ key: ImprovementBucket; label: string; alarming: boolean }> = [
    { key: "agent_unable_to_do_work", label: "Agent unable to do work", alarming: true },
    { key: "failure", label: "Failures", alarming: true },
    { key: "user_frustrated", label: "User frustrated", alarming: false },
  ];

  const act = async (id: string, fn: (userId: string, id: string) => Promise<void>) => {
    setBusy(id);
    try {
      await fn(userId, id);
      state.refetch();
    } catch (e) {
      setActionError(message(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <MetricsCard
      title="Improvement suggestions"
      subtitle={`${items.length} pending, generated hourly from negative-signal sessions. Make the change in the agent editor, then mark it handled; dismiss silences the same root cause for 7 days.`}
      busy={state.loading}
    >
      <div className="flex flex-col gap-2">
        {buckets.map((b) => {
          const rows = items.filter((i) => i.bucket === b.key);
          const open = openBucket === b.key;
          return (
            <div key={b.key} className="rounded-lg border border-xyne-border-subtle">
              <button
                type="button"
                onClick={() => setOpenBucket(open ? null : b.key)}
                aria-expanded={open}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-xyne-surface-subtle"
              >
                <span className="text-xyne-fg-muted">{open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}</span>
                <span className="text-[13px] font-medium text-xyne-fg-primary">{b.label}</span>
                <span
                  className={cn(
                    "inline-flex h-5 items-center gap-1 rounded-full px-2 text-[11px] font-medium tabular-nums",
                    rows.length > 0 && b.alarming ? "bg-xyne-warning-bg text-xyne-warning-fg" : "bg-xyne-neutral-bg text-xyne-neutral-fg",
                  )}
                >
                  {rows.length > 0 && b.alarming && <StatusGlyph status="warn" size={11} />}
                  {fmtInt(rows.length)}
                </span>
              </button>
              {open && rows.length > 0 && (
                <div className="flex flex-col gap-3 border-t border-xyne-border-subtle p-3">
                  {rows.map((c) => (
                    <ImprovementRow
                      key={c.id}
                      c={c}
                      onApply={() => void act(c.id, applyImprovement)}
                      onDismiss={() => void act(c.id, (u, id) => dismissImprovement(u, id))}
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
    </MetricsCard>
  );
}

function ImprovementRow({ c, onApply, onDismiss, busy }: { c: ImprovementCandidate; onApply: () => void; onDismiss: () => void; busy: boolean }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-xyne-surface-subtle p-3">
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="rounded bg-xyne-surface-sunken px-2 py-0.5 font-mono text-xyne-fg-primary">{c.rootCause}</span>
        <span className="rounded bg-xyne-neutral-bg px-2 py-0.5 text-xyne-neutral-fg">{c.confidence} confidence</span>
        <span className="text-xyne-fg-muted">
          · {c.evidence.length} {plural(c.evidence.length, "session")} as evidence
        </span>
      </div>
      <div className="text-[13px] text-xyne-fg-primary">{c.finding}</div>
      <div className="flex items-start gap-2 rounded-md bg-xyne-surface-sunken px-3 py-2 text-[12px]">
        <span className="shrink-0 font-mono text-xyne-fg-muted">{c.proposedFix.type}:</span>
        <span className="whitespace-pre-wrap break-words text-xyne-fg-primary">{c.proposedFix.description}</span>
      </div>
      <div className="flex items-center justify-between gap-3 pt-1">
        <span className="text-[11px] text-xyne-fg-muted">Mark as handled records a change you made yourself; it does not edit the agent.</span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onDismiss}
            disabled={busy}
            title="Hide this finding and silence the same root cause for this agent for 7 days"
            className="rounded-md bg-xyne-surface-sunken px-3 py-1 text-[12px] text-xyne-fg-muted hover:text-xyne-fg-primary disabled:opacity-40"
          >
            Dismiss
          </button>
          <button
            type="button"
            onClick={onApply}
            disabled={busy}
            title="Record that you made this change in the agent editor"
            className="rounded-md bg-xyne-fg-primary px-3 py-1 text-[12px] text-xyne-fg-inverse hover:opacity-90 disabled:opacity-40"
          >
            {busy ? "…" : "Mark as handled"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── 5. What was slowest? ─────────────────────────────────────────────────── */

function SlowestRunsCard({ scope }: { scope: MetricsScopeParams }): ReactElement {
  const summary = useSummary(scope);
  const patch = useMetricsParams();
  const wall = summary.data?.current.wall;
  const p95 = wall && wall.n >= SAMPLE_FLOORS.p95 ? wall.p95Ms : null;
  return (
    <MetricsCard
      title="Slowest runs"
      subtitle="The ten slowest completed runs by end-to-end time. Open one for its transcript and trace."
      action={
        p95 != null ? (
          <button
            type="button"
            onClick={() => patch({ drill: "slow", minMs: Math.floor(p95), status: null, model: null, provider: null })}
            className="inline-flex min-h-[28px] items-center gap-1 rounded-full border border-xyne-border px-3 text-[12px] font-medium text-xyne-fg-secondary hover:border-xyne-border-strong hover:text-xyne-fg-primary"
          >
            See all runs at or above p95 ({fmtMs(p95)})
            <ChevronRight size={12} aria-hidden />
          </button>
        ) : undefined
      }
    >
      <SessionsList scope={scope} request={{ kind: "slow" }} limit={10} subject="the run completed, slowest first" />
    </MetricsCard>
  );
}

/** Awakening rollup: renders nothing if no agent ever woke; amber only for a real failure (lastError). */
function AwakeningActivityCard({ scope }: { scope: MetricsScopeParams }) {
  const url = `/metrics/awakening?days=${scope.days}&orgScope=${scope.orgScope}`;
  const state = useMetricsResource<AwakeningActivity>(scope.userId ? `${scope.userId} ${url}` : null, url, () =>
    fetchAwakeningActivity(scope.userId, scope.days, scope.orgScope),
  );
  const [openRow, setOpenRow] = useState<string | null>(null);
  const data = state.data;
  if (state.error || !data) return null;
  if (data.agents.length === 0 && data.totals.runs === 0) return null;

  const { totals } = data;
  const failing = data.agents.filter((a) => a.lastError);
  const off = data.agents.filter((a) => !a.enabled && !a.lastError);
  const offNote = off.length > 0 ? `${fmtInt(off.length)} ${plural(off.length, "agent has", "agents have")} waking switched off` : null;

  if (totals.runs === 0) {
    return (
      <EmptyCardRow
        title="Awakened agents"
        message={
          <>
            No wakes in this window{offNote ? ` · ${offNote}` : ""}
            {failing.length > 0 && (
              <span className="ml-1 inline-flex items-center gap-1 font-medium text-xyne-warning-fg">
                · <StatusGlyph status="warn" /> {fmtInt(failing.length)} failing: {failing.slice(0, 3).map((a) => a.agentSlug).join(", ")}
              </span>
            )}
          </>
        }
      />
    );
  }

  const th = "py-2 text-[11px] font-medium uppercase tracking-wider";
  return (
    <MetricsCard
      title="Awakened agents"
      subtitle="Runs nobody triggered: the agent woke on a heartbeat or a reflex and decided for itself whether to act."
      busy={state.loading}
    >
      <KpiStrip
        cols="grid-cols-2 @min-[560px]:grid-cols-4"
        items={[
          { key: "wakes", label: "Wakes", value: fmtInt(totals.runs), line: `${fmtInt(totals.events)} events collected` },
          { key: "acted", label: "Acted", value: fmtInt(totals.ran), line: totals.shadow > 0 ? `${fmtInt(totals.shadow)} in shadow` : undefined },
          { key: "quiet", label: "Stayed quiet", value: fmtInt(totals.skipped), line: "Gate found nothing worth doing" },
          {
            key: "failed",
            label: "Failed",
            value: totals.failed === 0 ? <span className="font-normal text-xyne-fg-muted">0</span> : fmtInt(totals.failed),
            status: totals.failed > 0 ? "warn" : undefined,
          },
        ]}
      />
      {(failing.length > 0 || offNote) && (
        <div className="mt-3 flex flex-col gap-1 text-[12px]">
          {failing.map((a) => (
            <div key={a.agentSlug} className="inline-flex items-center gap-1 text-xyne-warning-fg">
              <StatusGlyph status="warn" />
              <span className="font-mono">{a.agentSlug}</span> — {a.lastError}
            </div>
          ))}
          {offNote && <div className="text-xyne-fg-muted">{offNote}.</div>}
        </div>
      )}
      {data.byAgent.length > 0 && (
        <table className="mt-4 w-full text-[12px]">
          <thead className="text-xyne-fg-muted">
            <tr className="border-b border-xyne-border text-left">
              <th className={th}>Agent</th>
              <th className={th}>Kind</th>
              <th className={cn(th, "text-right")}>Wakes</th>
              <th className={cn(th, "text-right")}>Acted</th>
              <th className={cn(th, "text-right")}>Quiet</th>
              <th className={cn(th, "text-right")}>Failed</th>
              <th className={cn(th, "text-right")}>Last wake</th>
            </tr>
          </thead>
          <tbody>
            {data.byAgent.map((r) => {
              const key = `${r.agentId}:${r.kind}`;
              const open = openRow === key;
              return (
                <React.Fragment key={key}>
                  <tr
                    className="cursor-pointer border-b border-xyne-border-subtle hover:bg-xyne-surface-subtle"
                    onClick={() => setOpenRow(open ? null : key)}
                    aria-expanded={open}
                  >
                    <td className="py-2 font-mono text-xyne-fg-primary">
                      <span className="mr-1 inline-flex w-3 align-middle text-xyne-fg-muted">
                        {open ? <ChevronDown size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />}
                      </span>
                      {r.agentSlug}
                    </td>
                    <td className="py-2 text-xyne-fg-muted">{r.kind}</td>
                    <td className="py-2 text-right tabular-nums text-xyne-fg-primary">{fmtInt(r.runs)}</td>
                    <td className="py-2 text-right tabular-nums text-xyne-fg-primary">{fmtInt(r.ran)}</td>
                    <td className="py-2 text-right tabular-nums text-xyne-fg-muted">{fmtInt(r.skipped)}</td>
                    <td className={cn("py-2 text-right tabular-nums", r.failed > 0 ? statusText("warn") : "text-xyne-fg-muted")}>{fmtInt(r.failed)}</td>
                    <td className="py-2 text-right tabular-nums text-xyne-fg-muted">{fmtDateTime(r.lastRunAt)}</td>
                  </tr>
                  {open && (
                    <tr>
                      <td colSpan={7} className="p-0">
                        <AwakeningRunsPanel scope={scope} agentId={r.agentId} agentSlug={r.agentSlug} kind={r.kind} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      )}
      {data.skipReasons.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 text-[12px] text-xyne-fg-muted">Why it stayed quiet — a healthy agent skips far more often than it acts.</div>
          <div className="flex flex-wrap gap-2">
            {data.skipReasons.map((r) => (
              <span key={r.reason} className="rounded-full bg-xyne-surface-subtle px-3 py-1 text-[12px] text-xyne-fg-muted">
                <span className="font-mono">{r.reason}</span> · <span className="tabular-nums">{fmtInt(r.count)}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </MetricsCard>
  );
}

const WAKES_PAGE_SIZE = 20;

/** One agent's paginated wake attempts; skipped wakes carry the gate rule that fired. */
function AwakeningRunsPanel({ scope, agentId, agentSlug, kind }: { scope: MetricsScopeParams; agentId: string; agentSlug: string; kind: string }) {
  const [offset, setOffset] = useState(0);
  const url = `/metrics/awakening/${encodeURIComponent(agentId)}/runs?days=${scope.days}&kind=${kind}&offset=${offset}&orgScope=${scope.orgScope}`;
  const state = useMetricsResource(scope.userId ? `${scope.userId} ${url}` : null, url, () =>
    fetchAwakeningRuns(scope.userId, agentId, scope.days, WAKES_PAGE_SIZE, offset, scope.orgScope, kind),
  );
  const page = state.data;
  const runs: AwakeningRun[] = page?.runs ?? [];
  const total = page?.total ?? 0;
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + WAKES_PAGE_SIZE, total);
  const th = "py-1.5 font-medium";
  return (
    <div className="border-b border-xyne-border-subtle bg-xyne-surface-subtle px-3 py-3">
      {state.error ? (
        <PanelError error={state.error} onRetry={state.refetch} />
      ) : !page ? (
        <Skeleton className="h-[120px] w-full" />
      ) : runs.length === 0 ? (
        <div className="text-[12px] text-xyne-fg-muted">
          No {kind} wakes for {agentSlug} in this window.
        </div>
      ) : (
        <>
          <table className="w-full text-[12px]">
            <thead className="text-xyne-fg-muted">
              <tr className="border-b border-xyne-border-subtle text-left">
                <th className={th}>When</th>
                <th className={th}>Outcome</th>
                <th className={th}>Why</th>
                <th className={cn(th, "text-right")}>Events</th>
                <th className={cn(th, "text-right")}>Took</th>
                <th className={cn(th, "text-right")}>Transcript</th>
              </tr>
            </thead>
            <tbody className={cn(state.isPlaceholder && "opacity-60")}>
              {runs.map((r) => (
                <tr key={r.id} className="border-b border-xyne-border-subtle">
                  <td className="whitespace-nowrap py-1.5 text-xyne-fg-primary">{fmtDateTime(r.startedAt)}</td>
                  <td className={cn("py-1.5", r.outcome === "failed" ? statusText("bad") : r.outcome === "skipped" ? "text-xyne-fg-muted" : "text-xyne-fg-primary")}>
                    {r.outcome}
                  </td>
                  <td className="py-1.5 font-mono text-xyne-fg-muted">{r.skipReason ?? "—"}</td>
                  <td className="py-1.5 text-right tabular-nums text-xyne-fg-muted">{fmtInt(r.eventCount)}</td>
                  <td className="py-1.5 text-right tabular-nums text-xyne-fg-muted">{fmtMs(r.durationMs)}</td>
                  <td className="py-1.5 text-right">
                    {r.conversationId ? (
                      <Link
                        className="text-xyne-fg-link underline underline-offset-2 hover:opacity-80"
                        to={`/v3/chat?${new URLSearchParams({ agent: agentSlug, conversation: r.conversationId, allRuns: "1", ...(r.sessionId ? { debug: r.sessionId } : {}) }).toString()}`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        open
                      </Link>
                    ) : (
                      <span className="text-xyne-fg-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 flex items-center justify-between text-[12px] text-xyne-fg-muted">
            <span className="tabular-nums">
              {fmtInt(from)}–{fmtInt(to)} of {fmtInt(total)}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={offset === 0 || state.loading}
                onClick={() => setOffset(Math.max(0, offset - WAKES_PAGE_SIZE))}
                className="rounded-md border border-xyne-border px-2 py-1 hover:text-xyne-fg-primary disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={to >= total || state.loading}
                onClick={() => setOffset(offset + WAKES_PAGE_SIZE)}
                className="rounded-md border border-xyne-border px-2 py-1 hover:text-xyne-fg-primary disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
