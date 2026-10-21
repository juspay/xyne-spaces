/** Tools tab: per-tool reliability, latency and context cost, plus the drawer behind every clickable tool number (Tools and Quality tabs). */

import { useEffect, useRef, useState, useSyncExternalStore, type ReactElement, type ReactNode } from "react";
import {
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  CircleSlash,
  CircleX,
  Copy,
  Quote,
  RotateCcw,
  Timer,
  Unplug,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import type { ErrorClassRow, RankPoint, ToolRow, ToolSignal, ToolSortKey, ToolsResponse } from "../../../../lib/api";
import { cn } from "../../../../lib/utils";
import { useErrorClasses, useToolStatsBackfill, useTools } from "../../../hooks/useDeepMetrics";
import {
  BackfillAction,
  CoverageBanner,
  DataTable,
  DrillCount,
  Drawer,
  InlineBar,
  KpiStrip,
  KpiStripSkeleton,
  LazyCard,
  MeasureToggle,
  MetricsCard,
  Pager,
  PanelError,
  PanelMessage,
  RecoveryCell,
  RowsSkeleton,
  SAMPLE_FLOORS,
  SegmentedControl,
  SessionsList,
  StatusGlyph,
  StatusValue,
  TableSkeleton,
  ToolName,
  Unknown,
  VIZ,
  fmtBytes,
  fmtCompact,
  fmtInt,
  fmtMs,
  fmtPct,
  plural,
  ratio,
  splitToolName,
  statusFor,
  statusText,
  useElementWidth,
  useMeasure,
  useMetricsParam,
  useMetricsParams,
  worstStatus,
  type Column,
  type Kpi,
  type MeasureOptions,
  type MetricsScopeParams,
  type PanelProps,
  type Status,
} from "../MetricsPrimitives";

// Thresholds in one unit (px) so Tailwind orders them correctly.
const KPI_COLS = "grid-cols-2 @min-[560px]:grid-cols-3 @min-[1040px]:grid-cols-6";
const TOP_N = 8;
const TOP_FAILURES = 6;
const PAGE_SIZE = 25;
const DEFAULT_SORT: ToolSortKey = "errors";
/** Below this table-card width Avg and Context/call move to the drawer. */
const NARROW_TABLE_PX = 760;

function fmtAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

/** p95 is estimated from duration buckets; past the top bucket it reads "> 5m". */
function fmtP95(row: Pick<ToolRow, "p95Ms" | "p95Overflow">): string {
  return row.p95Overflow ? "> 5m" : fmtMs(row.p95Ms);
}

/** An older backend ignores these sort keys and echoes `errors` in `page.sort`; the first echo flips the flag for the session. */
const NEW_TOOL_SORTS: ReadonlySet<ToolSortKey> = new Set<ToolSortKey>(["duplicates", "uncited"]);
let newToolSortsRejected = false;
const newToolSortListeners = new Set<() => void>();

export function useNewToolSorts(): boolean {
  return !useSyncExternalStore(
    (listener) => {
      newToolSortListeners.add(listener);
      return () => newToolSortListeners.delete(listener);
    },
    () => newToolSortsRejected,
  );
}

/** Returns false (and records it) when the backend ignored a new sort key. */
export function noteToolSortEcho(requested: ToolSortKey | undefined, res: Pick<ToolsResponse, "page"> | undefined): boolean {
  if (!requested || !res || !NEW_TOOL_SORTS.has(requested) || res.page.sort === requested) return true;
  if (!newToolSortsRejected) {
    newToolSortsRejected = true;
    for (const listener of [...newToolSortListeners]) listener();
  }
  return false;
}

/** Opens the tool drawer; `signal` preselects the Sessions filter, `errorClass` pins it to one failure mode. */
export function useOpenTool(): (tool: string, signal?: ToolSignal | null, errorClass?: string | null) => void {
  const patch = useMetricsParams();
  return (tool, signal, errorClass) =>
    patch({ tool, dfilter: errorClass ? "errors" : (signal ?? null), dclass: errorClass ?? null });
}

/** Table state in the URL (sort, dir, page, q); a sort key this table cannot show falls back to its default. */
export function useToolTableParams(allowed: ReadonlySet<string>, defaultSort: ToolSortKey) {
  const [rawSort] = useMetricsParam("sort");
  const [rawDir] = useMetricsParam("dir");
  const [rawPage] = useMetricsParam("page");
  const [rawQ] = useMetricsParam("q");
  const patch = useMetricsParams();
  const sort = (rawSort && allowed.has(rawSort) ? rawSort : defaultSort) as ToolSortKey;
  const dir: "asc" | "desc" = rawSort && allowed.has(rawSort) ? (rawDir === "asc" ? "asc" : "desc") : sort === "tool" ? "asc" : "desc";
  const page = Math.max(1, Math.floor(Number(rawPage) || 1));
  const search = rawQ ?? "";
  return {
    request: { sort, dir, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE, search: search || undefined },
    controls: {
      sort,
      dir,
      offset: (page - 1) * PAGE_SIZE,
      limit: PAGE_SIZE,
      search,
      onSort: (key: string, defaultDir: "asc" | "desc") => {
        const nextDir = key === sort ? (dir === "asc" ? "desc" : "asc") : defaultDir;
        const isDefault = key === defaultSort && nextDir === "desc";
        patch({ sort: isDefault ? null : key, dir: isDefault ? null : nextDir, page: null }, { replace: true });
      },
      onOffset: (offset: number) => {
        const p = Math.floor(offset / PAGE_SIZE) + 1;
        patch({ page: p > 1 ? p : null }, { replace: true });
      },
      onSearch: (q: string) => patch({ q: q || null, page: null }, { replace: true }),
    },
  };
}

/** True while `data` is a previous key's answer for the same window and agents, so only the table dims. */
export function useSameWindow(scope: MetricsScopeParams, state: { data: unknown; isPlaceholder: boolean }): boolean {
  const scopeKey = `${scope.userId}|${scope.days}|${JSON.stringify(scope.orgScope)}|${scope.agentSlugs.join(",")}`;
  const ref = useRef<string | null>(null);
  if (state.data !== undefined && !state.isPlaceholder) ref.current = scopeKey;
  return ref.current === scopeKey;
}

const STATUS_BAR: Record<Status, string> = {
  ok: VIZ.accent,
  warn: VIZ.warning,
  bad: VIZ.danger,
  thin: VIZ.neutralSoft,
  na: VIZ.neutralSoft,
};

export function ToolsPanel({ scope }: PanelProps): ReactElement {
  // The drawer sits outside the content so a deep link is not remounted when data lands; same request, one cache entry.
  const table = useToolTableParams(TOOLS_SORTS, DEFAULT_SORT);
  const rows = useTools(scope, table.request).data?.rows;
  return (
    <>
      <ToolsPanelContent scope={scope} />
      <ToolDrawer scope={scope} rows={rows} />
    </>
  );
}

function ToolsPanelContent({ scope }: PanelProps): ReactElement {
  const table = useToolTableParams(TOOLS_SORTS, DEFAULT_SORT);
  const state = useTools(scope, table.request);
  const classes = useErrorClasses(scope, { limit: TOP_FAILURES, perTool: 2 });
  const backfill = useToolStatsBackfill(scope.userId);
  const sameWindow = useSameWindow(scope, state);
  const openTool = useOpenTool();
  const [selectedTool] = useMetricsParam("tool");

  const { data, error } = state;
  const stale = state.isPlaceholder && !sameWindow;
  const tableBusy = state.isPlaceholder || (state.loading && data !== undefined);

  if (error && !data) return <PanelError error={error} onRetry={state.refetch} />;
  if (!data) {
    return (
      <div className="flex flex-col gap-5">
        <KpiStripSkeleton count={6} cols={KPI_COLS} />
        <div className="grid gap-5 min-[1100px]:grid-cols-2">
          <MetricsCard title="Where tool time goes" loading skeleton={<RowsSkeleton rows={6} />} />
          <MetricsCard title="Top failure modes" loading skeleton={<RowsSkeleton rows={5} />} />
        </div>
        <MetricsCard title="All tools" loading skeleton={<TableSkeleton rows={8} cols={8} />} />
      </div>
    );
  }

  const cov = data.coverage;
  const banner = (
    <CoverageBanner
      coverage={cov.coverage}
      covered={cov.runsSummarised}
      total={cov.runsInWindow}
      verb="have tool stats"
      action={<BackfillAction isAdmin={scope.isAdmin} state={backfill} onRun={backfill.run} />}
    />
  );

  const t = data.totals;
  if (t.calls === 0) {
    return (
      <div className="flex flex-col gap-5">
        {banner}
        <PanelMessage
          title="No tool calls in this window"
          detail={
            cov.runsInWindow > 0
              ? `${fmtInt(cov.runsInWindow)} ${plural(cov.runsInWindow, "run")} finished in the window and none called a tool. Widen the range or clear the agent filter.`
              : "No runs finished in this window. Widen the range or clear the agent filter."
          }
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {banner}
      <KpiStrip items={toolKpis(data)} cols={KPI_COLS} busy={stale} />

      <div className="@container">
        <div className="grid items-start gap-5 @min-[880px]:grid-cols-2">
          <RankingCard data={data} busy={stale} selectedTool={selectedTool} onOpen={(tool, signal) => openTool(tool, signal)} />
          <FailureModesCard
            state={classes}
            onOpen={(row) => openTool(row.tool, "errors", row.errorClass)}
            totalErrors={t.errors}
          />
        </div>
      </div>

      <AllToolsCard data={data} table={table.controls} busy={tableBusy} stale={stale} selectedTool={selectedTool} />
    </div>
  );
}

function toolKpis(data: ToolsResponse): Kpi[] {
  const t = data.totals;
  const cov = data.coverage;
  const errorRate = ratio(t.errors, t.calls);
  const recovery = ratio(t.recovered, t.errors);
  const droppedRate = ratio(t.dropped, t.calls);
  const duplicateRate = ratio(t.duplicates, t.calls);
  return [
    {
      key: "calls",
      label: "Tool calls",
      icon: Wrench,
      value: fmtInt(t.calls),
      hint: "Every tool call in the window, parent loop and subagents.",
      line: `in ${fmtInt(t.runsWithTools)} of ${fmtInt(cov.runsInWindow)} ${plural(cov.runsInWindow, "run")} · ${fmtInt(t.distinctTools)} ${plural(t.distinctTools, "tool")}`,
    },
    {
      key: "errors",
      label: "Error rate",
      icon: CircleX,
      value: t.errors === 0 ? "0" : fmtPct(errorRate),
      status: statusFor("toolErrorRate", errorRate, t.calls),
      n: t.calls,
      nLabel: "tool calls",
      floor: SAMPLE_FLOORS.rate,
      valueTitle: `${fmtInt(t.errors)} of ${fmtInt(t.calls)} calls returned an error`,
      line: `${fmtInt(t.errors)} errored ${plural(t.errors, "call")}${t.notFound > 0 ? ` · ${fmtInt(t.notFound)} tool not found` : ""}`,
    },
    {
      key: "recovered",
      label: "Recovered",
      icon: RotateCcw,
      hint: "Errored calls the agent got past: the same tool later succeeded in the same run.",
      value: fmtPct(recovery),
      status: statusFor("toolRecovery", recovery, t.errors),
      n: t.errors,
      nLabel: "errored calls",
      floor: SAMPLE_FLOORS.recovery,
      naWhy: "No errored calls to recover from",
      line: t.errors > 0 ? `${fmtInt(t.recovered)} of ${fmtInt(t.errors)} errored calls later succeeded` : "No errored calls in this window",
    },
    {
      key: "dropped",
      label: "Dropped",
      icon: Unplug,
      hint: "Calls whose end event never arrived. Excluded from latency rather than counted as instant successes.",
      value: t.dropped === 0 ? "0" : fmtPct(droppedRate),
      status: statusFor("toolDropped", droppedRate, t.calls),
      n: t.calls,
      nLabel: "tool calls",
      floor: SAMPLE_FLOORS.rate,
      line: t.dropped > 0 ? `${fmtInt(t.dropped)} never reported finishing` : "Every call reported finishing",
    },
    {
      key: "duplicates",
      label: "Duplicates",
      icon: Copy,
      hint: "Repeat calls with identical arguments inside one run — the model retrying without changing anything.",
      value: t.duplicates === 0 ? "0" : fmtPct(duplicateRate),
      status: statusFor("toolDuplicate", duplicateRate, t.calls),
      n: t.calls,
      nLabel: "tool calls",
      floor: SAMPLE_FLOORS.rate,
      line: t.duplicates > 0 ? `${fmtInt(t.duplicates)} identical ${plural(t.duplicates, "repeat")}` : "No identical repeats",
    },
    {
      key: "avg",
      label: "Avg per call",
      icon: Timer,
      hint: "Mean time inside a tool per timed call. Dropped calls are excluded.",
      value: fmtMs(t.avgMsPerCall),
      status: t.avgMsPerCall == null ? "na" : t.timedCalls < SAMPLE_FLOORS.avg ? "thin" : "ok",
      n: t.timedCalls,
      nOf: t.calls,
      nLabel: "timed calls",
      floor: SAMPLE_FLOORS.avg,
      naWhy: "No timed calls in this window",
      line: `${fmtMs(t.totalMs)} total in tools`,
    },
  ];
}

type Lens = "time" | "bytes" | "errors";
type SizeMeasure = "avg" | "total";
type ErrorMeasure = "count" | "rate";

const LENSES: ReadonlyArray<{ id: Lens; label: string }> = [
  { id: "time", label: "Time" },
  { id: "bytes", label: "Context" },
  { id: "errors", label: "Errors" },
];
const SIZE_MEASURES: MeasureOptions<SizeMeasure> = [
  { id: "avg", label: "Avg per call" },
  { id: "total", label: "Total" },
];
const ERROR_MEASURES: MeasureOptions<ErrorMeasure> = [
  { id: "count", label: "Count" },
  { id: "rate", label: "Rate" },
];

interface RankRow {
  key: string;
  tool: string | null;
  label: ReactNode;
  value: number;
  valueText: string;
  aside: string;
  status: Status;
}

function RankingCard({
  data,
  busy,
  selectedTool,
  onOpen,
}: {
  data: ToolsResponse;
  busy: boolean;
  selectedTool: string | null;
  onOpen: (tool: string, signal: ToolSignal | null) => void;
}): ReactElement {
  const [rawLens, setLens] = useMetricsParam("m_rank");
  const lens: Lens = rawLens === "bytes" || rawLens === "errors" ? rawLens : "time";
  const [size] = useMeasure("rank_by", SIZE_MEASURES, "avg");
  const [errMeasure] = useMeasure("rank_err", ERROR_MEASURES, "count");
  const t = data.totals;
  const r = data.ranking;

  let title: string;
  let subtitle: string;
  let points: RankPoint[];
  let rows: RankRow[];
  let other: RankRow | null = null;

  const statusOf = (p: RankPoint): Status =>
    lens === "time"
      ? statusFor("toolP95", p.p95Ms, p.calls)
      : lens === "errors"
        ? statusFor("toolErrorRate", p.errorRate, p.calls, { row: true })
        : "ok";

  if (lens === "errors") {
    const byRate = errMeasure === "rate";
    points = (byRate ? r.errors.byRate : r.errors.byCount).slice(0, TOP_N);
    title = byRate ? "Most error-prone tools" : "Where errors come from";
    subtitle = byRate
      ? "Error rate per tool, tools with 10+ calls."
      : "Errored calls per tool, most first; each tool's error rate on the right.";
    rows = points.map((p) => toRankRow(p, byRate ? fmtPct(p.value) : fmtInt(p.value), byRate ? `${fmtCompact(p.calls)} calls` : fmtPct(p.errorRate), statusOf(p)));
    const restTools = Math.max(0, t.distinctTools - points.length);
    if (restTools > 0) {
      if (byRate) {
        const shownCalls = points.reduce((a, p) => a + p.calls, 0);
        const shownErrors = points.reduce((a, p) => a + p.value * p.calls, 0);
        const rate = ratio(Math.max(0, t.errors - shownErrors), Math.max(0, t.calls - shownCalls));
        other = otherRow(restTools, rate ?? 0, fmtPct(rate), "together");
      } else if (r.errors.other.value > 0) {
        other = otherRow(r.errors.other.tools, r.errors.other.value, fmtInt(r.errors.other.value), fmtPct(r.errors.other.share));
      }
    }
  } else {
    const set = lens === "time" ? r.time : r.bytes;
    const fmt = lens === "time" ? fmtMs : fmtBytes;
    const avg = size === "avg";
    points = (avg ? set.byAvg : set.byTotal).slice(0, TOP_N);
    if (lens === "time") {
      title = avg ? "Slowest tools" : "Most time spent";
      subtitle = avg
        ? "Average time per call, tools with 5+ calls. Bar colour follows the tool's p95."
        : "Total time inside each tool over the window (volume × latency). Bar colour follows p95.";
    } else {
      title = avg ? "Biggest outputs" : "Where context goes";
      subtitle = avg
        ? "Average output per call fed back to the model, tools with 5+ calls — trimming targets."
        : "Total tool output fed back to the model over the window — the usual compaction drivers.";
    }
    rows = points.map((p) => toRankRow(p, fmt(p.value), avg ? `${fmtCompact(p.calls)} calls` : fmtPct(p.share), statusOf(p)));
    const restTools = Math.max(0, t.distinctTools - points.length);
    if (restTools > 0) {
      if (avg) {
        const windowTotal = lens === "time" ? t.totalMs : t.bytes;
        const windowCalls = lens === "time" ? t.timedCalls : t.calls;
        const shownTotal = points.reduce((a, p) => a + (p.avg ?? p.value) * p.calls, 0);
        const shownCalls = points.reduce((a, p) => a + p.calls, 0);
        const restAvg = ratio(Math.max(0, windowTotal - shownTotal), Math.max(0, windowCalls - shownCalls));
        if (restAvg != null) other = otherRow(restTools, restAvg, fmt(restAvg), "per call");
      } else if (set.other.value > 0) {
        other = otherRow(set.other.tools, set.other.value, fmt(set.other.value), fmtPct(set.other.share));
      }
    }
  }

  const action =
    lens === "errors" ? (
      <MeasureToggle card="rank_err" options={ERROR_MEASURES} defaultId="count" ariaLabel="Errors measure" />
    ) : (
      <MeasureToggle card="rank_by" options={SIZE_MEASURES} defaultId="avg" ariaLabel="Size measure" />
    );

  return (
    <MetricsCard title={title} subtitle={subtitle} action={action} busy={busy}>
      <div className="mb-2">
        <SegmentedControl ariaLabel="Rank tools by" options={LENSES} value={lens} onChange={(next) => setLens(next === "time" ? null : next, { replace: true })} />
      </div>
      <RankList
        rows={rows}
        other={other}
        selectedTool={selectedTool}
        onOpen={(tool) => onOpen(tool, lens === "errors" ? "errors" : null)}
        emptyMessage={
          lens === "errors"
            ? errMeasure === "rate"
              ? "No tool with 10+ calls errored in this window."
              : "No errored calls in this window."
            : size === "avg"
              ? "No tool has 5+ calls in this window — switch to Total."
              : "Nothing recorded for this measure."
        }
      />
    </MetricsCard>
  );
}

function toRankRow(p: RankPoint, valueText: string, aside: string, status: Status): RankRow {
  return { key: p.tool, tool: p.tool, label: <ToolName name={p.tool} />, value: p.value, valueText, aside, status };
}

function otherRow(tools: number, value: number, valueText: string, aside: string): RankRow {
  return {
    key: "__other__",
    tool: null,
    label: <span className="truncate text-[12px] text-xyne-fg-muted">Other {fmtInt(tools)} {plural(tools, "tool")}</span>,
    value,
    valueText,
    aside,
    status: "na",
  };
}

/** The "Other" row is text only: scaling bars to it would flatten the comparison. */
function RankList({
  rows,
  other,
  selectedTool,
  onOpen,
  emptyMessage,
}: {
  rows: RankRow[];
  other: RankRow | null;
  selectedTool: string | null;
  onOpen: (tool: string) => void;
  emptyMessage: string;
}): ReactElement {
  if (rows.length === 0) return <p className="py-6 text-center text-[13px] text-xyne-fg-muted">{emptyMessage}</p>;
  const max = Math.max(0, ...rows.map((r) => r.value));
  const grid = "grid w-full grid-cols-[minmax(0,40%)_minmax(0,1fr)_auto_4.75rem] items-center gap-3 rounded-md px-2 py-1.5 text-left";
  return (
    <ol className="-mx-2 flex flex-col">
      {rows.map((row) => {
        const width = max > 0 ? (row.value / max) * 100 : 0;
        const warnish = row.status === "warn" || row.status === "bad";
        return (
          <li key={row.key}>
            <button
              type="button"
              onClick={() => row.tool && onOpen(row.tool)}
              title={row.tool ? `Open ${row.tool}` : undefined}
              className={cn(grid, "min-h-[32px] hover:bg-xyne-surface-subtle", selectedTool === row.tool && "bg-xyne-surface-sunken")}
            >
              {row.label}
              <span className="flex h-3 items-center">
                <span
                  className="block h-2.5 rounded-r-[4px]"
                  style={{ width: `${Math.max(row.value > 0 ? 1 : 0, width)}%`, backgroundColor: STATUS_BAR[row.status] }}
                />
              </span>
              <span className={cn("inline-flex items-center justify-end gap-1 text-[12px] font-medium tabular-nums", warnish ? statusText(row.status) : "text-xyne-fg-primary")}>
                <StatusGlyph status={row.status} />
                {row.valueText}
              </span>
              <span className="whitespace-nowrap text-right text-[11px] tabular-nums text-xyne-fg-muted">{row.aside}</span>
            </button>
          </li>
        );
      })}
      {other && (
        <li className="mt-1 border-t border-xyne-border-subtle pt-1">
          <div className={grid}>
            {other.label}
            <span />
            <span className="text-right text-[12px] tabular-nums text-xyne-fg-muted">{other.valueText}</span>
            <span className="text-right text-[11px] tabular-nums text-xyne-fg-muted">{other.aside}</span>
          </div>
        </li>
      )}
    </ol>
  );
}

function FailureModesCard({
  state,
  onOpen,
  totalErrors,
}: {
  state: ReturnType<typeof useErrorClasses>;
  onOpen: (row: ErrorClassRow) => void;
  totalErrors: number;
}): ReactElement {
  const { data } = state;
  const rows = data?.rows ?? [];
  return (
    <MetricsCard
      title="Top failure modes"
      subtitle="Errored results grouped by normalised message (ids and numbers stripped). Click one for the sessions it happened in."
      loading={!data && state.loading}
      skeleton={<RowsSkeleton rows={5} />}
      busy={state.isPlaceholder}
      footnote={
        data && data.total > rows.length
          ? `Top ${fmtInt(rows.length)} of ${fmtInt(data.total)} failure ${plural(data.total, "class", "classes")} (at most 2 per tool) across ${fmtInt(data.occurrences)} errored ${plural(data.occurrences, "call")}.`
          : undefined
      }
    >
      {state.error && !data ? (
        <PanelError error={state.error} onRetry={state.refetch} />
      ) : rows.length === 0 ? (
        totalErrors > 0 ? (
          <p className="py-6 text-center text-[13px] text-xyne-fg-muted">
            {fmtInt(totalErrors)} errored {plural(totalErrors, "call")}, but none has a stored failure message yet — runs summarised before the error log existed carry counts only.
          </p>
        ) : (
          <p className="flex items-center justify-center gap-1.5 py-6 text-[13px] text-xyne-fg-muted">
            <CircleCheck size={14} aria-hidden />
            No tool errors in this window.
          </p>
        )
      ) : (
        <ol className="-mx-2 flex flex-col">
          {rows.map((fm) => (
            <FailureModeItem key={`${fm.tool}\u0000${fm.errorClass}`} row={fm} showTool onOpen={() => onOpen(fm)} />
          ))}
        </ol>
      )}
    </MetricsCard>
  );
}

function FailureModeItem({
  row,
  showTool,
  onOpen,
  selected = false,
  share,
}: {
  row: ErrorClassRow;
  showTool: boolean;
  onOpen: () => void;
  selected?: boolean;
  share?: number | null;
}): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <li className={cn("rounded-md", selected && "bg-xyne-surface-sunken")}>
      <div className="flex items-start gap-1">
        <button
          type="button"
          onClick={onOpen}
          title={`Show the sessions where ${row.tool} failed with: ${row.errorClass}`}
          className="group/fm flex min-h-[36px] min-w-0 flex-1 items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-xyne-surface-subtle"
        >
          <CircleX size={13} className="mt-[3px] shrink-0 text-xyne-error-fg" aria-hidden />
          <span className="min-w-0 flex-1">
            {showTool && <ToolName name={row.tool} className="mb-0.5" />}
            <span className="block truncate text-[13px] font-medium text-xyne-fg-primary" title={row.errorClass}>
              {row.notFound ? "Tool not found — " : ""}
              {row.errorClass}
            </span>
            <span className="block text-[11px] tabular-nums text-xyne-fg-muted">
              {fmtInt(row.runs)} {plural(row.runs, "run")} · last {fmtAgo(row.lastSeen)}
            </span>
            {share != null && (
              <span className="mt-1 block">
                <InlineBar value={share} color={VIZ.danger} width="100%" />
              </span>
            )}
          </span>
          <span className="shrink-0 pt-px text-[13px] font-semibold tabular-nums text-xyne-fg-primary">{fmtInt(row.occurrences)}×</span>
        </button>
        {row.sample && (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            title={open ? "Hide the raw result" : "Show the raw result"}
            className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-xyne-fg-muted hover:bg-xyne-surface-subtle hover:text-xyne-fg-primary"
          >
            {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
            <span className="sr-only">Raw result</span>
          </button>
        )}
      </div>
      {open && row.sample && (
        <pre className="mx-2 mb-2 ml-[29px] max-h-[180px] overflow-auto whitespace-pre-wrap break-words rounded-md bg-xyne-surface-sunken px-2.5 py-2 font-mono text-[11px] leading-relaxed text-xyne-fg-secondary">
          {row.sample}
        </pre>
      )}
    </li>
  );
}

const TOOLS_SORTS: ReadonlySet<string> = new Set<ToolSortKey>(["tool", "calls", "errors", "errorRate", "recoveryRate", "dropped", "p95Ms", "avgMs", "avgBytes"]);

function toolRowStatus(r: ToolRow): Status {
  return worstStatus([
    statusFor("toolErrorRate", r.errorRate, r.calls, { row: true }),
    r.errors >= 5 ? statusFor("toolRecovery", r.recoveryRate, r.errors, { row: true }) : "na",
    statusFor("toolDropped", r.droppedRate, r.calls, { row: true }),
    r.p95Overflow ? "bad" : statusFor("toolP95", r.p95Ms, r.timedCalls),
  ]);
}

function AllToolsCard({
  data,
  table,
  busy,
  stale,
  selectedTool,
}: {
  data: ToolsResponse;
  table: ReturnType<typeof useToolTableParams>["controls"];
  busy: boolean;
  stale: boolean;
  selectedTool: string | null;
}): ReactElement {
  const openTool = useOpenTool();
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const narrow = width > 0 && width < NARROW_TABLE_PX;
  const maxCalls = Math.max(1, ...data.rows.map((r) => r.calls));
  const columns = toolColumns({ totals: data.totals, maxCalls, narrow, open: openTool });
  return (
    <MetricsCard
      title="All tools"
      subtitle={`${fmtInt(data.totals.distinctTools)} ${plural(data.totals.distinctTools, "tool")} in the window, worst errors first. Click a number for the sessions behind it, or a row for the tool.`}
      busy={stale}
    >
      <div ref={ref}>
        <DataTable
          rows={data.rows}
          columns={columns}
          rowKey={(r) => r.tool}
          rowTitle={(r) => `Open ${r.tool}`}
          onRowClick={(r) => openTool(r.tool)}
          rowStatus={toolRowStatus}
          selectedKey={selectedTool}
          busy={busy && !stale}
          minWidth={narrow ? 600 : 860}
          maxHeight={640}
          emptyMessage={table.search ? `No tools match "${table.search}".` : "No tools in this window."}
          server={{ ...table, total: data.page.total, searchPlaceholder: "Filter tools by name…", unit: "tools" }}
          footnote={narrow ? "Avg and context per call are in each tool's drawer at this width." : undefined}
        />
      </div>
    </MetricsCard>
  );
}

function toolColumns({
  totals,
  maxCalls,
  narrow,
  open,
}: {
  totals: ToolsResponse["totals"];
  maxCalls: number;
  narrow: boolean;
  open: (tool: string, signal?: ToolSignal | null) => void;
}): Array<Column<ToolRow>> {
  const cols: Array<Column<ToolRow>> = [
    {
      key: "tool",
      header: "Tool",
      sortKey: "tool",
      render: (r) => <ToolName name={r.tool} className={narrow ? "max-w-[170px]" : "max-w-[240px]"} />,
    },
    {
      key: "calls",
      header: "Calls",
      numeric: true,
      sortKey: "calls",
      hint: "Calls in the window, parent loop and subagents",
      render: (r) => (
        <span className="inline-flex items-center justify-end gap-1.5">
          {!narrow && <InlineBar value={r.calls / maxCalls} color={VIZ.neutralSoft} width={40} />}
          <DrillCount value={r.calls} onClick={() => open(r.tool, "calls")} title={`Show the sessions that called ${r.tool}`} />
        </span>
      ),
    },
    {
      key: "errors",
      header: "Errors",
      group: "Reliability",
      numeric: true,
      sortKey: "errors",
      hint: "Error rate and errored calls. Sorts by count — impact first.",
      render: (r) => {
        if (r.errors === 0) return <ZeroCount />;
        const status = statusFor("toolErrorRate", r.errorRate, r.calls, { row: true });
        return (
          <span className="inline-flex items-center justify-end gap-1">
            <DrillCount
              value={r.errors}
              status={status}
              onClick={() => open(r.tool, "errors")}
              title={`Show the ${fmtInt(r.sessions.errored)} ${plural(r.sessions.errored, "session")} where ${r.tool} errored`}
            >
              {fmtPct(r.errorRate)}
            </DrillCount>
            <span className="min-w-[36px] text-right text-[12px] text-xyne-fg-muted">{fmtInt(r.errors)}</span>
          </span>
        );
      },
    },
    {
      key: "recovered",
      header: "Recovered",
      group: "Reliability",
      numeric: true,
      sortKey: "recoveryRate",
      hint: "Errored calls the agent got past (the same tool later succeeded in the run) ÷ errored calls",
      render: (r) => <RecoveryCell recovered={r.recovered} errors={r.errors} onDrill={() => open(r.tool, "recovered")} />,
    },
    {
      key: "dropped",
      header: "Dropped",
      group: "Reliability",
      numeric: true,
      sortKey: "dropped",
      hint: "Calls whose end event never arrived — excluded from latency. Hover for the rate.",
      windowTotal: totals.dropped,
      render: (r) => (
        <DrillCount
          value={r.dropped}
          status={statusFor("toolDropped", r.droppedRate, r.calls, { row: true })}
          onClick={() => open(r.tool, "dropped")}
          title={`${fmtPct(r.droppedRate)} of calls never reported finishing — show the sessions`}
        />
      ),
    },
    {
      key: "p95",
      header: (
        <span className="inline-flex items-center gap-1">
          p95
          <CircleHelp size={11} aria-hidden />
        </span>
      ),
      hiddenLabel: "p95",
      group: "Speed",
      numeric: true,
      sortKey: "p95Ms",
      hint: "Slow tail per call, estimated from duration buckets: interpolated within the band the 95th-percentile call fell in (… 1s, 2.5s, 5s, 10s, 30s, 1m, 2m, 5m), so it is close but not exact. Past 5m it reads \"> 5m\".",
      render: (r) => {
        if (r.p95Ms == null && !r.p95Overflow) return <Unknown why="No timed calls" />;
        const status = r.p95Overflow ? "bad" : statusFor("toolP95", r.p95Ms, r.timedCalls);
        return (
          <StatusValue status={status} title={`${fmtInt(r.timedCalls)} timed ${plural(r.timedCalls, "call")}`}>
            {fmtP95(r)}
          </StatusValue>
        );
      },
    },
  ];
  if (!narrow) {
    cols.push(
      {
        key: "avg",
        header: "Avg",
        group: "Speed",
        numeric: true,
        sortKey: "avgMs",
        hint: "Mean time per timed call — exact",
        render: (r) => (r.avgMs == null ? <Unknown why="No timed calls" /> : fmtMs(r.avgMs)),
      },
      {
        key: "ctx",
        header: "Context/call",
        numeric: true,
        sortKey: "avgBytes",
        hint: "Tool output fed back to the model, per call",
        render: (r) => (r.avgBytes == null ? <Unknown why="No output recorded" /> : fmtBytes(r.avgBytes)),
      },
    );
  }
  return cols;
}

function ZeroCount(): ReactElement {
  return <span className="font-normal text-xyne-fg-muted">0</span>;
}

const SIGNALS: ReadonlyArray<{
  signal: ToolSignal;
  label: string;
  icon: LucideIcon;
  count: (r: ToolRow) => number;
  sessions: (r: ToolRow) => number;
  verb: string;
  noun: string;
  group: "reliability" | "behaviour";
}> = [
  { signal: "calls", label: "Calls", icon: Wrench, count: (r) => r.calls, sessions: (r) => r.runs, verb: "was called", noun: "calls", group: "reliability" },
  { signal: "errors", label: "Errors", icon: CircleX, count: (r) => r.errors, sessions: (r) => r.sessions.errored, verb: "errored", noun: "errored calls", group: "reliability" },
  { signal: "recovered", label: "Recovered", icon: RotateCcw, count: (r) => r.recovered, sessions: (r) => r.sessions.recovered, verb: "recovered after an error", noun: "recovered calls", group: "reliability" },
  { signal: "unrecovered", label: "Not recovered", icon: CircleAlert, count: (r) => r.unrecovered, sessions: (r) => r.sessions.unrecovered, verb: "errored and never recovered", noun: "unrecovered errors", group: "reliability" },
  { signal: "dropped", label: "Dropped", icon: Unplug, count: (r) => r.dropped, sessions: (r) => r.sessions.dropped, verb: "never reported finishing", noun: "dropped calls", group: "behaviour" },
  { signal: "duplicates", label: "Duplicates", icon: Copy, count: (r) => r.duplicates, sessions: (r) => r.sessions.duplicated, verb: "repeated identical arguments", noun: "duplicate calls", group: "behaviour" },
  { signal: "empty", label: "Empty", icon: CircleSlash, count: (r) => r.empty, sessions: (r) => r.sessions.empty, verb: "returned nothing", noun: "empty results", group: "behaviour" },
  { signal: "cited", label: "Cited", icon: Quote, count: (r) => r.cited, sessions: (r) => r.sessions.cited, verb: "was cited in the answer", noun: "cited results", group: "behaviour" },
];

const SIGNAL_IDS: ReadonlySet<string> = new Set(SIGNALS.map((s) => s.signal));

const FAILURES_PAGE = 10;

/** Drawer state lives in the URL (`tool`, `dfilter`, `dclass`); renders nothing without `tool`. */
export function ToolDrawer({ scope, rows }: { scope: MetricsScopeParams; rows?: readonly ToolRow[] }): ReactElement | null {
  const [tool] = useMetricsParam("tool");
  if (!tool) return null;
  return <ToolDrawerBody key={tool} scope={scope} tool={tool} rows={rows} />;
}

function ToolDrawerBody({ scope, tool, rows }: { scope: MetricsScopeParams; tool: string; rows?: readonly ToolRow[] }): ReactElement {
  const patch = useMetricsParams();
  const [rawSignal] = useMetricsParam("dfilter");
  const [errorClass] = useMetricsParam("dclass");
  const backfill = useToolStatsBackfill(scope.userId);
  const sessionsRef = useRef<HTMLElement>(null);

  const known = rows?.find((r) => r.tool === tool) ?? null;
  // Wait for the panel's own rows first so a deep link does not race them.
  const lookup = useTools(scope, { search: tool, limit: 50, sort: "calls", dir: "desc" }, { enabled: rows !== undefined && known === null });
  const row = known ?? lookup.data?.rows.find((r) => r.tool === tool) ?? null;
  const lookupDone = known !== null || (lookup.data !== undefined && !lookup.isPlaceholder);

  const signal: ToolSignal =
    rawSignal && SIGNAL_IDS.has(rawSignal) ? (rawSignal as ToolSignal) : row && row.errors > 0 ? "errors" : "calls";
  const spec = SIGNALS.find((s) => s.signal === signal) ?? SIGNALS[0]!;

  const setSignal = (next: ToolSignal): void => patch({ dfilter: next, dclass: null }, { replace: true });
  const pickClass = (cls: string): void => {
    patch({ dfilter: "errors", dclass: cls }, { replace: true });
    sessionsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const close = (): void => patch({ tool: null, dfilter: null, dclass: null });
  return (
    <Drawer
      title={tool}
      width={760}
      heading={<ToolName name={tool} className="text-[15px] [&>span:last-child]:text-[15px]" />}
      subtitle={
        row
          ? `${fmtInt(row.calls)} ${plural(row.calls, "call")} in ${fmtInt(row.runs)} ${plural(row.runs, "run")} · last ${scope.days} ${plural(scope.days, "day")}`
          : `Last ${scope.days} ${plural(scope.days, "day")}`
      }
      onClose={close}
    >
      {row ? (
        <ToolSummary row={row} active={signal} onSignal={setSignal} />
      ) : lookupDone ? (
        <p className="rounded-lg bg-xyne-surface-subtle p-3 text-[12px] text-xyne-fg-muted">
          No calls to this tool in the selected window and agents.
        </p>
      ) : (
        <div className="h-[104px] animate-pulse rounded-lg bg-xyne-surface-subtle" aria-hidden />
      )}

      <section ref={sessionsRef} className="mt-6 scroll-mt-4">
        <h3 className="mb-2 text-[13px] font-semibold text-xyne-fg-primary">Sessions</h3>
        <SignalChips row={row} active={signal} onSignal={setSignal} />
        {errorClass && (
          <div className="mt-2 flex min-w-0 items-center gap-2 text-[12px]">
            <span className="shrink-0 text-xyne-fg-muted">Failure mode</span>
            <span className="inline-flex min-w-0 items-center gap-1 rounded-full border border-xyne-error-border bg-xyne-error-bg py-0.5 pl-2 pr-1 text-xyne-error-fg">
              <CircleX size={11} className="shrink-0" aria-hidden />
              <span className="min-w-0 truncate" title={errorClass}>
                {errorClass}
              </span>
              <button
                type="button"
                onClick={() => patch({ dclass: null }, { replace: true })}
                aria-label="Clear the failure-mode filter"
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full hover:bg-xyne-surface"
              >
                <X size={11} aria-hidden />
              </button>
            </span>
          </div>
        )}
        <div className="mt-3">
          <SessionsList
            scope={scope}
            request={{ kind: "tool", tool, signal, ...(errorClass ? { errorClass } : {}) }}
            subject={
              <>
                <code className="font-mono text-xyne-fg-secondary">{splitToolName(tool).tool}</code> {spec.verb}
                {errorClass ? " with this failure mode" : ""}
              </>
            }
            calls={row && !errorClass ? { value: spec.count(row), noun: spec.noun } : undefined}
            expected={row && !errorClass ? spec.sessions(row) : undefined}
            onWiden={() => patch({ range: 30 }, { replace: true })}
            backfill={<BackfillAction isAdmin={scope.isAdmin} state={backfill} onRun={backfill.run} />}
          />
        </div>
      </section>

      <LazyCard minHeight={120} className="mt-8" placeholder={<RowsSkeleton rows={3} />}>
        <DrawerFailureModes scope={scope} tool={tool} selected={errorClass} onPick={pickClass} />
      </LazyCard>
    </Drawer>
  );
}

/** Recovered at >= 70% over 5+ errors is the one value allowed to be green. */
function RecoveredSummaryValue({ row, onDrill }: { row: ToolRow; onDrill: () => void }): ReactElement {
  if (row.errors >= 5 && row.recoveryRate != null && statusFor("toolRecovery", row.recoveryRate, row.errors, { row: true }) === "ok") {
    return (
      <DrillCount
        value={row.recovered}
        onClick={onDrill}
        title={`Show the sessions that recovered (${fmtInt(row.recovered)} calls)`}
        className="text-xyne-success-fg decoration-xyne-success-fg"
      >
        <RotateCcw size={12} aria-hidden className="mr-0.5" />
        {fmtPct(row.recoveryRate)}
      </DrillCount>
    );
  }
  return <RecoveryCell recovered={row.recovered} errors={row.errors} onDrill={onDrill} />;
}

function ToolSummary({
  row,
  active,
  onSignal,
}: {
  row: ToolRow;
  active: ToolSignal;
  onSignal: (s: ToolSignal) => void;
}): ReactElement {
  const reliability: Array<{ key: string; label: string; value: ReactNode; note: string }> = [
    {
      key: "calls",
      label: "Calls",
      value: <DrillCount value={row.calls} onClick={() => onSignal("calls")} title="Show every session that called it" className="-ml-1.5 text-[15px] font-semibold" />,
      note: `${fmtInt(row.runs)} ${plural(row.runs, "run")}`,
    },
    {
      key: "errors",
      label: "Errors",
      value:
        row.errors === 0 ? (
          <ZeroCount />
        ) : (
          <DrillCount value={row.errors} status={statusFor("toolErrorRate", row.errorRate, row.calls, { row: true })} onClick={() => onSignal("errors")} title="Show the sessions where it errored" className="-ml-1.5 text-[15px] font-semibold">
            {fmtPct(row.errorRate)}
          </DrillCount>
        ),
      note: `${fmtInt(row.errors)} errored${row.notFound > 0 ? ` · ${fmtInt(row.notFound)} not found` : ""}`,
    },
    {
      key: "recovered",
      label: "Recovered",
      value: <RecoveredSummaryValue row={row} onDrill={() => onSignal("recovered")} />,
      note: row.errors > 0 ? `${fmtInt(row.unrecovered)} never recovered` : "nothing to recover",
    },
    {
      key: "dropped",
      label: "Dropped",
      value: (
        <DrillCount
          value={row.dropped}
          status={statusFor("toolDropped", row.droppedRate, row.calls, { row: true })}
          onClick={() => onSignal("dropped")}
          title="Show the sessions with a dropped call"
          className="-ml-1.5 text-[15px] font-semibold"
        />
      ),
      note: row.dropped > 0 ? `${fmtPct(row.droppedRate)} of calls` : "all reported finishing",
    },
    {
      key: "duplicates",
      label: "Duplicates",
      value: (
        <DrillCount
          value={row.duplicates}
          status={statusFor("toolDuplicate", row.duplicateRate, row.calls, { row: true })}
          onClick={() => onSignal("duplicates")}
          title="Show the sessions with identical repeats"
          className="-ml-1.5 text-[15px] font-semibold"
        />
      ),
      note: row.duplicates > 0 ? `${fmtPct(row.duplicateRate)} of calls` : "no identical repeats",
    },
  ];
  const speed = [
    `p50 ${fmtMs(row.p50Ms)} · p95 ${fmtP95(row)}`,
    `avg ${fmtMs(row.avgMs)} · max ${fmtMs(row.maxMs)}`,
    `${fmtBytes(row.avgBytes)} per call · ${fmtPct(row.contextShare)} of window context`,
    `${fmtInt(row.topLevelCalls)} parent / ${fmtInt(row.childCalls)} subagent calls`,
  ];
  return (
    <div className="rounded-lg bg-xyne-surface-subtle p-3">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 min-[560px]:grid-cols-5">
        {reliability.map((s) => (
          <div key={s.key} className="min-w-0">
            <dt className="text-[10px] font-medium uppercase tracking-wider text-xyne-fg-muted">{s.label}</dt>
            <dd className="mt-0.5 flex min-h-[28px] items-center text-[15px] font-semibold tabular-nums">{s.value}</dd>
            <dd className="truncate text-[11px] text-xyne-fg-muted">{s.note}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 border-t border-xyne-border-subtle pt-2 text-[12px] tabular-nums text-xyne-fg-muted">
        {speed.join("  ·  ")}
      </p>
      <p className="mt-1 text-[11px] text-xyne-fg-tertiary">p50 and p95 are estimated from duration buckets; avg and max are exact.</p>
    </div>
  );
}

/** Filter chips with call counts from the loaded row; zero chips are inert. */
function SignalChips({
  row,
  active,
  onSignal,
}: {
  row: ToolRow | null;
  active: ToolSignal;
  onSignal: (s: ToolSignal) => void;
}): ReactElement {
  const chip = (s: (typeof SIGNALS)[number]): ReactElement => {
    const count = row ? s.count(row) : null;
    const disabled = count === 0;
    const selected = active === s.signal;
    const Icon = s.icon;
    return (
      <button
        key={s.signal}
        type="button"
        aria-pressed={selected}
        disabled={disabled}
        onClick={() => onSignal(s.signal)}
        title={row ? `${fmtInt(s.sessions(row))} ${plural(s.sessions(row), "session")}` : undefined}
        className={cn(
          "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium tabular-nums transition-colors",
          selected
            ? "border-xyne-fg-primary bg-xyne-fg-primary text-xyne-fg-inverse"
            : "border-xyne-border text-xyne-fg-secondary hover:enabled:bg-xyne-surface-subtle hover:enabled:text-xyne-fg-primary",
          disabled && "cursor-not-allowed opacity-40",
        )}
      >
        <Icon size={12} aria-hidden />
        {s.label}
        {count != null && <span className={cn(selected ? "opacity-80" : "text-xyne-fg-muted")}>{fmtInt(count)}</span>}
      </button>
    );
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Show sessions where the tool">
      {SIGNALS.filter((s) => s.group === "reliability").map(chip)}
      <span aria-hidden className="mx-1 h-5 w-px bg-xyne-border" />
      {SIGNALS.filter((s) => s.group === "behaviour").map(chip)}
    </div>
  );
}

function DrawerFailureModes({
  scope,
  tool,
  selected,
  onPick,
}: {
  scope: MetricsScopeParams;
  tool: string;
  selected: string | null;
  onPick: (errorClass: string) => void;
}): ReactElement {
  const [offset, setOffset] = useState(0);
  const state = useErrorClasses(scope, { tool, limit: FAILURES_PAGE, offset });
  const data = state.data;
  useEffect(() => setOffset(0), [tool]);
  const rows = data?.rows ?? [];
  return (
    <section>
      <h3 className="mb-1 text-[13px] font-semibold text-xyne-fg-primary">Failure modes</h3>
      <p className="mb-2 text-[12px] text-xyne-fg-muted">
        {data
          ? data.total === 0
            ? "No stored failure messages for this tool in this window."
            : `${fmtInt(data.total)} ${plural(data.total, "class", "classes")} across ${fmtInt(data.occurrences)} errored ${plural(data.occurrences, "call")}, most frequent first. Click one to list its sessions above.`
          : "Loading failure modes…"}
      </p>
      {state.error && !data ? (
        <PanelError error={state.error} onRetry={state.refetch} />
      ) : !data ? (
        <RowsSkeleton rows={3} />
      ) : (
        <ol className={cn("-mx-2 flex flex-col transition-opacity duration-150", state.isPlaceholder && "opacity-60")}>
          {rows.map((fc, i) => (
            <FailureModeItem
              key={fc.errorClass}
              row={fc}
              showTool={false}
              selected={selected === fc.errorClass}
              share={offset === 0 && i === 0 && data.occurrences > 0 ? fc.occurrences / data.occurrences : null}
              onOpen={() => onPick(fc.errorClass)}
            />
          ))}
        </ol>
      )}
      {data && data.total > FAILURES_PAGE && (
        <Pager offset={offset} limit={FAILURES_PAGE} total={data.total} onOffset={setOffset} className="mt-3" />
      )}
    </section>
  );
}

