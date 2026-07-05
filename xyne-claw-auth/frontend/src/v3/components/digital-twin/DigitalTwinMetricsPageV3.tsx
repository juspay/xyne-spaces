import { useState, useEffect, useCallback } from "react";
import {
  ChartLineUpIcon,
  ArrowClockwiseIcon,
  SpinnerGapIcon,
  ArrowLeftIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  ArrowRightIcon,
  WarningIcon,
  ClockIcon,
  CloudArrowUpIcon,
  ArrowsCounterClockwiseIcon,
} from "@phosphor-icons/react";
import { getDigitalTwinMetrics, type DigitalTwinMetrics, type DigitalTwinSubsystemMetric, type DigitalTwinSourceMetric } from "../../../lib/api";
import { SUBSYSTEM_LABELS } from "./ProposalModal";

interface Props {
  userId: string;
  onBack?: () => void;
}

type DayFilter = 7 | 30 | 90 | null;

const DAY_OPTIONS: { label: string; value: DayFilter }[] = [
  { label: "7d",  value: 7 },
  { label: "30d", value: 30 },
  { label: "90d", value: 90 },
  { label: "All", value: null },
];

const SOURCE_LABELS: Record<string, { label: string; icon: React.ReactNode }> = {
  daily:    { label: "Daily curator",   icon: <ClockIcon size={13} className="text-xyne-fg-muted" /> },
  upload:   { label: "Manual upload",   icon: <CloudArrowUpIcon size={13} className="text-xyne-fg-muted" /> },
  backfill: { label: "Backfill",        icon: <ArrowsCounterClockwiseIcon size={13} className="text-xyne-fg-muted" /> },
};


// ── Subsystem colors ─────────────────────────────────────────────────────────

const SUBSYSTEM_COLORS: Record<string, string> = {
  style:         "#6366f1",
  expertise:     "#22863a",
  projects:      "#f59e0b",
  relationships: "#ec4899",
  preferences:   "#14b8a6",
  decisions:     "#8b5cf6",
  context:       "#f97316",
  docs:          "#64748b",
};

// ── Donut chart — large, label-outside style ─────────────────────────────────

type DonutSlice = { key: string; label: string; value: number; color: string };

function DonutChart({ slices, total, statusLabel }: { slices: DonutSlice[]; total: number; statusLabel: string }) {
  const [hovered, setHovered] = useState<string | null>(null);

  // Canvas dimensions — extra horizontal room for callout labels
  const W = 780, H = 480;
  const cx = W / 2, cy = H / 2;
  const Ro = 148, Ri = 88;   // outer / inner radius
  const lineR  = Ro + 14;    // leader starts just outside slice
  const elbowR = Ro + 52;    // leader bends here
  const TICK   = 30;         // horizontal tick to text

  if (total === 0) {
    return (
      <div className="flex h-[260px] items-center justify-center text-[13px] text-xyne-fg-muted">
        No data for this status
      </div>
    );
  }

  const cos = Math.cos, sin = Math.sin;
  let angle = -Math.PI / 2;

  const drawn = slices.filter((s) => s.value > 0).map((s) => {
    const sweep = (s.value / total) * 2 * Math.PI;
    const sa = angle, ea = angle + sweep;
    const mid = sa + sweep / 2;
    angle = ea;
    const large = sweep > Math.PI ? 1 : 0;

    const d = [
      `M${cx + Ro*cos(sa)},${cy + Ro*sin(sa)}`,
      `A${Ro},${Ro} 0 ${large},1 ${cx + Ro*cos(ea)},${cy + Ro*sin(ea)}`,
      `L${cx + Ri*cos(ea)},${cy + Ri*sin(ea)}`,
      `A${Ri},${Ri} 0 ${large},0 ${cx + Ri*cos(sa)},${cy + Ri*sin(sa)}`,
      "Z",
    ].join(" ");

    // Leader line: radial out → elbow → horizontal tick
    const lx1 = cx + lineR  * cos(mid), ly1 = cy + lineR  * sin(mid);
    const lx2 = cx + elbowR * cos(mid), ly2 = cy + elbowR * sin(mid);
    const isRight = cos(mid) >= 0;
    const lx3 = lx2 + (isRight ? TICK : -TICK), ly3 = ly2;
    const textX = lx3 + (isRight ? 6 : -6);
    const pct = Math.round((s.value / total) * 100);

    return {
      ...s, d, mid, pct,
      leader: `${lx1},${ly1} ${lx2},${ly2} ${lx3},${ly3}`,
      textX, textY: ly3,
      anchor: (isRight ? "start" : "end") as "start" | "end",
    };
  });

  const active = hovered ? drawn.find((d) => d.key === hovered) : null;

  return (
    <div className="text-xyne-fg-primary h-full w-full">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" style={{ overflow: "visible" }}>
        {drawn.map((s) => {
          const dim = !!(hovered && hovered !== s.key);
          return (
            <g
              key={s.key}
              style={{ cursor: "pointer" }}
              onMouseEnter={() => setHovered(s.key)}
              onMouseLeave={() => setHovered(null)}
            >
              <path
                d={s.d}
                fill={s.color}
                stroke="white"
                strokeWidth={2}
                opacity={dim ? 0.2 : 1}
                style={{ transition: "opacity 0.2s" }}
              />
              <polyline
                points={s.leader}
                fill="none"
                stroke={s.color}
                strokeWidth={1.5}
                opacity={dim ? 0.08 : 0.7}
                style={{ transition: "opacity 0.2s" }}
              />
              <text
                x={s.textX} y={s.textY - 8}
                textAnchor={s.anchor}
                fontSize={13} fontWeight="600"
                fill="currentColor"
                opacity={dim ? 0.2 : 1}
                style={{ transition: "opacity 0.2s" }}
              >
                {s.label}
              </text>
              <text
                x={s.textX} y={s.textY + 9}
                textAnchor={s.anchor}
                fontSize={11}
                fill="currentColor"
                opacity={dim ? 0.1 : 0.45}
                style={{ transition: "opacity 0.2s" }}
              >
                {s.pct}% · {s.value} {statusLabel}
              </text>
            </g>
          );
        })}

        {/* Center */}
        {active ? (
          <>
            <text x={cx} y={cy - 10} textAnchor="middle" fontSize={44} fontWeight="800" fill="currentColor">{active.value}</text>
            <text x={cx} y={cy + 16} textAnchor="middle" fontSize={11} fontWeight="600" letterSpacing="2" fill="currentColor" opacity="0.4">{active.pct}%</text>
          </>
        ) : (
          <>
            <text x={cx} y={cy - 10} textAnchor="middle" fontSize={52} fontWeight="800" fill="currentColor">{total}</text>
            <text x={cx} y={cy + 18} textAnchor="middle" fontSize={10} fontWeight="600" letterSpacing="2" fill="currentColor" opacity="0.35">{statusLabel.toUpperCase()}</text>
            <text x={cx} y={cy + 34} textAnchor="middle" fontSize={10} fill="currentColor" opacity="0.25">{drawn.length} subsystems</text>
          </>
        )}
      </svg>
    </div>
  );
}

// ── Donut card ───────────────────────────────────────────────────────────────

type DonutStatus = "approved" | "rejected" | "pending";

function SubsystemDonutCard({ subsystems }: { subsystems: DigitalTwinSubsystemMetric[] }) {
  const [status, setStatus] = useState<DonutStatus>("approved");

  const TABS: { key: DonutStatus; label: string }[] = [
    { key: "approved", label: "Approved" },
    { key: "rejected", label: "Rejected" },
    { key: "pending",  label: "Pending" },
  ];

  const slices: DonutSlice[] = subsystems
    .map((s) => ({
      key: s.subsystem,
      label: SUBSYSTEM_LABELS[s.subsystem] ?? s.subsystem,
      value: s[status],
      color: SUBSYSTEM_COLORS[s.subsystem] ?? "#94a3b8",
    }))
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value);

  const total = slices.reduce((sum, s) => sum + s.value, 0);
  const statusLabel = status;

  return (
    <div className="flex h-full flex-col">
      {/* Toggle — floats at top, centred */}
      <div className="flex shrink-0 items-center justify-center gap-[2px] pt-[16px]">
        <div className="flex items-center gap-[2px] rounded-lg border border-xyne-border bg-xyne-surface-sunken p-[2px]">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setStatus(t.key)}
              className={`rounded-md px-[14px] py-[4px] text-[12px] font-medium transition ${
                status === t.key
                  ? "bg-xyne-surface shadow-sm text-xyne-fg-primary"
                  : "text-xyne-fg-muted hover:text-xyne-fg-primary"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {/* Chart — takes all remaining height */}
      <div className="min-h-0 flex-1">
        <DonutChart slices={slices} total={total} statusLabel={statusLabel} />
      </div>
    </div>
  );
}

// ── Source row ───────────────────────────────────────────────────────────────

function SourceRow({ row }: { row: DigitalTwinSourceMetric }) {
  const reviewed = row.approved + row.rejected;
  const rate = reviewed > 0 ? Math.round((row.approved / reviewed) * 100) : null;
  const meta = SOURCE_LABELS[row.source];

  return (
    <div className="flex items-center gap-[10px]">
      {meta?.icon}
      <span className="w-[110px] shrink-0 text-[12px] text-xyne-fg-secondary">{meta?.label ?? row.source}</span>
      <div className="flex h-[6px] flex-1 overflow-hidden rounded-full bg-xyne-surface-sunken">
        {rate !== null && (
          <div className="bg-xyne-success-fg transition-all" style={{ width: `${rate}%` }} />
        )}
      </div>
      <span className="w-[30px] text-right text-[12px] font-semibold text-xyne-fg-primary">
        {rate !== null ? `${rate}%` : "—"}
      </span>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function DigitalTwinMetricsPageV3({ userId, onBack }: Props) {
  const [metrics, setMetrics] = useState<DigitalTwinMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState<DayFilter>(30);

  const load = useCallback(async (d: DayFilter) => {
    setLoading(true);
    setError(null);
    try {
      setMetrics(await getDigitalTwinMetrics(userId, d ?? undefined));
    } catch {
      setError("Failed to load metrics");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { void load(days); }, [load, days]);

  const sortedSubsystems = metrics?.bySubsystem
    .slice()
    .sort((a, b) => {
      const rA = a.approved + a.rejected, rB = b.approved + b.rejected;
      return (rB > 0 ? b.approved / rB : -1) - (rA > 0 ? a.approved / rA : -1);
    }) ?? [];

  const sortedSources = metrics?.bySource
    .slice()
    .sort((a, b) => {
      const rA = a.approved + a.rejected, rB = b.approved + b.rejected;
      return (rB > 0 ? b.approved / rB : -1) - (rA > 0 ? a.approved / rA : -1);
    }) ?? [];

  const approvalNarrative = (rate: number | null, prev: number | null) => {
    if (rate === null) return undefined;
    if (prev !== null && rate > prev) return "Rising. You're accepting more of what the Twin suggests — it's learning your voice.";
    if (prev !== null && rate < prev) return "Falling. The Twin may need more context, or your preferences have shifted.";
    return "Stable. The Twin is consistently matching your expectations.";
  };

  const editNarrative = (rate: number | null, prev: number | null) => {
    if (rate === null) return undefined;
    if (prev !== null && rate < prev) return "Falling — good. Fewer proposals need wording fixes. The Twin is getting calibrated.";
    if (prev !== null && rate > prev) return "Rising. More proposals are needing edits before approval.";
    return rate < 20 ? "Low — the Twin's wording is landing well." : "Moderate. Some proposals still need light editing.";
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* ── Header ── */}
      <div className="shrink-0 border-b border-xyne-border bg-xyne-surface">
        <div className="flex items-center gap-[12px] px-[24px] py-[14px]">
          <ChartLineUpIcon size={20} className="text-xyne-brand" />
          <div>
            <h1 className="text-[15px] font-semibold text-xyne-fg-primary">Twin Metrics</h1>
            <p className="text-[12px] text-xyne-fg-secondary">
              How well your Digital Twin understands you — and whether it's improving
            </p>
          </div>
          <div className="ml-auto flex items-center gap-[4px]">
            {onBack && (
              <button
                onClick={onBack}
                className="mr-[8px] flex items-center gap-[6px] rounded-lg border border-xyne-border bg-xyne-surface px-[10px] py-[5px] text-[12px] font-medium text-xyne-fg-secondary shadow-sm transition hover:bg-xyne-surface-sunken hover:text-xyne-fg-primary"
              >
                <ArrowLeftIcon size={13} />
                Overview
              </button>
            )}
            {DAY_OPTIONS.map((opt) => (
              <button
                key={opt.label}
                onClick={() => setDays(opt.value)}
                className={`rounded-md px-[10px] py-[4px] text-[12px] font-medium transition ${
                  days === opt.value
                    ? "bg-xyne-fg-primary text-xyne-fg-inverse"
                    : "text-xyne-fg-muted hover:bg-xyne-surface-sunken hover:text-xyne-fg-primary"
                }`}
              >
                {opt.label}
              </button>
            ))}
            <button
              onClick={() => void load(days)}
              disabled={loading}
              className="ml-[8px] flex h-[28px] w-[28px] items-center justify-center rounded-md text-xyne-fg-muted transition hover:bg-xyne-surface-sunken hover:text-xyne-fg-primary disabled:opacity-40"
              aria-label="Refresh"
            >
              {loading
                ? <SpinnerGapIcon size={14} className="animate-spin" />
                : <ArrowClockwiseIcon size={14} />}
            </button>
          </div>
        </div>
      </div>

      {/* ── Body: two-column split ── */}
      {loading && !metrics && (
        <div className="flex flex-1 items-center justify-center">
          <SpinnerGapIcon size={22} className="animate-spin text-xyne-fg-muted" />
        </div>
      )}

      {error && (
        <div className="m-[16px] rounded-lg border border-xyne-border bg-xyne-error-bg p-[12px] text-[12px] text-xyne-error-fg">
          {error}{" "}
          <button onClick={() => void load(days)} className="underline">Retry</button>
        </div>
      )}

      {metrics && metrics.total === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <ChartLineUpIcon size={32} className="mb-[8px] text-xyne-fg-muted" />
          <p className="text-[14px] font-medium text-xyne-fg-secondary">No candidates yet</p>
          <p className="mt-[4px] text-[12px] text-xyne-fg-tertiary">
            Metrics will appear once your Digital Twin starts generating memory candidates.
          </p>
        </div>
      )}

      {metrics && metrics.total > 0 && (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">

          {/* ── TOP: 3 cards, centred with even spacing ── */}
          <div className="shrink-0 border-b border-xyne-border">
            <div className="mx-auto flex w-full max-w-[1100px] items-stretch justify-evenly divide-x divide-xyne-border">

              {/* Approval rate */}
              <div className="flex flex-1 flex-col justify-between gap-[16px] px-[32px] py-[20px]">
                <p className="text-[12px] text-xyne-fg-muted">
                  approval rate
                  <span className="ml-[6px] text-xyne-fg-tertiary">· Can I trust what it proposes?</span>
                </p>
                <div>
                  <p className="text-[44px] font-bold leading-none tracking-tight text-xyne-fg-primary">
                    {metrics.approvalRate !== null ? `${metrics.approvalRate}%` : "—"}
                  </p>
                  {metrics.approvalRate !== null && metrics.previousApprovalRate !== null && (
                    <p className={`mt-[6px] flex items-center gap-[2px] text-[12px] font-medium ${metrics.approvalRate >= metrics.previousApprovalRate ? "text-xyne-success-fg" : "text-xyne-error-fg"}`}>
                      {metrics.approvalRate >= metrics.previousApprovalRate ? <ArrowUpIcon size={11} weight="bold" /> : <ArrowDownIcon size={11} weight="bold" />}
                      {Math.abs(metrics.approvalRate - metrics.previousApprovalRate)} pts vs prior period
                    </p>
                  )}
                </div>
              </div>

              {/* Edit rate */}
              <div className="flex flex-1 flex-col justify-between gap-[16px] px-[32px] py-[20px]">
                <p className="text-[12px] text-xyne-fg-muted">
                  edit rate
                  <span className="ml-[6px] text-xyne-fg-tertiary">· How often must I fix it?</span>
                </p>
                <div>
                  <p className="text-[44px] font-bold leading-none tracking-tight text-xyne-fg-primary">
                    {metrics.editRate !== null ? `${metrics.editRate}%` : "—"}
                  </p>
                  {metrics.editRate !== null && metrics.previousEditRate !== null && (
                    <p className={`mt-[6px] flex items-center gap-[2px] text-[12px] font-medium ${metrics.editRate <= metrics.previousEditRate ? "text-xyne-success-fg" : "text-xyne-error-fg"}`}>
                      {metrics.editRate <= metrics.previousEditRate ? <ArrowDownIcon size={11} weight="bold" /> : <ArrowUpIcon size={11} weight="bold" />}
                      {Math.abs(metrics.editRate - metrics.previousEditRate)} pts vs prior period
                    </p>
                  )}
                </div>
              </div>

              {/* Which intake to trust */}
              {sortedSources.length > 0 && (
                <div className="flex flex-1 flex-col justify-between gap-[16px] px-[32px] py-[20px]">
                  <div className="flex items-center justify-between">
                    <p className="text-[12px] text-xyne-fg-muted">which intake to trust</p>
                    <p className="text-[11px] text-xyne-fg-tertiary">approval rate by source</p>
                  </div>
                  <div className="flex flex-col gap-[10px]">
                    {sortedSources.map((row) => (
                      <SourceRow key={row.source} row={row} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── BOTTOM: donut chart with heading ── */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="shrink-0 px-[32px] pt-[20px] text-center">
              <h2 className="text-[14px] font-semibold text-xyne-fg-primary">Memory distribution by subsystem</h2>
              <p className="mt-[2px] text-[12px] text-xyne-fg-tertiary">
                How your memories spread across the 8 areas the Twin learns about you
              </p>
            </div>
            <div className="relative min-h-0 flex-1 overflow-hidden">
              {sortedSubsystems.length > 0 && (
                <SubsystemDonutCard subsystems={sortedSubsystems} />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
