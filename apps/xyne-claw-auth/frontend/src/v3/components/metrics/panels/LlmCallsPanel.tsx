/**
 * LLM calls tab: per-call model latency by prompt size, loop position and model.
 * Buckets or positions under 20 calls are hollow and lose their p95; a window under 20 calls gets no charts.
 * The series is never backfilled, so older windows are partial (the banner says so).
 */

import { useMemo, type ReactElement, type ReactNode } from "react";
import {
  Activity,
  Coins,
  Database,
  Gauge,
  GitFork,
  Hourglass,
  PenLine,
  RefreshCcwDot,
  Reply,
  Scissors,
  Zap,
  CircleX,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { LlmBucketRow, LlmCallsResponse, LlmIndexRow, LlmModelRow, SummaryResponse } from "../../../../lib/api";
import { useLlmCalls, useSummary } from "../../../hooks/useDeepMetrics";
import {
  AXIS_LINE,
  AXIS_TICK,
  BAR_CURSOR,
  ChartLegend,
  ChartTooltip,
  DataTable,
  KpiStrip,
  KpiStripSkeleton,
  LINE_CURSOR,
  MeasureToggle,
  MetricsCard,
  PanelError,
  PanelMessage,
  PanelToolbar,
  SAMPLE_FLOORS,
  CoverageBanner,
  fmtDay,
  useElementWidth,
  StatusValue,
  TableSkeleton,
  ToggleField,
  VIZ,
  ZeroCell,
  fmtCompact,
  fmtInt,
  fmtMs,
  fmtPct,
  fmtTokens,
  fmtTps,
  plural,
  ratio,
  statusFor,
  useMeasure,
  useMetricsParam,
  useMetricsParams,
  worstStatus,
  type Column,
  type Kpi,
  type MeasureOptions,
  type PanelProps,
  type Status,
} from "../MetricsPrimitives";

/** 12 tiles divide evenly at every column count. */
const KPI_COLS = "grid-cols-2 @min-[480px]:grid-cols-3 @min-[720px]:grid-cols-4 @min-[960px]:grid-cols-6";

/** Below this many calls only the KPI strip is shown. */
const MIN_CALLS_TO_CHART = 20;
const RELIABLE_N = SAMPLE_FLOORS.p95;
const MIN_POSITION_N = SAMPLE_FLOORS.p50;
/** Below this card width the By model table drops Avg prompt. */
const NARROW_MODEL_PX = 640;

const PROMPT_MEASURES: MeasureOptions<"wait" | "speed"> = [
  { id: "wait", label: "Wait" },
  { id: "speed", label: "Speed" },
];

/** Lower edges of the backend's context buckets (llm-call-analytics.ts). */
const BUCKET_EDGES = [0, 4_000, 8_000, 16_000, 32_000, 64_000, 128_000, 256_000];

function bucketLabel(lower: number): string {
  const i = BUCKET_EDGES.indexOf(lower);
  const next = BUCKET_EDGES[i + 1];
  if (i === -1 || next === undefined) return `${fmtTokens(lower)}+`;
  if (lower === 0) return `<${fmtTokens(next)}`;
  return `${fmtTokens(lower).replace(/k$/, "")}–${fmtTokens(next)}`;
}

function secondsTick(ms: number): string {
  if (!Number.isFinite(ms)) return "";
  const s = ms / 1000;
  return `${s >= 10 ? Math.round(s) : Number(s.toFixed(2))}s`;
}

interface BucketDatum {
  key: string;
  label: string;
  row: LlmBucketRow;
  reliable: boolean;
  typical: number | null;
  slow: number | null;
  speed: number | null;
}

interface PositionDatum extends LlmIndexRow {
  reliable: boolean;
}

export function LlmCallsPanel({ scope }: PanelProps): ReactElement {
  const [subagentsRaw, setSubagents] = useMetricsParam("subagents");
  const includeSubagents = subagentsRaw === "1";
  const llm = useLlmCalls(scope, { includeSubagents });
  const summary = useSummary(scope);
  const { data, loading, error, isPlaceholder, refetch } = llm;
  const busy = loading && data !== undefined;

  const toolbar = (
    <PanelToolbar
      controls={
        <ToggleField
          label="Include subagent calls"
          checked={includeSubagents}
          onChange={(next) => setSubagents(next ? "1" : null, { replace: true })}
          hint="Off: the parent agent loop only. On: every model call, including those made inside subagents."
        />
      }
    >
      <GitFork size={12} className="shrink-0 text-xyne-fg-muted" aria-hidden />
      <span>
        Scope:{" "}
        <span className="font-medium text-xyne-fg-secondary">
          {includeSubagents ? "parent loop + subagents" : "parent loop only"}
        </span>
      </span>
    </PanelToolbar>
  );

  if (error && !data) return <PanelError error={error} onRetry={refetch} />;
  if (!data) {
    return (
      <div className="flex flex-col gap-5">
        {toolbar}
        <KpiStripSkeleton count={12} cols={KPI_COLS} />
        <MetricsCard title="Bigger prompts → slower replies?" loading>
          {null}
        </MetricsCard>
        <MetricsCard title="Do later calls in a run wait longer?" loading>
          {null}
        </MetricsCard>
        <MetricsCard title="By model" loading skeleton={<TableSkeleton rows={4} cols={7} />}>
          {null}
        </MetricsCard>
      </div>
    );
  }

  const calls = data.summary.calls;
  return (
    <div className="flex flex-col gap-5">
      <SeriesBanner coverage={data.coverage} />
      {toolbar}
      {error && <PanelError error={error} onRetry={refetch} />}
      <KpiStrip items={summaryKpis(data, summary.data, includeSubagents)} cols={KPI_COLS} busy={busy || isPlaceholder} />
      {calls < MIN_CALLS_TO_CHART ? (
        <PanelMessage
          title={
            calls === 0
              ? "No model calls with per-call timing in this window"
              : `Not enough model calls to chart yet (${fmtInt(calls)} ${plural(calls, "call")} in ${fmtInt(data.summary.runs)} ${plural(data.summary.runs, "run")})`
          }
          detail={`The charts need ${fmtInt(MIN_CALLS_TO_CHART)}+ model calls with per-call timing. Runs that finish from now on add to it; a wider range${
            scope.agentSlugs.length > 0 ? " or no agent filter" : ""
          } may already be enough.`}
        />
      ) : (
        <>
          <PromptSizeCard rows={data.byContext} busy={busy} />
          <PositionCard rows={data.byCallIndex} busy={busy} />
          <ModelCard rows={data.byModel} busy={busy} />
        </>
      )}
    </div>
  );
}


function SeriesBanner({ coverage }: { coverage: LlmCallsResponse["coverage"] }): ReactElement | null {
  const { runsInWindow, runsWithSeries, seriesSince } = coverage;
  const have = `${fmtInt(runsWithSeries)} of ${fmtInt(runsInWindow)} ${plural(runsInWindow, "run")} in this window ${runsWithSeries === 1 ? "has" : "have"} it`;
  const message = seriesSince
    ? `Per-call timing is recorded from ${fmtDay(seriesSince)} onward — ${have}.`
    : `Per-call timing is only recorded by newer runs — ${have}.`;
  return (
    <CoverageBanner
      coverage={coverage.coverage}
      covered={runsWithSeries}
      total={runsInWindow}
      message={message}
      detail="Everything on this tab describes those runs only; older runs are never backfilled."
    />
  );
}


function zeroOr(n: number, render: (n: number) => ReactNode): ReactNode {
  return n === 0 ? <ZeroCell /> : render(n);
}

function summaryKpis(data: LlmCallsResponse, summary: SummaryResponse | undefined, includeSubagents: boolean): Kpi[] {
  const s = data.summary;
  const cov = data.coverage;
  const calls = s.calls;
  const retryShare = ratio(s.retries, calls);
  const errorShare = ratio(s.errorStops, calls);
  const reply = summary?.current.replyStart;
  const runsInWindow = summary?.current.runs ?? cov.runsInWindow;
  const replyStatus: Status =
    reply == null || reply.p50Ms == null ? "na" : reply.n < SAMPLE_FLOORS.p50 ? "thin" : "ok";
  const p95Status = statusFor("llmTtftP95", s.p95TtftMs, s.nTtft);
  const writeStatus: Status = s.p50DecodeMs == null ? "na" : s.nDecode < SAMPLE_FLOORS.p50 ? "thin" : "ok";
  const callsNoun = "model calls";

  return [
    {
      key: "calls",
      label: "Model calls",
      icon: Activity,
      value: fmtInt(calls),
      status: calls < MIN_CALLS_TO_CHART ? "thin" : undefined,
      n: calls,
      nLabel: callsNoun,
      floor: MIN_CALLS_TO_CHART,
      hint: "Each run makes several model calls; per-call data is only recorded for runs since the new recorder shipped.",
      line: `from ${fmtInt(cov.runsWithSeries)} of ${fmtInt(cov.runsInWindow)} runs (${fmtPct(cov.coverage)})`,
    },
    {
      key: "reply",
      label: "Reply starts after",
      icon: Reply,
      value: fmtMs(reply?.p50Ms),
      status: replyStatus,
      n: reply?.n,
      nLabel: "runs",
      floor: SAMPLE_FLOORS.p50,
      naWhy: summary ? "No run in this window recorded when its reply started" : "Loading the run summary",
      hint: "Run level: from the start of a run to the first token of its first model call. Model first-token wait (next tiles) is the same wait for EVERY call in the loop.",
      line: reply ? `p50 · from ${fmtInt(reply.n)} of ${fmtInt(runsInWindow)} runs` : "p50 per run",
    },
    {
      key: "ttft50",
      label: "First-token wait",
      icon: Zap,
      value: fmtMs(s.p50TtftMs),
      status: statusFor("llmTtftP50", s.p50TtftMs, s.nTtft),
      n: s.nTtft,
      nLabel: callsNoun,
      floor: SAMPLE_FLOORS.p50,
      hint: "Model first-token wait: how long a typical model call waits before its first token streams in. Retried calls are excluded, their wait includes an abandoned attempt.",
      line: "p50 · typical model call",
    },
    {
      key: "ttft95",
      label: "Slow first token",
      icon: Hourglass,
      value: p95Status === "thin" ? "—" : fmtMs(s.p95TtftMs),
      status: p95Status,
      n: s.nTtft,
      nLabel: callsNoun,
      floor: SAMPLE_FLOORS.p95,
      hint: "The slowest 5% of model calls waited at least this long for their first token.",
      line: p95Status === "thin" ? `p95 · needs ${fmtInt(SAMPLE_FLOORS.p95)}+ calls` : "p95 · slowest 5% of calls",
    },
    {
      key: "write",
      label: "Writing time",
      icon: PenLine,
      value: fmtMs(s.p50DecodeMs),
      status: writeStatus,
      n: s.nDecode,
      nLabel: callsNoun,
      floor: SAMPLE_FLOORS.p50,
      hint: "From the first token to the last: how long a typical call spends writing its reply.",
      line: `p50 · ${fmtTokens(s.avgOutputTokens)} tokens out per call`,
    },
    {
      key: "tps",
      label: "Output tokens/s",
      icon: Gauge,
      value: s.tokensPerSec == null ? "—" : fmtInt(s.tokensPerSec),
      status: statusFor("llmTps", s.tokensPerSec, s.nDecode),
      n: s.nDecode,
      nLabel: callsNoun,
      floor: SAMPLE_FLOORS.avg,
      naWhy: "No call recorded both output tokens and writing time",
      hint: "All output tokens ÷ all writing seconds, so long replies weigh more than short ones. Higher is faster.",
      line: "weighted over all calls",
    },
    {
      key: "perRun",
      label: "Calls per run",
      icon: GitFork,
      value: s.runs > 0 ? (calls / s.runs).toFixed(1) : "—",
      status: s.runs > 0 ? undefined : "na",
      naWhy: "No runs with per-call timing",
      hint: "Model calls per run that carries the series: one per turn of the agent loop.",
      line: includeSubagents
        ? `incl. ${fmtInt(s.subagentCalls)} subagent ${plural(s.subagentCalls, "call")}`
        : `parent loop only · +${fmtInt(s.subagentCalls)} in subagents`,
    },
    {
      key: "prompt",
      label: "Avg prompt",
      icon: Coins,
      value: s.avgContextTokens == null ? "—" : `${fmtTokens(s.avgContextTokens)} tok`,
      status: s.avgContextTokens == null ? "na" : calls < SAMPLE_FLOORS.avg ? "thin" : undefined,
      n: calls,
      nLabel: callsNoun,
      floor: SAMPLE_FLOORS.avg,
      hint: "Tokens sent per call: fresh + cache read + cache write. This is the size the provider sees.",
      line: "sent per call, incl. cached",
    },
    {
      key: "cache",
      label: "Cache hit",
      icon: Database,
      value: fmtPct(s.cacheHitRate),
      status: statusFor("cacheHit", s.cacheHitRate, calls),
      n: calls,
      nLabel: callsNoun,
      floor: SAMPLE_FLOORS.rate,
      naWhy: "No prompt tokens recorded",
      hint: "Share of prompt tokens served from the provider's cache. Higher is cheaper and faster.",
      line: "of prompt tokens",
    },
    {
      key: "compactions",
      label: "Compactions",
      icon: Scissors,
      value: zeroOr(s.compactions, fmtInt),
      hint: "Calls that ran on a just-compacted prompt: the history was summarised to fit the context window.",
      line: s.compactions > 0 ? `${fmtPct(ratio(s.compactions, calls))} of calls` : "no prompt was compacted",
    },
    {
      key: "retries",
      label: "Retries",
      icon: RefreshCcwDot,
      value: zeroOr(s.retries, fmtInt),
      status: s.retries === 0 ? undefined : statusFor("llmRetryShare", retryShare, calls),
      n: calls,
      nLabel: callsNoun,
      floor: SAMPLE_FLOORS.rate,
      hint: "Calls that retried a failed or stalled stream.",
      line: s.retries > 0 ? `${fmtPct(retryShare)} of calls` : "no stream was retried",
    },
    {
      key: "errors",
      label: "Error stops",
      icon: CircleX,
      value: zeroOr(s.errorStops, fmtInt),
      status: s.errorStops === 0 ? undefined : statusFor("llmErrorStops", errorShare, calls),
      n: calls,
      nLabel: callsNoun,
      floor: SAMPLE_FLOORS.rate,
      hint: "Calls whose stop reason was an error.",
      line: s.errorStops > 0 ? `${fmtPct(errorShare)} of calls` : "no call ended in an error",
    },
  ];
}


function promptTakeaway(data: BucketDatum[], measure: "wait" | "speed"): string | null {
  const reliable = data.filter((d) => d.reliable && (measure === "wait" ? d.typical != null : d.speed != null));
  if (reliable.length < 2) return null;
  const smallest = reliable[0]!;
  const largest = reliable[reliable.length - 1]!;
  const common = reliable.reduce((a, b) => (b.row.calls > a.row.calls ? b : a));
  if (measure === "wait") {
    const base = common === largest ? smallest : common;
    const ratioX = (largest.typical ?? 0) / Math.max(1, base.typical ?? 1);
    const lead =
      base === common
        ? `The most common prompt size, ${base.label} tokens, waits ${fmtMs(base.typical)} for the first token typically`
        : `Calls with ${base.label}-token prompts wait ${fmtMs(base.typical)} typically`;
    if (ratioX < 1.15 && ratioX > 0.87) {
      return `Prompt size barely moves the wait: ${fmtMs(smallest.typical)} at ${smallest.label} tokens, ${fmtMs(largest.typical)} at ${largest.label}.`;
    }
    return `${lead}; ${largest.label}-token prompts wait ${fmtMs(largest.typical)}${
      ratioX >= 1.15 ? `, ${ratioX.toFixed(1)}× as long` : ""
    }.`;
  }
  const lo = smallest.speed ?? 0;
  const hi = largest.speed ?? 0;
  const change = lo > 0 ? (hi - lo) / lo : 0;
  if (Math.abs(change) < 0.1) {
    return `Writing speed holds at about ${fmtTps(common.speed)} from ${smallest.label} to ${largest.label}-token prompts — bigger prompts cost wait, not writing speed.`;
  }
  return `Calls with ${smallest.label}-token prompts write ${fmtTps(lo)}; ${largest.label}-token prompts write ${fmtTps(hi)} (${fmtPct(Math.abs(change))} ${
    change < 0 ? "slower" : "faster"
  }).`;
}

function PromptSizeCard({ rows, busy }: { rows: LlmBucketRow[]; busy: boolean }): ReactElement {
  const [measure] = useMeasure("llm_prompt", PROMPT_MEASURES, "wait");
  const data = useMemo<BucketDatum[]>(
    () =>
      [...rows]
        .sort((a, b) => a.contextBucket - b.contextBucket)
        .map((row) => {
          const reliable = row.nTtft >= RELIABLE_N;
          return {
            key: String(row.contextBucket),
            label: bucketLabel(row.contextBucket),
            row,
            reliable,
            typical: row.p50TtftMs,
            slow: reliable ? row.p95TtftMs : null,
            speed: row.tokensPerSec,
          };
        }),
    [rows],
  );
  const reliableCount = data.filter((d) => d.reliable).length;
  const takeaway = promptTakeaway(data, measure);
  const thin = data.filter((d) => !d.reliable).length;

  return (
    <MetricsCard
      title="Bigger prompts → slower replies?"
      subtitle={
        measure === "wait"
          ? "Model calls grouped by prompt size. Bar height = seconds until the first token arrived."
          : "Model calls grouped by prompt size. Bar height = output tokens per second while the reply is written. Higher is faster."
      }
      action={<MeasureToggle card="llm_prompt" options={PROMPT_MEASURES} defaultId="wait" ariaLabel="Plot wait or speed" />}
      busy={busy}
      footnote={
        <>
          Prompt size = tokens sent, including cached ones. Retried calls are left out, because their wait includes an
          abandoned attempt.
          {thin > 0 && (
            <>
              {" "}
              Hollow bars have fewer than {fmtInt(RELIABLE_N)} calls; their slow-call bar is not drawn.
            </>
          )}
        </>
      }
    >
      {data.length === 0 ? (
        <p className="py-10 text-center text-[13px] text-xyne-fg-muted">No timed calls with a recorded prompt size.</p>
      ) : (
        <>
          {takeaway && <Takeaway>{takeaway}</Takeaway>}
          {reliableCount < 3 ? <PromptSizeTable data={data} measure={measure} /> : <PromptSizeChart data={data} measure={measure} />}
        </>
      )}
    </MetricsCard>
  );
}

function Takeaway({ children }: { children: ReactNode }): ReactElement {
  return <p className="mb-3 max-w-[90ch] text-[13px] leading-relaxed text-xyne-fg-secondary">{children}</p>;
}

function BucketTick({
  x,
  y,
  payload,
  data,
}: {
  x?: number;
  y?: number;
  payload?: { value?: unknown };
  data: readonly BucketDatum[];
}): ReactElement {
  const label = String(payload?.value ?? "");
  const d = data.find((r) => r.label === label);
  return (
    <g transform={`translate(${x ?? 0},${y ?? 0})`}>
      <text dy={12} textAnchor="middle" fontSize={11} fill={VIZ.tick}>
        {label}
      </text>
      {d && (
        <text dy={26} textAnchor="middle" fontSize={10} fill={VIZ.tick} opacity={d.reliable ? 0.8 : 1}>
          {d.reliable ? `n=${fmtCompact(d.row.calls)}` : `n=${fmtInt(d.row.calls)} · few`}
        </text>
      )}
    </g>
  );
}

function AxisTitle({ children, align = "left" }: { children: ReactNode; align?: "left" | "center" }): ReactElement {
  return (
    <p
      className={
        align === "center"
          ? "mt-1 text-center text-[11px] font-medium text-xyne-fg-muted"
          : "mb-1 text-[11px] font-medium text-xyne-fg-muted"
      }
    >
      {children}
    </p>
  );
}

const Y_WIDTH = 48;

function PromptSizeChart({ data, measure }: { data: BucketDatum[]; measure: "wait" | "speed" }): ReactElement {
  const wait = measure === "wait";
  const cells = data.map((d) => <Cell key={d.key} {...markStyle(VIZ.accent, d.reliable)} />);
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <AxisTitle>{wait ? "↑ Seconds to first token" : "↑ Output tokens per second (higher is faster)"}</AxisTitle>
        <ChartLegend
          className="mb-1"
          items={
            wait
              ? [
                  { label: "Typical call (p50)", color: VIZ.accent },
                  { label: "Slow calls (p95)", color: VIZ.accentSoft },
                ]
              : [{ label: "Output tokens / second", color: VIZ.accent }]
          }
        />
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={2} barCategoryGap="22%">
          <CartesianGrid stroke={VIZ.grid} vertical={false} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={AXIS_LINE}
            interval={0}
            height={36}
            tick={<BucketTick data={data} />}
          />
          <YAxis
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            width={Y_WIDTH}
            tickFormatter={(v: number) => (wait ? secondsTick(v) : fmtInt(v))}
          />
          <Tooltip
            cursor={BAR_CURSOR}
            content={
              <ChartTooltip<BucketDatum>
                title={(_l, d) => `Prompts of ${d.label} tokens`}
                rows={(d) => [
                  ...(wait
                    ? [
                        { label: "typical wait (p50)", value: fmtMs(d.row.p50TtftMs), color: VIZ.accent },
                        {
                          label: "slow calls (p95)",
                          value: d.reliable ? fmtMs(d.row.p95TtftMs) : `needs ${fmtInt(RELIABLE_N)}+ calls`,
                          color: VIZ.accentSoft,
                        },
                      ]
                    : [{ label: "output tokens / second", value: fmtInt(d.row.tokensPerSec), color: VIZ.accent }]),
                  { label: plural(d.row.calls, "call"), value: fmtInt(d.row.calls) },
                  { label: "avg output tokens", value: fmtTokens(d.row.avgOutputTokens) },
                ]}
              />
            }
          />
          {wait ? (
            <>
              <Bar dataKey="typical" name="Typical call (p50)" maxBarSize={28} radius={[4, 4, 0, 0]} isAnimationActive={false}>
                {cells}
              </Bar>
              <Bar dataKey="slow" name="Slow calls (p95)" fill={VIZ.accentSoft} maxBarSize={28} radius={[4, 4, 0, 0]} isAnimationActive={false} />
            </>
          ) : (
            <Bar dataKey="speed" name="Output tokens / second" maxBarSize={36} radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {cells}
            </Bar>
          )}
        </BarChart>
      </ResponsiveContainer>
      <AxisTitle align="center">Prompt size (tokens sent, incl. cached) →</AxisTitle>
    </div>
  );
}

/** Filled when the sample clears the floor, hollow when it does not. */
function markStyle(color: string, reliable: boolean): { fill: string; stroke: string; strokeWidth: number; strokeDasharray?: string } {
  return reliable
    ? { fill: color, stroke: color, strokeWidth: 0 }
    : { fill: "transparent", stroke: color, strokeWidth: 1.5, strokeDasharray: "3 2" };
}

function PromptSizeTable({ data, measure }: { data: BucketDatum[]; measure: "wait" | "speed" }): ReactElement {
  const columns: Array<Column<BucketDatum>> = [
    {
      key: "size",
      header: "Prompt size (tokens)",
      render: (d) => <span className="font-mono text-[12px]">{d.label}</span>,
    },
    {
      key: "calls",
      header: "Calls",
      numeric: true,
      render: (d) => (
        <StatusValue status={d.reliable ? "ok" : "thin"} n={d.row.calls} noun="model calls" floor={RELIABLE_N}>
          {fmtInt(d.row.calls)}
        </StatusValue>
      ),
    },
    measure === "wait"
      ? {
          key: "wait",
          header: "Typical / slow wait",
          numeric: true,
          render: (d) => (
            <span className="tabular-nums">
              {fmtMs(d.row.p50TtftMs)}
              <span className="text-xyne-fg-muted"> / {d.reliable ? fmtMs(d.row.p95TtftMs) : "—"}</span>
            </span>
          ),
        }
      : {
          key: "speed",
          header: "Output tokens / s",
          numeric: true,
          render: (d) => fmtInt(d.row.tokensPerSec),
        },
  ];
  return (
    <>
      <p className="mb-2 text-[12px] text-xyne-fg-muted">
        Fewer than three prompt sizes have {fmtInt(RELIABLE_N)}+ calls, so this is a table rather than a chart.
      </p>
      <DataTable rows={data} columns={columns} rowKey={(d) => d.key} emptyMessage="No timed calls." minWidth={360} maxHeight={360} />
    </>
  );
}


function positionTakeaway(rows: PositionDatum[]): string | null {
  const reliable = rows.filter((r) => r.reliable && r.p50TtftMs != null);
  if (reliable.length < 2) return null;
  const first = reliable[0]!;
  const last = reliable[reliable.length - 1]!;
  const x = (last.p50TtftMs ?? 0) / Math.max(1, first.p50TtftMs ?? 1);
  const prompt =
    first.avgContextTokens != null && last.avgContextTokens != null
      ? ` — prompts grow from ${fmtTokens(first.avgContextTokens)} to ${fmtTokens(last.avgContextTokens)} tokens along the way`
      : "";
  if (x < 1.15 && x > 0.87) {
    return `Later calls wait about as long as early ones: call #${first.callIndex} ${fmtMs(first.p50TtftMs)}, call #${last.callIndex} ${fmtMs(last.p50TtftMs)}.`;
  }
  return `Call #${first.callIndex} waits ${fmtMs(first.p50TtftMs)} typically; call #${last.callIndex} waits ${fmtMs(last.p50TtftMs)}${
    x >= 1.15 ? `, ${x.toFixed(1)}× as long` : ""
  }${prompt}.`;
}

function PositionCard({ rows, busy }: { rows: LlmIndexRow[]; busy: boolean }): ReactElement {
  const { shown, cut } = useMemo(() => {
    const sorted = [...rows].sort((a, b) => a.callIndex - b.callIndex);
    // Cut the rare tail: a few very long runs would draw a confident line from one call each.
    let end = sorted.length;
    while (end > 0 && sorted[end - 1]!.nTtft < MIN_POSITION_N) end -= 1;
    const kept = sorted.slice(0, Math.max(end, Math.min(sorted.length, 1)));
    return {
      shown: kept.map((r) => ({ ...r, reliable: r.nTtft >= RELIABLE_N })),
      cut: sorted.length - kept.length,
    };
  }, [rows]);
  const lastShown = shown[shown.length - 1]?.callIndex;
  const takeaway = positionTakeaway(shown);
  const hasCompaction = shown.some((r) => (r.compactionShare ?? 0) > 0);
  const hollow = shown.filter((r) => !r.reliable).length;

  return (
    <MetricsCard
      title="Do later calls in a run wait longer?"
      subtitle="Each point is the median first-token wait of every run's Nth model call. Prompts grow as a run goes on, so a rising line is the cost of a long loop."
      busy={busy}
      footnote={
        <>
          {cut > 0 && lastShown !== undefined && (
            <>Calls beyond #{lastShown} are rare (fewer than {fmtInt(MIN_POSITION_N)} each) and hidden. </>
          )}
          {hollow > 0 && <>Hollow points have fewer than {fmtInt(RELIABLE_N)} calls; read them as noisy. </>}
          {hasCompaction && (
            <>A compaction resets the prompt, so a dip right after a tall compaction bar is a shorter prompt, not a faster model.</>
          )}
        </>
      }
    >
      {shown.length === 0 ? (
        <p className="py-10 text-center text-[13px] text-xyne-fg-muted">No timed calls in this window.</p>
      ) : (
        <>
          {takeaway && <Takeaway>{takeaway}</Takeaway>}
          <PositionCharts rows={shown} hasCompaction={hasCompaction} />
        </>
      )}
    </MetricsCard>
  );
}

const INDEX_MARGIN = { top: 8, right: 16, bottom: 0, left: 0 };

type PositionDotProps = { cx?: number; cy?: number; payload?: PositionDatum; index?: number };

function PositionDot({ cx, cy, payload, index }: PositionDotProps): ReactElement {
  if (cx == null || cy == null || !payload || payload.p50TtftMs == null) return <g key={index} />;
  return payload.reliable ? (
    <circle key={index} cx={cx} cy={cy} r={4} fill={VIZ.accent} stroke={VIZ.surface} strokeWidth={2} />
  ) : (
    <circle key={index} cx={cx} cy={cy} r={4} fill={VIZ.surface} stroke={VIZ.neutral} strokeWidth={1.5} />
  );
}

function PositionCharts({ rows, hasCompaction }: { rows: PositionDatum[]; hasCompaction: boolean }): ReactElement {
  const tooltip = (
    <ChartTooltip<PositionDatum>
      title={(_l, d) => `Model call #${d.callIndex} of a run`}
      rows={(d) => [
        { label: "median first-token wait", value: fmtMs(d.p50TtftMs), color: VIZ.accent },
        { label: "slow calls (p95)", value: d.reliable ? fmtMs(d.p95TtftMs) : `needs ${fmtInt(RELIABLE_N)}+ calls` },
        { label: "avg prompt tokens", value: fmtTokens(d.avgContextTokens) },
        ...(hasCompaction ? [{ label: "on a just-compacted prompt", value: fmtPct(d.compactionShare), color: VIZ.neutral }] : []),
        { label: "retried", value: fmtPct(d.retriedShare) },
        { label: plural(d.calls, "call"), value: fmtInt(d.calls) },
      ]}
    />
  );
  return (
    <div>
      <AxisTitle>↑ Seconds to first token (median)</AxisTitle>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={rows} margin={hasCompaction ? { ...INDEX_MARGIN, bottom: 8 } : INDEX_MARGIN} syncId="llm-call-index">
          <CartesianGrid stroke={VIZ.grid} vertical={false} />
          <XAxis
            dataKey="callIndex"
            tickLine={false}
            axisLine={AXIS_LINE}
            interval="preserveStartEnd"
            minTickGap={8}
            // With the strip below, it carries the call numbers; this axis keeps its baseline only.
            tick={hasCompaction ? false : AXIS_TICK}
            height={hasCompaction ? 4 : 24}
            padding={{ left: 12, right: 12 }}
          />
          <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={Y_WIDTH} domain={[0, "auto"]} tickFormatter={secondsTick} />
          <Tooltip cursor={LINE_CURSOR} content={tooltip} />
          <Line
            type="linear"
            dataKey="p50TtftMs"
            name="Median first-token wait"
            stroke={VIZ.accent}
            strokeWidth={2}
            dot={(p: PositionDotProps) => <PositionDot key={p.index} {...p} />}
            activeDot={{ r: 5, stroke: VIZ.surface, strokeWidth: 2 }}
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
      {hasCompaction && (
        <>
          <AxisTitle>↑ % of calls on a just-compacted prompt</AxisTitle>
          <ResponsiveContainer width="100%" height={84}>
            <BarChart data={rows} margin={INDEX_MARGIN} syncId="llm-call-index" barCategoryGap="30%">
              <XAxis
                dataKey="callIndex"
                tick={AXIS_TICK}
                tickLine={false}
                axisLine={AXIS_LINE}
                interval="preserveStartEnd"
                minTickGap={8}
                height={24}
                padding={{ left: 12, right: 12 }}
              />
              <YAxis
                tick={AXIS_TICK}
                tickLine={false}
                axisLine={false}
                width={Y_WIDTH}
                tickCount={2}
                domain={[0, (max: number) => Math.max(0.05, max)]}
                tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
              />
              <Tooltip cursor={BAR_CURSOR} content={() => null} />
              <Bar dataKey="compactionShare" fill={VIZ.neutral} maxBarSize={14} radius={[3, 3, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </>
      )}
      <AxisTitle align="center">Model call number within the run (1 = first) →</AxisTitle>
    </div>
  );
}


function modelKey(r: LlmModelRow): string {
  return `${r.provider ?? ""}\u0000${r.model ?? ""}`;
}

function modelStatuses(r: LlmModelRow): Status[] {
  return [
    statusFor("llmTtftP50", r.p50TtftMs, r.nTtft),
    statusFor("llmTtftP95", r.p95TtftMs, r.nTtft),
    statusFor("llmTps", r.tokensPerSec, r.calls),
    r.errorStops === 0 ? "ok" : statusFor("llmErrorStops", ratio(r.errorStops, r.calls), r.calls),
  ];
}

const MODEL_COLUMNS: Array<Column<LlmModelRow>> = [
  {
    key: "model",
    header: "Model",
    sortValue: (r) => r.model ?? "",
    render: (r) => (
      <span className="flex min-w-0 flex-col">
        <span className="max-w-[260px] truncate font-mono text-[12px] font-medium" title={r.model ?? undefined}>
          {r.model ?? "unknown model"}
        </span>
        <span className="text-[11px] text-xyne-fg-muted" title="Provider reported on each model call">
          {r.provider ?? "unknown provider"}
        </span>
      </span>
    ),
  },
  {
    key: "calls",
    header: "Calls",
    numeric: true,
    sortValue: (r) => r.calls,
    render: (r) => (
      <span title={`${fmtInt(r.calls)} calls in ${fmtInt(r.runs)} ${plural(r.runs, "run")} · ${fmtTokens(r.avgOutputTokens)} output tokens per call`}>
        <span className="block">{fmtInt(r.calls)}</span>
        <span className="block text-[11px] text-xyne-fg-muted">
          in {fmtInt(r.runs)} {plural(r.runs, "run")}
        </span>
      </span>
    ),
  },
  {
    key: "ttft50",
    header: "p50",
    group: "First-token wait",
    numeric: true,
    sortValue: (r) => r.p50TtftMs,
    hint: "Median seconds until the first token, per model call",
    render: (r) => (
      <StatusValue status={statusFor("llmTtftP50", r.p50TtftMs, r.nTtft)} n={r.nTtft} noun="model calls" floor={SAMPLE_FLOORS.p50} naWhy="No timed calls">
        {fmtMs(r.p50TtftMs)}
      </StatusValue>
    ),
  },
  {
    key: "ttft95",
    header: "p95",
    group: "First-token wait",
    numeric: true,
    sortValue: (r) => (r.nTtft >= SAMPLE_FLOORS.p95 ? r.p95TtftMs : null),
    hint: "The slowest 5% of calls waited at least this long. Needs 20+ calls.",
    render: (r) => {
      const status = statusFor("llmTtftP95", r.p95TtftMs, r.nTtft);
      return (
        <StatusValue status={status} n={r.nTtft} noun="model calls" floor={SAMPLE_FLOORS.p95} naWhy="No timed calls">
          {status === "thin" ? "—" : fmtMs(r.p95TtftMs)}
        </StatusValue>
      );
    },
  },
  {
    key: "tps",
    header: "Tokens/s",
    numeric: true,
    sortValue: (r) => r.tokensPerSec,
    hint: "Output tokens ÷ writing seconds, weighted. Higher is faster.",
    render: (r) => (
      <StatusValue status={statusFor("llmTps", r.tokensPerSec, r.calls)} n={r.calls} noun="model calls" floor={SAMPLE_FLOORS.avg} naWhy="No decoded output recorded">
        {fmtInt(r.tokensPerSec)}
      </StatusValue>
    ),
  },
  {
    key: "prompt",
    header: "Avg prompt",
    numeric: true,
    sortValue: (r) => r.avgContextTokens,
    hint: "Tokens sent per call, including cached ones",
    render: (r) => fmtTokens(r.avgContextTokens),
  },
  {
    key: "errors",
    header: "Error stops",
    numeric: true,
    sortValue: (r) => r.errorStops,
    hint: "Calls whose stop reason was an error, and their share of this model's calls",
    render: (r) => {
      if (r.errorStops === 0) return <ZeroCell />;
      const rate = ratio(r.errorStops, r.calls);
      return (
        <StatusValue status={statusFor("llmErrorStops", rate, r.calls)} n={r.calls} noun="model calls" floor={SAMPLE_FLOORS.rate}>
          {fmtInt(r.errorStops)}
          <span className="text-[12px] font-normal text-xyne-fg-muted">· {fmtPct(rate)}</span>
        </StatusValue>
      );
    },
  },
];

function ModelCard({ rows, busy }: { rows: LlmModelRow[]; busy: boolean }): ReactElement {
  const patch = useMetricsParams();
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const narrow = width > 0 && width < NARROW_MODEL_PX;
  const columns = useMemo(() => (narrow ? MODEL_COLUMNS.filter((c) => c.key !== "prompt") : MODEL_COLUMNS), [narrow]);
  // The drawer is MetricsPageV3's; the URL says what to open.
  const open = (r: LlmModelRow): void => {
    if (!r.model) return;
    patch({ drill: "model", model: r.model, provider: r.provider ?? null, tool: null, dfilter: null, dclass: null });
  };
  return (
    <MetricsCard
      title="By model"
      subtitle="Every model that served a call in this window. Click a row for the runs that used it."
      busy={busy}
    >
      <div ref={ref}>
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={modelKey}
          initialSort={{ key: "calls", dir: "desc" }}
          emptyMessage="No model calls in this window."
          minWidth={500}
          maxHeight={520}
          maxRows={12}
          onRowClick={open}
          rowTitle={(r) => (r.model ? `Show the runs that called ${r.model}` : "Model name not recorded")}
          rowStatus={(r) => worstStatus(modelStatuses(r))}
          footnote={narrow ? "Avg prompt per model is hidden at this width; the prompt-size chart above has it by size." : undefined}
        />
      </div>
    </MetricsCard>
  );
}
