/**
 * Whether tool calls were worth making.
 *
 * Citation attribution is the only usefulness signal available without an LLM
 * judge, and it is a segmented diagnostic rather than a score. The panel is
 * built so it cannot be read as one:
 *
 *   - the denominator is CITEABLE calls, so a tool that can never be cited
 *     shows "n/a" and is never scored zero;
 *   - the two per-agent config flags that govern coverage are shown next to the
 *     rate, because `citationReflection` re-prompts the model until it cites and
 *     mechanically inflates the number for agents that enable it;
 *   - the scope (same-turn vs conversation) is stated, since the cheap default
 *     misses a later turn citing an earlier turn's chunk.
 *
 * Without those three, the rate reads as an agent-quality ranking, which it is
 * not.
 */

import { useMemo, type ReactElement } from "react";
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
import type { ToolQualityMetrics, ToolStatsRow } from "../../../../lib/api";
import {
  CoverageNotice,
  MetricsCard,
  PanelError,
  PanelMessage,
  SortableTable,
  StatTile,
  UnitBadge,
  type Column,
  type ServerPaging,
} from "../MetricsPrimitives";
import { AXIS_LINE, AXIS_TICK, NEUTRAL, SEQUENTIAL, STATUS } from "../metricsPalette";
import { MetricsTooltip } from "../MetricsTooltip";
import { formatCount, formatOptionalPct, formatPct } from "../metricsFormat";

/** Reflection outcomes, ordered best → worst so the bar reads as a quality gradient. */
const OUTCOME_ORDER = [
  "already_cited",
  "fixed_after_nudge",
  "still_uncited",
  "no_citeable_sources",
  "aborted",
] as const;

/** Keyed by the backend's snake_case enum values, so a Map rather than a literal. */
const OUTCOME_LABEL = new Map<string, string>([
  ["already_cited", "Cited unprompted"],
  ["fixed_after_nudge", "Cited only after nudge"],
  ["still_uncited", "Never cited"],
  ["no_citeable_sources", "Nothing citeable"],
  ["aborted", "Aborted"],
]);

const OUTCOME_TONE = new Map<string, string>([
  ["already_cited", STATUS.good],
  ["fixed_after_nudge", STATUS.warning],
  ["still_uncited", STATUS.critical],
  ["no_citeable_sources", NEUTRAL.muted],
  ["aborted", NEUTRAL.muted],
]);

export function QualityPanel({
  data,
  loading,
  error,
  exact,
  onToggleExact,
  toolFilter,
  paging,
}: {
  data: ToolQualityMetrics | undefined;
  loading: boolean;
  error: string | null;
  exact: boolean;
  onToggleExact: (next: boolean) => void;
  /** Empty = every tool. Narrows the loaded page only — the server owns the slice. */
  toolFilter: readonly string[];
  paging: ServerPaging;
}): ReactElement {
  // Memoised so the fallback array is stable — a fresh `[]` each render would
  // re-run every downstream useMemo.
  const rows = useMemo(() => {
    const wanted = new Set(toolFilter);
    const all = data?.quality ?? [];
    return wanted.size === 0 ? all : all.filter((r) => wanted.has(r.tool));
  }, [data, toolFilter]);

  // Window-wide, never summed from the visible page — otherwise the cite rate
  // would change as the reader pages through the table.
  const summary = useMemo(() => {
    const t = data?.totals;
    const citeable = t?.citeableCalls ?? 0;
    const cited = t?.citedCalls ?? 0;
    const errored = t?.errors ?? 0;
    const recovered = t?.recoveredCalls ?? 0;
    return {
      citeable,
      cited,
      rate: citeable > 0 ? cited / citeable : null,
      duplicates: t?.duplicateCalls ?? 0,
      errored,
      recoveryRate: errored > 0 ? recovered / errored : null,
    };
  }, [data]);

  const citeableRows = useMemo(
    () =>
      rows
        .filter((r) => r.citeableCalls > 0)
        .sort((a, b) => (b.citeRate ?? 0) - (a.citeRate ?? 0)),
    [rows],
  );

  const reflection = useMemo(() => {
    const map = new Map((data?.citationReflection ?? []).map((r) => [r.outcome, r]));
    return OUTCOME_ORDER.flatMap((outcome) => {
      const row = map.get(outcome);
      if (!row) return [];
      return [
        {
          outcome,
          label: OUTCOME_LABEL.get(outcome) ?? outcome,
          runs: row.runs,
          share: row.share,
        },
      ];
    });
  }, [data]);

  const flags = useMemo(() => {
    const cfg = data?.citationConfig ?? [];
    return {
      total: cfg.length,
      auto: cfg.filter((c) => c.autoToolCitations).length,
      reflection: cfg.filter((c) => c.citationReflection).length,
    };
  }, [data]);

  if (error) return <PanelError error={error} />;
  if (loading && !data) return <PanelMessage title="Loading quality metrics…" />;
  if (!data || rows.length === 0) {
    return (
      <PanelMessage
        title={toolFilter.length > 0 ? "No calls for the selected tools" : "No tool calls in this window"}
        detail={
          toolFilter.length > 0
            ? "Clear the tool filter, or widen the time range."
            : "Widen the time range to see quality signals."
        }
      />
    );
  }

  const columns: Array<Column<ToolStatsRow>> = [
    {
      key: "tool",
      header: "Tool",
      sortValue: (r) => r.tool,
      render: (r) => (
        <span className="font-mono text-[12px] font-medium text-xyne-fg-primary">{r.tool}</span>
      ),
    },
    {
      key: "calls",
      header: "Calls",
      numeric: true,
      sortValue: (r) => r.calls,
      render: (r) => formatCount(r.calls),
    },
    {
      key: "citeable",
      header: "Citeable",
      numeric: true,
      sortValue: (r) => r.citeableCalls,
      hint: "Calls whose result carried a citation token at all",
      render: (r) =>
        r.citeableCalls === 0 ? (
          <span className="text-xyne-fg-muted">—</span>
        ) : (
          formatCount(r.citeableCalls)
        ),
    },
    {
      key: "citeRate",
      header: "Cite rate",
      numeric: true,
      sortValue: (r) => r.citeRate,
      hint: "Cited ÷ citeable. n/a means nothing this tool returned could be cited — not that it failed.",
      render: (r) => (
        <span className={r.citeRate === null ? "text-xyne-fg-muted" : undefined}>
          {formatOptionalPct(r.citeRate)}
        </span>
      ),
    },
    {
      key: "duplicateRate",
      header: "Blind retries",
      numeric: true,
      sortValue: (r) => r.duplicateRate,
      hint: "Repeat calls with identical arguments inside one run",
      render: (r) =>
        r.duplicateCalls === 0 ? (
          <span className="text-xyne-fg-muted">—</span>
        ) : (
          <span style={r.duplicateRate > 0.1 ? { color: STATUS.serious } : undefined}>
            {formatPct(r.duplicateRate)}
          </span>
        ),
    },
    {
      key: "recoveryRate",
      header: "Recovery",
      numeric: true,
      sortValue: (r) => (r.erroredCalls > 0 ? r.recoveryRate : null),
      hint: "Of errored calls, how many were followed by a success of the same tool in the same run",
      render: (r) =>
        r.erroredCalls === 0 ? (
          <span className="text-xyne-fg-muted">n/a</span>
        ) : (
          formatPct(r.recoveryRate)
        ),
    },
    {
      key: "emptyResults",
      header: "Empty",
      numeric: true,
      sortValue: (r) => r.emptyResultRate,
      hint: "Calls that succeeded but returned nothing",
      render: (r) =>
        r.emptyResults === 0 ? (
          <span className="text-xyne-fg-muted">—</span>
        ) : (
          formatPct(r.emptyResultRate)
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

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          aggregation="rate"
          unit="of citeable"
          label="Cite rate"
          value={formatOptionalPct(summary.rate)}
          detail={`${formatCount(summary.cited)} of ${formatCount(summary.citeable)} citeable calls`}
          hint="A segmented diagnostic, not a quality score — read it with the config flags below."
        />
        <StatTile
          aggregation="cumulative"
          unit="calls"
          label="Blind retries"
          value={formatCount(summary.duplicates)}
          detail="Identical args repeated in one run"
          tone={summary.duplicates > 0 ? "warning" : "neutral"}
        />
        <StatTile
          aggregation="rate"
          unit="of errored"
          label="Error recovery"
          value={formatOptionalPct(summary.recoveryRate)}
          detail={`${formatCount(summary.errored)} errored calls`}
          tone={summary.recoveryRate !== null && summary.recoveryRate < 0.5 ? "serious" : "neutral"}
          hint="How often the agent recovers after a tool error instead of giving up."
        />
        <StatTile
          label="Citation scope"
          value={data.citationScope === "conversation" ? "Conversation" : "Same turn"}
          detail={
            data.citationScope === "conversation"
              ? "Exact — includes cross-turn citations"
              : "Misses a later turn citing an earlier chunk"
          }
        />
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl bg-xyne-surface px-4 py-3 shadow-sm">
        <p className="flex-1 text-[12px] text-xyne-fg-muted">
          <span className="font-medium text-xyne-fg-primary">Coverage caveat.</span> {flags.auto} of{" "}
          {flags.total} agents emit citation tokens on every tool result, and {flags.reflection}{" "}
          re-prompt the model until it cites. Cite rate is only comparable between agents with the
          same flags — the nudge inflates it.
        </p>
        <label className="flex shrink-0 items-center gap-2 text-[12px] text-xyne-fg-muted">
          <input
            type="checkbox"
            checked={exact}
            onChange={(e) => onToggleExact(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-xyne-border"
          />
          Exact cross-turn attribution (slower)
        </label>
      </div>

      {reflection.length > 0 && (
        <MetricsCard
          title="Did retrieved sources get used"
          description={`Run-level outcome of the citation-reflection pass, counted per run. A large "only after nudge" share means the cite rate above is being manufactured by the nudge rather than earned.`}
          action={<UnitBadge aggregation="cumulative" unit="runs" />}
        >
          <ResponsiveContainer width="100%" height={200}>
            <BarChart
              data={reflection}
              layout="vertical"
              margin={{ top: 4, right: 56, bottom: 4, left: 8 }}
            >
              <CartesianGrid stroke={NEUTRAL.grid} horizontal={false} />
              <XAxis
                type="number"
                tick={AXIS_TICK}
                tickLine={false}
                axisLine={AXIS_LINE}
                allowDecimals={false}
              />
              <YAxis
                type="category"
                dataKey="label"
                tick={AXIS_TICK}
                tickLine={false}
                axisLine={AXIS_LINE}
                width={170}
              />
              <Tooltip
                cursor={{ fill: "currentColor", opacity: 0.05 }}
                content={
                  <MetricsTooltip
                    format={(value, _name, item) =>
                      `${formatCount(Number(value))} runs · ${formatPct((item?.["share"] as number) ?? 0)}`
                    }
                  />
                }
              />
              <Bar
                dataKey="runs"
                name="Runs"
                radius={[0, 4, 4, 0]}
                barSize={18}
                isAnimationActive={false}
              >
                {reflection.map((r) => (
                  <Cell key={r.outcome} fill={OUTCOME_TONE.get(r.outcome) ?? SEQUENTIAL.mid} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </MetricsCard>
      )}

      {citeableRows.length > 0 && (
        <MetricsCard
          title="Cite rate by tool"
          description="Cited calls divided by citeable calls, per tool. Only tools that produced citeable output appear — the rest have no denominator and are excluded rather than shown as zero."
          action={<UnitBadge aggregation="rate" unit="of citeable calls" />}
        >
          <ResponsiveContainer
            width="100%"
            height={Math.max(160, Math.min(citeableRows.length, 10) * 34)}
          >
            <BarChart
              data={citeableRows.slice(0, 10)}
              layout="vertical"
              margin={{ top: 4, right: 56, bottom: 4, left: 8 }}
            >
              <CartesianGrid stroke={NEUTRAL.grid} horizontal={false} />
              <XAxis
                type="number"
                domain={[0, 1]}
                tick={AXIS_TICK}
                tickLine={false}
                axisLine={AXIS_LINE}
                tickFormatter={(v) => formatPct(Number(v))}
              />
              <YAxis
                type="category"
                dataKey="tool"
                tick={AXIS_TICK}
                tickLine={false}
                axisLine={AXIS_LINE}
                width={150}
              />
              <Tooltip
                cursor={{ fill: "currentColor", opacity: 0.05 }}
                content={
                  <MetricsTooltip
                    format={(value, _name, item) =>
                      `${formatPct(Number(value))} · ${formatCount((item?.["citedCalls"] as number) ?? 0)}/${formatCount((item?.["citeableCalls"] as number) ?? 0)}`
                    }
                  />
                }
              />
              <Bar
                dataKey="citeRate"
                name="Cite rate"
                fill={SEQUENTIAL.mid}
                radius={[0, 4, 4, 0]}
                barSize={16}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </MetricsCard>
      )}

      <MetricsCard
        title="Per-tool quality signals"
        description="Sort by blind retries to find tools the model calls repeatedly without changing anything, or by recovery to find errors it never gets past."
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
