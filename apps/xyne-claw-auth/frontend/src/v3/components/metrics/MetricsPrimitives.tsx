/**
 * Shared building blocks for the v3 metrics page: formatters, status model, cards, tables, drawer.
 * Unknown is never rendered as zero ("—" with a reason); colour never appears without a label or icon.
 * `statusFor` decides ok / warn / bad / na / thin from the `METRIC_DEFS` threshold table.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  CircleSlash,
  CircleX,
  Copy,
  Lock,
  Minus,
  Quote,
  RefreshCw,
  RotateCcw,
  Search,
  SearchX,
  TriangleAlert,
  Unplug,
  X,
  type LucideIcon,
} from "lucide-react";
import type {
  AgentRunListItem,
  MetricSessionRow,
  MetricSessionsRequest,
  MetricSessionsResponse,
  ToolSignal,
} from "../../../lib/api";
import { isCurrentUser } from "../../../lib/identity";
import { runReplayPath } from "../../../lib/runReplay";
import { cn } from "../../../lib/utils";
import {
  prefetchMetricSessions,
  useMetricSessions,
  type MetricsScopeParams,
} from "../../hooks/useDeepMetrics";
import { RunRow } from "../runs/RunRow";
import { Skeleton } from "../ui/Skeleton";
import { Switch } from "../ui/Switch";

export type { MetricsScopeParams };

/** What every tab panel receives; each panel fetches its own data from `scope`. */
export interface PanelProps {
  scope: MetricsScopeParams;
}

/** Chart colours by role. Values live in CSS variables so light/dark swap in one place. */
export const VIZ = {
  accent: "var(--viz-accent)",
  accentSoft: "var(--viz-accent-soft)",
  neutral: "var(--viz-neutral)",
  neutralSoft: "var(--viz-neutral-soft)",
  warning: "var(--viz-warning)",
  danger: "var(--viz-danger)",
  grid: "var(--viz-grid)",
  axis: "var(--viz-axis)",
  tick: "var(--viz-tick)",
  track: "var(--viz-track)",
  surface: "var(--viz-surface)",
} as const;

// On :root so portalled overlays (drawer, tooltips) resolve the same values.
const VIZ_CSS = `
:root {
  --viz-accent: #2a78d6;
  --viz-accent-soft: #86b6ef;
  --viz-neutral: #8a8f98;
  --viz-neutral-soft: #adb2b9;
  --viz-warning: #c98500;
  --viz-danger: #d0304f;
  --viz-grid: #eceef1;
  --viz-axis: #d6d9de;
  --viz-tick: #7c8698;
  --viz-track: #eef0f3;
  --viz-surface: #ffffff;
}
:root.dark {
  --viz-accent: #3987e5;
  --viz-accent-soft: #1f5aa6;
  --viz-neutral: #9da1a8;
  --viz-neutral-soft: #5d6168;
  --viz-warning: #c98500;
  --viz-danger: #e5546f;
  --viz-grid: #2a2a2a;
  --viz-axis: #404040;
  --viz-tick: #a3a3a3;
  --viz-track: #2a2a2a;
  --viz-surface: #171717;
}`;

export function MetricsVizStyle(): ReactElement {
  return <style>{VIZ_CSS}</style>;
}

/** Recharts chrome shared by every chart: recessive solid hairlines, muted ticks. */
export const AXIS_TICK = { fontSize: 11, fill: VIZ.tick } as const;
export const AXIS_LINE = { stroke: VIZ.axis } as const;
export const BAR_CURSOR = { fill: VIZ.grid, fillOpacity: 0.6 } as const;
export const LINE_CURSOR = { stroke: VIZ.axis } as const;

// The only number formatters; each renders null/NaN as "—".

/** ms → s → m → h, one decimal above a second. */
export function fmtMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const abs = Math.abs(ms);
  if (Math.round(abs) < 1000) return `${Math.round(ms)}ms`;
  if (abs < 59_950) return `${(ms / 1000).toFixed(1)}s`;
  if (abs < 3_597_000) return `${(ms / 60_000).toFixed(1)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

/** A 0..1 rate as a percentage with one decimal. Never prints 0.0% for a non-zero rate. */
export function fmtPct(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate)) return "—";
  if (rate > 0 && rate < 0.0005) return "<0.1%";
  if (rate < 1 && rate > 0.9995) return ">99.9%";
  return `${(rate * 100).toFixed(1)}%`;
}

export function fmtInt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString("en-US");
}

const COMPACT = new Intl.NumberFormat("en-US", { notation: "compact", maximumSignificantDigits: 3 });

/** Compact magnitudes for axis ticks and dense labels: 950 · 48.2k · 1.23M. */
export function fmtCompact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (Math.abs(n) < 1000) return String(Math.round(n));
  return COMPACT.format(n).replace("K", "k");
}

export function fmtTokens(n: number | null | undefined): string {
  return fmtCompact(n);
}

export function fmtBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return "—";
  if (Math.abs(bytes) < 1024) return `${Math.round(bytes)}B`;
  const units = ["KB", "MB", "GB", "TB"] as const;
  let value = bytes / 1024;
  let i = 0;
  while (Math.abs(value) >= 1023.95 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(Math.abs(value) >= 100 ? 0 : 1)}${units[i]}`;
}

export function fmtTps(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${Math.round(n)} tok/s`;
}

/** "2026-10-14" → "Oct 14" (bare days parse as UTC so they never shift); full timestamps show local. */
export function fmtDay(day: string): string {
  if (day.length > 10) {
    const t = new Date(day);
    return Number.isNaN(t.getTime()) ? day : t.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  const d = new Date(`${day.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return day;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Safe a / b for rates — null (unknown), not 0, when there is no denominator. */
export function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many;
}

/** "—" with a title saying WHY the value is unknown. Never use 0 for unknown. */
export function Unknown({ why }: { why: string }): ReactElement {
  return (
    <span className="cursor-help text-xyne-fg-muted" title={why}>
      —
    </span>
  );
}

/** A measured zero: muted `0`, never "0.0%", so the eye skips it and lands on the exceptions. */
export function ZeroCell({ title }: { title?: string }): ReactElement {
  return (
    <span className={cn("font-normal text-xyne-fg-muted", title && "cursor-help")} title={title}>
      0
    </span>
  );
}

/** na = never captured; thin = n below the sample floor (muted, no colour, excluded from the verdict). */
export type Status = "ok" | "warn" | "bad" | "na" | "thin";

/** Minimum n before a figure is judged. Mirrors the backend's SAMPLE_FLOORS (metrics-core.ts). */
export const SAMPLE_FLOORS = { p50: 5, p95: 20, avg: 5, rate: 30, toolRateRow: 10, recovery: 5 } as const;

export type MetricKey =
  | "runSuccess"
  | "runP50"
  | "runP95"
  | "toolErrorRate"
  | "toolRecovery"
  | "toolDropped"
  | "toolDuplicate"
  | "toolP95"
  | "llmTtftP50"
  | "llmTtftP95"
  | "llmTps"
  | "cacheHit"
  | "llmRetryShare"
  | "llmErrorStops"
  | "citeRate"
  | "grantUse"
  | "capture";

export interface MetricDef {
  label: string;
  definition: string;
  nLabel: string;
  /** Which floor applies: SAMPLE_FLOORS by statistic, or an explicit `floor`. */
  stat: "p50" | "p95" | "avg" | "rate";
  floor: number;
  rowFloor?: number;
  better: "higher" | "lower";
  /**
   * Lower-is-better: value >= warn → warn, >= bad → bad.
   * Higher-is-better: value < warn → warn, < bad → bad.
   * Absent on diagnostic metrics, which never take a status colour.
   */
  warn?: number;
  bad?: number;
  /** capture only: below this the figure it qualifies is `thin`, not merely amber. */
  thinBelow?: number;
}

/** The single threshold table. Durations are ms, rates 0..1. */
export const METRIC_DEFS: Record<MetricKey, MetricDef> = {
  runSuccess: {
    label: "Success rate",
    definition: "Completed ÷ finished runs",
    nLabel: "runs",
    stat: "rate",
    floor: SAMPLE_FLOORS.rate,
    better: "higher",
    warn: 0.95,
    bad: 0.9,
  },
  runP50: {
    label: "Typical run (p50)",
    definition: "Median end-to-end time over completed runs",
    nLabel: "timed runs",
    stat: "p50",
    floor: SAMPLE_FLOORS.p50,
    better: "lower",
  },
  runP95: {
    label: "Slow tail (p95)",
    definition: "95th percentile end-to-end time over completed runs",
    nLabel: "timed runs",
    stat: "p95",
    floor: SAMPLE_FLOORS.p95,
    better: "lower",
    warn: 120_000,
    bad: 300_000,
  },
  toolErrorRate: {
    label: "Tool error rate",
    definition: "Errored ÷ tool calls",
    nLabel: "tool calls",
    stat: "rate",
    floor: SAMPLE_FLOORS.rate,
    rowFloor: SAMPLE_FLOORS.toolRateRow,
    better: "lower",
    warn: 0.05,
    bad: 0.15,
  },
  toolRecovery: {
    label: "Recovered",
    definition: "Errored calls the agent recovered from ÷ errored calls",
    nLabel: "errored calls",
    stat: "rate",
    floor: SAMPLE_FLOORS.recovery,
    rowFloor: SAMPLE_FLOORS.recovery,
    better: "higher",
    warn: 0.7,
    bad: 0.3,
  },
  toolDropped: {
    label: "Dropped",
    definition: "Calls whose end event never arrived ÷ calls",
    nLabel: "tool calls",
    stat: "rate",
    floor: SAMPLE_FLOORS.rate,
    rowFloor: SAMPLE_FLOORS.toolRateRow,
    better: "lower",
    warn: 0.02,
    bad: 0.1,
  },
  toolDuplicate: {
    label: "Duplicates",
    definition: "Repeats with identical arguments ÷ calls",
    nLabel: "tool calls",
    stat: "rate",
    floor: SAMPLE_FLOORS.rate,
    rowFloor: SAMPLE_FLOORS.toolRateRow,
    better: "lower",
    warn: 0.1,
    bad: 0.25,
  },
  // Interpolated within a duration bucket, so thresholds sit on bucket edges (10s, 30s); overflow p95 (> 5m) is above both.
  toolP95: {
    label: "p95 per call",
    definition: "95th percentile per call, estimated from duration buckets",
    nLabel: "timed calls",
    stat: "p95",
    floor: SAMPLE_FLOORS.p95,
    better: "lower",
    warn: 10_000,
    bad: 30_000,
  },
  llmTtftP50: {
    label: "Model first-token wait (p50)",
    definition: "Median per-call time to first token, retried calls excluded",
    nLabel: "model calls",
    stat: "p50",
    floor: SAMPLE_FLOORS.p50,
    better: "lower",
    warn: 2_000,
    bad: 5_000,
  },
  llmTtftP95: {
    label: "Model first-token wait (p95)",
    definition: "95th percentile per-call time to first token",
    nLabel: "model calls",
    stat: "p95",
    floor: SAMPLE_FLOORS.p95,
    better: "lower",
    warn: 8_000,
    bad: 15_000,
  },
  llmTps: {
    label: "Throughput",
    definition: "Output tokens ÷ decode seconds, weighted",
    nLabel: "calls with output",
    stat: "avg",
    floor: SAMPLE_FLOORS.avg,
    better: "higher",
    warn: 40,
    bad: 15,
  },
  cacheHit: {
    label: "Cache hit",
    definition: "Cache-read ÷ (fresh + cache-read + cache-write) prompt tokens",
    nLabel: "runs with tokens",
    stat: "rate",
    floor: SAMPLE_FLOORS.rate,
    better: "higher",
    warn: 0.5,
    bad: 0.25,
  },
  llmRetryShare: {
    label: "Retried calls",
    definition: "Calls with a retry ÷ calls",
    nLabel: "model calls",
    stat: "rate",
    floor: SAMPLE_FLOORS.rate,
    better: "lower",
    warn: 0.05,
    bad: 0.15,
  },
  llmErrorStops: {
    label: "Error stops",
    definition: "Calls that stopped with an error ÷ calls",
    nLabel: "model calls",
    stat: "rate",
    floor: SAMPLE_FLOORS.rate,
    better: "lower",
    warn: 0.01,
    bad: 0.05,
  },
  citeRate: {
    label: "Cite rate",
    definition: "Cited ÷ citeable results — diagnostic, never judged",
    nLabel: "citeable results",
    stat: "rate",
    floor: SAMPLE_FLOORS.rate,
    better: "higher",
  },
  grantUse: {
    label: "Grants used",
    definition: "Granted tools used in the window ÷ granted tools",
    nLabel: "granted tools",
    stat: "rate",
    floor: 10,
    better: "higher",
    warn: 0.5,
    bad: 0.2,
  },
  capture: {
    label: "Captured",
    definition: "Runs carrying the field ÷ runs",
    nLabel: "runs",
    stat: "rate",
    floor: 1,
    better: "higher",
    warn: 0.9,
    thinBelow: 0.1,
  },
};

export interface StatusOptions {
  /** Judge as a per-tool table row (lower floor for rates). */
  row?: boolean;
  /** runP95 only: the previous window's value and n — a 1.5× jump is at least warn. */
  previous?: number | null;
  previousN?: number;
}

/** The floor `statusFor` applies for this metric and context. */
export function floorFor(key: MetricKey, opts?: StatusOptions): number {
  const def = METRIC_DEFS[key];
  return opts?.row && def.rowFloor !== undefined ? def.rowFloor : def.floor;
}

/** The one place that decides how a figure looks, so it reads the same on every surface. */
export function statusFor(key: MetricKey, value: number | null | undefined, n: number, opts?: StatusOptions): Status {
  if (value == null || !Number.isFinite(value)) return "na";
  const def = METRIC_DEFS[key];
  if (n < floorFor(key, opts)) return "thin";
  if (def.thinBelow !== undefined && value < def.thinBelow) return "thin";
  let status: Status = "ok";
  if (def.warn !== undefined || def.bad !== undefined) {
    if (def.better === "lower") {
      if (def.bad !== undefined && value >= def.bad) status = "bad";
      else if (def.warn !== undefined && value >= def.warn) status = "warn";
    } else {
      if (def.bad !== undefined && value < def.bad) status = "bad";
      else if (def.warn !== undefined && value < def.warn) status = "warn";
    }
  }
  if (
    key === "runP95" &&
    status === "ok" &&
    opts?.previous != null &&
    opts.previous > 0 &&
    (opts.previousN ?? 0) >= def.floor &&
    value >= 1.5 * opts.previous
  ) {
    status = "warn";
  }
  return status;
}

/** Worst of several statuses for a verdict or a row dot. na/thin never outrank a judged status. */
export function worstStatus(statuses: readonly Status[]): Status {
  const rank: Record<Status, number> = { bad: 4, warn: 3, ok: 2, thin: 1, na: 0 };
  return statuses.reduce<Status>((worst, s) => (rank[s] > rank[worst] ? s : worst), "na");
}

const STATUS_TEXT: Record<Status, string> = {
  ok: "text-xyne-fg-primary",
  warn: "font-semibold text-xyne-warning-fg",
  bad: "font-semibold text-xyne-error-fg",
  na: "font-normal text-xyne-fg-muted",
  thin: "font-normal text-xyne-fg-muted",
};

export function statusText(status: Status): string {
  return STATUS_TEXT[status];
}

/** The 2px danger rule a bad row carries on its first cell (inset, so it never shifts layout). */
export const BAD_ROW_RULE = "shadow-[inset_2px_0_0_0_var(--viz-danger)]";

export function StatusGlyph({ status, size = 12 }: { status: Status; size?: number }): ReactElement | null {
  if (status === "warn") return <TriangleAlert size={size} className="shrink-0 text-xyne-warning-fg" aria-label="Worth a look" />;
  if (status === "bad") return <CircleX size={size} className="shrink-0 text-xyne-error-fg" aria-label="Needs attention" />;
  return null;
}

/** "n=4" pill: the figure beside it rests on too few samples to judge. */
export function SampleChip({
  n,
  noun = "samples",
  runs,
  floor,
  title,
}: {
  n: number;
  noun?: string;
  runs?: number;
  floor?: number;
  title?: string;
}): ReactElement {
  const tip =
    title ??
    `Only ${fmtInt(n)} ${noun}${runs != null ? ` (${fmtInt(runs)} ${plural(runs, "run")})` : ""} in this window carry this measurement.${
      floor != null ? ` Needs ${fmtInt(floor)}+ to judge.` : ""
    }`;
  return (
    <span
      title={tip}
      className="inline-flex h-[18px] shrink-0 cursor-help items-center gap-1 whitespace-nowrap rounded-full bg-xyne-neutral-bg px-1.5 text-[11px] font-medium tabular-nums text-xyne-neutral-fg"
    >
      <CircleDashed size={11} aria-hidden />
      n={fmtInt(n)}
    </span>
  );
}

/** A value dressed by its status: quiet when ok, icon + colour when warn/bad, muted + SampleChip when thin. */
export function StatusValue({
  status,
  children,
  n,
  noun,
  floor,
  naWhy = "Not captured in this window",
  title,
  className,
}: {
  status: Status;
  children: ReactNode;
  n?: number;
  noun?: string;
  floor?: number;
  naWhy?: string;
  title?: string;
  className?: string;
}): ReactElement {
  if (status === "na") return <Unknown why={naWhy} />;
  return (
    <span title={title} className={cn("inline-flex items-center gap-1 tabular-nums", statusText(status), className)}>
      <StatusGlyph status={status} />
      {children}
      {status === "thin" && n !== undefined && <SampleChip n={n} noun={noun} floor={floor} />}
    </span>
  );
}

// Small baselines: counts under 20 print absolutely, 10x jumps as a ratio; rates and latencies compare only
// when both windows clear their floor; otherwise "too few to compare", never red or green.

export type DeltaTone = "good" | "bad" | "neutral";

export interface Delta {
  label: string;
  tone: DeltaTone;
  direction: "up" | "down" | "flat";
  title: string;
  /** True when either window is under its floor: rendered as muted text, not a chip. */
  insufficient?: boolean;
}

const FLAT_LABEL = "no change";
const TOO_FEW = "too few to compare";
/** Below this previous-window count a relative change is noise. */
export const COUNT_DELTA_MIN_BASE = 20;

function tooFew(title: string): Delta {
  return { label: TOO_FEW, tone: "neutral", direction: "flat", title, insufficient: true };
}

function sideLabel(value: string, n: number | undefined, noun: string): string {
  return n === undefined ? value : `${value} over ${fmtInt(n)} ${plural(n, noun.replace(/s$/, ""), noun)}`;
}

/** Volume change, where more is neither good nor bad. */
export function countDelta(
  current: number | null | undefined,
  previous: number | null | undefined,
  format: (n: number) => string = fmtInt,
): Delta | null {
  if (current == null || previous == null) return null;
  const title = `Now: ${format(current)} · Previous window: ${format(previous)}`;
  const d = current - previous;
  if (d === 0) return { label: FLAT_LABEL, tone: "neutral", direction: "flat", title };
  const direction = d > 0 ? "up" : "down";
  if (previous < COUNT_DELTA_MIN_BASE) {
    return { label: `${d > 0 ? "+" : "−"}${format(Math.abs(d))} vs ${format(previous)}`, tone: "neutral", direction, title };
  }
  const ratioUp = current / previous;
  if (ratioUp >= 10) return { label: `${ratioUp.toFixed(1)}×`, tone: "neutral", direction, title };
  const r = d / previous;
  if (Math.abs(r) < 0.005) return { label: FLAT_LABEL, tone: "neutral", direction: "flat", title };
  return { label: `${r > 0 ? "+" : "−"}${(Math.abs(r) * 100).toFixed(1)}%`, tone: "neutral", direction, title };
}

/** Rate change in percentage points; only when both windows clear `floor`. */
export function rateDelta(
  current: { value: number | null | undefined; n: number },
  previous: { value: number | null | undefined; n: number } | null | undefined,
  opts: { higherIsBetter: boolean; floor?: number; noun?: string },
): Delta | null {
  if (current.value == null || previous == null || previous.value == null) return null;
  const noun = opts.noun ?? "runs";
  const title = `Now: ${sideLabel(fmtPct(current.value), current.n, noun)} · Previous: ${sideLabel(fmtPct(previous.value), previous.n, noun)}`;
  const floor = opts.floor ?? SAMPLE_FLOORS.rate;
  if (current.n < floor || previous.n < floor) return tooFew(title);
  const d = current.value - previous.value;
  if (Math.abs(d) < 0.0005) return { label: FLAT_LABEL, tone: "neutral", direction: "flat", title };
  const better = opts.higherIsBetter ? d > 0 : d < 0;
  return {
    label: `${d > 0 ? "+" : "−"}${(Math.abs(d) * 100).toFixed(1)}pp`,
    tone: better ? "good" : "bad",
    direction: d > 0 ? "up" : "down",
    title,
  };
}

/** Latency change, lower is better; only when both windows have `floor` (20) samples. */
export function latencyDelta(
  current: { ms: number | null | undefined; n: number },
  previous: { ms: number | null | undefined; n: number } | null | undefined,
  opts: { floor?: number; noun?: string } = {},
): Delta | null {
  if (current.ms == null || previous == null || previous.ms == null) return null;
  const noun = opts.noun ?? "runs";
  const title = `Now: ${sideLabel(fmtMs(current.ms), current.n, noun)} · Previous: ${sideLabel(fmtMs(previous.ms), previous.n, noun)}`;
  const floor = opts.floor ?? SAMPLE_FLOORS.p95;
  if (current.n < floor || previous.n < floor) return tooFew(title);
  const d = current.ms - previous.ms;
  if (Math.abs(d) < 50 || (previous.ms > 0 && Math.abs(d) / previous.ms < 0.02)) {
    return { label: FLAT_LABEL, tone: "neutral", direction: "flat", title };
  }
  return {
    label: `${fmtMs(Math.abs(d))} ${d > 0 ? "slower" : "faster"}`,
    tone: d > 0 ? "bad" : "good",
    direction: d > 0 ? "up" : "down",
    title,
  };
}

const DELTA_CLASS: Record<DeltaTone, string> = {
  good: "bg-xyne-success-bg text-xyne-success-fg",
  bad: "bg-xyne-error-bg text-xyne-error-fg",
  neutral: "bg-xyne-neutral-bg text-xyne-neutral-fg",
};

/** Signed change vs the previous window. The word ("faster", "pp") carries the meaning, not the hue. */
export function DeltaChip({ delta }: { delta: Delta }): ReactElement {
  if (delta.insufficient) {
    return (
      <span title={delta.title} className="cursor-help whitespace-nowrap text-[11px] text-xyne-fg-muted">
        {delta.label}
      </span>
    );
  }
  const Icon = delta.direction === "up" ? ArrowUp : delta.direction === "down" ? ArrowDown : Minus;
  return (
    <span
      title={delta.title}
      className={cn(
        "inline-flex h-5 items-center gap-0.5 whitespace-nowrap rounded-full px-1.5 text-[11px] font-medium tabular-nums",
        DELTA_CLASS[delta.tone],
      )}
    >
      <Icon size={11} strokeWidth={2.5} aria-hidden />
      {delta.label}
    </span>
  );
}

/** Bordered card. `loading` renders `skeleton`; `busy` dims the body and runs a top line over a refetch. */
export function MetricsCard({
  title,
  subtitle,
  action,
  footnote,
  busy = false,
  loading = false,
  skeleton,
  className,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  footnote?: ReactNode;
  busy?: boolean;
  loading?: boolean;
  skeleton?: ReactNode;
  className?: string;
  children?: ReactNode;
}): ReactElement {
  return (
    <section
      aria-busy={busy || loading || undefined}
      className={cn(
        // overflow-clip keeps the corners without making the card a scroll container (sticky headers).
        "relative min-w-0 overflow-clip rounded-xl border border-xyne-border-subtle bg-xyne-surface p-5 shadow-sm",
        className,
      )}
    >
      {busy && !loading && <ProgressLine />}
      <header className="mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-[14px] font-semibold text-xyne-fg-primary">{title}</h2>
          {subtitle && (
            <p className="mt-0.5 max-w-[80ch] text-[12px] leading-relaxed text-xyne-fg-muted">{subtitle}</p>
          )}
        </div>
        {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
      </header>
      {loading ? (
        (skeleton ?? <ChartSkeleton />)
      ) : (
        <div className={cn("transition-opacity duration-150", busy && "opacity-60")}>{children}</div>
      )}
      {footnote && !loading && (
        <p className="mt-4 border-t border-xyne-border-subtle pt-2.5 text-[11px] leading-relaxed text-xyne-fg-muted">
          {footnote}
        </p>
      )}
    </section>
  );
}

/** 2px indeterminate line along a card's top edge while its own fetch is in flight. */
export function ProgressLine(): ReactElement {
  return (
    <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[2px] overflow-hidden">
      <span className="block h-full w-full animate-pulse" style={{ backgroundColor: VIZ.accent }} />
    </span>
  );
}

/** A card with nothing in the window, collapsed to one line. */
export function EmptyCardRow({ title, message, action }: { title: ReactNode; message: ReactNode; action?: ReactNode }): ReactElement {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-xyne-border-subtle bg-xyne-surface px-5 py-3 text-[13px]">
      <span className="font-semibold text-xyne-fg-primary">{title}</span>
      <span className="text-xyne-fg-muted">— {message}</span>
      {action && <span className="ml-auto">{action}</span>}
    </div>
  );
}

/** Axis frame + bars: the first-load placeholder of a chart card. */
export function ChartSkeleton({ height = 220, bars = 6 }: { height?: number; bars?: number }): ReactElement {
  const heights = [0.55, 0.8, 0.4, 0.95, 0.65, 0.5, 0.75, 0.35];
  return (
    <div aria-hidden className="flex items-end gap-3 border-b border-l border-xyne-border-subtle px-3 pb-0" style={{ height }}>
      {Array.from({ length: bars }, (_, i) => (
        <div
          key={i}
          className="flex-1 animate-pulse rounded-t-[4px] bg-xyne-surface-sunken"
          style={{ height: `${(heights[i % heights.length] ?? 0.5) * 100}%` }}
        />
      ))}
    </div>
  );
}

/** Header + rows at the table's 36px row height. */
export function TableSkeleton({ rows = 5, cols = 5 }: { rows?: number; cols?: number }): ReactElement {
  return (
    <div aria-hidden className="flex flex-col">
      <div className="flex gap-4 border-b border-xyne-border py-2.5">
        {Array.from({ length: cols }, (_, i) => (
          <Skeleton key={i} className={cn("h-3", i === 0 ? "w-32" : "ml-auto w-12")} />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex h-9 items-center gap-4 border-t border-xyne-border-subtle">
          {Array.from({ length: cols }, (_, i) => (
            <Skeleton key={i} className={cn("h-3", i === 0 ? "w-40" : "ml-auto w-10")} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** RunRow-height rows: the first-load placeholder of a sessions list. */
export function RowsSkeleton({ rows = 5 }: { rows?: number }): ReactElement {
  return (
    <div aria-hidden className="flex flex-col gap-2">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-lg border border-xyne-border-subtle px-4 py-3">
          <Skeleton className="h-[22px] w-[22px] shrink-0 rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-3/5" />
            <Skeleton className="h-3 w-2/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

export type ChipTone = "outline" | "neutral" | "info" | "warning" | "danger" | "good";

const CHIP_CLASS: Record<ChipTone, string> = {
  outline: "border-xyne-border text-xyne-fg-muted",
  neutral: "border-xyne-neutral-border bg-xyne-neutral-bg text-xyne-neutral-fg",
  info: "border-xyne-info-border bg-xyne-info-bg text-xyne-info-fg",
  warning: "border-xyne-warning-border bg-xyne-warning-bg text-xyne-warning-fg",
  danger: "border-xyne-error-border bg-xyne-error-bg text-xyne-error-fg",
  good: "border-xyne-success-border bg-xyne-success-bg text-xyne-success-fg",
};

export function Chip({
  children,
  tone = "outline",
  title,
  className,
}: {
  children: ReactNode;
  tone?: ChipTone;
  title?: string;
  className?: string;
}): ReactElement {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 text-[11px] font-medium",
        CHIP_CLASS[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export interface Kpi {
  key: string;
  label: string;
  value: ReactNode;
  /** Tooltip on the value — the exact counts behind it, or why it is unknown. */
  valueTitle?: string;
  /** Longer explanation, shown on hover of the label. */
  hint?: string;
  delta?: Delta | null;
  deltaNote?: string;
  line?: ReactNode;
  badge?: ReactNode;
  /** warn/bad put the glyph before the value; thin mutes it and adds a SampleChip; na shows "—". */
  status?: Status;
  /** Family icon before the label (ux-audit §2.6), muted — a marker, not an alert. */
  icon?: LucideIcon;
  n?: number;
  /** Population n is drawn from; with `n`, prints "n = 117 of 741 runs" when capture is under 90%. */
  nOf?: number;
  nLabel?: string;
  floor?: number;
  naWhy?: string;
}

/** "n = 117 of 741 runs" when the figure covers under 90% of its population, else null. */
export function nLine(n: number | undefined, nOf: number | undefined, noun = "runs"): string | null {
  if (n === undefined || nOf === undefined || nOf <= 0 || n / nOf >= 0.9) return null;
  return `n = ${fmtInt(n)} of ${fmtInt(nOf)} ${noun}`;
}

/** KPI cells in one card, separated by hairlines. */
export function KpiStrip({
  items,
  size = "md",
  cols,
  valueClass,
  showDeltas = false,
  busy = false,
}: {
  items: Kpi[];
  size?: "lg" | "md";
  /** Grid column classes; keep every container-query threshold in px (mixed units order unpredictably). */
  cols: string;
  /** Overrides the value size, e.g. to step down when the strip goes 7-across. */
  valueClass?: string;
  showDeltas?: boolean;
  busy?: boolean;
}): ReactElement {
  return (
    <div className="@container relative overflow-hidden rounded-xl border border-xyne-border-subtle bg-xyne-surface shadow-sm">
      {busy && <ProgressLine />}
      <dl className={cn("grid overflow-hidden rounded-xl transition-opacity duration-150", cols, busy && "opacity-60")}>
        {items.map((kpi) => (
          <KpiCell key={kpi.key} kpi={kpi} size={size} showDelta={showDeltas} valueClass={valueClass} />
        ))}
      </dl>
    </div>
  );
}

function KpiCell({
  kpi,
  size,
  showDelta,
  valueClass,
}: {
  kpi: Kpi;
  size: "lg" | "md";
  showDelta: boolean;
  valueClass: string | undefined;
}): ReactElement {
  const status = kpi.status;
  const Icon = kpi.icon;
  const coverage = nLine(kpi.n, kpi.nOf, kpi.nLabel);
  const valueTone = statusText(status ?? "ok");
  return (
    // Right + bottom hairlines on every cell; the strip clips those on its outer edge.
    <div
      className={cn(
        "flex min-w-0 flex-col shadow-[1px_0_0_0_var(--color-xyne-border-subtle),0_1px_0_0_var(--color-xyne-border-subtle)]",
        size === "lg" ? "gap-1.5 px-4 py-3.5" : "gap-1 px-3.5 py-3",
      )}
    >
      <dt
        className={cn(
          "flex min-w-0 items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-xyne-fg-muted",
          kpi.hint && "cursor-help",
        )}
        title={kpi.hint}
      >
        {Icon && <Icon size={12} className="shrink-0 text-xyne-fg-muted" aria-hidden />}
        <span className="truncate">{kpi.label}</span>
        {kpi.badge}
      </dt>
      <dd
        title={kpi.valueTitle}
        className={cn(
          "flex min-w-0 items-center gap-1 whitespace-nowrap font-semibold leading-tight tabular-nums",
          valueClass ?? (size === "lg" ? "text-[22px]" : "text-[18px]"),
          valueTone,
          status === "thin" && "font-normal",
          kpi.valueTitle && "cursor-help",
        )}
      >
        {status === "na" ? (
          <Unknown why={kpi.naWhy ?? "Not captured in this window"} />
        ) : (
          <>
            {status !== undefined && <StatusGlyph status={status} size={size === "lg" ? 16 : 14} />}
            {kpi.value}
            {status === "thin" && kpi.n !== undefined && (
              <SampleChip n={kpi.n} noun={kpi.nLabel} floor={kpi.floor} />
            )}
          </>
        )}
      </dd>
      {showDelta && (
        <dd className="flex h-5 items-center">
          {kpi.delta ? (
            <DeltaChip delta={kpi.delta} />
          ) : (
            kpi.deltaNote && <span className="text-[11px] text-xyne-fg-muted">{kpi.deltaNote}</span>
          )}
        </dd>
      )}
      {/* A plain-text line clamps at two lines; a line with inline drill counts
          does not, because the clamp's overflow would clip their 24px hit area. */}
      {kpi.line && (
        <dd className={cn("text-[11px] leading-[15px] text-xyne-fg-muted", typeof kpi.line === "string" && "line-clamp-2")}>{kpi.line}</dd>
      )}
      {coverage && <dd className="text-[11px] leading-[15px] tabular-nums text-xyne-fg-muted">{coverage}</dd>}
    </div>
  );
}

export function KpiStripSkeleton({ count, cols, tall = false }: { count: number; cols: string; tall?: boolean }): ReactElement {
  return (
    <div className="@container rounded-xl border border-xyne-border-subtle bg-xyne-surface shadow-sm">
      <div className={cn("grid", cols)}>
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="flex flex-col gap-2 px-4 py-3.5">
            <Skeleton className="h-3 w-16" />
            <Skeleton className={cn("w-20", tall ? "h-7" : "h-5")} />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: ReadonlyArray<{ id: T; label: string }>;
  value: T;
  onChange: (next: T) => void;
  ariaLabel: string;
}): ReactElement {
  return (
    <div role="group" aria-label={ariaLabel} className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-xyne-surface-sunken p-0.5">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
          className={cn(
            "h-6 rounded-full px-2.5 text-[12px] font-medium transition-colors",
            value === option.id
              ? "bg-xyne-fg-primary text-xyne-fg-inverse"
              : "text-xyne-fg-muted hover:text-xyne-fg-primary",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** A labelled switch for a panel-level option ("Include subagent calls"). */
export function ToggleField({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  hint?: string;
}): ReactElement {
  return (
    <label className="flex shrink-0 cursor-pointer items-center gap-2 text-[12px] text-xyne-fg-secondary" title={hint}>
      <Switch checked={checked} onChange={onChange} ariaLabel={label} />
      {label}
    </label>
  );
}

export interface Column<T> {
  key: string;
  header: ReactNode;
  hint?: string;
  /** Consecutive columns sharing a group get one spanning header above them. */
  group?: string;
  numeric?: boolean;
  /** Server mode: present = sortable, and this key is sent to the server. */
  sortKey?: string;
  /** Local mode: present = sortable. Nulls sort last in both directions — unknown is never "worst". */
  sortValue?: (row: T) => number | string | null | undefined;
  /** First direction when this column is picked. Text defaults asc, numbers desc. */
  defaultDir?: "asc" | "desc";
  className?: string;
  render: (row: T) => ReactNode;
  /** The column's WINDOW total; exactly 0 hides the column and names it in a footnote. */
  windowTotal?: number | null;
  /** Name in the "Hidden: …" footnote; defaults to the header when it is a string. */
  hiddenLabel?: string;
}

/** Server-driven sort, page and search: a paged table cannot sort locally, so header clicks call back. */
export interface ServerTable {
  sort: string;
  dir: "asc" | "desc";
  offset: number;
  limit: number;
  total: number;
  search: string;
  onSort: (key: string, defaultDir: "asc" | "desc") => void;
  onOffset: (offset: number) => void;
  onSearch: (query: string) => void;
  searchPlaceholder: string;
  unit: string;
}

const TH = "px-2 py-2 text-[11px] font-medium uppercase tracking-wider text-xyne-fg-muted first:pl-0 last:pr-0";
const TD = "px-2 py-2 text-[13px] text-xyne-fg-primary first:pl-0 last:pr-0";
// pl-* sorts after px-* in Tailwind's output, so this wins over TD/TH's px-2.
const GROUP_EDGE = "border-l border-xyne-border-subtle pl-3";

export function DataTable<T>({
  rows,
  columns: allColumns,
  rowKey,
  emptyMessage,
  server,
  initialSort,
  onRowClick,
  rowTitle,
  selectedKey,
  mergeCells,
  maxRows,
  busy = false,
  minWidth = 640,
  footnote,
  rowStatus,
  maxHeight,
}: {
  rows: readonly T[];
  columns: ReadonlyArray<Column<T>>;
  rowKey: (row: T) => string;
  emptyMessage: ReactNode;
  server?: ServerTable;
  initialSort?: { key: string; dir: "asc" | "desc" };
  onRowClick?: (row: T) => void;
  rowTitle?: (row: T) => string;
  selectedKey?: string | null;
  /** Replace a run of cells with one spanning cell — e.g. "no tools config" across four columns. */
  mergeCells?: (row: T) => { from: string; span: number; content: ReactNode } | null;
  maxRows?: number;
  busy?: boolean;
  minWidth?: number;
  footnote?: ReactNode;
  rowStatus?: (row: T) => Status;
  /** Caps height and scrolls internally; a wide table needs it for a header that stays in view. */
  maxHeight?: number;
}): ReactElement {
  const [localSort, setLocalSort] = useState(initialSort ?? null);
  const [expanded, setExpanded] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const scrollsX = useHorizontalOverflow(wrapRef, tableRef);

  const hiddenCols = useMemo(() => allColumns.filter((c) => c.windowTotal === 0), [allColumns]);
  const columns = useMemo(
    () => (hiddenCols.length === 0 ? allColumns : allColumns.filter((c) => c.windowTotal !== 0)),
    [allColumns, hiddenCols],
  );
  const firstKey = columns[0]?.key;
  const stickyCell = (key: string, head: boolean): string | false =>
    scrollsX && key === firstKey && cn("sticky left-0 z-[1]", head ? "bg-xyne-surface" : "bg-xyne-surface group-hover/row:bg-xyne-surface-subtle");

  const sorted = useMemo(() => {
    // Server rows arrive ordered; re-sorting one page would pose as a ranking of the window.
    if (server || !localSort) return rows;
    const col = columns.find((c) => c.key === localSort.key);
    const value = col?.sortValue;
    if (!value) return rows;
    const factor = localSort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = value(a);
      const bv = value(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string" || typeof bv === "string") return factor * String(av).localeCompare(String(bv));
      return factor * (av - bv);
    });
  }, [rows, columns, localSort, server]);

  const limited = !server && maxRows !== undefined && !expanded ? sorted.slice(0, maxRows) : sorted;
  const hidden = sorted.length - limited.length;

  // Consecutive columns with the same `group` share one header cell.
  const segments = useMemo(() => {
    const out: Array<{ group: string | undefined; cols: Array<Column<T>> }> = [];
    for (const col of columns) {
      const last = out[out.length - 1];
      if (col.group && last && last.group === col.group) last.cols.push(col);
      else out.push({ group: col.group, cols: [col] });
    }
    return out;
  }, [columns]);
  const hasGroups = segments.some((s) => s.group);
  const groupStarts = useMemo(
    () => new Set(segments.filter((s) => s.group).map((s) => s.cols[0]!.key)),
    [segments],
  );

  const activeSort = server ? { key: server.sort, dir: server.dir } : localSort;

  const sortHandler = (col: Column<T>): (() => void) | undefined => {
    const defaultDir = col.defaultDir ?? (col.numeric ? "desc" : "asc");
    if (server) {
      if (!col.sortKey) return undefined;
      const key = col.sortKey;
      return () => server.onSort(key, defaultDir);
    }
    if (!col.sortValue) return undefined;
    return () =>
      setLocalSort((cur) =>
        cur && cur.key === col.key
          ? { key: col.key, dir: cur.dir === "asc" ? "desc" : "asc" }
          : { key: col.key, dir: defaultDir },
      );
  };

  const isActive = (col: Column<T>): boolean =>
    activeSort != null && (server ? col.sortKey === activeSort.key : col.key === activeSort.key);

  const headerCell = (col: Column<T>, rowSpan?: number): ReactElement => {
    const onSort = sortHandler(col);
    const active = isActive(col);
    return (
      <th
        key={col.key}
        scope="col"
        rowSpan={rowSpan}
        title={col.hint}
        aria-sort={active ? (activeSort?.dir === "asc" ? "ascending" : "descending") : undefined}
        className={cn(
          TH,
          "whitespace-nowrap border-b border-xyne-border align-bottom",
          col.numeric ? "text-right" : "text-left",
          groupStarts.has(col.key) && GROUP_EDGE,
          stickyCell(col.key, true),
        )}
      >
        {onSort ? (
          <button
            type="button"
            onClick={onSort}
            className={cn(
              "group inline-flex items-center gap-1 uppercase tracking-wider hover:text-xyne-fg-primary",
              col.numeric && "flex-row-reverse",
              active && "text-xyne-fg-primary",
            )}
          >
            <span>{col.header}</span>
            {active ? (
              activeSort?.dir === "asc" ? (
                <ArrowUp size={11} aria-hidden />
              ) : (
                <ArrowDown size={11} aria-hidden />
              )
            ) : (
              <ArrowUpDown size={11} aria-hidden className="opacity-0 transition-opacity group-hover:opacity-60" />
            )}
          </button>
        ) : (
          <span className={cn(col.hint && "cursor-help")}>{col.header}</span>
        )}
      </th>
    );
  };

  const rangeStart = server && server.total > 0 ? server.offset + 1 : 0;
  const rangeEnd = server ? Math.min(server.offset + rows.length, server.total) : 0;

  return (
    <div>
      {server && (
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <SearchBox value={server.search} onChange={server.onSearch} placeholder={server.searchPlaceholder} />
          <span className="text-[12px] tabular-nums text-xyne-fg-muted">
            {server.total === 0
              ? server.search
                ? `No ${server.unit} match`
                : `No ${server.unit}`
              : `${fmtInt(rangeStart)}–${fmtInt(rangeEnd)} of ${fmtInt(server.total)} ${server.unit}${server.search ? " matching" : ""}`}
          </span>
        </div>
      )}
      <div
        ref={wrapRef}
        className={cn("-mx-1 px-1", maxHeight !== undefined ? "overflow-auto" : scrollsX ? "overflow-x-auto" : "overflow-visible")}
        style={maxHeight !== undefined ? { maxHeight } : undefined}
      >
        <table ref={tableRef} className="w-full border-collapse" style={{ minWidth }}>
          {/* The shadow redraws the header rule while stuck: with border-collapse
              the cell borders stay with the table and scroll away. */}
          <thead
            className={cn(
              "sticky z-[2] bg-xyne-surface shadow-[0_1px_0_0_var(--color-xyne-border)]",
              maxHeight !== undefined || scrollsX ? "top-0" : "top-[var(--metrics-sticky-offset,0px)]",
            )}
          >
            {hasGroups ? (
              <>
                <tr>
                  {segments.map((seg, i) =>
                    seg.group ? (
                      <th
                        key={`group-${i}`}
                        scope="colgroup"
                        colSpan={seg.cols.length}
                        className={cn(
                          "px-2 pb-0 pt-1 text-left text-[10px] font-semibold uppercase tracking-wider text-xyne-fg-tertiary last:pr-0",
                          GROUP_EDGE,
                        )}
                      >
                        <span className="block border-b border-xyne-border pb-1">{seg.group}</span>
                      </th>
                    ) : (
                      seg.cols.map((col) => headerCell(col, 2))
                    ),
                  )}
                </tr>
                <tr>{columns.filter((c) => c.group).map((col) => headerCell(col))}</tr>
              </>
            ) : (
              <tr>{columns.map((col) => headerCell(col))}</tr>
            )}
          </thead>
          <tbody className={cn("transition-opacity duration-150", busy && "opacity-60")}>
            {limited.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="py-8 text-center text-[13px] text-xyne-fg-muted">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              limited.map((row) => {
                const key = rowKey(row);
                const merge = mergeCells?.(row) ?? null;
                const bad = rowStatus?.(row) === "bad";
                const cells: ReactNode[] = [];
                for (let i = 0; i < columns.length; i += 1) {
                  const col = columns[i]!;
                  if (merge && col.key === merge.from) {
                    cells.push(
                      <td
                        key={col.key}
                        colSpan={merge.span}
                        className={cn(
                          TD,
                          "text-[12px] text-xyne-fg-muted",
                          groupStarts.has(col.key) && GROUP_EDGE,
                          stickyCell(col.key, false),
                          bad && i === 0 && cn(BAD_ROW_RULE, "first:pl-2"),
                        )}
                      >
                        {merge.content}
                      </td>,
                    );
                    i += merge.span - 1;
                    continue;
                  }
                  cells.push(
                    <td
                      key={col.key}
                      className={cn(
                        TD,
                        col.numeric && "whitespace-nowrap text-right tabular-nums",
                        groupStarts.has(col.key) && GROUP_EDGE,
                        col.className,
                        stickyCell(col.key, false),
                        bad && i === 0 && cn(BAD_ROW_RULE, "first:pl-2"),
                      )}
                    >
                      {col.render(row)}
                    </td>,
                  );
                }
                return (
                  <tr
                    key={key}
                    tabIndex={onRowClick ? 0 : undefined}
                    title={rowTitle?.(row)}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    onKeyDown={
                      onRowClick
                        ? (e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              onRowClick(row);
                            }
                          }
                        : undefined
                    }
                    className={cn(
                      "group/row border-t border-xyne-border-subtle",
                      onRowClick &&
                        "cursor-pointer hover:bg-xyne-surface-subtle focus-visible:bg-xyne-surface-subtle focus-visible:outline-none",
                      selectedKey != null && key === selectedKey && "bg-xyne-surface-sunken",
                    )}
                  >
                    {cells}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {server && server.total > server.limit && (
        <Pager offset={server.offset} limit={server.limit} total={server.total} onOffset={server.onOffset} className="mt-3" />
      )}
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-3 text-[12px] font-medium text-xyne-fg-muted hover:text-xyne-fg-primary"
        >
          Show all {fmtInt(sorted.length)}
        </button>
      )}
      {expanded && maxRows !== undefined && sorted.length > maxRows && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="mt-3 text-[12px] font-medium text-xyne-fg-muted hover:text-xyne-fg-primary"
        >
          Show fewer
        </button>
      )}
      {(footnote || hiddenCols.length > 0) && (
        <p className="mt-3 text-[11px] leading-relaxed text-xyne-fg-muted">
          {hiddenCols.length > 0 && (
            <>
              Hidden:{" "}
              {hiddenCols
                .map((c) => c.hiddenLabel ?? (typeof c.header === "string" ? c.header : c.key))
                .join(", ")}{" "}
              (0 in window).{footnote ? " " : ""}
            </>
          )}
          {footnote}
        </p>
      )}
    </div>
  );
}

/** True once the table is wider than its wrapper (only then does it scroll and stick the first column). */
function useHorizontalOverflow(
  wrapRef: RefObject<HTMLDivElement | null>,
  tableRef: RefObject<HTMLTableElement | null>,
): boolean {
  const [scrolls, setScrolls] = useState(false);
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const table = tableRef.current;
    if (!wrap || !table) return;
    const measure = (): void => setScrolls(table.scrollWidth > wrap.clientWidth + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    ro.observe(table);
    return () => ro.disconnect();
  }, [wrapRef, tableRef]);
  return scrolls;
}

/** Debounced so typing does not fire a server request per keystroke. */
function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (query: string) => void;
  placeholder: string;
}): ReactElement {
  const [draft, setDraft] = useState(value);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Follow external changes without clobbering a trailing space being typed.
  useEffect(() => {
    setDraft((d) => (d.trim() === value ? d : value));
  }, [value]);

  useEffect(() => {
    if (draft.trim() === value) return;
    const timer = setTimeout(() => onChangeRef.current(draft.trim()), 300);
    return () => clearTimeout(timer);
  }, [draft, value]);

  return (
    <div className="flex h-8 w-[240px] items-center gap-2 rounded-full border border-xyne-border bg-xyne-surface px-3 focus-within:border-xyne-border-strong">
      <Search size={13} className="shrink-0 text-xyne-fg-muted" aria-hidden />
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="min-w-0 flex-1 bg-transparent text-[13px] text-xyne-fg-primary placeholder:text-xyne-fg-placeholder focus:outline-none"
      />
      {draft && (
        <button
          type="button"
          onClick={() => {
            setDraft("");
            onChangeRef.current("");
          }}
          aria-label="Clear filter"
          className="shrink-0 text-xyne-fg-muted hover:text-xyne-fg-primary"
        >
          <X size={12} aria-hidden />
        </button>
      )}
    </div>
  );
}

export function Pager({
  offset,
  limit,
  total,
  onOffset,
  className,
}: {
  offset: number;
  limit: number;
  total: number;
  onOffset: (offset: number) => void;
  className?: string;
}): ReactElement {
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.max(1, Math.ceil(total / limit));
  const button =
    "inline-flex h-7 items-center gap-1 rounded-md border border-xyne-border px-2.5 text-[12px] font-medium text-xyne-fg-primary hover:enabled:bg-xyne-surface-subtle disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      <span className="text-[12px] tabular-nums text-xyne-fg-muted">
        Page {fmtInt(page)} of {fmtInt(pages)}
      </span>
      <div className="flex items-center gap-1.5">
        <button type="button" className={button} disabled={offset === 0} onClick={() => onOffset(Math.max(0, offset - limit))}>
          <ChevronLeft size={13} aria-hidden />
          Previous
        </button>
        <button type="button" className={button} disabled={offset + limit >= total} onClick={() => onOffset(offset + limit)}>
          Next
          <ChevronRight size={13} aria-hidden />
        </button>
      </div>
    </div>
  );
}

/** A 0..1 value as a short track + fill, for table cells. The number always sits beside it. */
export function InlineBar({
  value,
  color,
  width = 48,
}: {
  value: number | null | undefined;
  color: string;
  width?: number | string;
}): ReactElement {
  const pct = value == null ? 0 : Math.min(1, Math.max(0, value)) * 100;
  return (
    <span
      aria-hidden
      className="inline-block h-1.5 shrink-0 overflow-hidden rounded-full align-middle"
      style={{ width, backgroundColor: VIZ.track }}
    >
      <span className="block h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
    </span>
  );
}

export interface Segment {
  key: string;
  label: string;
  value: number;
  color: string;
  hint?: string;
}

/** One whole as a stacked bar plus a legend carrying the numbers. */
export function StackedBar({
  segments,
  format,
  ariaLabel,
}: {
  segments: readonly Segment[];
  format: (value: number) => string;
  ariaLabel: string;
}): ReactElement {
  const total = segments.reduce((a, s) => a + s.value, 0);
  return (
    <div>
      <div role="img" aria-label={ariaLabel} className="flex h-3.5 w-full gap-[2px] overflow-hidden rounded-[4px]">
        {total === 0 ? (
          <div className="h-full w-full" style={{ backgroundColor: VIZ.track }} />
        ) : (
          segments
            .filter((s) => s.value > 0)
            .map((s) => (
              <div
                key={s.key}
                title={`${s.label}: ${format(s.value)} (${fmtPct(s.value / total)})`}
                className="h-full min-w-[3px]"
                style={{ flexGrow: s.value, flexBasis: 0, backgroundColor: s.color }}
              />
            ))
        )}
      </div>
      <ul className="mt-3 flex flex-col gap-1.5">
        {segments.map((s) => (
          <li key={s.key} className="flex items-center gap-2 text-[12px]" title={s.hint}>
            <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: s.color }} />
            <span className={cn("min-w-0 flex-1 truncate text-xyne-fg-secondary", s.hint && "cursor-help")}>{s.label}</span>
            <span className="font-medium tabular-nums text-xyne-fg-primary">{format(s.value)}</span>
            <span className="w-[46px] text-right tabular-nums text-xyne-fg-muted">{total > 0 ? fmtPct(s.value / total) : "—"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Rendered outside the SVG so its text wears text tokens, not the series colour. */
export function ChartLegend({
  items,
  className,
}: {
  items: ReadonlyArray<{ label: string; color: string; shape?: "square" | "line" }>;
  className?: string;
}): ReactElement {
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-4 gap-y-1", className)}>
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5 text-[11px] text-xyne-fg-muted">
          <span
            aria-hidden
            className={item.shape === "line" ? "h-[2px] w-3 rounded-full" : "h-2.5 w-2.5 rounded-[3px]"}
            style={{ backgroundColor: item.color }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

export interface TooltipRow {
  label: string;
  value: string;
  /** Series colour for the key stroke; omit for context rows (sample size, share). */
  color?: string;
}

/** Tooltip content for every chart, built from the hovered datum. */
export function ChartTooltip<D>({
  active,
  payload,
  label,
  title,
  rows,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: unknown }>;
  label?: unknown;
  title?: (label: unknown, datum: D) => string;
  rows: (datum: D) => TooltipRow[];
}): ReactElement | null {
  if (!active || !payload || payload.length === 0) return null;
  const datum = payload[0]?.payload as D | undefined;
  if (datum === undefined) return null;
  const list = rows(datum);
  if (list.length === 0) return null;
  return (
    <div className="min-w-[160px] rounded-lg border border-xyne-border bg-xyne-surface px-3 py-2 shadow-md">
      <div className="mb-1.5 text-[12px] font-medium text-xyne-fg-primary">
        {title ? title(label, datum) : String(label ?? "")}
      </div>
      <ul className="flex flex-col gap-1">
        {list.map((row) => (
          <li key={row.label} className="flex items-center gap-2 text-[12px]">
            {row.color ? (
              <span aria-hidden className="h-[3px] w-2.5 shrink-0 rounded-full" style={{ backgroundColor: row.color }} />
            ) : (
              <span aria-hidden className="w-2.5 shrink-0" />
            )}
            <span className="font-semibold tabular-nums text-xyne-fg-primary">{row.value}</span>
            <span className="text-xyne-fg-muted">{row.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Checkbox dropdown for filters. Empty means ALL; search narrows options only; selected values missing from `options` stay listed. */
export function MultiSelect({
  noun,
  allLabel,
  options,
  selected,
  onChange,
  emptyMessage,
  onOpenChange,
}: {
  noun: string;
  allLabel: string;
  options: readonly string[];
  selected: readonly string[];
  onChange: (next: string[]) => void;
  emptyMessage: string;
  /** Fires on every open and close, e.g. to load the options only once the list is shown. */
  onOpenChange?: (open: boolean) => void;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  // Reported from an effect so every way of closing reports once; the initial state is not reported.
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  const everOpened = useRef(false);
  useEffect(() => {
    if (open) everOpened.current = true;
    else if (!everOpened.current) return;
    onOpenChangeRef.current?.(open);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const all = useMemo(() => {
    const known = new Set(options);
    return [...selected.filter((s) => !known.has(s)), ...options];
  }, [options, selected]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? all.filter((o) => o.toLowerCase().includes(q)) : all;
  }, [all, query]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const trigger = selected.length === 0 ? allLabel : selected.length === 1 ? selected[0]! : `${selected.length} ${noun}`;

  return (
    <div ref={rootRef} className="relative">
      <div
        className={cn(
          "flex h-8 max-w-[260px] items-center rounded-full border bg-xyne-surface text-[13px] text-xyne-fg-primary",
          open ? "border-xyne-border-strong" : "border-xyne-border hover:border-xyne-border-strong",
        )}
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={open}
          className="flex h-full min-w-0 items-center gap-1.5 pl-3 pr-2"
        >
          <span className={cn("truncate", selected.length === 1 && "font-mono text-[12px]")}>{trigger}</span>
          <ChevronDown size={13} className="shrink-0 text-xyne-fg-muted" aria-hidden />
        </button>
        {selected.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            aria-label={`Clear ${noun} filter`}
            className="mr-2 shrink-0 rounded-full p-0.5 text-xyne-fg-muted hover:text-xyne-fg-primary"
          >
            <X size={12} aria-hidden />
          </button>
        )}
      </div>

      {open && (
        <div className="absolute left-0 z-30 mt-1 w-[300px] rounded-lg border border-xyne-border bg-xyne-surface p-1 shadow-lg">
          <div className="flex items-center gap-2 border-b border-xyne-border-subtle px-2 pb-1.5 pt-1">
            <Search size={13} className="shrink-0 text-xyne-fg-muted" aria-hidden />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${noun}…`}
              aria-label={`Search ${noun}`}
              className="w-full bg-transparent text-[13px] text-xyne-fg-primary placeholder:text-xyne-fg-placeholder focus:outline-none"
            />
          </div>
          <div role="listbox" aria-multiselectable="true" className="max-h-[280px] overflow-y-auto py-1">
            {visible.length === 0 ? (
              <p className="px-3 py-4 text-center text-[12px] text-xyne-fg-muted">{query ? "No match." : emptyMessage}</p>
            ) : (
              visible.map((option) => {
                const isSelected = selectedSet.has(option);
                return (
                  <button
                    key={option}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() =>
                      onChange(isSelected ? selected.filter((s) => s !== option) : [...selected, option])
                    }
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-xyne-surface-subtle"
                  >
                    <span
                      className={cn(
                        "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border",
                        isSelected ? "border-xyne-brand bg-xyne-brand text-xyne-fg-inverse" : "border-xyne-border-strong",
                      )}
                    >
                      {isSelected && <Check size={10} strokeWidth={3} aria-hidden />}
                    </span>
                    <span className="truncate font-mono text-[12px] text-xyne-fg-primary">{option}</span>
                  </button>
                );
              })
            )}
          </div>
          {selected.length > 0 && (
            <div className="flex items-center justify-between border-t border-xyne-border-subtle px-2 pt-1.5">
              <span className="text-[11px] text-xyne-fg-muted">{selected.length} selected</span>
              <button
                type="button"
                onClick={() => onChange([])}
                className="text-[11px] font-medium text-xyne-fg-muted hover:text-xyne-fg-primary"
              >
                Clear
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Right-side overlay for a row drill-down, so the reader's place in a long table survives. */
export function Drawer({
  title,
  subtitle,
  onClose,
  children,
  width = 600,
  heading,
}: {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** Panel width in px, capped at the viewport. 760 fits the 7-column sessions list. */
  width?: number;
  heading?: ReactNode;
}): ReactElement {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-[var(--comp-z-modal)] flex justify-end">
      <div aria-hidden onClick={onClose} className="absolute inset-0 bg-black/30" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="relative flex h-full flex-col border-l border-xyne-border bg-xyne-surface shadow-[var(--comp-shadow-xl)] outline-none"
        style={{ width: `min(${width}px, 100vw)` }}
      >
        <div className="flex shrink-0 items-start gap-3 border-b border-xyne-border-subtle px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-mono text-[15px] font-semibold text-xyne-fg-primary" title={title}>
              {heading ?? title}
            </h2>
            {subtitle && <div className="mt-1 text-[12px] text-xyne-fg-muted">{subtitle}</div>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xyne-fg-muted hover:bg-xyne-surface-subtle hover:text-xyne-fg-primary"
          >
            <X size={16} aria-hidden />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Says a tab's numbers describe only part of the window. Under 10% capture is neutral, 10-90% amber, 90%+ hidden;
 * `tone="neutral"` forces the quiet form, `message` replaces the default sentence.
 */
export function CoverageBanner({
  coverage,
  covered,
  total,
  verb = "",
  message,
  detail,
  action,
  tone = "auto",
}: {
  coverage: number | null | undefined;
  covered: number;
  total: number;
  /** Completes "Only 62% of runs in this window …" — "have tool stats". Unused with `message`. */
  verb?: string;
  message?: ReactNode;
  detail?: ReactNode;
  action?: ReactNode;
  tone?: "auto" | "neutral";
}): ReactElement | null {
  if (total === 0 || coverage == null || coverage >= 0.9) return null;
  const neutral = tone === "neutral" || coverage < 0.1;
  // Floor so 99.6% never reads "100%"; "<1%" when a few runs are covered.
  const floored = Math.floor(Math.max(0, coverage) * 100);
  const pct = floored === 0 && covered > 0 ? "<1" : String(floored);
  const Icon = neutral ? CircleDashed : TriangleAlert;
  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-4 py-2.5 text-[12px]",
        neutral
          ? "border-xyne-neutral-border bg-xyne-neutral-bg text-xyne-neutral-fg"
          : "border-xyne-warning-border bg-xyne-warning-bg text-xyne-warning-fg",
      )}
    >
      <Icon size={14} className="shrink-0" aria-hidden />
      <p className="min-w-0 flex-1 leading-relaxed">
        {message !== undefined ? (
          <span className="font-semibold">{message}</span>
        ) : (
          <>
            <span className="font-semibold">
              Only {pct}% of runs in this window {verb}
            </span>{" "}
            — counts under-report ({fmtInt(covered)} of {fmtInt(total)} runs).
          </>
        )}
        {detail && <> {detail}</>}
      </p>
      {action}
    </div>
  );
}

export interface BackfillState {
  running: boolean;
  error: string | null;
  remaining: number | null;
}

export interface BackfillProps {
  isAdmin: boolean;
  state: BackfillState;
  onRun: () => void;
}

/** The admin remedy for an incomplete toolStats window. */
export function BackfillAction({ isAdmin, state, onRun }: BackfillProps): ReactElement {
  if (!isAdmin) return <span className="text-[12px] opacity-90">An admin can run the backfill to close the gap.</span>;
  const left = state.remaining ? `${fmtInt(state.remaining)} left` : null;
  return (
    <span className="flex items-center gap-2">
      {state.error && <span className="text-[12px] text-xyne-error-fg">Backfill failed: {state.error}</span>}
      {!state.running && !state.error && left && <span className="text-[12px] opacity-90">Stopped with {left}</span>}
      <button
        type="button"
        onClick={onRun}
        disabled={state.running}
        className="inline-flex h-7 items-center gap-1.5 rounded-full bg-xyne-fg-primary px-3 text-[12px] font-medium text-xyne-fg-inverse hover:opacity-90 disabled:cursor-progress disabled:opacity-60"
      >
        <RefreshCw size={12} className={cn(state.running && "animate-spin")} aria-hidden />
        {state.running ? (left ? `Backfilling… ${left}` : "Backfilling…") : "Run backfill"}
      </button>
    </span>
  );
}

/** Empty state — always says what would populate it. */
export function PanelMessage({ title, detail }: { title: string; detail?: ReactNode }): ReactElement {
  return (
    <div className="rounded-xl border border-dashed border-xyne-border px-6 py-12 text-center">
      <p className="text-[13px] font-medium text-xyne-fg-primary">{title}</p>
      {detail && <p className="mx-auto mt-1 max-w-[60ch] text-[12px] leading-relaxed text-xyne-fg-muted">{detail}</p>}
    </div>
  );
}

export function PanelError({ error, onRetry }: { error: string; onRetry?: () => void }): ReactElement {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-3 rounded-xl border border-xyne-error-border bg-xyne-error-bg px-4 py-3 text-[13px] text-xyne-error-fg"
    >
      <TriangleAlert size={15} className="shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">Failed to load: {error}</span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex h-7 items-center gap-1.5 rounded-full border border-xyne-error-border px-3 text-[12px] font-medium hover:bg-xyne-surface"
        >
          <RefreshCw size={12} aria-hidden />
          Retry
        </button>
      )}
    </div>
  );
}

/** Thin row above a panel's content: what the panel is scoped to, and its options. */
export function PanelToolbar({ children, controls }: { children: ReactNode; controls?: ReactNode }): ReactElement {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-[12px] text-xyne-fg-muted">
      <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>
      {controls && <div className="flex flex-wrap items-center gap-4">{controls}</div>}
    </div>
  );
}

/** Drawer and view keys tied to the current range and agents; `clearDrillParams` drops them on change. */
export const DRILL_PARAMS = [
  "tool",
  "dfilter",
  "dclass",
  "drill",
  "status",
  "minMs",
  "model",
  "provider",
  "sort",
  "dir",
  "page",
  "q",
] as const;

/** Removes DRILL_PARAMS (and, unless `keepMeasures`, every `m_<card>` key) from `params` in place. */
export function clearDrillParams(params: URLSearchParams, opts: { keepMeasures?: boolean } = {}): URLSearchParams {
  for (const key of DRILL_PARAMS) params.delete(key);
  if (!opts.keepMeasures) {
    for (const key of [...params.keys()]) if (key.startsWith("m_")) params.delete(key);
  }
  return params;
}

export type ParamPatch = Record<string, string | number | null | undefined>;

/** Patches URL keys in one history entry; null / undefined / "" delete a key. `replace` swaps instead of pushing. */
export function useMetricsParams(): (patch: ParamPatch, opts?: { replace?: boolean }) => void {
  const [, setSearchParams] = useSearchParams();
  return useCallback(
    (patch, opts) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(patch)) {
            if (value == null || value === "") next.delete(key);
            else next.set(key, String(value));
          }
          return next;
        },
        { replace: opts?.replace ?? false },
      );
    },
    [setSearchParams],
  );
}

/** One URL key as state: `[value | null, set]`. `set(null)` removes the key. */
export function useMetricsParam(
  key: string,
): [string | null, (next: string | number | null | undefined, opts?: { replace?: boolean }) => void] {
  const [searchParams] = useSearchParams();
  const patch = useMetricsParams();
  const set = useCallback(
    (next: string | number | null | undefined, opts?: { replace?: boolean }) => patch({ [key]: next }, opts),
    [key, patch],
  );
  return [searchParams.get(key), set];
}

export interface MeasureOption<T extends string> {
  id: T;
  label: string;
}

/** At most two options per card (Hick): a toggle, not a menu. */
export type MeasureOptions<T extends string> = readonly [MeasureOption<T>, MeasureOption<T>];

/** A card's measure choice in the URL as `m_<card>` (default stored as absent); body and MeasureToggle share it. */
export function useMeasure<T extends string>(card: string, options: MeasureOptions<T>, defaultId: T): [T, (next: T) => void] {
  const [raw, set] = useMetricsParam(`m_${card}`);
  const value = options.some((o) => o.id === raw) ? (raw as T) : defaultId;
  const setValue = useCallback((next: T) => set(next === defaultId ? null : next, { replace: true }), [set, defaultId]);
  return [value, setValue];
}

/** Card-header switch between two measures, for MetricsCard's `action` slot. */
export function MeasureToggle<T extends string>({
  card,
  options,
  defaultId,
  ariaLabel,
}: {
  card: string;
  options: MeasureOptions<T>;
  defaultId: T;
  ariaLabel: string;
}): ReactElement {
  const [value, setValue] = useMeasure(card, options, defaultId);
  return <SegmentedControl options={options} value={value} onChange={setValue} ariaLabel={ariaLabel} />;
}

/** Width of an element, live. Used to drop low-value table columns at narrow widths. */
export function useElementWidth<E extends HTMLElement>(): [RefObject<E | null>, number] {
  const ref = useRef<E | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = (): void => setWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/** True once `ref` comes within `rootMargin` of the viewport, and stays true. */
export function useNearViewport<E extends Element>(rootMargin = "200px"): [RefObject<E | null>, boolean] {
  const ref = useRef<E | null>(null);
  const [near, setNear] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    if (near) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (records) => {
        if (records.some((r) => r.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [near, rootMargin]);
  return [ref, near];
}

/** Mounts `children` only near the viewport so a below-the-fold card's request waits; a placeholder holds the space. */
export function LazyCard({
  children,
  minHeight = 240,
  rootMargin = "200px",
  placeholder,
  className,
}: {
  children: ReactNode;
  minHeight?: number;
  rootMargin?: string;
  placeholder?: ReactNode;
  className?: string;
}): ReactElement {
  const [ref, near] = useNearViewport<HTMLDivElement>(rootMargin);
  return (
    <div ref={ref} className={cn("min-w-0", className)} style={near ? undefined : { minHeight }}>
      {near
        ? children
        : (placeholder ?? (
            <div aria-hidden className="h-full rounded-xl border border-xyne-border-subtle bg-xyne-surface" style={{ minHeight }} />
          ))}
    </div>
  );
}

const DRILL_DECORATION: Record<Status, string> = {
  ok: "decoration-xyne-fg-muted",
  warn: "decoration-xyne-warning-fg",
  bad: "decoration-xyne-error-fg",
  na: "decoration-xyne-fg-muted",
  thin: "decoration-xyne-fg-muted",
};

/**
 * The clickable-number style: a count or rate that opens the sessions behind it; zero is inert.
 * `variant="inline"` sits inside a sentence: inherits text style, dotted underline, 28px pseudo-element hit area
 * (the container must not clip it).
 */
export function DrillCount({
  value,
  onClick,
  to,
  status = "ok",
  title,
  children,
  disabled = false,
  className,
  variant = "cell",
}: {
  value: number;
  onClick?: () => void;
  /** Router path instead of a handler (headline → Runs page). */
  to?: string;
  status?: Status;
  /** "Show the sessions where post-diff errored". */
  title: string;
  /** Display override, e.g. the percentage when the count sits beside it. Defaults to fmtInt(value). */
  children?: ReactNode;
  disabled?: boolean;
  className?: string;
  variant?: "cell" | "inline";
}): ReactElement {
  const inline = variant === "inline";
  if (value === 0) return inline ? <span className="tabular-nums">0</span> : <ZeroCell />;
  const body = inline ? (
    <>{children ?? fmtInt(value)}</>
  ) : (
    <>
      <StatusGlyph status={status} />
      {children ?? fmtInt(value)}
      <ChevronRight size={10} aria-hidden className="opacity-0 transition-opacity group-hover/drill:opacity-100" />
    </>
  );
  const cls = inline
    ? cn(
        // Inherits font and colour.
        "relative inline cursor-pointer rounded-sm p-0 tabular-nums underline decoration-dotted underline-offset-2",
        "hover:decoration-solid focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-xyne-border-strong",
        // px, not rem: the root size is 14px.
        "before:absolute before:-inset-x-[3px] before:top-1/2 before:h-[28px] before:-translate-y-1/2 before:content-['']",
        "disabled:cursor-default disabled:no-underline disabled:opacity-60",
        status === "warn" || status === "bad" ? statusText(status) : "decoration-current",
        status === "warn" || status === "bad" ? DRILL_DECORATION[status] : undefined,
        className,
      )
    : cn(
        "group/drill inline-flex min-h-[28px] items-center gap-0.5 rounded px-1.5 py-0.5 text-[13px] tabular-nums underline-offset-2 hover:bg-xyne-surface-subtle hover:underline disabled:cursor-default disabled:no-underline disabled:opacity-60",
        statusText(status),
        DRILL_DECORATION[status],
        className,
      );
  if (to && !disabled) {
    return (
      <Link to={to} title={title} onClick={(e) => e.stopPropagation()} className={cls}>
        {body}
      </Link>
    );
  }
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onClick?.();
      }}
      className={cls}
    >
      {body}
    </button>
  );
}

const SERVER_LABELS: Record<string, string> = {
  "xyne-spaces": "Xyne Spaces",
  xyne_spaces: "Xyne Spaces",
  "xyne-spaces-app-tools": "Spaces apps",
  github: "GitHub",
  gitlab: "GitLab",
  google: "Google",
  jira: "Jira",
  slack: "Slack",
  builtin: "Built-in",
  "built-in": "Built-in",
};

function titleCase(slug: string): string {
  return slug
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** `server__tool` → server + tool; no `__` = claw built-in; a repeated server prefix in the tool part is dropped. */
export function splitToolName(name: string): { server: string | null; serverLabel: string; tool: string } {
  const at = name.indexOf("__");
  if (at <= 0) return { server: null, serverLabel: "Built-in", tool: name };
  const server = name.slice(0, at);
  let tool = name.slice(at + 2);
  const lower = server.toLowerCase();
  for (const sep of ["_", "-"]) {
    if (tool.toLowerCase().startsWith(lower + sep) && tool.length > lower.length + 1) {
      tool = tool.slice(lower.length + 1);
      break;
    }
  }
  return { server, serverLabel: SERVER_LABELS[lower] ?? titleCase(server), tool };
}

/** Muted server chip + mono tool name; the full runtime name is the tooltip. */
export function ToolName({
  name,
  showServer = true,
  className,
}: {
  name: string;
  showServer?: boolean;
  className?: string;
}): ReactElement {
  const { serverLabel, tool } = splitToolName(name);
  return (
    <span className={cn("flex min-w-0 items-center gap-1.5", className)} title={name}>
      {showServer && (
        <span className="shrink-0 whitespace-nowrap rounded bg-xyne-surface-subtle px-1.5 py-px text-[10px] font-medium text-xyne-fg-tertiary">
          {serverLabel}
        </span>
      )}
      <span className="min-w-0 truncate font-mono text-[12px] font-medium text-xyne-fg-primary">{tool}</span>
    </span>
  );
}

/** Recovered share of errored calls: no errors → "—", under 5 → "1 of 2" muted, else the rate. `onDrill` opens the sessions. */
export function RecoveryCell({
  recovered,
  errors,
  onDrill,
  row = true,
}: {
  recovered: number;
  errors: number;
  onDrill?: () => void;
  /** Per-tool row (default) or a window-wide figure; both use the recovery floor today. */
  row?: boolean;
}): ReactElement {
  if (errors <= 0) return <Unknown why="No errored calls to recover from" />;
  const floor = floorFor("toolRecovery", { row });
  if (errors < floor) {
    return (
      <span
        className="cursor-help tabular-nums text-xyne-fg-muted"
        title={`Only ${fmtInt(errors)} errored ${plural(errors, "call")}: too few to judge recovery (needs ${floor}+)`}
      >
        {fmtInt(recovered)} of {fmtInt(errors)}
      </span>
    );
  }
  const rate = recovered / errors;
  const status = statusFor("toolRecovery", rate, errors, { row });
  const pct = fmtPct(rate);
  return (
    <span className="inline-flex items-center justify-end gap-1.5 tabular-nums">
      {onDrill && recovered > 0 ? (
        <DrillCount value={recovered} onClick={onDrill} status={status} title={`Show the sessions that recovered (${fmtInt(recovered)} calls)`}>
          {pct}
        </DrillCount>
      ) : (
        <StatusValue status={status}>{pct}</StatusValue>
      )}
      <span className="text-[12px] text-xyne-fg-muted">
        {fmtInt(recovered)}/{fmtInt(errors)}
      </span>
    </span>
  );
}

export interface CursorPagerState {
  /** Cursor for the current page; undefined on page 1. */
  cursor: string | undefined;
  page: number;
  older: (nextCursor: string) => void;
  newer: () => void;
  reset: () => void;
}

/** The cursor stack behind CursorPager; not in the URL (a cursor is valid only for its filter); `resetKey` resets it. */
export function useCursorPager(resetKey: string): CursorPagerState {
  const [stack, setStack] = useState<{ key: string; cursors: string[] }>({ key: resetKey, cursors: [] });
  const cursors = stack.key === resetKey ? stack.cursors : [];
  const older = useCallback((next: string) => setStack({ key: resetKey, cursors: [...cursors, next] }), [resetKey, cursors]);
  const newer = useCallback(() => setStack({ key: resetKey, cursors: cursors.slice(0, -1) }), [resetKey, cursors]);
  const reset = useCallback(() => setStack({ key: resetKey, cursors: [] }), [resetKey]);
  return { cursor: cursors[cursors.length - 1], page: cursors.length + 1, older, newer, reset };
}

/** ‹ Newer · Page 2 · Older ›. Hidden on a single page. */
export function CursorPager({
  page,
  hasMore,
  onNewer,
  onOlder,
  onOlderIntent,
  busy = false,
  className,
}: {
  page: number;
  hasMore: boolean;
  onNewer: () => void;
  onOlder: () => void;
  /** Pointer over or focus on "Older": the moment to warm the next page. */
  onOlderIntent?: () => void;
  busy?: boolean;
  className?: string;
}): ReactElement | null {
  if (page <= 1 && !hasMore) return null;
  const button =
    "inline-flex h-7 items-center gap-1 rounded-md border border-xyne-border px-2.5 text-[12px] font-medium text-xyne-fg-primary hover:enabled:bg-xyne-surface-subtle disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      <span className="text-[12px] tabular-nums text-xyne-fg-muted">Page {fmtInt(page)}</span>
      <div className="flex items-center gap-1.5">
        <button type="button" className={button} disabled={busy || page <= 1} onClick={onNewer}>
          <ChevronLeft size={13} aria-hidden />
          Newer
        </button>
        <button
          type="button"
          className={button}
          disabled={busy || !hasMore}
          onClick={onOlder}
          onPointerEnter={onOlderIntent}
          onFocus={onOlderIntent}
        >
          Older
          <ChevronRight size={13} aria-hidden />
        </button>
      </div>
    </div>
  );
}

/** Where a session row links: its conversation, or the Runs page searched to it; null for a restricted row. */
export function sessionHref(row: MetricSessionRow): string | null {
  if (row.restricted) return null;
  const replay = runReplayPath(row, { allRuns: !isCurrentUser(row.userId) });
  if (replay) return `${replay}&${new URLSearchParams({ debug: row.sessionId }).toString()}`;
  return `/v3/runs?${new URLSearchParams({ session: row.sessionId }).toString()}`;
}

const PRIVATE_TASK = "Private run";

/** A metrics row in the shape RunRow renders. The backend's plain strings are narrowed here. */
export function toRunListItem(row: MetricSessionRow): AgentRunListItem {
  return {
    id: row.id,
    sessionId: row.sessionId,
    userId: row.userId,
    agentSlug: row.agentSlug,
    triggerSource: row.triggerSource as AgentRunListItem["triggerSource"],
    status: row.status as AgentRunListItem["status"],
    task: row.restricted ? PRIVATE_TASK : (row.task ?? ""),
    conversationId: row.restricted ? null : row.conversationId,
    channelId: row.channelId,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    tokensIn: row.tokensIn,
    tokensOut: row.tokensOut,
    rating: row.rating === "up" || row.rating === "down" ? row.rating : null,
    userName: row.userName,
    userEmail: row.userEmail,
  };
}

/** Signal → which per-run figure it reads and how its pill looks. Fixed order so the eye finds the same slot. */
const SIGNAL_PILLS: ReadonlyArray<{
  signal: ToolSignal;
  field: "e" | "rec" | "unrec" | "d" | "dup" | "z" | "ci";
  label: string;
  icon: LucideIcon;
  tone: string;
}> = [
  { signal: "errors", field: "e", label: "errored", icon: CircleX, tone: "text-xyne-error-fg" },
  { signal: "recovered", field: "rec", label: "recovered", icon: RotateCcw, tone: "text-xyne-success-fg" },
  { signal: "unrecovered", field: "unrec", label: "not recovered", icon: CircleX, tone: "text-xyne-error-fg" },
  { signal: "dropped", field: "d", label: "dropped", icon: Unplug, tone: "text-xyne-warning-fg" },
  { signal: "duplicates", field: "dup", label: "duplicate", icon: Copy, tone: "text-xyne-fg-secondary" },
  { signal: "empty", field: "z", label: "empty", icon: CircleSlash, tone: "text-xyne-fg-secondary" },
  { signal: "cited", field: "ci", label: "cited", icon: Quote, tone: "text-xyne-fg-secondary" },
];

const ERROR_SIGNALS: ReadonlySet<ToolSignal | undefined> = new Set<ToolSignal | undefined>(["errors", "recovered", "unrecovered", "notFound"]);

/** Clamped mono sample that expands in place. Stops the click from following the row link. */
function SampleBlock({ text, danger = true }: { text: string; danger?: boolean }): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <button
      type="button"
      title={open ? "Collapse" : "Show the full sample"}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOpen((v) => !v);
      }}
      className={cn(
        "mt-1 block w-full whitespace-pre-wrap break-words rounded bg-xyne-surface-sunken px-2 py-1 text-left font-mono text-[11px] leading-[15px]",
        danger ? "text-xyne-error-fg" : "text-xyne-fg-secondary",
        !open && "line-clamp-2",
      )}
    >
      {text}
    </button>
  );
}

function ToolFooter({ row, signal }: { row: MetricSessionRow; signal: ToolSignal | undefined }): ReactElement | null {
  const t = row.tool;
  if (!t) return null;
  const pills = SIGNAL_PILLS.filter((p) => t[p.field] > 0 && !(p.field === "unrec" && signal !== "unrecovered"));
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
        {pills.map((p) => {
          const Icon = p.icon;
          const active = p.signal === signal;
          return (
            <span
              key={p.signal}
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-1.5 py-px tabular-nums",
                p.tone,
                active ? "font-semibold ring-1 ring-current" : "font-normal",
              )}
            >
              <Icon size={11} aria-hidden />
              {p.field === "dup" || p.field === "z" || p.field === "ci"
                ? t[p.field] === 1
                  ? p.label
                  : `${fmtInt(t[p.field])} ${p.label}`
                : `${fmtInt(t[p.field])} ${p.label}`}
            </span>
          );
        })}
        <span className="text-xyne-fg-muted tabular-nums">
          of {fmtInt(t.c)} {plural(t.c, "call")}
          {t.ms > 0 ? ` · ${fmtMs(t.ms)} in tool` : ""}
        </span>
      </div>
      {row.sample && ERROR_SIGNALS.has(signal) && <SampleBlock text={row.sample} />}
    </div>
  );
}

function SlowFooter({ row }: { row: MetricSessionRow }): ReactElement | null {
  const split = row.split;
  const total = split?.totalMs ?? row.durationMs ?? row.totalMs;
  if (!split || total == null) return null;
  const llm = split.llmMs ?? 0;
  const tools = split.toolMs ?? 0;
  const other = Math.max(0, total - llm - tools);
  const parts = [
    { key: "llm", value: llm, color: VIZ.accent, label: "model" },
    { key: "tools", value: tools, color: VIZ.neutral, label: "tools" },
    { key: "other", value: other, color: VIZ.track, label: "other" },
  ].filter((p) => p.value > 0);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div role="img" aria-label="Where this run's time went" className="flex h-1.5 w-full max-w-[320px] gap-[2px] overflow-hidden rounded-full">
        {parts.map((p) => (
          <span key={p.key} title={`${p.label}: ${fmtMs(p.value)}`} className="h-full min-w-[2px]" style={{ flexGrow: p.value, flexBasis: 0, backgroundColor: p.color }} />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-xyne-fg-muted tabular-nums">
        <span className="font-semibold text-xyne-fg-primary">{fmtMs(total)} total</span>
        {split.llmMs != null && <span>· model {fmtMs(split.llmMs)}</span>}
        {split.toolMs != null && <span>· tools {fmtMs(split.toolMs)}</span>}
        {split.topTools.slice(0, 3).map((t) => (
          <span
            key={t.tool}
            title={`${t.tool}: ${fmtInt(t.calls)} ${plural(t.calls, "call")}${t.errored ? ", errored" : ""}`}
            className={cn("rounded bg-xyne-surface-subtle px-1.5 py-px font-mono", t.errored && "text-xyne-error-fg")}
          >
            {splitToolName(t.tool).tool} {fmtMs(t.ms)}
          </span>
        ))}
      </div>
    </div>
  );
}

function ModelFooter({ row }: { row: MetricSessionRow }): ReactElement | null {
  const m = row.model;
  if (!m) return null;
  if (m.calls === 0) return <span className="text-[11px] text-xyne-fg-muted">No per-call timing recorded</span>;
  return (
    <span className="text-[11px] tabular-nums text-xyne-fg-muted">
      {fmtInt(m.calls)} {plural(m.calls, "call")} · first token max {fmtMs(m.ttftMaxMs)} · context max {fmtTokens(m.ctxMax)} tok ·{" "}
      <span className={cn(m.retries > 0 && "text-xyne-warning-fg")}>
        {fmtInt(m.retries)} {plural(m.retries, "retry", "retries")}
      </span>
      {m.errorStops > 0 && (
        <span className="text-xyne-error-fg">
          {" "}
          · {fmtInt(m.errorStops)} error {plural(m.errorStops, "stop")}
        </span>
      )}
    </span>
  );
}

function SessionFooter({ row, request }: { row: MetricSessionRow; request: SessionsListProps["request"] }): ReactElement | null {
  if (row.restricted) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-xyne-fg-muted">
        <Lock size={11} aria-label="Private run" />
        Used the owner's personal credentials; details hidden
      </span>
    );
  }
  switch (request.kind) {
    case "tool":
      return <ToolFooter row={row} signal={request.signal} />;
    case "failed":
      return row.error ? <SampleBlock text={row.error.split("\n")[0] ?? row.error} /> : null;
    case "slow":
      return <SlowFooter row={row} />;
    case "model":
      return <ModelFooter row={row} />;
    default:
      return null;
  }
}

/** Viewport y of the nearest scrolling ancestor's visible top, plus the element's scroll-margin-top. */
function scrollParentTop(el: HTMLElement): number {
  const margin = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
  for (let node = el.parentElement; node; node = node.parentElement) {
    const oy = getComputedStyle(node).overflowY;
    if ((oy === "auto" || oy === "scroll") && node.scrollHeight > node.clientHeight) {
      return node.getBoundingClientRect().top + margin;
    }
  }
  return margin;
}

export interface SessionsListProps {
  scope: MetricsScopeParams;
  /** What to list. limit/cursor/count are managed here. */
  request: Omit<MetricSessionsRequest, "limit" | "cursor" | "count">;
  limit?: number;
  /** Completes the caption "Showing 1–25 of 64 sessions where …", e.g. <><code>post-diff</code> errored</>. */
  subject: ReactNode;
  /** Optional calls figure for the caption ("· 92 errored calls") — the table cell counts calls, the list counts sessions. */
  calls?: { value: number; noun: string };
  /** Sessions the source counts say exist; with rows expected but none returned, the empty state blames missing summaries. */
  expected?: number;
  /** Offered as "Widen to 30 days" in the empty state when the range is shorter. */
  onWiden?: () => void;
  backfill?: ReactNode;
  /** Owner names on each row (admin, cross-user scope). Defaults to scope.isAdmin. */
  showOwner?: boolean;
  enabled?: boolean;
}

/** The drill-down list behind every clickable number: RunRow per session, cursor paging, total caption. */
export function SessionsList({
  scope,
  request,
  limit = 25,
  subject,
  calls,
  expected,
  onWiden,
  backfill,
  showOwner,
  enabled = true,
}: SessionsListProps): ReactElement {
  const filterKey = JSON.stringify([request, limit, scope.days, scope.orgScope, scope.agentSlugs, scope.userId]);
  const pager = useCursorPager(filterKey);
  const pageRequest: MetricSessionsRequest = {
    ...request,
    limit,
    ...(pager.cursor ? { cursor: pager.cursor } : { count: true }),
  };
  const state = useMetricSessions(scope, pageRequest, { enabled });
  const data = state.data;

  // Page 1 carries the total; keep it while paging deeper.
  const totalRef = useRef<{ key: string; total: MetricSessionsResponse["total"] }>({ key: "", total: null });
  if (!state.isPlaceholder && data && pager.page === 1) totalRef.current = { key: filterKey, total: data.total };
  const total = totalRef.current.key === filterKey ? totalRef.current.total : null;

  // A cursor the server no longer accepts: restart quietly at page 1.
  const { errorStatus } = state;
  const resetPager = pager.reset;
  useEffect(() => {
    if (errorStatus === 400 && pager.page > 1) resetPager();
  }, [errorStatus, pager.page, resetPager]);

  // Warm the next page on intent (hover or focus on "Older"), not on load.
  const nextCursor = !state.isPlaceholder && data?.page.hasMore ? data.page.nextCursor : null;
  const prefetchNext = (): void => {
    if (enabled && nextCursor) prefetchMetricSessions(scope, { ...request, limit, cursor: nextCursor });
  };

  // After a page change, bring the caption back into view if it scrolled above its container; never scroll down.
  const captionRef = useRef<HTMLParagraphElement>(null);
  const shownPage = useRef(pager.page);
  useEffect(() => {
    if (shownPage.current === pager.page) return;
    shownPage.current = pager.page;
    const caption = captionRef.current;
    if (!caption) return;
    const top = caption.getBoundingClientRect().top;
    const viewTop = scrollParentTop(caption);
    if (top < viewTop) caption.scrollIntoView({ block: "start" });
  }, [pager.page]);

  const owner = showOwner ?? scope.isAdmin;
  const header = (rows: number): ReactNode => {
    const start = (pager.page - 1) * limit + 1;
    const end = start + rows - 1;
    const totalText = total
      ? `${total.capped ? `${fmtInt(total.value)}+` : fmtInt(total.value)} ${plural(total.value, "session")}`
      : data?.page.hasMore
        ? `${fmtInt(end + 1)}+ sessions`
        : `${fmtInt(end)} ${plural(end, "session")}`;
    return (
      <p
        ref={captionRef}
        className="text-[12px] tabular-nums text-xyne-fg-muted"
        // Below the page's sticky bars when the list scrolls with the page; 0 in the drawer.
        style={{ scrollMarginTop: "calc(var(--metrics-sticky-offset, 0px) + 12px)" }}
      >
        Showing {fmtInt(start)}–{fmtInt(end)} of {totalText} where {subject}
        {calls && calls.value > 0 && (
          <>
            {" "}
            · {fmtInt(calls.value)} {calls.noun}
          </>
        )}
      </p>
    );
  };

  const coverage = data?.coverage;
  const uncovered = coverage && coverage.runsInWindow > 0 ? 1 - coverage.runsSummarised / coverage.runsInWindow : 0;
  const coverageNote =
    coverage && request.kind === "tool" ? (
      <CoverageBanner
        tone="neutral"
        coverage={coverage.runsInWindow > 0 ? coverage.runsSummarised / coverage.runsInWindow : null}
        covered={coverage.runsSummarised}
        total={coverage.runsInWindow}
        verb="have tool stats"
        action={backfill}
      />
    ) : null;

  if (state.error && !(errorStatus === 400 && pager.page > 1)) {
    return <PanelError error={state.error} onRetry={state.refetch} />;
  }
  if (!data) return <RowsSkeleton />;

  const rows = data.rows;
  if (rows.length === 0 && !state.isPlaceholder) {
    const gap = expected !== undefined && expected > 0;
    return (
      <div className="flex flex-col gap-3">
        {coverageNote}
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-xyne-border px-6 py-8 text-center">
          <SearchX size={18} className="text-xyne-fg-muted" aria-hidden />
          {gap ? (
            <p className="max-w-[60ch] text-[13px] text-xyne-fg-primary">
              No sessions found for this signal.
              {uncovered > 0 && (
                <span className="text-xyne-fg-muted"> {fmtPct(uncovered)} of runs in this window have no tool summary yet.</span>
              )}
            </p>
          ) : (
            <p className="max-w-[60ch] text-[13px] text-xyne-fg-primary">No sessions in this window where {subject}.</p>
          )}
          {gap && backfill}
          {!gap && onWiden && scope.days < 30 && (
            <button type="button" onClick={onWiden} className="text-[12px] font-medium text-xyne-fg-muted underline-offset-2 hover:text-xyne-fg-primary hover:underline">
              Widen to 30 days
            </button>
          )}
        </div>
      </div>
    );
  }

  const switching = state.isPlaceholder || state.loading;
  return (
    <div className="flex flex-col gap-3">
      {coverageNote}
      {header(rows.length)}
      <ul className={cn("flex flex-col gap-2 transition-opacity duration-150", switching && "opacity-60")} aria-busy={switching || undefined}>
        {rows.map((row) => {
          const href = sessionHref(row);
          return (
            <li key={row.id}>
              <RunRow
                run={toRunListItem(row)}
                showOwner={owner}
                agentLabel={row.agentSlug}
                href={href ?? undefined}
                footer={<SessionFooter row={row} request={request} />}
              />
            </li>
          );
        })}
      </ul>
      <CursorPager
        page={pager.page}
        hasMore={data.page.hasMore && !state.isPlaceholder}
        busy={switching}
        onNewer={pager.newer}
        onOlder={() => {
          if (data.page.nextCursor) pager.older(data.page.nextCursor);
        }}
        onOlderIntent={prefetchNext}
      />
    </div>
  );
}
