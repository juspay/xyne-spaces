import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listRuns, pollChatMessages, rateRun, exportSessionUrl, type AgentRun, type ChatMsg } from "../lib/api";

// In dev, VITE_XYNE_BACKEND_URL may be empty; in prod the dashboard is served off the same origin as this app.
// Fall back to the current origin so the "Open thread" button always has a target.
import { spacesThreadUrl } from "../lib/spacesLink";
import { MessageBubble } from "./MessageBubble";
import { ToolInvocationList } from "./ToolInvocationList";

interface Props {
  userId: string;
}

const SOURCE_BADGE: Record<string, string> = {
  spaces: "bg-blue-950 text-blue-400",
  scheduled: "bg-amber-950 text-amber-400",
  chat: "bg-purple-950 text-purple-400",
  automation: "bg-fuchsia-950 text-fuchsia-300",
  api: "bg-zinc-800 text-zinc-300",
};

const STATUS_BADGE: Record<string, string> = {
  running: "bg-blue-950 text-blue-300",
  completed: "bg-green-950 text-green-400",
  failed: "bg-red-950 text-red-400",
  cancelled: "bg-zinc-800 text-zinc-500",
};

// Colour palette — vibrant neon hues (inspired by Command Center reference)
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

function formatDuration(startedAt: string, completedAt: string | null): string {
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const secs = Math.max(0, Math.floor((end - start) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return `${mins}m ${rem}s`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return d.toLocaleDateString();
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

type Range = 7 | 30;

interface SessionFilterState {
  query: string;
  agent: string;   // "" = all
  source: string;  // "" = all
  status: string;  // "" = all
}

// Match xyne-claw/src/routes/run.ts session key logic
function sessionKeyFor(run: AgentRun): string {
  return run.conversationId && run.agentSlug ? `${run.conversationId}_${run.agentSlug}` : run.sessionId;
}

interface Session {
  key: string;
  agentSlug: string;
  triggerSource: AgentRun["triggerSource"];
  runs: AgentRun[];          // sorted oldest → newest
  latest: AgentRun;           // runs[runs.length-1]
  first: AgentRun;            // runs[0]
  totalToolsUsed: number;
  totalDurationMs: number;
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
    const totalToolsUsed = sorted.reduce((acc, r) => acc + r.toolsUsed.length, 0);
    const totalDurationMs = sorted.reduce((acc, r) => {
      const s = new Date(r.startedAt).getTime();
      const e = r.completedAt ? new Date(r.completedAt).getTime() : Date.now();
      return acc + Math.max(0, e - s);
    }, 0);
    sessions.push({
      key,
      agentSlug: latest.agentSlug,
      triggerSource: latest.triggerSource,
      runs: sorted,
      latest,
      first,
      totalToolsUsed,
      totalDurationMs,
    });
  }
  // Most recent activity first
  return sessions.sort((a, b) => new Date(b.latest.startedAt).getTime() - new Date(a.latest.startedAt).getTime());
}

function formatTokens(n: number): string {
  if (n < 1_000) return String(n);
  if (n < 1_000_000) return `${(n / 1_000).toFixed(n < 10_000 ? 1 : 0)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

function formatDurationMs(ms: number): string {
  const secs = Math.max(0, Math.floor(ms / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return `${mins}m ${rem}s`;
}

export function ActivityTab({ userId }: Props) {
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AgentRun | null>(null);
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [range, setRange] = useState<Range>(7);
  const [filters, setFilters] = useState<SessionFilterState>({ query: "", agent: "", source: "", status: "" });

  // Keep the selectedSession fresh as `runs` reloads (so live progress updates show).
  // Depend only on `runs` — using selectedSession here would infinite-loop since
  // groupBySession returns a new object identity on every call.
  const selectedKey = selectedSession?.key;
  useEffect(() => {
    if (!selectedKey) return;
    const refreshed = groupBySession(runs).find((s) => s.key === selectedKey);
    if (refreshed) setSelectedSession(refreshed);
  }, [runs, selectedKey]);

  const load = useCallback(async () => {
    try {
      const data = await listRuns(userId, { limit: 200 });
      setRuns(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load runs");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  // Auto-poll: 3s while any running, 15s otherwise
  useEffect(() => {
    const hasRunning = runs.some((r) => r.status === "running");
    const interval = hasRunning ? 3000 : 15000;
    const timer = setInterval(load, interval);
    return () => clearInterval(timer);
  }, [runs, load]);

  // Filter to the selected range for the chart/summary
  const windowStart = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - (range - 1));
    return startOfDay(d);
  }, [range]);

  const windowRuns = useMemo(
    () => runs.filter((r) => new Date(r.startedAt) >= windowStart),
    [runs, windowStart],
  );

  const summary = useMemo(() => {
    const sessions = groupBySession(windowRuns).length;
    const completed = windowRuns.filter((r) => r.status === "completed").length;
    const failed = windowRuns.filter((r) => r.status === "failed").length;
    const agents = new Set(windowRuns.map((r) => r.agentSlug)).size;
    const toolsUsed = windowRuns.reduce((acc, r) => acc + r.toolsUsed.length, 0);
    const tokensIn = windowRuns.reduce((acc, r) => acc + (r.tokensIn ?? 0), 0);
    const tokensOut = windowRuns.reduce((acc, r) => acc + (r.tokensOut ?? 0), 0);
    return { sessions, completed, failed, agents, toolsUsed, tokensIn, tokensOut };
  }, [windowRuns]);

  const running = runs.filter((r) => r.status === "running");
  const history = runs.filter((r) => r.status !== "running");
  const historySessions = useMemo(() => groupBySession(history), [history]);

  const filteredSessions = useMemo(() => {
    const q = filters.query.trim().toLowerCase();
    return historySessions.filter((s) => {
      if (filters.agent && s.agentSlug !== filters.agent) return false;
      if (filters.source && s.triggerSource !== filters.source) return false;
      if (filters.status && s.latest.status !== filters.status) return false;
      if (q) {
        const hay = (s.latest.task + " " + s.first.task + " " + (s.latest.result ?? "") + " " + s.agentSlug).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [historySessions, filters]);

  return (
    <div className="space-y-6">
      {error && <div className="rounded border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">{error}</div>}

      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-4 pb-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">Agent Control Center</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-zinc-500">
            <RangeLabel range={range} />
            <span className="h-1 w-1 rounded-full bg-zinc-700" />
            <span><span className="text-zinc-200">{summary.sessions}</span> sessions</span>
            <span className="h-1 w-1 rounded-full bg-zinc-700" />
            <span><span className="text-zinc-200">{summary.completed}</span> messages</span>
            {summary.failed > 0 && <><span className="h-1 w-1 rounded-full bg-zinc-700" /><span className="text-red-400">{summary.failed} failed</span></>}
            <span className="h-1 w-1 rounded-full bg-zinc-700" />
            <span><span className="text-zinc-200">{summary.agents}</span> agents</span>
            <span className="h-1 w-1 rounded-full bg-zinc-700" />
            <span><span className="text-zinc-200">{summary.toolsUsed}</span> tool calls</span>
            {(summary.tokensIn > 0 || summary.tokensOut > 0) && (
              <>
                <span className="h-1 w-1 rounded-full bg-zinc-700" />
                <span>
                  <span className="text-zinc-200">{formatTokens(summary.tokensIn + summary.tokensOut)}</span> tokens
                  <span className="ml-1 text-zinc-600">({formatTokens(summary.tokensIn)} in / {formatTokens(summary.tokensOut)} out)</span>
                </span>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={range}
            onChange={(e) => setRange(Number(e.target.value) as Range)}
            className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-200"
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
          </select>
        </div>
      </header>

      {/* Live indicator */}
      {running.length > 0 && (
        <div className="flex items-center gap-2 text-sm text-zinc-400">
          <span className="flex h-2 w-2">
            <span className="absolute h-2 w-2 animate-ping rounded-full bg-blue-500 opacity-75" />
            <span className="relative h-2 w-2 rounded-full bg-blue-500" />
          </span>
          <span className="text-zinc-200">{running.length}</span> running now
        </div>
      )}

      {/* Timeline chart */}
      <ActivityTimeline sessions={groupBySession(windowRuns)} days={range} onSelectSession={setSelectedSession} />

      {/* Live table */}
      {running.length > 0 && (
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">Live</h2>
          <RunTable runs={running} onSelect={openSessionForRun} live />
        </section>
      )}

      {/* Recent sessions table */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">Recent Sessions</h2>
        <SessionFilters
          sessions={historySessions}
          filters={filters}
          onChange={setFilters}
        />
        {loading ? (
          <p className="text-sm text-zinc-500">Loading…</p>
        ) : filteredSessions.length === 0 ? (
          <p className="rounded-lg border border-zinc-800 bg-zinc-900 p-6 text-center text-sm text-zinc-500">
            {historySessions.length === 0 ? "No history yet." : "No sessions match these filters."}
          </p>
        ) : (
          <SessionTable sessions={filteredSessions} onSelectSession={setSelectedSession} onSelectRun={setSelected} />
        )}
      </section>

      {selected && <RunDetailDrawer run={selected} onClose={() => setSelected(null)} />}
      {selectedSession && <SessionDetailDrawer session={selectedSession} userId={userId} onClose={() => setSelectedSession(null)} onSelectRun={(r) => { setSelectedSession(null); setSelected(r); }} onRated={load} />}
    </div>
  );

  function openSessionForRun(r: AgentRun) {
    const key = sessionKeyFor(r);
    const session = groupBySession(runs).find((s) => s.key === key);
    if (session) setSelectedSession(session);
    else setSelected(r);
  }
}

function RangeLabel({ range }: { range: Range }) {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - (range - 1));
  const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return <span>{fmt(start)} – {fmt(end)}</span>;
}

// ── Timeline scatter chart — X=day, Y=hour-of-day ──────────────────────

function ActivityTimeline({ sessions, days, onSelectSession }: { sessions: Session[]; days: number; onSelectSession: (s: Session) => void }) {
  // Compact canvas — denser dot feel. viewBox stretches with container but max-width caps how big it ever gets.
  const W = 900;
  const H = 460;
  const padL = 36;
  const padR = 16;
  const padT = 18;
  const padB = 36;

  const now = new Date();
  const end = startOfDay(now);
  end.setDate(end.getDate() + 1); // exclusive
  const start = new Date(end);
  start.setDate(start.getDate() - days);

  // Dynamic Y range — if all activity is within a narrow band, zoom in. Otherwise show full 0-24.
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
    // Only compress the Y range if activity fits comfortably in less than ~16 of the 24 hours
    if (observedRange >= 16) return { yMin: 0, yMax: 24 };
    return {
      yMin: Math.max(0, Math.floor(min - pad)),
      yMax: Math.min(24, Math.ceil(max + pad)),
    };
  }, [sessions]);
  const ySpan = yMax - yMin;

  const hourToY = (hour: number) => padT + ((yMax - hour) / ySpan) * (H - padT - padB);

  // Bucket sessions by DAY only — every session on the same day gets its own X slot,
  // regardless of hour. Hour still drives Y so time-of-day information is preserved.
  type RawPoint = { session: Session; dayIdx: number; y: number; radius: number };
  const raw: RawPoint[] = sessions.map((s) => {
    const d = new Date(s.first.startedAt);
    const dayIdx = Math.floor((startOfDay(d).getTime() - start.getTime()) / 86_400_000);
    const hour = d.getHours() + d.getMinutes() / 60;
    const y = hourToY(hour);
    const radius = Math.min(4 + Math.sqrt(s.runs.length) * 2, 10);
    return { session: s, dayIdx, y, radius };
  });
  // Group by day
  const dayBuckets = new Map<number, RawPoint[]>();
  for (const p of raw) {
    const arr = dayBuckets.get(p.dayIdx) ?? [];
    arr.push(p);
    dayBuckets.set(p.dayIdx, arr);
  }
  // Sort each bucket by Y (top to bottom), stable — dots keep a consistent left-to-right order
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

  // Agents seen — legend shows SESSIONS count, not runs
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
    dayTicks.push({
      x: xPos,
      label: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    });
  }

  // Dynamic hour ticks — pick a nice step that yields ~4-6 labels across the range
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
          <h3 className="text-sm font-medium text-zinc-300">Sessions over time</h3>
          <p className="text-xs text-zinc-500">Each dot is one session (thread × agent). Dot size = message count. Y = hour of day, X = date.</p>
        </div>
        <span className="text-xs text-zinc-600">{sessions.length} sessions</span>
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
            {/* Y axis label */}
            <text x={12} y={padT + (H - padT - padB) / 2} textAnchor="middle" fontSize="10" fill="#52525b" transform={`rotate(-90 12 ${padT + (H - padT - padB) / 2})`}>hour of day</text>
            {/* Hour grid lines + y labels */}
            {hourTicks.map((h) => {
              const y = hourToY(h);
              return (
                <g key={h}>
                  <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="#27272a" strokeDasharray="2 4" />
                  <text x={padL - 6} y={y + 3} textAnchor="end" fontSize="10" fill="#52525b">{h}</text>
                </g>
              );
            })}
            {/* Day x-axis labels */}
            {dayTicks.map((t) => (
              <text key={t.x} x={t.x} y={H - padB + 16} textAnchor="middle" fontSize="10" fill="#52525b">{t.label}</text>
            ))}
            {/* Axis lines */}
            <line x1={padL} y1={padT} x2={padL} y2={H - padB} stroke="#3f3f46" />
            <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="#3f3f46" />
            {/* Dots — one per session */}
            {plot.map((p) => {
              const opacity = p.session.latest.status === "failed" ? 0.5 : 0.9;
              return (
                <g key={p.session.key} onClick={() => onSelectSession(p.session)} style={{ cursor: "pointer" }}>
                  <title>{`${p.session.agentSlug} · ${p.session.runs.length} message${p.session.runs.length === 1 ? "" : "s"} · ${new Date(p.session.first.startedAt).toLocaleString()} · ${p.session.latest.status}`}</title>
                  {p.isLive && (
                    <>
                      {/* Soft pulsing halo behind the dot */}
                      <circle cx={p.x} cy={p.y} r={p.radius + 4} fill={p.color} filter="url(#agent-glow)" opacity="0.75">
                        <animate attributeName="opacity" values="0.35;0.85;0.35" dur="1.4s" repeatCount="indefinite" />
                        <animate attributeName="r" values={`${p.radius + 2};${p.radius + 6};${p.radius + 2}`} dur="1.4s" repeatCount="indefinite" />
                      </circle>
                      {/* Expanding ripple ring */}
                      <circle cx={p.x} cy={p.y} r={p.radius} fill="none" stroke={p.color} strokeWidth="1.5">
                        <animate attributeName="r" values={`${p.radius};${p.radius + 10};${p.radius}`} dur="1.8s" repeatCount="indefinite" />
                        <animate attributeName="opacity" values="0.8;0;0.8" dur="1.8s" repeatCount="indefinite" />
                      </circle>
                    </>
                  )}
                  <circle cx={p.x} cy={p.y} r={p.radius} fill={p.color} stroke={p.isLive ? p.color : "#0a0a0a"} strokeWidth={p.isLive ? 2 : 1} opacity={opacity} />
                </g>
              );
            })}
            {plot.length === 0 && (
              <text x={W / 2} y={H / 2} textAnchor="middle" fontSize="12" fill="#52525b">No sessions in this window</text>
            )}
          </svg>
        </div>
        {/* Legend */}
        {legend.length > 0 && (
          <div className="w-48 shrink-0 space-y-2 border-l border-zinc-800 pl-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Agents</p>
            {legend.map(([slug, count]) => (
              <div key={slug} className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2 truncate">
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: colorForAgent(slug) }} />
                  <span className="truncate text-zinc-300">{slug}</span>
                </span>
                <span className="text-zinc-500">{count}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SessionFilters({ sessions, filters, onChange }: { sessions: Session[]; filters: SessionFilterState; onChange: (f: SessionFilterState) => void }) {
  const agents = useMemo(() => {
    const set = new Set(sessions.map((s) => s.agentSlug));
    return [...set].sort();
  }, [sessions]);
  const sources = useMemo(() => {
    const set = new Set(sessions.map((s) => s.triggerSource));
    return [...set].sort();
  }, [sessions]);
  const statuses = useMemo(() => {
    const set = new Set(sessions.map((s) => s.latest.status));
    return [...set].sort();
  }, [sessions]);

  const hasActive = filters.query || filters.agent || filters.source || filters.status;

  const selectClass = "rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 focus:border-zinc-500 focus:outline-none";

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <input
        type="text"
        value={filters.query}
        onChange={(e) => onChange({ ...filters, query: e.target.value })}
        placeholder="Search task, result, agent…"
        className="flex-1 min-w-[200px] rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
      />
      <select value={filters.agent} onChange={(e) => onChange({ ...filters, agent: e.target.value })} className={selectClass}>
        <option value="">All agents</option>
        {agents.map((a) => <option key={a} value={a}>{a}</option>)}
      </select>
      <select value={filters.source} onChange={(e) => onChange({ ...filters, source: e.target.value })} className={selectClass}>
        <option value="">All sources</option>
        {sources.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
      <select value={filters.status} onChange={(e) => onChange({ ...filters, status: e.target.value })} className={selectClass}>
        <option value="">All statuses</option>
        {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
      {hasActive && (
        <button
          onClick={() => onChange({ query: "", agent: "", source: "", status: "" })}
          className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
        >
          Clear
        </button>
      )}
    </div>
  );
}

function SessionTable({ sessions, onSelectSession, onSelectRun }: { sessions: Session[]; onSelectSession: (s: Session) => void; onSelectRun: (r: AgentRun) => void }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (key: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900">
      <table className="w-full text-sm">
        <thead className="bg-zinc-950 text-xs uppercase text-zinc-500">
          <tr>
            <th className="w-8 px-2 py-2" />
            <th className="px-3 py-2 text-left">Agent</th>
            <th className="px-3 py-2 text-left">Source</th>
            <th className="px-3 py-2 text-left">Status</th>
            <th className="px-3 py-2 text-left">Latest task</th>
            <th className="px-3 py-2 text-center">Messages</th>
            <th className="px-3 py-2 text-left">Last activity</th>
            <th className="px-3 py-2 text-right">Total time</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => {
            const isOpen = expanded.has(s.key);
            const hasMany = s.runs.length > 1;
            return (
              <Fragment key={s.key}>
                <tr
                  onClick={() => onSelectSession(s)}
                  className="cursor-pointer border-t border-zinc-800 transition hover:bg-zinc-800/40"
                >
                  <td className="px-2 py-2 text-zinc-500" onClick={(e) => { e.stopPropagation(); if (hasMany) toggle(s.key); }}>
                    {hasMany ? (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`transition ${isOpen ? "rotate-90" : ""}`}>
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-2 font-medium text-zinc-200">
                      <span className="h-2 w-2 rounded-full" style={{ background: colorForAgent(s.agentSlug) }} />
                      {s.agentSlug}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-1.5 py-0.5 text-xs ${SOURCE_BADGE[s.triggerSource] ?? "bg-zinc-800 text-zinc-400"}`}>
                      {s.triggerSource}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs ${STATUS_BADGE[s.latest.status] ?? "bg-zinc-800 text-zinc-400"}`}>
                      {s.latest.status === "running" && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400" />}
                      {s.latest.status}
                    </span>
                  </td>
                  <td className="max-w-xs truncate px-3 py-2 text-zinc-400">{s.latest.task}</td>
                  <td className="px-3 py-2 text-center">
                    <span className={`rounded px-2 py-0.5 text-xs ${hasMany ? "bg-zinc-800 text-zinc-200" : "text-zinc-600"}`}>
                      {s.runs.length}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-zinc-500">{formatTime(s.latest.startedAt)}</td>
                  <td className="px-3 py-2 text-right font-mono text-zinc-400">{formatDurationMs(s.totalDurationMs)}</td>
                </tr>
                {isOpen && s.runs.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => onSelectRun(r)}
                    className="cursor-pointer border-t border-zinc-900 bg-zinc-950/50 text-xs hover:bg-zinc-800/30"
                  >
                    <td className="px-2 py-1.5" />
                    <td className="px-3 py-1.5 pl-8 text-zinc-500">↳</td>
                    <td className="px-3 py-1.5" />
                    <td className="px-3 py-1.5">
                      <span className={`inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 ${STATUS_BADGE[r.status] ?? "bg-zinc-800 text-zinc-400"}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="max-w-xs truncate px-3 py-1.5 text-zinc-400">{r.task}</td>
                    <td className="px-3 py-1.5 text-center text-zinc-600">—</td>
                    <td className="px-3 py-1.5 text-zinc-500">{formatTime(r.startedAt)}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-zinc-500">{formatDuration(r.startedAt, r.completedAt)}</td>
                  </tr>
                ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RunTable({ runs, onSelect, live }: { runs: AgentRun[]; onSelect: (r: AgentRun) => void; live?: boolean }) {
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900">
      <table className="w-full text-sm">
        <thead className="bg-zinc-950 text-xs uppercase text-zinc-500">
          <tr>
            <th className="px-3 py-2 text-left">Agent</th>
            <th className="px-3 py-2 text-left">Source</th>
            <th className="px-3 py-2 text-left">Status</th>
            <th className="px-3 py-2 text-left">{live ? "Current tool" : "Task"}</th>
            <th className="px-3 py-2 text-left">Started</th>
            <th className="px-3 py-2 text-right">Duration</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr
              key={r.id}
              onClick={() => onSelect(r)}
              className="cursor-pointer border-t border-zinc-800 transition hover:bg-zinc-800/40"
            >
              <td className="px-3 py-2">
                <span className="flex items-center gap-2 font-medium text-zinc-200">
                  <span className="h-2 w-2 rounded-full" style={{ background: colorForAgent(r.agentSlug) }} />
                  {r.agentSlug}
                </span>
              </td>
              <td className="px-3 py-2">
                <span className={`rounded px-1.5 py-0.5 text-xs ${SOURCE_BADGE[r.triggerSource] ?? "bg-zinc-800 text-zinc-400"}`}>
                  {r.triggerSource}
                </span>
              </td>
              <td className="px-3 py-2">
                <span className={`inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs ${STATUS_BADGE[r.status] ?? "bg-zinc-800 text-zinc-400"}`}>
                  {r.status === "running" && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400" />}
                  {r.status}
                </span>
              </td>
              <td className="max-w-xs truncate px-3 py-2 text-zinc-400">
                {live ? (r.currentToolLabel ?? <span className="text-zinc-600">starting…</span>) : r.task}
              </td>
              <td className="px-3 py-2 text-zinc-500">{formatTime(r.startedAt)}</td>
              <td className="px-3 py-2 text-right font-mono text-zinc-400">{formatDuration(r.startedAt, r.completedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SessionDetailDrawer({ session, userId, onClose, onSelectRun, onRated }: { session: Session; userId: string; onClose: () => void; onSelectRun: (r: AgentRun) => void; onRated?: () => void }) {
  const agentColor = colorForAgent(session.agentSlug);
  const lastActivity = session.latest.completedAt ?? session.latest.startedAt;
  const conversationId = session.latest.conversationId;
  const [messages, setMessages] = useState<ChatMsg[] | null>(null);
  const [fetchErr, setFetchErr] = useState<string | null>(null);

  useEffect(() => {
    if (!conversationId) { setMessages([]); return; }
    let cancelled = false;
    pollChatMessages(session.agentSlug, conversationId)
      .then(({ messages: msgs }) => { if (!cancelled) setMessages(msgs); })
      .catch((e) => { if (!cancelled) setFetchErr(e instanceof Error ? e.message : "Failed to load transcript"); });
    return () => { cancelled = true; };
  }, [session.agentSlug, conversationId, session.runs.length]);

  // Per-assistant-message metadata — pair assistant messages with the AgentRun that produced them
  // by their startedAt/createdAt proximity (simple chronological pairing).
  const runMetaByIdx = useMemo(() => {
    if (!messages) return new Map<number, AgentRun>();
    const assistantIndices: number[] = [];
    messages.forEach((m, i) => { if (m.role === "assistant") assistantIndices.push(i); });
    const map = new Map<number, AgentRun>();
    assistantIndices.forEach((msgIdx, i) => {
      const run = session.runs[i];
      if (run) map.set(msgIdx, run);
    });
    return map;
  }, [messages, session.runs]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end bg-black/60" onClick={onClose}>
      <div className="flex h-full w-full max-w-3xl flex-col overflow-hidden border-l border-zinc-800 bg-zinc-950" onClick={(e) => e.stopPropagation()}>
        {/* Sticky header */}
        <div className="border-b border-zinc-800 bg-zinc-950 p-6">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="flex items-center gap-2 text-lg font-semibold text-zinc-100">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: agentColor }} />
                {session.agentSlug}
                <span className="rounded bg-zinc-800 px-2 py-0.5 text-xs font-normal text-zinc-400">
                  {session.runs.length} message{session.runs.length === 1 ? "" : "s"}
                </span>
              </h3>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                <span className={`rounded px-1.5 py-0.5 ${SOURCE_BADGE[session.triggerSource] ?? "bg-zinc-800 text-zinc-400"}`}>{session.triggerSource}</span>
                <span>•</span>
                <span>Started {new Date(session.first.startedAt).toLocaleString()}</span>
                <span>•</span>
                <span>Last activity {formatTime(lastActivity)}</span>
                <span>•</span>
                <span className="font-mono">{formatDurationMs(session.totalDurationMs)} total</span>
                {session.totalToolsUsed > 0 && (<><span>•</span><span>{session.totalToolsUsed} tool calls</span></>)}
              </p>
              {conversationId && (
                <p className="mt-1 text-xs text-zinc-600">
                  thread: <code className="text-zinc-500">{conversationId}</code>
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <OpenSessionButton session={session} />
              {conversationId && <ExportMenu conversationId={conversationId} agentSlug={session.agentSlug} />}
              <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200">✕</button>
            </div>
          </div>
        </div>

        {/* Scrollable transcript */}
        <div className="flex-1 space-y-3 overflow-y-auto p-6">
          {fetchErr && <div className="rounded border border-red-900 bg-red-950/30 p-3 text-sm text-red-300">{fetchErr}</div>}
          {!messages ? (
            <p className="text-sm text-zinc-500">Loading transcript…</p>
          ) : messages.length === 0 ? (
            // Fallback: use AgentRun data directly (e.g., old Spaces sessions with no ChatMessage rows)
            session.runs.map((r) => (
              <Fragment key={r.id}>
                <MessageBubble message={{ id: `${r.id}-u`, role: "user", content: r.task }} />
                <MessageBubble
                  message={{
                    id: `${r.id}-a`,
                    role: "assistant",
                    content: r.result ?? (r.error ? `**Error:** ${r.error}` : r.status === "running" ? `_${r.currentToolLabel ?? "starting…"}_` : "_(no response)_"),
                    status: r.status === "running" ? "running" : r.status === "failed" ? "failed" : "completed",
                    footer: <RunMetaFooter run={r} onOpenDetail={() => onSelectRun(r)} userId={userId} onRated={onRated} />,
                  }}
                />
              </Fragment>
            ))
          ) : (
            messages.map((m, i) => {
              const run = runMetaByIdx.get(i);
              return (
                <MessageBubble
                  key={m.id}
                  message={{
                    id: m.id,
                    role: m.role as "user" | "assistant",
                    content: m.content,
                    status: m.status as "completed" | "failed" | undefined,
                    ...(run && m.role === "assistant"
                      ? { footer: <RunMetaFooter run={run} onOpenDetail={() => onSelectRun(run)} userId={userId} onRated={onRated} /> }
                      : {}),
                  }}
                />
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function OpenSessionButton({ session }: { session: Session }) {
  const navigate = useNavigate();
  const source = session.triggerSource;
  const conversationId = session.latest.conversationId;

  if (source === "chat" && conversationId) {
    return (
      <button
        onClick={() => navigate(`/agents/${encodeURIComponent(session.agentSlug)}/chat?conv=${encodeURIComponent(conversationId)}`)}
        className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-300 shadow-sm transition hover:border-zinc-600 hover:bg-zinc-800"
        title="Open in chat"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
        </svg>
        Open chat
      </button>
    );
  }

  if (source === "spaces" && session.latest.channelId && conversationId) {
    // Spaces dashboard route — from xyne-spaces/dashboard/src/routes/AppRoot.tsx: /chat/dir/:channelId/:conversationId
    const threadUrl = spacesThreadUrl(session.latest.channelId, conversationId);
    return (
      <a
        href={threadUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-300 shadow-sm transition hover:border-zinc-600 hover:bg-zinc-800"
        title="Open thread in Spaces"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
          <polyline points="15 3 21 3 21 9" />
          <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
        Open thread
      </a>
    );
  }

  return null;
}

function ExportMenu({ conversationId, agentSlug }: { conversationId: string; agentSlug: string }) {
  const [open, setOpen] = useState(false);
  const [showInstructions, setShowInstructions] = useState<"claude-code" | "claude-project" | null>(null);

  const download = (format: "claude-code" | "markdown" | "claude-project") => {
    const url = exportSessionUrl(conversationId, agentSlug, format);
    const a = document.createElement("a");
    a.href = url;
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setOpen(false);
    if (format === "claude-code") setShowInstructions("claude-code");
    if (format === "claude-project") setShowInstructions("claude-project");
  };

  return (
    <>
      <div className="relative">
        <button
          onClick={() => setOpen((v) => !v)}
          className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-300 shadow-sm transition hover:border-zinc-600 hover:bg-zinc-800"
          title="Export session"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Export
        </button>
        {open && (
          <div className="absolute right-0 top-full z-10 mt-1 w-64 overflow-hidden rounded-md border border-zinc-800 bg-zinc-950 shadow-xl">
            <button
              onClick={() => download("claude-project")}
              className="block w-full px-3 py-2 text-left text-xs hover:bg-zinc-900"
            >
              <div className="font-medium text-zinc-200">Claude Code project <code className="text-zinc-500">.zip</code></div>
              <div className="text-[11px] text-zinc-500">Full bundle: agent + subagents + skills + session</div>
            </button>
            <button
              onClick={() => download("claude-code")}
              className="block w-full border-t border-zinc-800 px-3 py-2 text-left text-xs hover:bg-zinc-900"
            >
              <div className="font-medium text-zinc-200">Session only <code className="text-zinc-500">.jsonl</code></div>
              <div className="text-[11px] text-zinc-500">Just the transcript, resumable in <code>claude</code></div>
            </button>
            <button
              onClick={() => download("markdown")}
              className="block w-full border-t border-zinc-800 px-3 py-2 text-left text-xs hover:bg-zinc-900"
            >
              <div className="font-medium text-zinc-200">Markdown <code className="text-zinc-500">.md</code></div>
              <div className="text-[11px] text-zinc-500">Human-readable transcript</div>
            </button>
          </div>
        )}
      </div>
      {showInstructions && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" onClick={() => setShowInstructions(null)}>
          <div className="w-full max-w-lg rounded-lg border border-zinc-800 bg-zinc-950 p-5" onClick={(e) => e.stopPropagation()}>
            {showInstructions === "claude-project" ? (
              <>
                <h3 className="mb-2 text-sm font-semibold text-zinc-100">Use the bundle in Claude Code</h3>
                <p className="mb-3 text-xs text-zinc-500">You got a zip with the agent prompt, subagents, skills, and session transcript. To activate it:</p>
                <pre className="mb-3 overflow-auto rounded bg-zinc-900 p-3 font-mono text-[11px] leading-relaxed text-zinc-200">{`# 1. Unzip wherever you like
unzip ~/Downloads/*.zip -d ~/my-agent-project

# 2. Move the session jsonl into Claude Code's project folder
mkdir -p ~/.claude/projects/$(basename ~/my-agent-project)
mv ~/my-agent-project/*.jsonl ~/.claude/projects/$(basename ~/my-agent-project)/

# 3. Open the project
cd ~/my-agent-project
claude

# Inside Claude Code:
/resume    # load the prior conversation
/agents    # list the imported subagents`}</pre>
                <p className="mb-4 text-xs text-zinc-500">
                  The bundle's <code>README.md</code> has full details including MCP caveats. Subagents are prompt-only — install your own MCP servers if you want live tool access.
                </p>
              </>
            ) : (
              <>
                <h3 className="mb-2 text-sm font-semibold text-zinc-100">Resume in Claude Code</h3>
                <p className="mb-3 text-xs text-zinc-500">Transcript saved as <code>&lt;sessionId&gt;.jsonl</code>. To open it:</p>
                <pre className="mb-3 overflow-auto rounded bg-zinc-900 p-3 font-mono text-[11px] leading-relaxed text-zinc-200">{`mkdir -p ~/.claude/projects/xyne-session
mv ~/Downloads/*.jsonl ~/.claude/projects/xyne-session/
cd ~/.claude/projects/xyne-session
claude
# then type /resume`}</pre>
                <p className="mb-4 text-xs text-zinc-500">
                  The transcript is loaded as context. Original xyne-claw tool calls appear as prose summaries — Claude Code uses its own tools for any new actions.
                </p>
              </>
            )}
            <div className="flex justify-end">
              <button
                onClick={() => setShowInstructions(null)}
                className="rounded-md bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-900 hover:bg-white"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function RunMetaFooter({ run, onOpenDetail, userId, onRated }: { run: AgentRun; onOpenDetail: () => void; userId?: string; onRated?: () => void }) {
  const [showTools, setShowTools] = useState(false);
  const invocations = run.toolInvocations ?? [];
  const toolCount = invocations.length > 0 ? invocations.length : run.toolsUsed.length;
  const totalTokens = (run.tokensIn ?? 0) + (run.tokensOut ?? 0);
  const canRate = userId && (run.status === "completed" || run.status === "failed");

  return (
    <div className="space-y-1">
      <span className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 ${STATUS_BADGE[run.status] ?? "bg-zinc-800 text-zinc-400"}`}>
          {run.status === "running" && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400" />}
          {run.status}
        </span>
        <span className="font-mono">{formatDuration(run.startedAt, run.completedAt)}</span>
        {totalTokens > 0 && (
          <span className="text-zinc-500" title={`input ${run.tokensIn ?? 0} · output ${run.tokensOut ?? 0}${run.tokensCacheRead ? ` · cache read ${run.tokensCacheRead}` : ""}`}>
            {formatTokens(totalTokens)} tok
          </span>
        )}
        {toolCount > 0 && (
          <button
            onClick={(e) => { e.stopPropagation(); setShowTools((v) => !v); }}
            className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
            disabled={invocations.length === 0}
            title={invocations.length === 0 ? "Tool details unavailable (run predates the richer-data schema)" : ""}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`transition ${showTools ? "rotate-90" : ""}`}>
              <polyline points="9 18 15 12 9 6" />
            </svg>
            {toolCount} tool call{toolCount === 1 ? "" : "s"}
          </button>
        )}
        {canRate && <RatingButtons run={run} userId={userId!} onRated={onRated} />}
        <button onClick={onOpenDetail} className="ml-auto text-xs text-zinc-500 underline decoration-dotted hover:text-zinc-300">
          details
        </button>
      </span>
      {showTools && invocations.length > 0 && <ToolInvocationList invocations={invocations} />}
    </div>
  );
}

function RatingButtons({ run, userId, onRated }: { run: AgentRun; userId: string; onRated?: () => void }) {
  const [saving, setSaving] = useState<string | null>(null);
  const [showComment, setShowComment] = useState(false);
  const [comment, setComment] = useState(run.ratingComment ?? "");

  const submit = async (rating: "up" | "down", commentArg?: string) => {
    setSaving(rating);
    try {
      await rateRun(userId, run.sessionId, rating, commentArg);
      onRated?.();
    } catch (err) {
      console.warn("[rating] failed", err);
    } finally {
      setSaving(null);
    }
  };

  const isUp = run.rating === "up";
  const isDown = run.rating === "down";

  return (
    <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => submit("up")}
        disabled={saving !== null}
        title="This run went well"
        className={`rounded px-1.5 py-0.5 text-xs transition ${isUp ? "bg-green-950 text-green-400" : "text-zinc-500 hover:bg-zinc-800 hover:text-green-400"}`}
      >
        👍
      </button>
      <button
        onClick={() => { setShowComment(true); if (!isDown) submit("down"); }}
        disabled={saving !== null}
        title="Something went wrong"
        className={`rounded px-1.5 py-0.5 text-xs transition ${isDown ? "bg-red-950 text-red-400" : "text-zinc-500 hover:bg-zinc-800 hover:text-red-400"}`}
      >
        👎
      </button>
      {showComment && isDown && (
        <span className="ml-1 inline-flex items-center gap-1">
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="what went wrong?"
            className="w-44 rounded border border-zinc-700 bg-zinc-950 px-2 py-0.5 text-xs text-zinc-200 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
          />
          <button
            onClick={() => { submit("down", comment); setShowComment(false); }}
            disabled={saving !== null}
            className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-200 hover:bg-zinc-700"
          >
            save
          </button>
        </span>
      )}
    </span>
  );
}


function RunDetailDrawer({ run, onClose }: { run: AgentRun; onClose: () => void }) {
  // For runs that originated from a Spaces thread we link back to the source
  // conversation. Same URL shape used by the session-level OpenSessionButton
  // above — see Spaces dashboard route `/chat/dir/:channelId/:conversationId`.
  const spacesThreadHref =
    run.triggerSource === "spaces" && run.channelId && run.conversationId
      ? spacesThreadUrl(run.channelId, run.conversationId)
      : null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end bg-black/60" onClick={onClose}>
      <div className="h-full w-full max-w-2xl overflow-y-auto border-l border-zinc-800 bg-zinc-950 p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h3 className="flex items-center gap-2 text-lg font-semibold text-zinc-100">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: colorForAgent(run.agentSlug) }} />
              {run.agentSlug}
            </h3>
            <p className="mt-1 flex items-center gap-2 text-xs">
              <span className={`rounded px-1.5 py-0.5 ${SOURCE_BADGE[run.triggerSource] ?? "bg-zinc-800 text-zinc-400"}`}>{run.triggerSource}</span>
              <span className={`rounded px-1.5 py-0.5 ${STATUS_BADGE[run.status] ?? "bg-zinc-800 text-zinc-400"}`}>{run.status}</span>
              <span className="text-zinc-500">{formatDuration(run.startedAt, run.completedAt)}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            {spacesThreadHref && (
              <a
                href={spacesThreadHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-300 shadow-sm transition hover:border-zinc-600 hover:bg-zinc-800"
                title="Open thread in Spaces"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
                Open thread
              </a>
            )}
            <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200">✕</button>
          </div>
        </div>

        <dl className="space-y-4 text-sm">
          <div>
            <dt className="mb-1 text-xs uppercase tracking-wide text-zinc-500">Task</dt>
            <dd className="whitespace-pre-wrap rounded bg-zinc-900 p-3 text-zinc-300">{run.task}</dd>
          </div>
          {run.status === "running" && (
            <div>
              <dt className="mb-1 text-xs uppercase tracking-wide text-zinc-500">Current tool</dt>
              <dd className="text-zinc-300">{run.currentToolLabel ?? "starting…"}</dd>
            </div>
          )}
          {run.result && (
            <div>
              <dt className="mb-1 text-xs uppercase tracking-wide text-zinc-500">Result</dt>
              <dd className="max-h-96 overflow-auto whitespace-pre-wrap rounded bg-zinc-900 p-3 text-zinc-300">{run.result}</dd>
            </div>
          )}
          {run.error && (
            <div>
              <dt className="mb-1 text-xs uppercase tracking-wide text-zinc-500">Error</dt>
              <dd className="whitespace-pre-wrap rounded border border-red-900 bg-red-950/30 p-3 text-red-300">{run.error}</dd>
            </div>
          )}
          {run.toolsUsed.length > 0 && (
            <div>
              <dt className="mb-1 text-xs uppercase tracking-wide text-zinc-500">Tools used ({run.toolsUsed.length})</dt>
              <dd className="flex flex-wrap gap-1">
                {run.toolsUsed.map((t, i) => (
                  <span key={i} className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">{t}</span>
                ))}
              </dd>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4 border-t border-zinc-800 pt-4 text-xs text-zinc-500">
            <div><span className="text-zinc-600">Session:</span> <code className="text-zinc-400">{run.sessionId}</code></div>
            <div><span className="text-zinc-600">Started:</span> {new Date(run.startedAt).toLocaleString()}</div>
            {run.conversationId && <div><span className="text-zinc-600">Conversation:</span> <code className="text-zinc-400">{run.conversationId.slice(0, 16)}</code></div>}
            {run.channelId && <div><span className="text-zinc-600">Channel:</span> <code className="text-zinc-400">{run.channelId}</code></div>}
          </div>
        </dl>
      </div>
    </div>
  );
}
