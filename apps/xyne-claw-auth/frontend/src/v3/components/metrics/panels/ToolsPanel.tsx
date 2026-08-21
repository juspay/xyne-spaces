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

import { type ReactElement } from "react";
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
  ChartAggregation,
  ChartMeasure,
  ChartRequest,
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

/** What the bars measure. The server ranks for the pair, so switching refetches. */
const CHART_MEASURES = [
  { id: "bytes", label: "Context returned" },
  { id: "time", label: "Time in tool" },
  { id: "errors", label: "Errors" },
  { id: "calls", label: "Calls" },
] as const;

const AGG_LABEL: Record<ChartAggregation, string> = {
  total: "Cumulative",
  perCall: "Per call",
  perSession: "Per session",
};

/**
 * Every (measure, aggregation) pair, spelled out.
 *
 * Composing a description from two generic halves produced sentences like
 * "mean calls for a single call" and attached a duration-specific caveat to a
 * byte count. Each cell is written for the thing it actually describes, and a
 * pair that has no meaning simply is not offered — calls-per-call is 1 by
 * definition, so `calls` has no `perCall` entry and the control hides it.
 */
interface ChartSpec {
  /** Completes "Tools by …". */
  noun: string;
  description: string;
  badge: Aggregation;
  unit: string;
  format: (v: number) => string;
}

const roundedCount = (v: number): string => formatCount(Math.round(v * 100) / 100);

const CHART_SPECS: Record<ChartMeasure, Partial<Record<ChartAggregation, ChartSpec>>> = {
  bytes: {
    total: {
      noun: "context returned",
      description: "Total bytes of tool output fed back into the model, summed over every call in the window. The biggest bar is usually the best compaction target.",
      badge: "cumulative", unit: "bytes", format: formatBytes,
    },
    perCall: {
      noun: "context per call",
      description: "Mean bytes a single call returns. A tool can be cheap per call and still dominate the budget on volume — compare against the cumulative view.",
      badge: "average", unit: "bytes / call", format: formatBytes,
    },
    perSession: {
      noun: "context per session",
      description: "Mean bytes a run gets from this tool, across runs that use it at all. Runs that never call it are not in the denominator.",
      badge: "average", unit: "bytes / session", format: formatBytes,
    },
  },
  time: {
    total: {
      noun: "time in tool",
      description: "Total time spent inside this tool, summed over every call — not the time of a typical call. A tool can lead here on volume alone, so read it beside p50 and p95 in the table.",
      badge: "cumulative", unit: "ms", format: formatMs,
    },
    perCall: {
      noun: "time per call",
      description: "Mean duration of a single call. Divides by TIMED calls — a call whose end event never arrived has no duration and would drag the mean toward zero.",
      badge: "average", unit: "ms / call", format: formatMs,
    },
    perSession: {
      noun: "time per session",
      description: "Mean time a run spends inside this tool, across runs that use it at all.",
      badge: "average", unit: "ms / session", format: formatMs,
    },
  },
  errors: {
    total: {
      noun: "errored calls",
      description: "Errored calls per tool, counted over the window. Absolute counts, not rates — a rare tool at a 100% error rate is a smaller problem than a common one at 5%.",
      badge: "cumulative", unit: "calls", format: roundedCount,
    },
    perCall: {
      noun: "error rate",
      description: "Share of this tool's calls that errored. The rate view: it surfaces unreliable tools regardless of how often they are used, so read it beside the cumulative count.",
      badge: "rate", unit: "of calls", format: (v) => formatPct(v),
    },
    perSession: {
      noun: "errors per session",
      description: "Mean errored calls a run hits from this tool, across runs that use it at all.",
      badge: "average", unit: "errors / session", format: roundedCount,
    },
  },
  calls: {
    total: {
      noun: "call volume",
      description: "Calls per tool, counted over the window.",
      badge: "cumulative", unit: "calls", format: roundedCount,
    },
    // No perCall: calls-per-call is 1 by definition.
    perSession: {
      noun: "calls per session",
      description: "Mean calls a run makes to this tool, across runs that use it at all. High means a few runs call it repeatedly — a loop; near 1 means many runs call it once — a broad dependency.",
      badge: "average", unit: "calls / session", format: roundedCount,
    },
  },
};

/** Only the aggregations that mean something for this measure. */
function aggregationsFor(measure: ChartMeasure): Array<{ id: ChartAggregation; label: string }> {
  return (Object.keys(CHART_SPECS[measure]) as ChartAggregation[]).map((id) => ({
    id,
    label: AGG_LABEL[id],
  }));
}

/** Falls back to the measure's cumulative view when a pair has no meaning. */
function specFor(measure: ChartMeasure, aggregation: ChartAggregation): { spec: ChartSpec; aggregation: ChartAggregation } {
  const exact = CHART_SPECS[measure][aggregation];
  if (exact) return { spec: exact, aggregation };
  return { spec: CHART_SPECS[measure].total!, aggregation: "total" };
}

/** Below this, an average rests on too little evidence to rank confidently. */
const THIN_EVIDENCE_CALLS = 3;

export function ToolsPanel({
  data,
  loading,
  error,
  toolFilter,
  paging,
  failures,
  onDrillFailures,
  chart,
  onChartChange,
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
  /** Owned by the page: the pair is a request parameter, not local view state. */
  chart: ChartRequest;
  onChartChange: (next: ChartRequest) => void;
}): ReactElement {

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
    sessions: 0,
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
  // Prefer what the server actually computed: it coerces a pair it cannot
  // honour, and the labels must describe the bars on screen, not the request.
  const requested = data.chartRequest ?? chart;
  const { spec, aggregation } = specFor(requested.measure, requested.aggregation);
  const series = data.chart ?? [];

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
      key: "sessions",
      header: "Sessions",
      numeric: true,
      sortValue: (r) => r.sessions,
      hint: "Distinct runs that called this tool at least once",
      render: (r) => formatCount(r.sessions),
    },
    {
      key: "callsPerSession",
      header: "Calls / session",
      numeric: true,
      sortValue: (r) => r.callsPerSession,
      hint: "Calls ÷ sessions. High means a few runs call it repeatedly; near 1 means many runs call it once.",
      render: (r) =>
        r.callsPerSession === null ? (
          <span className="text-xyne-fg-muted">n/a</span>
        ) : (
          <span style={r.callsPerSession >= 5 ? { color: STATUS.warning } : undefined}>
            {r.callsPerSession.toFixed(1)}×
          </span>
        ),
    },
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

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Tool calls" value={formatCount(totals.calls)} detail={`${formatCount(totals.distinctTools)} distinct tools`} aggregation="cumulative" unit="calls" />
        <StatTile
          label="Calls per session"
          value={totals.sessions > 0 ? `${(totals.calls / totals.sessions).toFixed(1)}×` : "—"}
          detail={`${formatCount(totals.sessions)} sessions used tools`}
          aggregation="average"
          unit="calls / session"
          hint="Across runs that made at least one tool call. Runs that used no tools are not in the denominator."
        />
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
        title={`Tools by ${spec.noun}`}
        description={`${spec.description} Ranked across every tool in the window, not the rows on this page.`}
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <UnitBadge aggregation={spec.badge} unit={spec.unit} />
            <SegmentedControl
              ariaLabel="Chart measure"
              options={CHART_MEASURES}
              value={requested.measure}
              onChange={(measureId) =>
                // Keep the aggregation only if the new measure supports it.
                onChartChange({
                  measure: measureId,
                  aggregation: specFor(measureId, aggregation).aggregation,
                })
              }
            />
            <SegmentedControl
              ariaLabel="Chart aggregation"
              options={aggregationsFor(requested.measure)}
              value={aggregation}
              onChange={(aggId) => onChartChange({ measure: requested.measure, aggregation: aggId })}
            />
          </div>
        }
      >
        {series.length === 0 ? (
          <p className="py-6 text-[13px] text-xyne-fg-muted">Nothing recorded for this measure.</p>
        ) : (
          <>
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
                    value: spec.unit,
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
                      format={(value, _n, item) => {
                        const share = item?.["share"] as number | null | undefined;
                        const calls = (item?.["calls"] as number) ?? 0;
                        const sessions = (item?.["sessions"] as number) ?? 0;
                        const evidence = `${formatCount(calls)} call${calls === 1 ? "" : "s"} across ${formatCount(sessions)} session${sessions === 1 ? "" : "s"}`;
                        return share == null
                          ? `${spec.format(Number(value))} · ${evidence}`
                          : `${spec.format(Number(value))} · ${formatPct(share)} of window · ${evidence}`;
                      }}
                    />
                  }
                />
                <Bar dataKey="value" name={spec.unit} radius={[0, 4, 4, 0]} barSize={18} isAnimationActive={false}>
                  {series.map((entry) => (
                    <Cell
                      key={entry.tool}
                      fill={
                        // An average over a handful of calls can top the chart on
                        // noise. Muted rather than hidden — the reader decides.
                        aggregation !== "total" && entry.calls < THIN_EVIDENCE_CALLS
                          ? NEUTRAL.muted
                          : (entry.share ?? 0) >= 0.25
                            ? STATUS.serious
                            : SEQUENTIAL.mid
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            {aggregation !== "total" && series.some((s) => s.calls < THIN_EVIDENCE_CALLS) && (
              <p className="mt-2 text-[11px] text-xyne-fg-muted">
                Greyed bars rest on fewer than {THIN_EVIDENCE_CALLS} calls — a high average there is
                thin evidence, not a finding.
              </p>
            )}
          </>
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
