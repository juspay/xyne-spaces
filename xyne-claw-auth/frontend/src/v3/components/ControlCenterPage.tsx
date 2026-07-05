import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import {
  UsersThreeIcon,
  RobotIcon,
  ClipboardTextIcon,
  TerminalIcon,
  CircleNotchIcon,
  ArrowCounterClockwiseIcon,
  EyeIcon,
  LockOpenIcon,
  CaretDownIcon,
  CaretRightIcon,
  WarningCircleIcon,
  ArrowSquareOutIcon,
  MagnifyingGlassIcon,
  XIcon,
  CheckCircleIcon,
  ChatCircleIcon,
} from "@phosphor-icons/react";
import { useNavigate } from "react-router-dom";
import { SessionExportMenu } from "./ui/SessionExportMenu";
import { useControlCenter } from "../hooks/useControlCenter";
import { useSnackbar } from "./ui/Snackbar";
import { PageLayout } from "./ui/PageLayout";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { Skeleton } from "./ui/Skeleton";
import { Avatar } from "./ui/Avatar";
import {
  retryControlCenterRun,
  resolveControlCenterRun,
  approveControlCenterAction,
  rejectControlCenterAction,
} from "../../lib/api";
import type {
  ControlCenterAgent,
  ControlCenterFailure,
  Approval,
  AgentRun,
} from "../../lib/api";
import { formatTimeAgo } from "./home/homeUtils";

/* ── helpers ───────────────────────────────────────────────────────── */

function formatMinutesAgo(min: number): string {
  if (min < 1) return "Just now";
  if (min === 1) return "1 min ago";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  return h === 1 ? "1 hr ago" : `${h} hrs ago`;
}


function formatDuration(startedAt: string, completedAt: string | null): string {
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const ms = end - new Date(startedAt).getTime();
  const totalSecs = Math.floor(ms / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}

function formatDurationMs(ms: number): string {
  const totalSecs = Math.floor(ms / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}

/** Compact "12.3s" / "1m 02s" / "—" formatter for a possibly-null ms column. */
function fmtMsCell(ms: number | null | undefined): string {
  if (ms == null || ms < 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  return formatDurationMs(ms);
}

/** Multi-line latency breakdown for the Duration cell's `title=` tooltip. */
function buildLatencyTooltip(run: AgentRun): string {
  const lines: string[] = [];
  lines.push(`Total: ${fmtMsCell(run.totalMs)}`);
  if (run.llmTotalMs != null) {
    lines.push(`LLM: ${fmtMsCell(run.llmTotalMs)} (wait ${fmtMsCell(run.llmWaitMs)} + decode ${fmtMsCell(run.llmDecodeMs)})`);
  }
  if (run.toolMs != null) lines.push(`Tools: ${fmtMsCell(run.toolMs)}`);
  if (run.llmTurns != null) lines.push(`Turns: ${run.llmTurns}`);
  if (run.ttftMs != null) lines.push(`First TTFT: ${fmtMsCell(run.ttftMs)}`);
  if (run.tokensPerSec != null) lines.push(`Output: ${run.tokensPerSec} tok/s`);
  if (run.llmRetries != null && run.llmRetries > 0) {
    lines.push(`Retries: ${run.llmRetries}${run.lastRetryReason ? ` (${run.lastRetryReason})` : ""}`);
  }
  return lines.join("\n");
}

/* ── status styles ─────────────────────────────────────────────────── */

const STATUS_STYLES: Record<
  string,
  { dot: string; text: string; bg: string; accent: string }
> = {
  running: {
    dot: "bg-xyne-success",
    text: "text-xyne-success",
    bg: "bg-xyne-success-bg",
    accent: "var(--color-xyne-success)",
  },
  waiting: {
    dot: "bg-xyne-info",
    text: "text-xyne-info",
    bg: "bg-xyne-info-bg",
    accent: "var(--color-xyne-info)",
  },
  blocked: {
    dot: "bg-xyne-warning",
    text: "text-xyne-warning",
    bg: "bg-xyne-warning-bg",
    accent: "var(--color-xyne-warning)",
  },
  completed: {
    dot: "bg-xyne-fg-muted",
    text: "text-xyne-fg-muted",
    bg: "bg-xyne-surface-sunken",
    accent: "var(--color-xyne-fg-muted)",
  },
  failed: {
    dot: "bg-xyne-error",
    text: "text-xyne-error",
    bg: "bg-xyne-error-bg",
    accent: "var(--color-xyne-error)",
  },
  cancelled: {
    dot: "bg-xyne-fg-tertiary",
    text: "text-xyne-fg-tertiary",
    bg: "bg-xyne-surface-sunken",
    accent: "var(--color-xyne-fg-tertiary)",
  },
};

/* ── keyframe styles ───────────────────────────────────────────────── */

const KEYFRAME_CSS = `
@keyframes cc-shimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(200%); }
}
`;

/* ── Session helpers (from ActivityTab) ─────────────────────────────── */

interface Session {
  key: string;
  agentSlug: string;
  triggerSource: AgentRun["triggerSource"];
  runs: AgentRun[];
  latest: AgentRun;
  first: AgentRun;
  totalToolsUsed: number;
  totalDurationMs: number;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

const AGENT_COLORS = [
  "#00E5FF", // bright cyan
  "#00FF7F", // bright green
  "#FFD700", // bright gold
  "#FF6B35", // bright orange
  "#4D7CFF", // bright blue
  "#FF6B9D", // bright pink
  "#A78BFA", // bright violet
  "#FF4D4D", // bright red
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
    const sorted = list.slice().sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
    const first = sorted[0]!;
    const latest = sorted[sorted.length - 1]!;
    const totalToolsUsed = sorted.reduce((acc, r) => acc + (r.toolsUsed?.length ?? 0), 0);
    const totalDurationMs = sorted.reduce((acc, r) => {
      const s = new Date(r.startedAt).getTime();
      const e = r.completedAt ? new Date(r.completedAt).getTime() : Date.now();
      return acc + Math.max(0, e - s);
    }, 0);
    sessions.push({ key, agentSlug: latest.agentSlug, triggerSource: latest.triggerSource, runs: sorted, latest, first, totalToolsUsed, totalDurationMs });
  }
  return sessions.sort((a, b) => new Date(b.latest.startedAt).getTime() - new Date(a.latest.startedAt).getTime());
}

/* ── MetricCard (redesigned) ───────────────────────────────────────── */

function MetricCard({
  title,
  value,
  icon,
  highlight,
  onClick,
}: {
  title: string;
  value: number;
  icon: React.ReactNode;
  highlight?: "success" | "warning" | null;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={[
        "relative flex flex-col justify-between overflow-hidden rounded-xl border border-xyne-border bg-xyne-surface p-3",
        highlight === "success" && "border-l-[3px] border-l-xyne-success",
        highlight === "warning" && "border-l-[3px] border-l-xyne-warning",
        onClick && "cursor-pointer hover:bg-xyne-surface-subtle transition",
      ].join(" ")}
      style={{ minHeight: 80 }}
    >
      <div className="absolute right-3 top-3 text-xyne-fg-muted">
        {icon}
      </div>
      <div>
        <div className="flex items-center gap-2">
          {highlight === "success" && (
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-xyne-success" />
          )}
          <span className="text-[24px] font-semibold leading-tight tracking-tight text-xyne-fg-primary">
            {value.toLocaleString()}
          </span>
        </div>
        <div className="mt-1 text-[11px] font-medium uppercase tracking-wider text-xyne-fg-tertiary">
          {title}
        </div>
      </div>
    </div>
  );
}

/* ── AgentRow ──────────────────────────────────────────────────────── */

function AgentRow({
  agent,
  onRetry,
  onResolve,
  isRetrying,
  isResolving,
}: {
  agent: ControlCenterAgent;
  onRetry: (id: string) => void;
  onResolve: (id: string, action: "view-reason" | "unblock") => void;
  isRetrying: boolean;
  isResolving: boolean;
}) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [showError, setShowError] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showDropdown) return;
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showDropdown]);

  const st = STATUS_STYLES[agent.status] ?? STATUS_STYLES.completed!;
  const progressVal =
    agent.status === "completed" ? 100 : (agent.progress ?? 0);

  return (
    <div
      className="relative overflow-hidden rounded-xl border border-xyne-border bg-xyne-surface transition-colors hover:bg-xyne-surface-subtle"
      style={{
        boxShadow:
          agent.status === "failed"
            ? "inset 3px 0 0 0 var(--color-xyne-error)"
            : agent.status === "blocked"
              ? "inset 3px 0 0 0 var(--color-xyne-warning)"
              : undefined,
      }}
    >
      <div className="flex items-start gap-3 p-3">
        {/* Status dot */}
        <div className="mt-2 shrink-0">
          <div className={["h-2 w-2 rounded-full", st.dot].join(" ")} />
        </div>

        {/* Avatar */}
        <Avatar
          name={agent.name}
          color={agent.avatarBg}
          size={32}
          shape="circle"
        />

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-medium text-xyne-fg-primary">
              {agent.name}
            </span>
            <span
              className={[
                "rounded-full px-2 py-0.5 text-[11px] font-medium",
                st.bg,
                st.text,
              ].join(" ")}
            >
              {agent.status.charAt(0).toUpperCase() + agent.status.slice(1)}
            </span>
          </div>

          <p
            className={[
              "mt-0.5 text-[13px]",
              agent.status === "failed"
                ? "text-xyne-error"
                : "text-xyne-fg-secondary",
            ].join(" ")}
          >
            {agent.task}
          </p>

          {/* Progress bar */}
          {(agent.status === "running" ||
            agent.status === "waiting" ||
            agent.status === "completed") && (
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-xyne-surface-sunken">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${progressVal}%`,
                  backgroundColor:
                    agent.status === "completed"
                      ? "var(--color-xyne-fg-muted)"
                      : st.accent,
                }}
              />
            </div>
          )}

          {/* Meta row */}
          <div className="mt-2 flex items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-xyne-fg-tertiary">
              <span className="rounded bg-xyne-surface-sunken px-1.5 py-0.5">
                {agent.integration}
              </span>
              <span>{formatMinutesAgo(agent.minutesAgo)}</span>
              {agent.deepLink && (
                <a
                  href={agent.deepLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 transition-colors hover:text-xyne-fg-secondary"
                  data-id="cc-agent-open-in-spaces"
                >
                  <ArrowSquareOutIcon size={11} />
                  <span>Open in Spaces</span>
                </a>
              )}
            </div>

            {/* Blocked actions */}
            {agent.status === "blocked" && (
              <div className="relative shrink-0" ref={dropdownRef}>
                <button
                  onClick={() => setShowDropdown((s) => !s)}
                  disabled={isResolving}
                  className="flex items-center gap-1 text-[12px] font-medium text-xyne-warning transition-opacity hover:opacity-80 disabled:opacity-50"
                >
                  Resolve
                  <CaretDownIcon
                    size={12}
                    className={[
                      "transition-transform",
                      showDropdown && "rotate-180",
                    ].join(" ")}
                  />
                </button>
                {showDropdown && (
                  <div className="absolute right-0 top-full z-10 mt-1 w-44 rounded-lg border border-xyne-border bg-xyne-surface py-1 shadow-lg">
                    <button
                      onClick={() => {
                        setShowDropdown(false);
                        onResolve(agent.id, "view-reason");
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-[12px] text-xyne-fg-secondary transition-colors hover:bg-xyne-surface-subtle"
                    >
                      <EyeIcon size={12} />
                      View block reason
                    </button>
                    <button
                      onClick={() => {
                        setShowDropdown(false);
                        onResolve(agent.id, "unblock");
                      }}
                      disabled={isResolving}
                      className="flex w-full items-center gap-2 px-3 py-2 text-[12px] text-xyne-fg-secondary transition-colors hover:bg-xyne-surface-subtle disabled:opacity-50"
                    >
                      <LockOpenIcon size={12} />
                      Unblock manually
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Failed actions */}
            {agent.status === "failed" && (
              <div className="flex shrink-0 items-center gap-2">
                <button
                  onClick={() => setShowError((s) => !s)}
                  className="text-[12px] text-xyne-error underline-offset-2 hover:underline"
                >
                  {showError ? "Hide error" : "View error"}
                </button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onRetry(agent.id)}
                  disabled={isRetrying}
                  leadingIcon={
                    isRetrying ? (
                      <CircleNotchIcon
                        size={12}
                        className="animate-spin"
                      />
                    ) : (
                      <ArrowCounterClockwiseIcon size={12} />
                    )
                  }
                >
                  {isRetrying ? "Retrying" : "Retry"}
                </Button>
              </div>
            )}
          </div>

          {/* Error panel */}
          {showError && agent.error && (
            <div className="mt-2 rounded-md border border-xyne-error-border bg-xyne-error-bg px-3 py-2 text-[12px] text-xyne-error-fg">
              {agent.error}
            </div>
          )}
        </div>
      </div>

      {/* Shimmer for running agents */}
      {agent.status === "running" && (
        <div className="h-0.5 w-full overflow-hidden bg-transparent">
          <div
            className="h-full w-1/2"
            style={{
              background:
                "linear-gradient(90deg, transparent, var(--color-xyne-success), transparent)",
              animation: "cc-shimmer 2s linear infinite",
            }}
          />
        </div>
      )}
    </div>
  );
}

/* ── FailureCard ───────────────────────────────────────────────────── */

function FailureCard({
  failure,
  onRetry,
  isRetrying,
}: {
  failure: ControlCenterFailure;
  onRetry: (sessionId: string) => void;
  isRetrying: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const failedMinsAgo = Math.floor(
    (Date.now() - new Date(failure.failedAt).getTime()) / 60000,
  );

  return (
    <div
      className="overflow-hidden rounded-lg border border-xyne-border bg-xyne-surface"
      style={{ boxShadow: "inset 3px 0 0 0 var(--color-xyne-error)" }}
      data-id="cc-failure-card"
    >
      <div className="flex items-start gap-3 p-3">
        <div className="mt-2 shrink-0">
          <div className="h-2 w-2 rounded-full bg-xyne-error" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-xyne-fg-primary">
              {failure.agentName}
            </span>
            <span className="rounded bg-xyne-surface-sunken px-1.5 py-0.5 text-[11px] text-xyne-fg-secondary">
              {failure.agentSlug}
            </span>
          </div>
          <p className="mt-0.5 text-[13px] text-xyne-fg-secondary">
            {failure.task}
          </p>
          <div className="mt-2 flex items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-xyne-fg-tertiary">
              <span>{formatMinutesAgo(failedMinsAgo)}</span>
              {failure.deepLink && (
                <a
                  href={failure.deepLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 transition-colors hover:text-xyne-fg-secondary"
                  data-id="cc-failure-open-in-spaces"
                >
                  <ArrowSquareOutIcon size={11} />
                  <span>Open in Spaces</span>
                </a>
              )}
              <button
                onClick={() => setExpanded((v) => !v)}
                className="flex items-center gap-1 text-xyne-error transition-colors hover:text-xyne-error-fg"
              >
                <WarningCircleIcon size={11} />
                {expanded ? "Hide error" : "View error"}
              </button>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onRetry(failure.sessionId)}
              disabled={isRetrying}
              leadingIcon={
                isRetrying ? (
                  <CircleNotchIcon size={12} className="animate-spin" />
                ) : (
                  <ArrowCounterClockwiseIcon size={12} />
                )
              }
            >
              {isRetrying ? "Retrying" : "Retry"}
            </Button>
          </div>
          {expanded && (
            <div className="mt-2 rounded-md border border-xyne-error-border bg-xyne-error-bg px-3 py-2 text-[12px] text-xyne-error-fg">
              {failure.error.message}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── ActivityTimeline (ported from ActivityTab) ────────────────────── */

function ActivityTimeline({ sessions, days }: { sessions: Session[]; days: number }) {
  const W = 900;
  const H = 460;
  const padL = 36;
  const padR = 16;
  const padT = 18;
  const padB = 36;

  const now = new Date();
  const end = startOfDay(now);
  end.setDate(end.getDate() + 1);
  const start = new Date(end);
  start.setDate(start.getDate() - days);

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

  const hourToY = (hour: number) => padT + ((yMax - hour) / ySpan) * (H - padT - padB);

  type RawPoint = { session: Session; dayIdx: number; y: number; radius: number };
  const raw: RawPoint[] = sessions.map((s) => {
    const d = new Date(s.first.startedAt);
    const dayIdx = Math.floor((startOfDay(d).getTime() - start.getTime()) / 86_400_000);
    const hour = d.getHours() + d.getMinutes() / 60;
    const y = hourToY(hour);
    const radius = Math.min(4 + Math.sqrt(s.runs.length) * 2, 10);
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
    const dayCenter = padL + ((p.dayIdx + 0.5) / days) * (W - padL - padR);
    const step = p.radius * 2 + 1;
    const offset = bucket.length > 1 ? (indexInBucket - (bucket.length - 1) / 2) * step : 0;
    const x = dayCenter + offset;
    return { session: p.session, x, y: p.y, radius: p.radius, color: colorForAgent(p.session.agentSlug), isLive: p.session.latest.status === "running" };
  });

  const legend = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of sessions) map.set(s.agentSlug, (map.get(s.agentSlug) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [sessions]);

  const dayTicks = [];
  const labelEvery = days > 14 ? Math.ceil(days / 10) : 1;
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    if (i % labelEvery !== 0 && i !== days - 1) continue;
    const xPos = padL + ((i + 0.5) / days) * (W - padL - padR);
    dayTicks.push({ x: xPos, label: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) });
  }

  const hourTicks = useMemo(() => {
    const span = yMax - yMin;
    const step = span <= 4 ? 1 : span <= 8 ? 2 : span <= 14 ? 3 : span <= 20 ? 4 : 6;
    const ticks: number[] = [];
    const firstTick = Math.ceil(yMin / step) * step;
    for (let h = firstTick; h <= yMax; h += step) ticks.push(h);
    if (ticks[0] !== yMin) ticks.unshift(yMin);
    if (ticks[ticks.length - 1] !== yMax) ticks.push(yMax);
    return ticks;
  }, [yMin, yMax]);

  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between">
        <div>
          <h3 className="text-sm font-medium text-xyne-fg-secondary">Sessions over time</h3>
          <p className="text-xs text-xyne-fg-tertiary">Each dot is one session. Dot size = message count. Y = hour of day, X = date.</p>
        </div>
        <span className="text-xs text-xyne-fg-muted">{sessions.length} sessions</span>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1" style={{ maxWidth: 900 }}>
          <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" preserveAspectRatio="xMidYMid meet">
            <defs>
              <filter id="agent-glow" x="-80%" y="-80%" width="260%" height="260%">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <text x={12} y={padT + (H - padT - padB) / 2} textAnchor="middle" fontSize="10" fill="var(--color-xyne-fg-muted)" transform={`rotate(-90 12 ${padT + (H - padT - padB) / 2})`}>hour of day</text>
            {hourTicks.map((h) => {
              const y = hourToY(h);
              return (
                <g key={h}>
                  <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="var(--color-xyne-border-subtle)" strokeDasharray="2 4" />
                  <text x={padL - 6} y={y + 3} textAnchor="end" fontSize="10" fill="var(--color-xyne-fg-tertiary)">{h}</text>
                </g>
              );
            })}
            {dayTicks.map((t) => (
              <text key={t.x} x={t.x} y={H - padB + 16} textAnchor="middle" fontSize="10" fill="var(--color-xyne-fg-tertiary)">{t.label}</text>
            ))}
            <line x1={padL} y1={padT} x2={padL} y2={H - padB} stroke="var(--color-xyne-border)" />
            <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="var(--color-xyne-border)" />
            {plot.map((p) => {
              const opacity = p.session.latest.status === "failed" ? 0.5 : 0.9;
              return (
                <g key={p.session.key} style={{ cursor: "pointer" }}>
                  <title>{`${p.session.agentSlug} · ${p.session.runs.length} message${p.session.runs.length === 1 ? "" : "s"} · ${new Date(p.session.first.startedAt).toLocaleString()} · ${p.session.latest.status}`}</title>
                  {p.isLive && (
                    <>
                      <circle cx={p.x} cy={p.y} r={p.radius + 4} fill={p.color} filter="url(#agent-glow)" opacity="0.75">
                        <animate attributeName="opacity" values="0.35;0.85;0.35" dur="1.4s" repeatCount="indefinite" />
                        <animate attributeName="r" values={`${p.radius + 2};${p.radius + 6};${p.radius + 2}`} dur="1.4s" repeatCount="indefinite" />
                      </circle>
                      <circle cx={p.x} cy={p.y} r={p.radius} fill="none" stroke={p.color} strokeWidth="1.5">
                        <animate attributeName="r" values={`${p.radius};${p.radius + 10};${p.radius}`} dur="1.8s" repeatCount="indefinite" />
                        <animate attributeName="opacity" values="0.8;0;0.8" dur="1.8s" repeatCount="indefinite" />
                      </circle>
                    </>
                  )}
                  <circle cx={p.x} cy={p.y} r={p.radius} fill={p.color} stroke={p.isLive ? p.color : "var(--color-xyne-border)"} strokeWidth={p.isLive ? 2 : 1} opacity={opacity} />
                </g>
              );
            })}
            {plot.length === 0 && (
              <text x={W / 2} y={H / 2} textAnchor="middle" fontSize="12" fill="var(--color-xyne-fg-muted)">No sessions in this window</text>
            )}
          </svg>
        </div>
        {legend.length > 0 && (
          <div className="w-48 shrink-0 space-y-2 border-l border-xyne-border-subtle pl-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-xyne-fg-tertiary">Agents</p>
            {legend.map(([slug, count]) => (
              <div key={slug} className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2 truncate">
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: colorForAgent(slug) }} />
                  <span className="truncate text-xyne-fg-secondary">{slug}</span>
                </span>
                <span className="text-xyne-fg-muted">{count}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── ApprovalCard ──────────────────────────────────────────────────── */

function ApprovalCard({
  approval,
  onApprove,
  onReject,
  isActing,
}: {
  approval: Approval;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  isActing: boolean;
}) {
  return (
    <div className="rounded-lg border border-xyne-border bg-xyne-surface p-3">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-medium text-xyne-fg-primary truncate">
              {approval.agentName}
            </span>
            <span className="shrink-0 rounded bg-xyne-surface-sunken px-1.5 py-0.5 text-[10px] text-xyne-fg-secondary">
              {approval.agentSlug}
            </span>
          </div>
          <p className="mt-0.5 text-[12px] text-xyne-fg-secondary">
            {approval.action}
          </p>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-xyne-fg-tertiary">
            <span>{approval.targetSystem}</span>
            <span>·</span>
            <span>{formatMinutesAgo(approval.minutesAgo)}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onReject(approval.id)}
            disabled={isActing}
          >
            Reject
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => onApprove(approval.id)}
            disabled={isActing}
            leadingIcon={<CheckCircleIcon size={12} />}
          >
            Approve
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ── CCHeader ──────────────────────────────────────────────────────── */

function CCHeader({
  loading,
  sseConnected,
  days,
  onDaysChange,
  sessionsCount,
  agentsCount,
  toolCalls,
  tokens,
}: {
  loading: boolean;
  sseConnected: boolean;
  days: 7 | 30;
  onDaysChange: (d: 7 | 30) => void;
  sessionsCount: number;
  agentsCount: number;
  toolCalls: number;
  tokens: number;
}) {
  return (
    <div className="border-b border-xyne-border bg-xyne-surface">
      <div className="mx-auto flex w-full max-w-350 items-center justify-between px-[32px] py-3">
        <div className="flex items-center gap-[16px]">
          <span className="text-[15px] font-semibold text-xyne-fg-primary">
            Control Center
          </span>
          {!loading && (
            <span className="text-[12px] text-xyne-fg-tertiary">
              {sessionsCount} sessions · {agentsCount} agents ·{" "}
              {toolCalls.toLocaleString()} tool calls ·{" "}
              {tokens.toLocaleString()} tokens
            </span>
          )}
          {loading && (
            <span className="text-[12px] text-xyne-fg-tertiary">
              Loading…
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {sseConnected ? (
            <Badge
              as="span"
              label="Live"
              variant="success"
              size="sm"
              dot
            />
          ) : (
            <Badge
              as="span"
              label="Reconnecting…"
              variant="warning"
              size="sm"
              dot
            />
          )}
          <div className="ml-2 flex items-center gap-1">
            <Button
              variant={days === 7 ? "primary" : "secondary"}
              size="sm"
              onClick={() => onDaysChange(7)}
            >
              7d
            </Button>
            <Button
              variant={days === 30 ? "primary" : "secondary"}
              size="sm"
              onClick={() => onDaysChange(30)}
            >
              30d
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── SessionsTable ─────────────────────────────────────────────────── */

function StatusBadge({ status }: { status: string }) {
  const st = STATUS_STYLES[status];
  if (!st)
    return (
      <span className="text-[11px] text-xyne-fg-tertiary">{status}</span>
    );
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${st.bg} ${st.text}`}
    >
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

/**
 * RowActions — "Open in Chat" button + shared export menu for a session
 * or run row. Export UI lives in `ui/SessionExportMenu` so the chat
 * header can use the same dropdown.
 *
 * Renders nothing when conversationId is missing — API/scheduled runs
 * that never produced a chat thread have nothing to open or export.
 */
function RowActions({
  conversationId,
  agentSlug,
  compact = false,
}: {
  conversationId: string | null;
  agentSlug: string;
  /** Inside expanded-run subtable, padding/icon size shrinks. */
  compact?: boolean;
}) {
  const navigate = useNavigate();
  if (!conversationId) return null;
  const iconSize = compact ? 12 : 14;
  const btnPad = compact ? "p-[3px]" : "p-[5px]";

  return (
    <div className="flex items-center gap-[2px]" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() =>
          navigate(
            `/v3/chat?agent=${encodeURIComponent(agentSlug)}&conversation=${encodeURIComponent(conversationId)}`,
          )
        }
        title="Open session in chat"
        aria-label="Open session in chat"
        className={`rounded ${btnPad} text-xyne-fg-tertiary hover:bg-xyne-surface-sunken hover:text-xyne-fg-primary`}
      >
        <ChatCircleIcon size={iconSize} weight="fill" />
      </button>
      <SessionExportMenu
        conversationId={conversationId}
        agentSlug={agentSlug}
        compact={compact}
      />
    </div>
  );
}

function SessionRow({
  session,
  isExpanded,
  onToggle,
}: {
  session: Session;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <div className="grid cursor-pointer grid-cols-[1fr_80px_60px_80px_70px_60px_80px_70px] items-center gap-2 border-b border-xyne-border px-3 py-2.5 transition hover:bg-xyne-surface-subtle"
           onClick={onToggle}>
        <div className="flex min-w-0 items-center gap-2">
          <CaretRightIcon
            size={12}
            className={`shrink-0 transition-transform ${isExpanded ? "rotate-90" : ""}`}
          />
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ background: colorForAgent(session.agentSlug) }}
          />
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-[11px] font-medium text-xyne-fg-secondary">
              {session.agentSlug}
            </span>
            <span className="truncate text-[12px] text-xyne-fg-primary">
              {session.latest.task}
            </span>
          </div>
        </div>
        <StatusBadge status={session.latest.status} />
        <span className="text-[12px] text-xyne-fg-secondary">
          {session.totalToolsUsed}
        </span>
        <span
          className="text-[12px] text-xyne-fg-secondary"
          title={buildLatencyTooltip(session.latest)}
        >
          {formatDurationMs(session.totalDurationMs)}
        </span>
        <span className="text-[12px] text-xyne-fg-secondary">
          {fmtMsCell(session.runs.reduce((acc, r) => acc + (r.llmTotalMs ?? 0), 0) || null)}
        </span>
        <span
          className={`text-[12px] ${session.runs.some((r) => (r.llmRetries ?? 0) > 0) ? "text-amber-500 font-medium" : "text-xyne-fg-secondary"}`}
        >
          {session.runs.reduce((acc, r) => acc + (r.llmRetries ?? 0), 0) || "—"}
        </span>
        <span className="text-[11px] text-xyne-fg-tertiary">
          {formatTimeAgo(session.latest.startedAt)}
        </span>
        <RowActions
          conversationId={session.latest.conversationId}
          agentSlug={session.agentSlug}
        />
      </div>
      {isExpanded && (
        <div className="border-b border-xyne-border bg-xyne-surface-sunken">
          {session.runs.map((run) => (
            <div
              key={run.id}
              className="grid grid-cols-[1fr_80px_60px_80px_70px_60px_80px_70px] items-center gap-2 border-b border-xyne-border-subtle px-3 py-2 pl-8 transition hover:bg-xyne-surface-subtle"
            >
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-[11px] text-xyne-fg-tertiary">
                  {run.agentSlug}
                </span>
                <span className="truncate text-[12px] text-xyne-fg-secondary">
                  {run.task}
                </span>
              </div>
              <StatusBadge status={run.status} />
              <span className="text-[12px] text-xyne-fg-secondary">
                {run.toolsUsed?.length ?? 0}
              </span>
              <span
                className="text-[12px] text-xyne-fg-secondary"
                title={buildLatencyTooltip(run)}
              >
                {formatDuration(run.startedAt, run.completedAt)}
              </span>
              <span className="text-[12px] text-xyne-fg-secondary">
                {fmtMsCell(run.llmTotalMs)}
              </span>
              <span
                className={`text-[12px] ${(run.llmRetries ?? 0) > 0 ? "text-amber-500 font-medium" : "text-xyne-fg-secondary"}`}
                title={run.lastRetryReason ?? undefined}
              >
                {run.llmRetries ?? "—"}
              </span>
              <span className="text-[11px] text-xyne-fg-tertiary">
                {formatTimeAgo(run.startedAt)}
              </span>
              <RowActions
                conversationId={run.conversationId}
                agentSlug={run.agentSlug}
                compact
              />
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function RunRow({ run }: { run: AgentRun }) {
  return (
    <div className="grid grid-cols-[1fr_80px_60px_80px_70px_60px_80px_70px] items-center gap-2 border-b border-xyne-border px-3 py-2.5 transition hover:bg-xyne-surface-subtle">
      <div className="flex min-w-0 items-center gap-2">
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ background: colorForAgent(run.agentSlug) }}
        />
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-[11px] font-medium text-xyne-fg-secondary">
            {run.agentSlug}
          </span>
          <span className="truncate text-[12px] text-xyne-fg-primary">
            {run.task}
          </span>
        </div>
      </div>
      <StatusBadge status={run.status} />
      <span className="text-[12px] text-xyne-fg-secondary">
        {run.toolsUsed?.length ?? 0}
      </span>
      <span
        className="text-[12px] text-xyne-fg-secondary"
        title={buildLatencyTooltip(run)}
      >
        {formatDuration(run.startedAt, run.completedAt)}
      </span>
      <span className="text-[12px] text-xyne-fg-secondary">
        {fmtMsCell(run.llmTotalMs)}
      </span>
      <span
        className={`text-[12px] ${(run.llmRetries ?? 0) > 0 ? "text-amber-500 font-medium" : "text-xyne-fg-secondary"}`}
        title={run.lastRetryReason ?? undefined}
      >
        {run.llmRetries ?? "—"}
      </span>
      <span className="text-[11px] text-xyne-fg-tertiary">
        {formatTimeAgo(run.startedAt)}
      </span>
      <RowActions conversationId={run.conversationId} agentSlug={run.agentSlug} />
    </div>
  );
}

function SessionsTable({
  runs,
  sessions,
}: {
  runs: AgentRun[];
  sessions: Session[];
}) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "running" | "completed" | "failed" | "cancelled"
  >("all");
  const [viewMode, setViewMode] = useState<"flat" | "grouped">("grouped");
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    setExpandedKeys(new Set());
  }, [viewMode, statusFilter, search]);

  const filteredSessions = useMemo(() => {
    let result = sessions;
    if (statusFilter !== "all") {
      result = result.filter((s) => s.latest.status === statusFilter);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (s) =>
          s.agentSlug.toLowerCase().includes(q) ||
          s.latest.task.toLowerCase().includes(q),
      );
    }
    return result;
  }, [sessions, statusFilter, search]);

  const filteredRuns = useMemo(() => {
    let result = runs;
    if (statusFilter !== "all") {
      result = result.filter((r) => r.status === statusFilter);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (r) =>
          r.agentSlug.toLowerCase().includes(q) ||
          r.task.toLowerCase().includes(q),
      );
    }
    return result;
  }, [runs, statusFilter, search]);

  const toggleExpand = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const items = viewMode === "grouped" ? filteredSessions : filteredRuns;

  return (
    <div className="flex flex-col gap-3">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-50 flex-1">
          <MagnifyingGlassIcon
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xyne-fg-tertiary"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search sessions…"
            className="w-full rounded-lg border border-xyne-border bg-xyne-surface py-1.5 pl-8 pr-8 text-[12px] text-xyne-fg-primary focus:border-xyne-brand focus:outline-none"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2"
            >
              <XIcon size={12} className="text-xyne-fg-tertiary" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1">
          {(["all", "running", "completed", "failed", "cancelled"] as const).map(
            (s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={[
                  "rounded-md px-2.5 py-1 text-[11px] font-medium capitalize transition",
                  statusFilter === s
                    ? "border border-xyne-border bg-xyne-surface-sunken text-xyne-fg-primary"
                    : "text-xyne-fg-muted hover:text-xyne-fg-secondary",
                ].join(" ")}
              >
                {s}
              </button>
            ),
          )}
        </div>
        <div className="flex items-center rounded-lg border border-xyne-border">
          <button
            onClick={() => setViewMode("grouped")}
            className={[
              "px-2.5 py-1 text-[11px] font-medium",
              viewMode === "grouped"
                ? "bg-xyne-surface-sunken text-xyne-fg-primary"
                : "text-xyne-fg-muted",
            ].join(" ")}
          >
            Grouped
          </button>
          <button
            onClick={() => setViewMode("flat")}
            className={[
              "px-2.5 py-1 text-[11px] font-medium",
              viewMode === "flat"
                ? "bg-xyne-surface-sunken text-xyne-fg-primary"
                : "text-xyne-fg-muted",
            ].join(" ")}
          >
            Flat
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-xyne-border">
        {/* Header */}
        <div className="grid grid-cols-[1fr_80px_60px_80px_70px_60px_80px_70px] gap-2 border-b border-xyne-border bg-xyne-surface-subtle px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-xyne-fg-tertiary">
          <span>Agent / Task</span>
          <span>Status</span>
          <span>Tools</span>
          <span>Duration</span>
          <span title="Total model time (wait + decode) across all turns">LLM</span>
          <span title="auto_retry_start count — most often 'terminated' mid-stream">Retry</span>
          <span>When</span>
          <span></span>
        </div>

        {/* Rows */}
        {items.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-xyne-fg-tertiary">
            No sessions match your filters
          </div>
        ) : viewMode === "grouped" ? (
          (items as Session[]).map((session) => (
            <SessionRow
              key={session.key}
              session={session}
              isExpanded={expandedKeys.has(session.key)}
              onToggle={() => toggleExpand(session.key)}
            />
          ))
        ) : (
          (items as AgentRun[]).map((run) => <RunRow key={run.id} run={run} />)
        )}
      </div>
    </div>
  );
}

/* ── Main component ────────────────────────────────────────────────── */

interface ControlCenterPageProps {
  userId: string;
}

export function ControlCenterPage({ userId }: ControlCenterPageProps) {
  const {
    metrics,
    agents,
    failures,
    approvals,
    runs,
    loading,
    sseConnected,
    reload,
  } = useControlCenter(userId);

  const { show: showSnackbar } = useSnackbar();

  const [days, setDays] = useState<7 | 30>(7);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [actingOnId, setActingOnId] = useState<string | null>(null);

  /* ── agent handlers ── */
  const handleRetryAgent = useCallback(
    async (id: string) => {
      if (retryingId) return;
      const agent = agents.find((a) => a.id === id);
      if (!agent) return;
      setRetryingId(id);
      try {
        await retryControlCenterRun(agent.sessionId);
        showSnackbar({
          variant: "success",
          title: "Retry initiated",
        });
        reload();
      } catch (err) {
        showSnackbar({
          variant: "error",
          title: err instanceof Error ? err.message : "Retry failed",
        });
      } finally {
        setRetryingId(null);
      }
    },
    [retryingId, agents, showSnackbar, reload],
  );

  const handleResolveAgent = useCallback(
    async (id: string, action: "view-reason" | "unblock") => {
      if (resolvingId) return;
      const agent = agents.find((a) => a.id === id);
      if (!agent) return;
      if (action === "view-reason") {
        showSnackbar({
          variant: "info",
          title: agent.error ?? "No block reason recorded",
        });
        return;
      }
      setResolvingId(id);
      try {
        await resolveControlCenterRun(agent.sessionId);
        showSnackbar({ variant: "success", title: "Run resolved" });
        reload();
      } catch (err) {
        showSnackbar({
          variant: "error",
          title: err instanceof Error ? err.message : "Resolve failed",
        });
      } finally {
        setResolvingId(null);
      }
    },
    [resolvingId, agents, showSnackbar, reload],
  );

  /* ── failure handlers ── */
  const handleRetryFailure = useCallback(
    async (sessionId: string) => {
      if (retryingId) return;
      setRetryingId(sessionId);
      try {
        const data = await retryControlCenterRun(sessionId);
        showSnackbar({
          variant: "success",
          title: `Retry: ${data.agentSlug}`,
          description:
            data.task.slice(0, 60) + (data.task.length > 60 ? "..." : ""),
        });
        reload();
      } catch (err) {
        showSnackbar({
          variant: "error",
          title: err instanceof Error ? err.message : "Retry failed",
        });
      } finally {
        setRetryingId(null);
      }
    },
    [retryingId, showSnackbar, reload],
  );

  /* ── approval handlers ── */
  const handleApprove = useCallback(
    async (id: string) => {
      if (actingOnId) return;
      setActingOnId(id);
      try {
        await approveControlCenterAction(id);
        showSnackbar({ variant: "success", title: "Approved" });
        reload();
      } catch (err) {
        showSnackbar({
          variant: "error",
          title: err instanceof Error ? err.message : "Approval failed",
        });
      } finally {
        setActingOnId(null);
      }
    },
    [actingOnId, showSnackbar, reload],
  );

  const handleReject = useCallback(
    async (id: string) => {
      if (actingOnId) return;
      setActingOnId(id);
      try {
        await rejectControlCenterAction(id);
        showSnackbar({ variant: "success", title: "Rejected" });
        reload();
      } catch (err) {
        showSnackbar({
          variant: "error",
          title: err instanceof Error ? err.message : "Rejection failed",
        });
      } finally {
        setActingOnId(null);
      }
    },
    [actingOnId, showSnackbar, reload],
  );

  /* ── derived data ── */
  const pendingCount = approvals.length;
  const hasUrgent = approvals.some((a) => a.minutesAgo > 5);

  const windowStart = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - (days - 1));
    return startOfDay(d);
  }, [days]);

  const windowRuns = useMemo(
    () => runs.filter((r) => new Date(r.startedAt) >= windowStart),
    [runs, windowStart],
  );

  const windowSessions = useMemo(
    () => groupBySession(windowRuns),
    [windowRuns],
  );

  const totalToolCalls = useMemo(
    () => windowRuns.reduce((sum, r) => sum + (r.toolsUsed?.length ?? 0), 0),
    [windowRuns],
  );

  const totalTokens = useMemo(
    () =>
      windowRuns.reduce(
        (sum, r) =>
          sum +
          (r.tokensIn ?? 0) +
          (r.tokensOut ?? 0) +
          (r.tokensCacheRead ?? 0) +
          (r.tokensCacheWrite ?? 0),
        0,
      ),
    [windowRuns],
  );

  return (
    <>
      <style>{KEYFRAME_CSS}</style>
      <PageLayout
        header={
          <CCHeader
            loading={loading}
            sseConnected={sseConnected}
            days={days}
            onDaysChange={setDays}
            sessionsCount={windowSessions.length}
            agentsCount={agents.length}
            toolCalls={totalToolCalls}
            tokens={totalTokens}
          />
        }
        body={
          <div className="mx-auto flex w-full max-w-350 flex-col gap-6 px-[32px] py-[24px] 2xl:flex-row">
            {/* Left column – 70% */}
            <div className="flex w-full min-w-0 flex-col gap-6 2xl:w-[70%]">
              {/* Recent Sessions Table */}
              <div>
                <div className="mb-3 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-xyne-fg-tertiary">
                  Recent Sessions
                  <span className="normal-case text-xyne-fg-secondary">
                    {windowSessions.length} sessions
                  </span>
                </div>
                {loading ? (
                  <Skeleton className="h-75 rounded-xl" />
                ) : (
                  <SessionsTable
                    runs={windowRuns}
                    sessions={windowSessions}
                  />
                )}
              </div>

              {/* Sessions over time */}
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-medium text-xyne-fg-secondary">
                    Sessions over time
                  </h3>
                  <span className="text-xs text-xyne-fg-muted">
                    {windowSessions.length} sessions
                  </span>
                </div>
                {loading ? (
                  <Skeleton className="h-100 rounded-xl" />
                ) : (
                  <div className="rounded-xl border border-xyne-border bg-xyne-surface p-4">
                    <ActivityTimeline sessions={windowSessions} days={days} />
                  </div>
                )}
              </div>

              {/* Failures */}
              <div>
                <div className="mb-3 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-xyne-fg-tertiary">
                  Failures
                  <span
                    className={[
                      "normal-case",
                      failures.length > 0
                        ? "text-xyne-error"
                        : "text-xyne-fg-secondary",
                    ].join(" ")}
                  >
                    {failures.length}
                  </span>
                </div>
                <div className="flex flex-col gap-2">
                  {loading
                    ? Array.from({ length: 2 }).map((_, i) => (
                        <Skeleton
                          key={i}
                          className="h-18 rounded-xl"
                        />
                      ))
                    : failures.length === 0
                      ? (
                        <div className="rounded-lg border border-xyne-border-subtle bg-xyne-surface-subtle px-4 py-8 text-center text-sm text-xyne-fg-tertiary">
                          No failures
                        </div>
                      )
                      : failures.map((failure) => (
                          <FailureCard
                            key={failure.sessionId}
                            failure={failure}
                            onRetry={handleRetryFailure}
                            isRetrying={retryingId === failure.sessionId}
                          />
                        ))}
                </div>
              </div>
            </div>

            {/* Right column – 30% */}
            <div className="flex w-full min-w-0 flex-col gap-6 2xl:w-[30%]">
              {/* Metrics grid */}
              <div className="grid grid-cols-2 gap-3">
                {loading
                  ? Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton
                        key={i}
                        className="h-20 rounded-xl"
                      />
                    ))
                  : (
                    <>
                      <MetricCard
                        title="Active Sessions"
                        value={metrics?.activeSessions ?? 0}
                        icon={<UsersThreeIcon size={18} />}
                      />
                      <MetricCard
                        title="Running Agents"
                        value={metrics?.runningAgents ?? 0}
                        icon={<RobotIcon size={18} />}
                        highlight={
                          metrics && metrics.runningAgents > 0
                            ? "success"
                            : null
                        }
                      />
                      <MetricCard
                        title="Pending Approvals"
                        value={metrics?.pendingApprovals ?? pendingCount}
                        icon={<ClipboardTextIcon size={18} />}
                        highlight={hasUrgent ? "warning" : null}
                      />
                      <MetricCard
                        title="Tool Calls Today"
                        value={metrics?.toolCallsToday ?? 0}
                        icon={<TerminalIcon size={18} />}
                      />
                    </>
                  )}
              </div>

              {/* Live Agents */}
              <div>
                <div className="mb-3 flex items-center justify-between text-[11px] font-medium uppercase tracking-wider text-xyne-fg-tertiary">
                  Live Agents
                  <span className="normal-case text-xyne-fg-secondary">
                    {agents.length} active
                  </span>
                </div>
                <div className="flex flex-col gap-2">
                  {loading
                    ? Array.from({ length: 3 }).map((_, i) => (
                        <Skeleton
                          key={i}
                          className="h-20 rounded-xl"
                        />
                      ))
                    : agents.length === 0
                      ? (
                        <div
                          className="rounded-lg border border-xyne-border-subtle bg-xyne-surface-subtle px-4 py-8 text-center text-sm text-xyne-fg-tertiary"
                          data-id="cc-agents-empty"
                        >
                          No active agents
                        </div>
                      )
                      : agents.map((agent) => (
                          <AgentRow
                            key={agent.id}
                            agent={agent}
                            onRetry={handleRetryAgent}
                            onResolve={handleResolveAgent}
                            isRetrying={retryingId === agent.id}
                            isResolving={resolvingId === agent.id}
                          />
                        ))}
                </div>
              </div>

              {/* Pending Approvals */}
              <div>
                <div className="mb-3 flex items-center justify-between text-[11px] font-medium uppercase tracking-wider text-xyne-fg-tertiary">
                  Pending Approvals
                  <span className="normal-case text-xyne-fg-secondary">
                    {approvals.length}
                  </span>
                </div>
                <div className="flex flex-col gap-2">
                  {loading
                    ? Array.from({ length: 2 }).map((_, i) => (
                        <Skeleton
                          key={i}
                          className="h-15 rounded-xl"
                        />
                      ))
                    : approvals.length === 0
                      ? (
                        <div className="rounded-lg border border-xyne-border-subtle bg-xyne-surface-subtle px-4 py-6 text-center text-sm text-xyne-fg-tertiary">
                          No pending approvals
                        </div>
                      )
                      : approvals.map((approval) => (
                          <ApprovalCard
                            key={approval.id}
                            approval={approval}
                            onApprove={handleApprove}
                            onReject={handleReject}
                            isActing={actingOnId === approval.id}
                          />
                        ))}
                </div>
              </div>
            </div>
          </div>
        }
      />
    </>
  );
}
