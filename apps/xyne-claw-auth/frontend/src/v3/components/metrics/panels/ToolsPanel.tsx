/**
 * Per-tool reliability, latency and context cost.
 *
 * Ordered by what a reader needs first: a KPI row that says whether anything is
 * wrong, then the failure modes (which tool, and why), then the charts, then the
 * full table.
 *
 * ── Everything here is window-wide, nothing is page-derived ───────────────
 * A workspace can grant thousands of tools, so the table is paged and sorted by
 * the server. That makes two things load-bearing:
 *
 *   - the KPI tiles read `data.totals`, computed over every tool. Summing the
 *     visible rows would make "total tool calls" shrink as the reader pages.
 *   - the charts read `data.charts`, a server-side top-N. Ranking the loaded
 *     page would draw "the eight worst tools" from whichever eight happened to
 *     be on screen.
 *
 * ── Units ─────────────────────────────────────────────────────────────────
 * Every chart and tile carries a UnitBadge, because "tool time: 4.2m" is
 * ambiguous between the sum over every call and the typical call — figures that
 * differ by orders of magnitude and lead to opposite decisions.
 */

import { useState, type ReactElement } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  ToolChartPoint,
  ToolFailuresResponse,
  ToolMetrics,
  ToolSortKey,
  ToolStatsRow,
  ToolWindowTotals,
} from "../../../../lib/api";
import {
  CoverageNotice,
  MetricsCard,
  PanelError,
  PanelMessage,
  SegmentedControl,
  ShareBar,
  SortableTable,
  StatTile,
  UnitBadge,
  type Aggregation,
  type Column,
  type ServerPaging,
} from "../MetricsPrimitives";
import { AXIS_LINE, AXIS_TICK, NEUTRAL, SEQUENTIAL, STATUS, rateTone } from "../metricsPalette";
import { MetricsTooltip } from "../MetricsTooltip";
import { ToolFailuresCard } from "../ToolFailuresCard";
import {
  formatBytes,
  formatCount,
  formatMs,
  formatOptionalPct,
  formatPct,
} from "../metricsFormat";

const CHART_HEIGHT = 280;

/** The three "which tool is worst" questions, each with its own unit. */
const CHART_METRICS = [
  { id: "bytes", label: "Context returned" },
  { id: "time", label: "Time in tool" },
  { id: "errors", label: "Errors" },
] as const;

type ChartMetric = (typeof CHART_METRICS)[number]["id"];

const CHART_SPEC: Record<
  ChartMetric,
  {
    title: string;
    description: string;
    aggregation: Aggregation;
    unit: string;
    format: (value: number) => string;
    pick: (charts: ToolMetrics["charts"]) => ToolChartPoint[];
  }
> = {
  bytes: {
    title: "Which tools consume the context budget",
    description:
      "Total bytes of tool output fed back into the model, summed over every call in the window. The biggest bar is usually the best compaction target.",
    aggregation: "cumulative",
    unit: "bytes",
    format: formatBytes,
    pick: (c) => c.byBytes,
  },
  time: {
    title: "Which tools consume wall-clock",
    description:
      "Total time spent inside each tool, summed over every call — not the time of a typical call. A tool can lead here on volume alone, so read it beside p50 and p95 in the table.",
    aggregation: "cumulative",
    unit: "ms",
    format: formatMs,
    pick: (c) => c.byTime,
  },
  errors: {
    title: "Which tools fail most",
    description:
      "Errored calls per tool, counted over the window. Absolute counts, not rates — a rare tool with a 100% error rate is a smaller problem than a common one at 5%.",
    aggregation: "cumulative",
    unit: "calls",
    format: formatCount,
    pick: (c) => c.byErrors,
  },
};

export function ToolsPanel({
  data,
  loading,
  error,
  toolFilter,
  paging,
  failures,
  onDrillFailures,
}: {
  data: ToolMetrics | undefined;
  loading: boolean;
  error: string | null;
  /** Client-side narrowing on top of the server page — see MetricsPageV3. */
  toolFilter: readonly string[];
  paging: ServerPaging;
  /** Open failure drill-down, or null. The page owns the fetch. */
  failures: {
    tool: string;
    data: ToolFailuresResponse | undefined;
    loading: boolean;
    error: string | null;
    onOffset: (offset: number) => void;
  } | null;
  onDrillFailures: (tool: string | null) => void;
}): ReactElement {
  const [chartMetric, setChartMetric] = useState<ChartMetric>("bytes");

  if (error) return <PanelError error={error} />;
  if (loading && !data) return <PanelMessage title="Loading tool metrics…" />;

  const wanted = new Set(toolFilter);
  const rows = wanted.size === 0 ? (data?.tools ?? []) : (data?.tools ?? []).filter((r) => wanted.has(r.tool));
  const errorClasses = wanted.size === 0
    ? (data?.errorClasses ?? [])
    : (data?.errorClasses ?? []).filter((r) => wanted.has(r.tool));

  // Degrade rather than crash when the response predates these fields. The
  // frontend and backend deploy separately, so during a rollout this panel can
  // meet an older /metrics/tools that returns neither totals nor charts. Summing
  // the page is wrong (that is the whole point of window totals) but it is a
  // truthful reading of what arrived, and it beats a blank tab.
  const totals: ToolWindowTotals = data?.totals ?? {
    distinctTools: rows.length,
    calls: rows.reduce((a, r) => a + r.calls, 0),
    errors: rows.reduce((a, r) => a + r.errors, 0),
    droppedEnd: rows.reduce((a, r) => a + r.droppedEnd, 0),
    duplicateCalls: rows.reduce((a, r) => a + r.duplicateCalls, 0),
    emptyResults: rows.reduce((a, r) => a + r.emptyResults, 0),
    citeableCalls: rows.reduce((a, r) => a + r.citeableCalls, 0),
    citedCalls: rows.reduce((a, r) => a + r.citedCalls, 0),
    recoveredCalls: rows.reduce((a, r) => a + r.recoveredCalls, 0),
    resultBytes: rows.reduce((a, r) => a + r.resultBytesTotal, 0),
    totalMs: rows.reduce((a, r) => a + r.totalMs, 0),
  };

  if (!data || (totals.distinctTools === 0 && rows.length === 0)) {
    return (
      <PanelMessage
        title="No tool calls in this window"
        detail="Widen the time range, or clear the agent filter to look across the workspace."
      />
    );
  }
  const errorRate = totals.calls > 0 ? totals.errors / totals.calls : 0;
  const droppedRate = totals.calls > 0 ? totals.droppedEnd / totals.calls : 0;
  const spec = CHART_SPEC[chartMetric];
  const series = data.charts ? spec.pick(data.charts) : [];

  const columns: Array<Column<ToolStatsRow>> = [
    {
      key: "tool" satisfies ToolSortKey,
      header: "Tool",
      sortValue: (r) => r.tool,
      render: (r) => (
        <div className="flex flex-col">
          <button
            type="button"
            onClick={() => onDrillFailures(r.tool)}
            title="Show every failure class for this tool"
            className="text-left font-mono text-[12px] font-medium text-xyne-fg-primary underline-offset-2 hover:underline"
          >
            {r.tool}
          </button>
          {r.childCalls > 0 && (
            <span className="text-[11px] text-xyne-fg-muted">
              {formatCount(r.topLevelCalls)} top-level · {formatCount(r.childCalls)} in subagents
            </span>
          )}
        </div>
      ),
    },
    { key: "calls", header: "Calls", numeric: true, sortValue: (r) => r.calls, hint: "Cumulative calls in the window", render: (r) => formatCount(r.calls) },
    {
      key: "errorRate",
      header: "Errors",
      numeric: true,
      sortValue: (r) => r.errorRate,
      hint: "Share of calls that returned an error. Sorts by rate, shows count and rate.",
      render: (r) => {
        const tone = rateTone(r.errorRate);
        return r.errors === 0 ? (
          <span className="text-xyne-fg-muted">—</span>
        ) : (
          <button
            type="button"
            onClick={() => onDrillFailures(r.tool)}
            title="Show every failure class for this tool"
            className="underline-offset-2 hover:underline"
            style={tone ? { color: STATUS[tone] } : undefined}
          >
            {formatCount(r.errors)} · {formatPct(r.errorRate)}
          </button>
        );
      },
    },
    {
      key: "recoveryRate",
      header: "Recovered",
      numeric: true,
      sortValue: (r) => (r.erroredCalls > 0 ? r.recoveryRate : null),
      hint: "Errored calls where the same tool later succeeded in the same run",
      render: (r) => (r.erroredCalls === 0 ? <span className="text-xyne-fg-muted">n/a</span> : formatPct(r.recoveryRate)),
    },
    {
      key: "duplicateRate",
      header: "Duplicates",
      numeric: true,
      sortValue: (r) => r.duplicateRate,
      hint: "Repeat calls with identical arguments inside one run — blind retries",
      render: (r) =>
        r.duplicateCalls === 0 ? (
          <span className="text-xyne-fg-muted">—</span>
        ) : (
          `${formatCount(r.duplicateCalls)} · ${formatPct(r.duplicateRate)}`
        ),
    },
    {
      key: "droppedEnd",
      header: "Lost events",
      numeric: true,
      sortValue: (r) => r.droppedEndRate,
      hint: "Calls whose completion event never arrived. Excluded from the latency columns.",
      render: (r) =>
        r.droppedEnd === 0 ? (
          <span className="text-xyne-fg-muted">—</span>
        ) : (
          <span style={{ color: STATUS.warning }}>{formatCount(r.droppedEnd)}</span>
        ),
    },
    { key: "avgMs", header: "Avg", numeric: true, sortValue: (r) => r.avgMs, hint: "Mean duration per timed call, in ms — exact, not bucketed", render: (r) => formatMs(r.avgMs) },
    { key: "p50Ms", header: "p50", numeric: true, sortValue: (r) => r.p50Ms, hint: "Median call duration. Resolves to a latency band, not an exact millisecond.", render: (r) => formatMs(r.p50Ms) },
    {
      key: "p95Ms",
      header: "p95",
      numeric: true,
      sortValue: (r) => r.p95Ms,
      hint: "Slow tail. Bucketed to the nearest latency band, not exact to the millisecond.",
      render: (r) => formatMs(r.p95Ms),
    },
    { key: "totalMs", header: "Cumulative", numeric: true, sortValue: (r) => r.totalMs, hint: "Sum of every call's duration — volume × latency", render: (r) => formatMs(r.totalMs) },
    {
      key: "resultBytes",
      header: "Context burn",
      numeric: true,
      sortValue: (r) => r.resultBytesTotal,
      hint: "Cumulative bytes of tool output, and the share of all such bytes in the window",
      render: (r) => (
        <div className="flex justify-end">
          <ShareBar share={r.contextShare} label={formatBytes(r.resultBytesTotal)} emphasis={r.contextShare >= 0.25} />
        </div>
      ),
    },
    {
      key: "citeRate",
      header: "Cited",
      numeric: true,
      sortValue: (r) => r.citeRate,
      hint: "Of the calls that produced citeable output, how many the answer cited. Same-turn scope; n/a when nothing was citeable.",
      render: (r) => (
        <span className={r.citeRate === null ? "text-xyne-fg-muted" : undefined}>
          {formatOptionalPct(r.citeRate)}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-[20px]">
      <CoverageNotice
        coverage={data.coverage.coverage}
        total={data.coverage.runsInWindow}
        covered={data.coverage.runsSummarised}
        unit="runs"
        remedy="Run the tool-stats backfill to close the gap."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile label="Tool calls" value={formatCount(totals.calls)} detail={`${formatCount(totals.distinctTools)} distinct tools`} aggregation="cumulative" unit="calls" />
        <StatTile
          label="Error rate"
          value={formatPct(errorRate)}
          detail={`${formatCount(totals.errors)} failed calls`}
          tone={rateTone(errorRate) ?? "good"}
          aggregation="rate"
          unit="of calls"
        />
        <StatTile
          label="Blind retries"
          value={formatCount(totals.duplicateCalls)}
          detail="Identical args, same run"
          tone={totals.duplicateCalls > 0 ? "warning" : "neutral"}
          aggregation="cumulative"
          unit="calls"
          hint="A repeat call with identical arguments inside one run — the model retrying without changing anything."
        />
        <StatTile
          label="Lost end-events"
          value={formatPct(droppedRate)}
          detail={`${formatCount(totals.droppedEnd)} calls`}
          tone={droppedRate > 0.02 ? "serious" : "neutral"}
          aggregation="rate"
          unit="of calls"
          hint="Tool completions whose push never landed. Excluded from latency figures rather than counted as instant successes."
        />
        <StatTile
          label="Context returned"
          value={formatBytes(totals.resultBytes)}
          detail={`${formatMs(totals.totalMs)} spent in tools`}
          aggregation="cumulative"
          unit="bytes"
        />
      </div>

      {failures && (
        <ToolFailuresCard
          tool={failures.tool}
          data={failures.data}
          loading={failures.loading}
          error={failures.error}
          onOffset={failures.onOffset}
          onClose={() => onDrillFailures(null)}
        />
      )}

      {errorClasses.length > 0 && (
        <MetricsCard
          title="Top failure modes"
          description="Errored results grouped by normalised message, so the same failure with different ids collapses into one row. Capped at the top few per tool — select a tool for its full list."
          action={<UnitBadge aggregation="cumulative" unit="occurrences" />}
        >
          <ul className="flex flex-col gap-2">
            {errorClasses.slice(0, 8).map((ec) => (
              <li key={`${ec.tool}-${ec.errorClass}`} className="rounded-lg bg-xyne-surface-sunken/60 px-3 py-2">
                <div className="flex items-baseline justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => onDrillFailures(ec.tool)}
                    className="font-mono text-[12px] font-medium text-xyne-fg-primary underline-offset-2 hover:underline"
                  >
                    {ec.tool}
                  </button>
                  <span className="shrink-0 text-[11px] tabular-nums text-xyne-fg-muted">
                    {formatCount(ec.occurrences)}×
                    {ec.lastSeen && ` · last ${new Date(ec.lastSeen).toLocaleDateString()}`}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 break-words font-mono text-[11px] text-xyne-fg-muted">
                  {ec.sample || ec.errorClass}
                </p>
              </li>
            ))}
          </ul>
        </MetricsCard>
      )}

      <MetricsCard
        title={spec.title}
        description={spec.description}
        action={
          <div className="flex items-center gap-2">
            <UnitBadge aggregation={spec.aggregation} unit={spec.unit} />
            <SegmentedControl
              ariaLabel="Chart measure"
              options={CHART_METRICS}
              value={chartMetric}
              onChange={setChartMetric}
            />
          </div>
        }
      >
        {series.length === 0 ? (
          <p className="py-6 text-[13px] text-xyne-fg-muted">Nothing recorded for this measure.</p>
        ) : (
          <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
            <BarChart data={series} layout="vertical" margin={{ top: 4, right: 56, bottom: 16, left: 8 }}>
              <CartesianGrid stroke={NEUTRAL.grid} horizontal={false} />
              <XAxis
                type="number"
                tick={AXIS_TICK}
                tickLine={false}
                axisLine={AXIS_LINE}
                tickFormatter={(v) => spec.format(Number(v))}
                label={{
                  value: `${spec.aggregation === "cumulative" ? "cumulative" : spec.aggregation} ${spec.unit}`,
                  position: "insideBottom",
                  offset: -8,
                  fontSize: 10,
                  fill: "currentColor",
                  opacity: 0.5,
                }}
              />
              <YAxis type="category" dataKey="tool" tick={AXIS_TICK} tickLine={false} axisLine={AXIS_LINE} width={160} />
              <Tooltip
                cursor={{ fill: "currentColor", opacity: 0.05 }}
                content={
                  <MetricsTooltip
                    format={(value, _n, item) =>
                      `${spec.format(Number(value))} · ${formatPct((item?.["share"] as number) ?? 0)} of window`
                    }
                  />
                }
              />
              <Bar dataKey="value" name={spec.unit} radius={[0, 4, 4, 0]} barSize={18} isAnimationActive={false}>
                {series.map((entry) => (
                  <Cell key={entry.tool} fill={entry.share >= 0.25 ? STATUS.serious : SEQUENTIAL.mid} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </MetricsCard>

      <MetricsCard
        title="All tools"
        description="Sorted and paged by the server, so the ranking is over every tool in the window rather than the rows on screen. Click a column to re-sort, or a tool name for its full failure list."
      >
        <SortableTable
          rows={rows}
          columns={columns}
          defaultSort="calls"
          rowKey={(r) => r.tool}
          emptyMessage="No tool calls match."
          paging={paging}
        />
      </MetricsCard>
    </div>
  );
}
