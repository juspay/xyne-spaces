/**
 * SessionActivityChart — scatter-plot of sessions over the past 7 days.
 *
 * Ported from ControlCenterPage's ActivityTimeline, adapted for the home page:
 *   - Fixed 7-day window
 *   - Smaller SVG height (compact for the main content column)
 *   - Same dot semantics: each dot = one session, size = message count,
 *     Y = hour of day, X = date. Live sessions pulse.
 *   - Agent legend capped at 5 entries (space-constrained)
 */

import { useMemo, useState, useCallback } from "react";
// Chart consumes the lightweight projection — heavy fields (toolsUsed, task,
// etc.) are not selected by /runs/light. The hover panel degrades gracefully:
// `totalToolsUsed` becomes 0 and the task preview shows "—" when the field is
// absent, which is fine because the panel is rarely opened and we save 10s of
// MB on first paint.
import type { AgentRunLight as AgentRun } from "../../../lib/api";
import { Skeleton } from "../ui/Skeleton";
import { formatTimeAgo } from "./homeUtils";
import { SessionDetailPanel } from "./SessionDetailPanel";

/* ── helpers ──────────────────────────────────────────────────────────── */

interface Session {
  key: string;
  agentSlug: string;
  triggerSource: AgentRun["triggerSource"];
  runs: AgentRun[];
  latest: AgentRun;
  first: AgentRun;
  totalToolsUsed: number;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

const AGENT_COLORS = [
  "#00E5FF",
  "#00FF7F",
  "#FFD700",
  "#FF6B35",
  "#4D7CFF",
  "#FF6B9D",
  "#A78BFA",
  "#FF4D4D",
];

function colorForAgent(slug: string): string {
  let hash = 0;
  for (let i = 0; i < slug.length; i++) hash = (hash * 31 + slug.charCodeAt(i)) | 0;
  return AGENT_COLORS[Math.abs(hash) % AGENT_COLORS.length]!;
}

function sessionKeyFor(run: AgentRun): string {
  return run.conversationId && run.agentSlug
    ? `${run.conversationId}_${run.agentSlug}`
    : run.sessionId;
}

function groupBySession(runs: AgentRun[]): Session[] {
  const byKey = new Map<string, AgentRun[]>();
  for (const r of runs) {
    const k = sessionKeyFor(r);
    const list = byKey.get(k) ?? [];
    list.push(r);
    byKey.set(k, list);
  }
  const sessions: Session[] = [];
  for (const [key, list] of byKey) {
    const sorted = list
      .slice()
      .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
    const first = sorted[0]!;
    const latest = sorted[sorted.length - 1]!;
    // toolsUsed isn't in the lightweight row projection — keep the field for
    // type compatibility with SessionPanelData but always 0 here. The detail
    // panel re-fetches the full session when opened, so the count is correct
    // wherever it actually matters.
    const totalToolsUsed = 0;
    sessions.push({ key, agentSlug: latest.agentSlug, triggerSource: latest.triggerSource, runs: sorted, latest, first, totalToolsUsed });
  }
  return sessions.sort(
    (a, b) => new Date(b.latest.startedAt).getTime() - new Date(a.latest.startedAt).getTime(),
  );
}

/* ── component ────────────────────────────────────────────────────────── */

interface SessionActivityChartProps {
  runs: AgentRun[];
  isLoading: boolean;
  days: 1 | 7 | 30;
  onDaysChange: (d: 1 | 7 | 30) => void;
}

interface HoverState {
  session: Session;
  /** Client-space X position for tooltip anchor */
  clientX: number;
  /** Client-space Y position for tooltip anchor */
  clientY: number;
}

const W = 880;
const H = 200;
const PAD_L = 30;
const PAD_R = 12;
const PAD_T = 12;
const PAD_B = 28;

export function SessionActivityChart({ runs, isLoading, days, onDaysChange }: SessionActivityChartProps) {
  const [hover, setHover] = useState<HoverState | null>(null);
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);

  const openSession = useCallback((session: Session) => {
    setHover(null);
    setSelectedSession(session);
  }, []);

  const sessions = useMemo(() => groupBySession(runs), [runs]);

  const { yMin, yMax } = useMemo(() => {
    if (sessions.length === 0) return { yMin: 0, yMax: 24 };
    let min = 24, max = 0;
    for (const s of sessions) {
      const d = new Date(s.first.startedAt);
      const h = d.getHours() + d.getMinutes() / 60;
      if (h < min) min = h;
      if (h > max) max = h;
    }
    const pad = 1.5;
    const observedRange = max - min;
    if (observedRange >= 16) return { yMin: 0, yMax: 24 };
    return {
      yMin: Math.max(0, Math.floor(min - pad)),
      yMax: Math.min(24, Math.ceil(max + pad)),
    };
  }, [sessions]);
  const ySpan = yMax - yMin;

  const now = new Date();
  const end = startOfDay(now);
  end.setDate(end.getDate() + 1);
  const start = new Date(end);
  start.setDate(start.getDate() - days);

  const hourToY = (hour: number) =>
    PAD_T + ((yMax - hour) / ySpan) * (H - PAD_T - PAD_B);

  type RawPoint = { session: Session; dayIdx: number; y: number; radius: number };
  const raw: RawPoint[] = sessions
    .filter((s) => {
      const t = new Date(s.first.startedAt).getTime();
      return t >= start.getTime() && t < end.getTime();
    })
    .map((s) => {
      const d = new Date(s.first.startedAt);
      const dayIdx = Math.floor(
        (startOfDay(d).getTime() - start.getTime()) / 86_400_000,
      );
      const hour = d.getHours() + d.getMinutes() / 60;
      const y = hourToY(hour);
      const radius = Math.min(3 + Math.sqrt(s.runs.length) * 1.8, 8);
      return { session: s, dayIdx, y, radius };
    });

  const dayBuckets = new Map<number, RawPoint[]>();
  for (const p of raw) {
    const arr = dayBuckets.get(p.dayIdx) ?? [];
    arr.push(p);
    dayBuckets.set(p.dayIdx, arr);
  }
  for (const bucket of dayBuckets.values()) {
    bucket.sort((a, b) => a.y - b.y || a.session.key.localeCompare(b.session.key));
  }

  const plot = raw.map((p) => {
    const bucket = dayBuckets.get(p.dayIdx)!;
    const indexInBucket = bucket.indexOf(p);
    const dayCenter = PAD_L + ((p.dayIdx + 0.5) / days) * (W - PAD_L - PAD_R);
    const step = p.radius * 2 + 1;
    const offset =
      bucket.length > 1 ? (indexInBucket - (bucket.length - 1) / 2) * step : 0;
    const x = dayCenter + offset;
    return {
      session: p.session,
      x,
      y: p.y,
      radius: p.radius,
      color: colorForAgent(p.session.agentSlug),
      isLive: p.session.latest.status === "running",
    };
  });

  // Day-axis ticks
  const labelEvery = days > 7 ? Math.ceil(days / 10) : 1;
  const dayTicks = Array.from({ length: days }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const x = PAD_L + ((i + 0.5) / days) * (W - PAD_L - PAD_R);
    const isToday = i === days - 1;
    if (i % labelEvery !== 0 && !isToday) return null;
    const label = isToday
      ? "Today"
      : days > 7
        ? d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
        : d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    return { x, label, isToday };
  }).filter((t): t is { x: number; label: string; isToday: boolean } => t !== null);

  // Hour ticks
  const hourTicks = useMemo(() => {
    const span = yMax - yMin;
    const step = span <= 4 ? 1 : span <= 8 ? 2 : span <= 14 ? 3 : 6;
    const ticks: number[] = [];
    const firstTick = Math.ceil(yMin / step) * step;
    for (let h = firstTick; h <= yMax; h += step) ticks.push(h);
    if (!ticks.includes(yMin)) ticks.unshift(yMin);
    if (!ticks.includes(yMax)) ticks.push(yMax);
    return ticks;
  }, [yMin, yMax]);

  // Legend (top 5 agents by session count)
  const legend = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of sessions) map.set(s.agentSlug, (map.get(s.agentSlug) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [sessions]);

  if (isLoading) {
    return (
      <div className="bg-xyne-surface border border-xyne-border rounded-[14px] px-[16px] py-[14px]">
        <Skeleton className="h-[10px] w-[140px] mb-[14px]" />
        <Skeleton className="h-[200px] w-full rounded-[8px]" />
      </div>
    );
  }

  return (
    <div className="bg-xyne-surface border border-xyne-border rounded-[14px] px-[16px] py-[14px] relative">
      {/* Header */}
      <div className="flex items-center justify-between mb-[10px]">
        <div className="flex items-baseline gap-[8px]">
          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-xyne-fg-tertiary">
            {days === 1 ? "Sessions — Today" : `Sessions — last ${days} days`}
          </span>
          <span className="text-[11px] text-xyne-fg-tertiary">
            {sessions.length} total
          </span>
        </div>
        {/* Compact legend */}
        <div className="flex items-center gap-[10px]">
          {legend.length > 0 && (
            <div className="flex items-center gap-[10px]">
              {legend.map(([slug, count]) => (
                <div key={slug} className="flex items-center gap-[4px]">
                  <span
                    className="w-[7px] h-[7px] rounded-full flex-shrink-0"
                    style={{ background: colorForAgent(slug) }}
                  />
                  <span className="text-[10px] text-xyne-fg-tertiary truncate max-w-[80px]">
                    {slug}
                  </span>
                  <span className="text-[10px] text-xyne-fg-muted">{count}</span>
                </div>
              ))}
            </div>
          )}
          {/* Today / 7d / 30d toggle */}
          <div className="flex items-center rounded-[8px] border border-xyne-border overflow-hidden">
            {([{ value: 1, label: "Today" }, { value: 7, label: "7d" }, { value: 30, label: "30d" }] as const).map(({ value, label }) => (
              <button
                key={value}
                onClick={() => onDaysChange(value)}
                className={`px-[10px] py-[3px] text-[11px] font-medium transition-colors ${
                  days === value
                    ? "bg-xyne-surface-sunken text-xyne-fg-primary"
                    : "text-xyne-fg-muted hover:text-xyne-fg-secondary"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* SVG chart */}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block h-auto w-full"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <filter id="home-glow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Y-axis label */}
        <text
          x={8}
          y={PAD_T + (H - PAD_T - PAD_B) / 2}
          textAnchor="middle"
          fontSize="9"
          fill="var(--color-xyne-fg-muted)"
          transform={`rotate(-90 8 ${PAD_T + (H - PAD_T - PAD_B) / 2})`}
        >
          hour
        </text>

        {/* Hour gridlines + labels */}
        {hourTicks.map((h) => {
          const y = hourToY(h);
          return (
            <g key={h}>
              <line
                x1={PAD_L}
                y1={y}
                x2={W - PAD_R}
                y2={y}
                stroke="var(--color-xyne-border-subtle)"
                strokeDasharray="2 4"
              />
              <text
                x={PAD_L - 4}
                y={y + 3}
                textAnchor="end"
                fontSize="9"
                fill="var(--color-xyne-fg-tertiary)"
              >
                {h}
              </text>
            </g>
          );
        })}

        {/* Day ticks */}
        {dayTicks.map((t) => (
          <text
            key={t.x}
            x={t.x}
            y={H - PAD_B + 14}
            textAnchor="middle"
            fontSize="9"
            fill={
              t.isToday
                ? "var(--color-xyne-fg-secondary)"
                : "var(--color-xyne-fg-tertiary)"
            }
            fontWeight={t.isToday ? "600" : "400"}
          >
            {t.label}
          </text>
        ))}

        {/* Axes */}
        <line
          x1={PAD_L}
          y1={PAD_T}
          x2={PAD_L}
          y2={H - PAD_B}
          stroke="var(--color-xyne-border)"
        />
        <line
          x1={PAD_L}
          y1={H - PAD_B}
          x2={W - PAD_R}
          y2={H - PAD_B}
          stroke="var(--color-xyne-border)"
        />

        {/* Session dots — clickable, open the session */}
        {plot.map((p) => {
          const opacity = p.session.latest.status === "failed" ? 0.45 : 0.88;
          const isHovered = hover?.session.key === p.session.key;
          return (
            <g
              key={p.session.key}
              style={{ cursor: "pointer" }}
              onClick={() => openSession(p.session)}
              onMouseEnter={(e) => setHover({ session: p.session, clientX: e.clientX, clientY: e.clientY })}
              onMouseMove={(e) => setHover((h) => h ? { ...h, clientX: e.clientX, clientY: e.clientY } : null)}
              onMouseLeave={() => setHover(null)}
            >
              {/* Transparent larger hit target for easy clicking */}
              <circle cx={p.x} cy={p.y} r={p.radius + 6} fill="transparent" />

              {p.isLive && (
                <>
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={p.radius + 3}
                    fill={p.color}
                    filter="url(#home-glow)"
                    opacity="0.7"
                  >
                    <animate attributeName="opacity" values="0.3;0.8;0.3" dur="1.4s" repeatCount="indefinite" />
                    <animate attributeName="r" values={`${p.radius + 1};${p.radius + 5};${p.radius + 1}`} dur="1.4s" repeatCount="indefinite" />
                  </circle>
                  <circle cx={p.x} cy={p.y} r={p.radius} fill="none" stroke={p.color} strokeWidth="1.5">
                    <animate attributeName="r" values={`${p.radius};${p.radius + 8};${p.radius}`} dur="1.8s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values="0.8;0;0.8" dur="1.8s" repeatCount="indefinite" />
                  </circle>
                </>
              )}

              {/* Main dot — slightly scaled up on hover */}
              <circle
                cx={p.x}
                cy={p.y}
                r={isHovered ? p.radius + 2 : p.radius}
                fill={p.color}
                stroke={isHovered ? "white" : p.isLive ? p.color : "var(--color-xyne-border)"}
                strokeWidth={isHovered ? 1.5 : p.isLive ? 2 : 0.8}
                opacity={isHovered ? 1 : opacity}
                style={{ transition: "r 0.1s, opacity 0.1s" }}
              />
            </g>
          );
        })}

        {/* Empty state */}
        {plot.length === 0 && (
          <text
            x={W / 2}
            y={H / 2}
            textAnchor="middle"
            fontSize="11"
            fill="var(--color-xyne-fg-muted)"
          >
            {`No sessions in the last ${days} days`}
          </text>
        )}
      </svg>
      {/* Session detail slide-over */}
      {selectedSession && (
        <SessionDetailPanel
          session={selectedSession}
          onClose={() => setSelectedSession(null)}
        />
      )}

      {/* Hover tooltip — fixed to viewport, follows cursor */}
      {hover && (
        <div
          className="fixed z-50 pointer-events-none"
          style={{ left: hover.clientX + 14, top: hover.clientY - 10 }}
        >
          <div className="bg-xyne-surface-sunken border border-xyne-border rounded-[10px] px-[12px] py-[8px] shadow-lg flex flex-col gap-[4px] min-w-[180px] max-w-[280px]">
            <div className="flex items-center gap-[6px]">
              <span
                className="w-[8px] h-[8px] rounded-full flex-shrink-0"
                style={{ background: colorForAgent(hover.session.agentSlug) }}
              />
              <span className="text-[12px] font-medium text-xyne-fg-primary truncate">
                {hover.session.agentSlug}
              </span>
              <span className={`text-[10px] px-[5px] py-[1px] rounded-full flex-shrink-0 ${
                hover.session.latest.status === "completed"
                  ? "bg-xyne-success/15 text-xyne-success-fg"
                  : hover.session.latest.status === "failed"
                    ? "bg-xyne-error/15 text-xyne-error"
                    : hover.session.latest.status === "running"
                      ? "bg-xyne-warning/15 text-xyne-warning-fg"
                      : "bg-xyne-surface text-xyne-fg-tertiary"
              }`}>
                {hover.session.latest.status}
              </span>
            </div>
            <p className="text-[11px] text-xyne-fg-secondary truncate">
              {/* task isn't fetched on the home page anymore — open the
                  session panel for the full prompt + response. */}
              —
            </p>
            <div className="flex items-center gap-[8px] text-[10px] text-xyne-fg-tertiary">
              <span>{hover.session.runs.length} turn{hover.session.runs.length !== 1 ? "s" : ""}</span>
              <span>·</span>
              <span>{hover.session.totalToolsUsed} tool{hover.session.totalToolsUsed !== 1 ? "s" : ""}</span>
              <span>·</span>
              <span>{formatTimeAgo(hover.session.first.startedAt)}</span>
            </div>
            <p className="text-[10px] text-xyne-brand mt-[2px]">Click to open →</p>
          </div>
        </div>
      )}
    </div>
  );
}
