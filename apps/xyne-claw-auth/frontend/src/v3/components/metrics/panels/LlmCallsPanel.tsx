/**
 * Per-LLM-call latency: how time-to-first-token and throughput move with prompt
 * size and with position in the agent loop.
 *
 * ── Why these charts, in this order ───────────────────────────────────────
 * "Does a bigger prompt cost us latency" is the question, so context buckets
 * come first. Position-in-loop comes second because it is the same measure
 * against a different axis, and it only makes sense once the first chart has
 * established the relationship.
 *
 * Every chart plots ONE measure per axis. TTFT (ms) and throughput (tok/s) are
 * different scales and never share a y-axis — they are separate charts, because
 * a second y-axis invites the reader to compare two lines whose crossing point
 * is an artefact of the scaling. Sample size rides the tooltip for the same
 * reason.
 *
 * The compaction and retry shares sit under the call-index chart rather than
 * inside it: they explain the shape (a sawtooth, a spike) without competing
 * with the latency line for the same visual channel.
 */

import { useMemo, type ReactElement } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { LlmCallIndexRow, LlmCallMetrics } from "../../../../lib/api";
import {
  ChartLegend,
  CoverageNotice,
  MetricsCard,
  PanelError,
  PanelMessage,
  StatTile,
  UnitBadge,
} from "../MetricsPrimitives";
import { AXIS_LINE, AXIS_TICK, NEUTRAL, SERIES, STATUS } from "../metricsPalette";
import { MetricsTooltip } from "../MetricsTooltip";
import { formatCompact, formatCount, formatMs, formatPct } from "../metricsFormat";

const CHART_HEIGHT = 280;

const bucketLabel = (tokens: number): string =>
  tokens === 0 ? "<4k" : `${formatCompact(tokens)}+`;

export function LlmCallsPanel({
  data,
  loading,
  error,
  includeSubagents,
  onToggleSubagents,
}: {
  data: LlmCallMetrics | undefined;
  loading: boolean;
  error: string | null;
  includeSubagents: boolean;
  onToggleSubagents: (next: boolean) => void;
}): ReactElement {
  const byContext = useMemo(
    () => (data?.byContext ?? []).map((b) => ({ ...b, label: bucketLabel(b.contextBucket) })),
    [data],
  );
  const byIndex = useMemo(() => data?.byCallIndex ?? [], [data]);

  const summary = useMemo(() => {
    const rows = data?.byContext ?? [];
    const calls = rows.reduce((a, r) => a + r.calls, 0);
    const weighted = rows.reduce((a, r) => a + (r.avgTokensPerSec ?? 0) * r.calls, 0);
    const smallest = rows.find((r) => r.p50TtftMs !== null);
    const largest = [...rows].reverse().find((r) => r.p50TtftMs !== null);
    // Only meaningful across two distinct buckets — a single bucket has no ratio.
    const ttftGrowth =
      smallest && largest && smallest !== largest && smallest.p50TtftMs
        ? (largest.p50TtftMs ?? 0) / smallest.p50TtftMs
        : null;
    const indexCalls = byIndex.reduce((a, r) => a + r.calls, 0);
    return {
      calls,
      avgTps: calls > 0 ? Math.round(weighted / calls) : null,
      ttftGrowth,
      smallestLabel: smallest ? bucketLabel(smallest.contextBucket) : null,
      largestLabel: largest ? bucketLabel(largest.contextBucket) : null,
      compactionShare:
        indexCalls > 0
          ? byIndex.reduce((a, r) => a + r.compactionShare * r.calls, 0) / indexCalls
          : null,
    };
  }, [data, byIndex]);

  if (error) return <PanelError error={error} />;
  if (loading && !data) return <PanelMessage title="Loading LLM call metrics…" />;

  if (!data || (byContext.length === 0 && byIndex.length === 0)) {
    return (
      <PanelMessage
        title="No per-call data in this window"
        detail="This series is recorded while a run executes and is never backfilled, so windows that predate the feature stay empty. Runs completed since then will populate it."
      />
    );
  }

  return (
    <div className="flex flex-col gap-[20px]">
      <CoverageNotice
        coverage={data.coverage.coverage}
        total={data.coverage.runsInWindow}
        covered={data.coverage.runsWithSeries}
        unit="runs"
        remedy="There is no backfill for per-call timing — it only exists while a run executes, so earlier runs stay empty permanently."
      />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile
            label="LLM calls"
            aggregation="cumulative"
            unit="calls"
            value={formatCount(summary.calls)}
            detail={data.scope === "parent" ? "Parent loop only" : "Parent + subagents"}
          />
          <StatTile
            label="Avg throughput"
            aggregation="average"
            unit="tok/s"
            value={summary.avgTps === null ? "—" : `${summary.avgTps} tok/s`}
            detail="Output tokens per second of decode"
          />
          <StatTile
            label="TTFT growth"
            value={summary.ttftGrowth === null ? "—" : `${summary.ttftGrowth.toFixed(1)}×`}
            detail={
              summary.smallestLabel && summary.largestLabel
                ? `${summary.smallestLabel} → ${summary.largestLabel} context`
                : "Needs two context buckets"
            }
            tone={summary.ttftGrowth !== null && summary.ttftGrowth >= 2 ? "serious" : "neutral"}
            hint="How much slower the first token gets between the smallest and largest context bucket."
          />
          <StatTile
            label="Compactions"
            aggregation="rate"
            unit="of calls"
            value={summary.compactionShare === null ? "—" : formatPct(summary.compactionShare)}
            detail="Calls on a freshly reset prompt"
            hint="Compaction resets the prompt, which is why context against turn number is a sawtooth rather than a ramp."
          />
        </div>
        <label className="flex shrink-0 items-center gap-2 pt-3 text-[12px] text-xyne-fg-muted">
          <input
            type="checkbox"
            checked={includeSubagents}
            onChange={(e) => onToggleSubagents(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-xyne-border"
          />
          Include subagent calls
        </label>
      </div>

      <MetricsCard
        title="Time to first token vs prompt size"
        description="Context is fresh input plus cached tokens — the real prompt the provider sees. Each point is the median and 95th percentile across every call in that bucket, not one call. Retried calls are excluded because their TTFT includes an abandoned attempt."
        action={<UnitBadge aggregation="median" unit="ms · p50 and p95" />}
      >
        <ChartLegend
          className="mb-2"
          items={[
            { color: SERIES[0], label: "p50 TTFT" },
            { color: SERIES[1], label: "p95 TTFT" },
          ]}
        />
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <LineChart data={byContext} margin={{ top: 8, right: 16, bottom: 16, left: 0 }}>
            <CartesianGrid stroke={NEUTRAL.grid} vertical={false} />
            <XAxis
              dataKey="label"
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={AXIS_LINE}
              label={{
                value: "context tokens",
                position: "insideBottom",
                offset: -8,
                fontSize: 10,
                fill: "currentColor",
                opacity: 0.5,
              }}
            />
            <YAxis
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={AXIS_LINE}
              width={56}
              tickFormatter={(v) => formatMs(Number(v))}
            />
            <Tooltip
              cursor={{ stroke: NEUTRAL.axis }}
              content={
                <MetricsTooltip
                  labelFormat={(l) => `${String(l)} context tokens`}
                  format={(value, _name, item) =>
                    `${formatMs(Number(value))} · n=${formatCount((item?.["calls"] as number) ?? 0)}`
                  }
                />
              }
            />
            <Line
              type="monotone"
              dataKey="p50TtftMs"
              name="p50 TTFT"
              stroke={SERIES[0]}
              strokeWidth={2}
              dot={{ r: 4, fill: SERIES[0], strokeWidth: 2, stroke: NEUTRAL.surface }}
              connectNulls
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="p95TtftMs"
              name="p95 TTFT"
              stroke={SERIES[1]}
              strokeWidth={2}
              strokeDasharray="4 3"
              dot={{ r: 4, fill: SERIES[1], strokeWidth: 2, stroke: NEUTRAL.surface }}
              connectNulls
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </MetricsCard>

      <MetricsCard
        title="Throughput vs prompt size"
        description="Output tokens per second of decode, averaged across the calls in each bucket. Plotted separately from TTFT rather than on a second axis — the two measures share no scale."
        action={<UnitBadge aggregation="average" unit="tok/s" />}
      >
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={byContext} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid stroke={NEUTRAL.grid} vertical={false} />
            <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={AXIS_LINE} />
            <YAxis
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={AXIS_LINE}
              width={56}
              tickFormatter={(v) => `${v}/s`}
            />
            <Tooltip
              cursor={{ stroke: NEUTRAL.axis }}
              content={
                <MetricsTooltip
                  labelFormat={(l) => `${String(l)} context tokens`}
                  format={(value) => `${Number(value)} tok/s`}
                />
              }
            />
            <Area
              type="monotone"
              dataKey="avgTokensPerSec"
              name="Throughput"
              stroke={SERIES[2]}
              strokeWidth={2}
              fill={SERIES[2]}
              fillOpacity={0.12}
              dot={{ r: 4, fill: SERIES[2], strokeWidth: 2, stroke: NEUTRAL.surface }}
              connectNulls
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </MetricsCard>

      <MetricsCard
        title="Latency by position in the loop"
        description="Call 1 is the first model call of a run. Each point is the median across every run's call at that position. Context climbs with each turn until a compaction resets it, so read this against the prompt-size chart below."
        action={<UnitBadge aggregation="median" unit="ms" />}
      >
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <LineChart data={byIndex} margin={{ top: 8, right: 16, bottom: 16, left: 0 }}>
            <CartesianGrid stroke={NEUTRAL.grid} vertical={false} />
            <XAxis
              dataKey="callIndex"
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={AXIS_LINE}
              label={{
                value: "call # within run",
                position: "insideBottom",
                offset: -8,
                fontSize: 10,
                fill: "currentColor",
                opacity: 0.5,
              }}
            />
            <YAxis
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={AXIS_LINE}
              width={56}
              tickFormatter={(v) => formatMs(Number(v))}
            />
            <Tooltip
              cursor={{ stroke: NEUTRAL.axis }}
              content={
                <MetricsTooltip
                  labelFormat={(l) => `Call #${String(l)}`}
                  format={(value, _name, item) =>
                    `${formatMs(Number(value))} · n=${formatCount((item?.["calls"] as number) ?? 0)}`
                  }
                />
              }
            />
            <Line
              type="monotone"
              dataKey="p50TtftMs"
              name="p50 TTFT"
              stroke={SERIES[0]}
              strokeWidth={2}
              dot={{ r: 3, fill: SERIES[0] }}
              connectNulls
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>

        <div className="mt-4 border-t border-xyne-border-subtle pt-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] font-medium uppercase tracking-wider text-xyne-fg-muted">
              Prompt size at each call — the sawtooth is compaction resetting the context
            </p>
            <UnitBadge aggregation="average" unit="tokens" />
          </div>
          <ResponsiveContainer width="100%" height={150}>
            <BarChart data={byIndex} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={NEUTRAL.grid} vertical={false} />
              <XAxis dataKey="callIndex" tick={AXIS_TICK} tickLine={false} axisLine={AXIS_LINE} />
              <YAxis
                tick={AXIS_TICK}
                tickLine={false}
                axisLine={AXIS_LINE}
                width={56}
                tickFormatter={(v) => formatCompact(Number(v))}
              />
              <Tooltip
                cursor={{ fill: "currentColor", opacity: 0.05 }}
                content={
                  <MetricsTooltip
                    labelFormat={(l) => `Call #${String(l)}`}
                    format={(value, _name, item) =>
                      `${formatCompact(Number(value))} tok · ${formatPct((item?.["compactionShare"] as number) ?? 0)} compacted`
                    }
                  />
                }
              />
              <Bar
                dataKey="avgContextTokens"
                name="Avg context"
                fill={SERIES[5]}
                radius={[3, 3, 0, 0]}
                barSize={14}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <CallIndexNotes rows={byIndex} />
      </MetricsCard>
    </div>
  );
}

/**
 * Calls out the two confounders that would otherwise be read as context
 * effects: a retry's TTFT includes its abandoned attempt, and a compaction
 * resets the prompt entirely.
 */
function CallIndexNotes({ rows }: { rows: LlmCallIndexRow[] }): ReactElement | null {
  const retryHeavy = rows.filter((r) => r.retriedShare > 0.05);
  const compactionHeavy = rows.filter((r) => r.compactionShare > 0.2);
  if (retryHeavy.length === 0 && compactionHeavy.length === 0) return null;
  return (
    <ul className="mt-3 flex flex-col gap-1 text-[11px] text-xyne-fg-muted">
      {compactionHeavy.length > 0 && (
        <li className="flex items-start gap-1.5">
          <span
            aria-hidden
            className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: SERIES[5] }}
          />
          <span>
            Compaction is common at call{compactionHeavy.length > 1 ? "s" : ""}{" "}
            {compactionHeavy.map((r) => `#${r.callIndex}`).join(", ")} — the TTFT drop there is a
            reset prompt, not a speed-up.
          </span>
        </li>
      )}
      {retryHeavy.length > 0 && (
        <li className="flex items-start gap-1.5">
          <span
            aria-hidden
            className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: STATUS.warning }}
          />
          <span>
            Retries at call{retryHeavy.length > 1 ? "s" : ""}{" "}
            {retryHeavy.map((r) => `#${r.callIndex}`).join(", ")} — their TTFT includes a failed
            attempt.
          </span>
        </li>
      )}
    </ul>
  );
}
