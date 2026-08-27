/**
 * MetricsPageV3 — workspace-wide latency & throughput dashboard.
 *
 * Purpose: a single page where the operator can see whether changes are
 * improving things — sessions per day, p50/p95 of totalMs, LLM vs Tool
 * split, error rate, and a per-agent leaderboard.
 *
 * All charts are inline SVG with no library dependency, sized for a
 * 1180px max-width column matching the rest of v3.
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  ResponsiveContainer,
  BarChart, Bar,
  LineChart, Line,
  XAxis, YAxis as RcYAxis, CartesianGrid, Tooltip, Legend as RcLegend,
} from "recharts";
import {
  fetchGlobalMetrics, fetchAgentMetrics, listAgents,
  fetchAwakeningActivity, type AwakeningActivity,
  fetchAwakeningRuns, type AwakeningRun,
  fetchAgentImprovements, applyImprovement, dismissImprovement,
  type GlobalMetrics, type GlobalMetricsDayBucket, type AgentMetrics,
  type SlowSession, type ToolLatencyRow, type AgentSentiment, type GlobalMetricsProviderRow,
  type ImprovementCandidate, type ImprovementBucket, type AdminOrgScope,
} from "../../lib/api";
import { Skeleton } from "./ui/Skeleton";
import { Switch } from "./ui/Switch";
import { useAdminStatus } from "../hooks/useAdminStatus";

interface MetricsPageV3Props {
  userId: string;
}

const DAY_OPTIONS: Array<{ label: string; days: 1 | 7 | 30 }> = [
  { label: "1d", days: 1 },
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
];

function fmtMs(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function fmtPct(p: number | null | undefined): string {
  if (p == null || Number.isNaN(p)) return "—";
  return `${(p * 100).toFixed(1)}%`;
}

function fmtSignedMs(ms: number | null | undefined): { label: string; tone: "good" | "bad" | "flat" } {
  if (ms == null) return { label: "—", tone: "flat" };
  if (Math.abs(ms) < 50) return { label: "≈0", tone: "flat" };
  const sign = ms > 0 ? "+" : "";
  return {
    label: `${sign}${fmtMs(Math.abs(ms))}${ms > 0 ? " slower" : " faster"}`,
    tone: ms > 0 ? "bad" : "good",
  };
}

function fmtSignedPct(p: number | null | undefined): { label: string; tone: "good" | "bad" | "flat" } {
  if (p == null || Number.isNaN(p)) return { label: "—", tone: "flat" };
  if (Math.abs(p) < 0.001) return { label: "≈0", tone: "flat" };
  const sign = p > 0 ? "+" : "";
  return { label: `${sign}${(p * 100).toFixed(1)}pp`, tone: p > 0 ? "bad" : "good" };
}

/**
 * Reusable metrics panel — used by both MetricsPageV3 (workspace-wide) and
 * AgentDetailPageV3 (single agent). Accepts a `fetcher` so the parent
 * decides which endpoint to hit; charts and tiles render the same shape.
 *
 * Pass `showLeaderboard=true` to render the top-agents table (only valid
 * when the data has a `topAgents` field — i.e. global mode).
 */
export function MetricsPanel({
  userId,
  fetcher,
  showLeaderboard = false,
  onAgentClick,
  orgScope,
}: {
  userId: string;
  fetcher: (userId: string, days: 1 | 7 | 30) => Promise<GlobalMetrics | AgentMetrics>;
  showLeaderboard?: boolean;
  /** Passed through to the awakening rollup, which fetches independently. */
  orgScope?: AdminOrgScope;
  /** When the workspace leaderboard renders an agent, clicking it bubbles up
   *  so the parent page can pivot to that agent's view. */
  onAgentClick?: (agentSlug: string) => void;
}) {
  const [days, setDays] = useState<1 | 7 | 30>(7);
  const [data, setData] = useState<GlobalMetrics | AgentMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetcher(userId, days)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [userId, days, fetcher]);

  return (
    <div className="flex flex-col gap-[20px]">
      <div className="flex items-center justify-end">
        <div className="flex items-center gap-1 rounded-full bg-xyne-bg-secondary p-1">
          {DAY_OPTIONS.map((opt) => (
            <button
              key={opt.days}
              onClick={() => setDays(opt.days)}
              className={
                "px-3 py-1 rounded-full text-[12px] font-medium transition-colors " +
                (days === opt.days
                  ? "bg-xyne-fg-primary text-xyne-fg-inverse"
                  : "text-xyne-fg-muted hover:text-xyne-fg-primary")
              }
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-xl bg-red-500/10 text-red-500 p-4 text-[13px]">
          Failed to load metrics: {error}
        </div>
      )}

      {loading || !data ? (
        <>
          <Skeleton className="h-[120px] w-full" />
          <Skeleton className="h-[260px] w-full" />
          <Skeleton className="h-[260px] w-full" />
        </>
      ) : (
        <>
          <TotalsStrip data={data} />
          {showLeaderboard && "byTrigger" in data && (
            <Card title="By trigger" subtitle="User combines Spaces mentions, DMs, and dashboard chat. CLI is API-triggered runs.">
              <TriggerTiles rows={data.byTrigger} />
            </Card>
          )}
          {showLeaderboard && "byTrigger" in data ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-[20px]">
              <Card title="How many runs each day" subtitle="Bar height = total runs. Stacked by outcome.">
                <SessionsBarChart perDay={data.perDay} />
              </Card>
              <Card title="Daily runs by trigger" subtitle="Same run volume, grouped by how the run started.">
                <TriggerBarChart perDay={data.perDay} />
              </Card>
            </div>
          ) : (
            <Card title="How many runs each day" subtitle="Bar height = total runs. Stacked by outcome.">
              <SessionsBarChart perDay={data.perDay} />
            </Card>
          )}
          {/* Two charts side-by-side so each line gets its own y-axis. When
              p50 and p95 share a scale (p95 is 10-20× larger), the p50 line
              flattens to the baseline and looks broken. */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-[20px]">
            <Card title="Typical run time over time" subtitle="p50 — half of runs finished faster than this each day. Watch for upward drift.">
              <SingleLineChart perDay={data.perDay} valueKey="p50TotalMs" color="#3b82f6" displayName="Typical run (p50)" />
            </Card>
            <Card title="Slow-tail over time" subtitle="p95 — the slowest 5% each day. This is where pain lives.">
              <SingleLineChart perDay={data.perDay} valueKey="p95TotalMs" color="#ef4444" displayName="Slow tail (p95)" />
            </Card>
          </div>
          <Card title="LLM time vs Tool time" subtitle="If the orange grows, tools are dragging things. If the blue grows, the LLM itself is slow.">
            <SplitChart perDay={data.perDay} />
          </Card>
          {showLeaderboard && "byProvider" in data && (
            <Card title="LLM latency by provider/model" subtitle="Compare provider+model pairs using the same window. Sort by any column to isolate slow tails or unstable providers.">
              <ProviderLatencyTable rows={data.byProvider} />
            </Card>
          )}
          {showLeaderboard && "topAgents" in data && (
            <Card title="Agents leaderboard" subtitle={`Top ${data.topAgents.length} by run count — click a row to drill into one agent`}>
              <AgentTable rows={data.topAgents} onAgentClick={onAgentClick} />
            </Card>
          )}
          {"sentiment" in data && data.sentiment.totalRuns > 0 && (
            <Card title="User sentiment & feedback" subtitle="Explicit ratings + behavioural signals from the same window. Lower bars are better.">
              <SentimentPanel sentiment={data.sentiment} />
            </Card>
          )}
          {"agentSlug" in data && (
            <ImprovementsCard userId={userId} agentSlug={data.agentSlug} />
          )}
          {"toolLatency" in data && data.toolLatency.length > 0 && (
            <Card title="Tool latency for this agent" subtitle={`Top ${data.toolLatency.length} tools by cumulative time — find the one dragging the agent down`}>
              <ToolLatencyTable rows={data.toolLatency} />
            </Card>
          )}
          {showLeaderboard && (
            <AwakeningActivityCard userId={userId} days={days} orgScope={orgScope} />
          )}
          {data.slowSessions.length > 0 && (
            <Card title="Slowest sessions" subtitle={`Top ${data.slowSessions.length} by total wall-clock — expand a row for the tool breakdown`}>
              <SlowSessionsTable rows={data.slowSessions} showAgent={showLeaderboard} />
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function SlowSessionsTable({ rows, showAgent }: { rows: SlowSession[]; showAgent: boolean }) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <table className="w-full min-w-[720px] text-[13px]">
        <thead>
          <tr className="text-left text-xyne-fg-muted text-[11px] uppercase tracking-wider">
            <th className="py-2 pr-3 w-8"></th>
            <th className="py-2 pr-3">Session</th>
            {showAgent && <th className="py-2 pr-3">Agent</th>}
            <th className="py-2 pr-3 text-right">Total</th>
            <th className="py-2 pr-3 text-right">LLM</th>
            <th className="py-2 pr-3 text-right">Tool</th>
            <th className="py-2 pr-3 text-right">When</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const open = openId === r.sessionId;
            return (
              <React.Fragment key={r.sessionId}>
                <tr
                  className="border-t border-xyne-border cursor-pointer hover:bg-xyne-bg-secondary/40"
                  onClick={() => setOpenId(open ? null : r.sessionId)}
                >
                  <td className="py-2 pr-3 text-xyne-fg-muted">{open ? "▾" : "▸"}</td>
                  <td className="py-2 pr-3 font-mono text-[12px] text-xyne-fg-primary truncate max-w-[180px]">
                    {r.sessionId}
                  </td>
                  {showAgent && <td className="py-2 pr-3">{r.agentSlug}</td>}
                  <td className="py-2 pr-3 text-right tabular-nums font-medium">{fmtMs(r.totalMs)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{fmtMs(r.llmTotalMs)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{fmtMs(r.toolMs)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-xyne-fg-muted">
                    {new Date(r.completedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </td>
                </tr>
                {open && (
                  <tr className="bg-xyne-bg-secondary/30">
                    <td></td>
                    <td colSpan={showAgent ? 6 : 5} className="py-3 pr-3">
                      {r.task && (
                        <div className="mb-2 text-[12px] text-xyne-fg-muted line-clamp-2">
                          <span className="text-xyne-fg-primary">Task: </span>{r.task}
                        </div>
                      )}
                      <div className="text-[11px] uppercase tracking-wider text-xyne-fg-muted mb-1">Top tools by time</div>
                      {r.topTools.length === 0 ? (
                        <div className="text-[12px] text-xyne-fg-muted">No tool calls recorded.</div>
                      ) : (
                        <table className="w-full text-[12px]">
                          <thead>
                            <tr className="text-left text-xyne-fg-muted">
                              <th className="py-1 pr-3 font-normal">Tool</th>
                              <th className="py-1 pr-3 font-normal text-right">Cumulative</th>
                              <th className="py-1 pr-3 font-normal text-right">Calls</th>
                              <th className="py-1 pr-3 font-normal text-right">Avg</th>
                              <th className="py-1 pr-3 font-normal text-right">Error</th>
                            </tr>
                          </thead>
                          <tbody>
                            {r.topTools.map((t) => (
                              <tr key={t.tool} className="border-t border-xyne-border-subtle">
                                <td className="py-1 pr-3 font-mono text-[12px]">{t.tool}</td>
                                <td className="py-1 pr-3 text-right tabular-nums">{fmtMs(t.ms)}</td>
                                <td className="py-1 pr-3 text-right tabular-nums">{t.calls}</td>
                                <td className="py-1 pr-3 text-right tabular-nums">{fmtMs(Math.round(t.ms / Math.max(t.calls, 1)))}</td>
                                <td className="py-1 pr-3 text-right">
                                  {t.isError ? <span className="text-red-500">⚠</span> : <span className="text-xyne-fg-muted">—</span>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function MetricsPageV3({ userId }: MetricsPageV3Props) {
  const { isAdmin } = useAdminStatus();
  // null = workspace-wide view, otherwise a single agent's slug.
  // The selector below drives this; the leaderboard renders agent rows as
  // clickable links into the per-agent view so you can pivot without scrolling
  // back to the dropdown.
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [agentSlugs, setAgentSlugs] = useState<string[]>([]);
  const [allOrgs, setAllOrgs] = useState(false);
  const adminOrgScope: AdminOrgScope = allOrgs ? "all" : "org";

  useEffect(() => {
    if (!isAdmin && allOrgs) setAllOrgs(false);
  }, [isAdmin, allOrgs]);

  // Populate the agent selector from the FULL agent roster (allAgents=true, so
  // admins get every user's agents) UNIONed with agents that have runs in the
  // last 30d. Using only /metrics/global.topAgents (the old behaviour) left out
  // every agent without recent runs — and, for admins, other users' private
  // agents — so the dropdown couldn't reach them. The union keeps run-only
  // slugs that might not be in the roster (e.g. deleted agents) as a fallback.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      listAgents(userId, true, adminOrgScope).then((rows) => rows.map((a) => a.slug)).catch(() => [] as string[]),
      fetchGlobalMetrics(userId, 30, adminOrgScope).then((g) => g.topAgents.map((a) => a.agentSlug)).catch(() => [] as string[]),
    ]).then(([all, withRuns]) => {
      if (cancelled) return;
      setAgentSlugs([...new Set([...all, ...withRuns])].sort());
    });
    return () => { cancelled = true; };
  }, [userId, adminOrgScope]);

  // The fetcher passed to MetricsPanel switches based on selection. Memoising
  // would be cleaner but a fresh function per render is fine here since the
  // panel re-runs its effect on every fetcher identity change anyway.
  const fetcher = useCallback((uid: string, days: 1 | 7 | 30) => (
    selectedAgent
      ? fetchAgentMetrics(uid, selectedAgent, days, adminOrgScope)
      : fetchGlobalMetrics(uid, days, adminOrgScope)
  ), [selectedAgent, adminOrgScope]);

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-[1180px] mx-auto px-[40px] pt-[32px] pb-[56px] w-full min-w-[640px]">
        <div className="mb-[16px] flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-[22px] font-semibold text-xyne-fg-primary">
              {selectedAgent ? `Agent · ${selectedAgent}` : "Workspace Metrics"}
            </h1>
            <p className="text-[13px] text-xyne-fg-muted mt-1">
              {selectedAgent
                ? `Latency, throughput, tokens, users, and tool-by-tool breakdown for ${selectedAgent}.`
                : "Latency, throughput, and error trends across all agents and users."}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {isAdmin && (
              <label className="flex shrink-0 items-center gap-2 text-[12px] text-xyne-fg-muted">
                <Switch checked={allOrgs} onChange={setAllOrgs} />
                All orgs
              </label>
            )}
            <label className="text-[12px] text-xyne-fg-muted">View:</label>
            <select
              value={selectedAgent ?? ""}
              onChange={(e) => setSelectedAgent(e.target.value || null)}
              className="text-[13px] rounded-md bg-xyne-bg-secondary border border-xyne-border px-3 py-1.5 text-xyne-fg-primary focus:outline-none focus:ring-1 focus:ring-xyne-fg-primary/30"
            >
              <option value="">All workspace</option>
              {agentSlugs.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>
        <MetricsPanel
          // Re-key on selection so the panel resets its day-window state to 7d
          // each time we switch agent — avoids the dropdown going stale on a
          // window that has zero data for the newly-picked agent.
          key={selectedAgent ?? "__global__"}
          userId={userId}
          fetcher={fetcher}
          showLeaderboard={!selectedAgent}
          onAgentClick={(slug) => setSelectedAgent(slug)}
          orgScope={adminOrgScope}
        />
      </div>
    </div>
  );
}

/**
 * Awakening rollup — agents that ran with nobody triggering them.
 *
 * Fetches independently rather than riding the main metrics payload: awakened
 * runs live in their own table (`agent_awakening_runs`) with no `userId`, and
 * folding unattended runs into per-user latency would skew it.
 *
 * Renders nothing at all when no agent in the org has ever woken, so the
 * section stays invisible for workspaces that do not use the feature.
 */
function AwakeningActivityCard({
  userId,
  days,
  orgScope,
}: {
  userId: string;
  days: 1 | 7 | 30;
  orgScope?: AdminOrgScope;
}) {
  const [data, setData] = useState<AwakeningActivity | null>(null);
  const [failed, setFailed] = useState(false);
  // Keyed by agent AND kind: the rollup lists one row per wake kind, so keying
  // on agentId alone expanded an agent's heartbeat and reflex rows together.
  const [openRow, setOpenRow] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    fetchAwakeningActivity(userId, days, orgScope)
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [userId, days, orgScope]);

  if (failed || !data) return null;
  // Never configured here — do not show an empty shell.
  if (data.agents.length === 0 && data.totals.runs === 0) return null;

  const { totals } = data;
  const stopped = data.agents.filter((a) => !a.enabled || a.lastError);

  return (
    <Card
      title="Awakened agents"
      subtitle="Runs that nobody triggered — the agent woke on a heartbeat or a reflex and decided for itself whether to act."
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-[12px] mb-[16px]">
        <Tile label="Wakes" value={String(totals.runs)} sub={`${totals.events} events collected`} />
        <Tile
          label="Acted"
          value={String(totals.ran)}
          sub={totals.shadow > 0 ? `${totals.shadow} in shadow` : undefined}
        />
        <Tile
          label="Stayed quiet"
          value={String(totals.skipped)}
          sub="gate found nothing worth doing"
        />
        <Tile
          label="Failed"
          value={String(totals.failed)}
          sub={totals.injections > 0 ? `${totals.injections} live updates` : undefined}
          subTone={totals.failed > 0 ? "bad" : "flat"}
        />
      </div>

      {stopped.length > 0 && (
        <div className="mb-[16px] rounded-lg border border-amber-300/60 bg-amber-50 p-3 dark:border-amber-900/60 dark:bg-amber-950/30">
          <div className="text-[12px] font-medium text-amber-900 dark:text-amber-200 mb-1">
            {stopped.length} agent{stopped.length === 1 ? "" : "s"} not waking
          </div>
          {stopped.slice(0, 5).map((a) => (
            <div key={a.agentSlug} className="text-[12px] text-amber-800 dark:text-amber-300">
              <span className="font-mono">{a.agentSlug}</span>
              {a.lastError ? ` — ${a.lastError}` : " — switched off"}
            </div>
          ))}
        </div>
      )}

      {data.byAgent.length > 0 && (
        <table className="w-full text-[12px]">
          <thead className="text-xyne-fg-muted">
            <tr className="text-left border-b border-xyne-border">
              <th className="py-2 font-medium">Agent</th>
              <th className="py-2 font-medium">Kind</th>
              <th className="py-2 font-medium text-right">Wakes</th>
              <th className="py-2 font-medium text-right">Acted</th>
              <th className="py-2 font-medium text-right">Quiet</th>
              <th className="py-2 font-medium text-right">Failed</th>
              <th className="py-2 font-medium text-right">Events</th>
              <th className="py-2 font-medium text-right">Last wake</th>
            </tr>
          </thead>
          <tbody>
            {data.byAgent.map((r) => (
              <React.Fragment key={`${r.agentId}:${r.kind}`}>
              <tr
                className="border-b border-xyne-border/50 cursor-pointer hover:bg-xyne-bg-secondary/60"
                onClick={() => setOpenRow(openRow === rowKey(r) ? null : rowKey(r))}
              >
                <td className="py-2 font-mono text-xyne-fg-primary">
                  <span className="mr-1 inline-block w-3 text-xyne-fg-muted">
                    {openRow === rowKey(r) ? "▾" : "▸"}
                  </span>
                  {r.agentSlug}
                </td>
                <td className="py-2 text-xyne-fg-muted">{r.kind}</td>
                <td className="py-2 text-right text-xyne-fg-primary">{r.runs}</td>
                <td className="py-2 text-right text-xyne-fg-primary">{r.ran}</td>
                <td className="py-2 text-right text-xyne-fg-muted">{r.skipped}</td>
                <td className={"py-2 text-right " + (r.failed > 0 ? "text-red-500" : "text-xyne-fg-muted")}>
                  {r.failed}
                </td>
                <td className="py-2 text-right text-xyne-fg-muted">{r.events}</td>
                <td className="py-2 text-right text-xyne-fg-muted">
                  {r.lastRunAt ? new Date(r.lastRunAt).toLocaleString() : "—"}
                </td>
              </tr>
              {openRow === rowKey(r) && (
                <tr>
                  <td colSpan={8} className="p-0">
                    <AwakeningRunsPanel
                      userId={userId}
                      agentId={r.agentId}
                      agentSlug={r.agentSlug}
                      kind={r.kind}
                      days={days}
                      orgScope={orgScope}
                    />
                  </td>
                </tr>
              )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      )}

      {data.skipReasons.length > 0 && (
        <div className="mt-[16px]">
          <div className="text-[12px] text-xyne-fg-muted mb-2">
            Why it stayed quiet — a healthy agent skips far more often than it acts.
          </div>
          <div className="flex flex-wrap gap-2">
            {data.skipReasons.map((r) => (
              <span
                key={r.reason}
                className="rounded-full bg-xyne-bg-secondary px-3 py-1 text-[12px] text-xyne-fg-muted"
              >
                <span className="font-mono">{r.reason}</span> · {r.count}
              </span>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

const RUNS_PAGE_SIZE = 20;

/** The rollup is one row per (agent, wake kind) — both are needed to identify a row. */
const rowKey = (r: { agentId: string; kind: string }): string => `${r.agentId}:${r.kind}`;

/**
 * One agent's wake history, paginated.
 *
 * Lists every wake ATTEMPT, not just the ones that acted — a skipped wake
 * carries the gate rule that fired, which is usually the thing you opened this
 * to find out. Wakes that dispatched link to their transcript; skipped ones
 * never created a conversation and have nothing to link to.
 */
function AwakeningRunsPanel({
  userId,
  agentId,
  agentSlug,
  kind,
  days,
  orgScope,
}: {
  userId: string;
  agentId: string;
  agentSlug: string;
  /** Narrows to the wake kind of the row that was clicked. */
  kind: string;
  days: 1 | 7 | 30;
  orgScope?: AdminOrgScope;
}) {
  const [runs, setRuns] = useState<AwakeningRun[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Reset paging when the window changes — offset 40 is meaningless against a
  // freshly narrowed result set.
  useEffect(() => { setOffset(0); }, [days, agentId, kind]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchAwakeningRuns(userId, agentId, days, RUNS_PAGE_SIZE, offset, orgScope, kind)
      .then((page) => {
        if (cancelled) return;
        setRuns(page.runs);
        setTotal(page.total);
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [userId, agentId, kind, days, offset, orgScope]);

  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + RUNS_PAGE_SIZE, total);

  return (
    <div className="bg-xyne-bg-secondary/40 px-3 py-3 border-b border-xyne-border/50">
      {error ? (
        <div className="text-[12px] text-red-500">Failed to load sessions: {error}</div>
      ) : loading && runs.length === 0 ? (
        <Skeleton className="h-[120px] w-full" />
      ) : runs.length === 0 ? (
        <div className="text-[12px] text-xyne-fg-muted">
          No {kind} wakes for {agentSlug} in this window.
        </div>
      ) : (
        <>
          <table className="w-full text-[12px]">
            <thead className="text-xyne-fg-muted">
              <tr className="text-left border-b border-xyne-border/60">
                <th className="py-1.5 font-medium">When</th>
                <th className="py-1.5 font-medium">Outcome</th>
                <th className="py-1.5 font-medium">Why</th>
                <th className="py-1.5 font-medium text-right">Events</th>
                <th className="py-1.5 font-medium text-right">Updates</th>
                <th className="py-1.5 font-medium text-right">Took</th>
                <th className="py-1.5 font-medium text-right">Transcript</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-b border-xyne-border/30">
                  <td className="py-1.5 text-xyne-fg-primary whitespace-nowrap">
                    {new Date(r.startedAt).toLocaleString()}
                  </td>
                  <td className={"py-1.5 " + outcomeTone(r.outcome)}>{r.outcome}</td>
                  <td className="py-1.5 font-mono text-xyne-fg-muted">{r.skipReason ?? "—"}</td>
                  <td className="py-1.5 text-right text-xyne-fg-muted">{r.eventCount}</td>
                  <td className="py-1.5 text-right text-xyne-fg-muted">
                    {r.injectionsUsed > 0 ? r.injectionsUsed : "—"}
                  </td>
                  <td className="py-1.5 text-right text-xyne-fg-muted">{fmtMs(r.durationMs)}</td>
                  <td className="py-1.5 text-right">
                    {r.conversationId ? (
                      <a
                        className="text-blue-500 hover:underline"
                        href={`/claw/v3/chat?agent=${encodeURIComponent(agentSlug)}&conversation=${encodeURIComponent(r.conversationId)}&allRuns=1`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        open
                      </a>
                    ) : (
                      <span className="text-xyne-fg-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-2 flex items-center justify-between text-[12px] text-xyne-fg-muted">
            <span>{from}–{to} of {total}</span>
            <div className="flex items-center gap-2">
              <button
                disabled={offset === 0 || loading}
                onClick={() => setOffset(Math.max(0, offset - RUNS_PAGE_SIZE))}
                className="rounded-md border border-xyne-border px-2 py-1 disabled:opacity-40 hover:text-xyne-fg-primary"
              >
                Previous
              </button>
              <button
                disabled={to >= total || loading}
                onClick={() => setOffset(offset + RUNS_PAGE_SIZE)}
                className="rounded-md border border-xyne-border px-2 py-1 disabled:opacity-40 hover:text-xyne-fg-primary"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function outcomeTone(outcome: string): string {
  if (outcome === "failed") return "text-red-500";
  if (outcome === "skipped") return "text-xyne-fg-muted";
  if (outcome === "shadow") return "text-amber-500";
  return "text-xyne-fg-primary";
}

/* ── building blocks ──────────────────────────────────────────────────── */

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-xyne-surface shadow-sm p-[20px]">
      <div className="mb-3">
        <div className="text-[14px] font-semibold text-xyne-fg-primary">{title}</div>
        {subtitle && <div className="text-[12px] text-xyne-fg-muted mt-0.5">{subtitle}</div>}
      </div>
      {children}
    </div>
  );
}

function TotalsStrip({ data }: { data: GlobalMetrics | AgentMetrics }) {
  const p50d = fmtSignedMs(data.delta.p50TotalMs);
  const p95d = fmtSignedMs(data.delta.p95TotalMs);
  const errd = fmtSignedPct(data.delta.errorRate);
  const errPct = data.totals.errorRate;

  // ── Status read-out: turns numbers into a one-line health summary. ──
  // Thresholds tuned for the typical claw run mix; tweak as we learn what's
  // "normal". The point is to anchor the eye before it dives into details.
  const isErrorHigh = errPct > 0.1;             // >10% errors
  const isP95Slow = (data.totals.p95TotalMs ?? 0) > 5 * 60_000; // >5 min p95
  const errGettingWorse = (data.delta.errorRate ?? 0) > 0.02;   // +2pp
  const latGettingWorse = (data.delta.p95TotalMs ?? 0) > 30_000; // +30s p95
  const concerns: string[] = [];
  if (isErrorHigh)      concerns.push(`error rate is ${fmtPct(errPct)} — high`);
  if (isP95Slow)        concerns.push(`tail latency p95 = ${fmtMs(data.totals.p95TotalMs)} — slow`);
  if (errGettingWorse)  concerns.push(`errors trending up vs previous window`);
  if (latGettingWorse)  concerns.push(`p95 latency trending up vs previous window`);
  const tone = concerns.length === 0 ? "good"
              : (isErrorHigh || (isP95Slow && latGettingWorse)) ? "bad"
              : "warn";
  const bannerStyle =
    tone === "good" ? "bg-green-500/10 text-green-700 dark:text-green-300 border-green-500/30" :
    tone === "bad"  ? "bg-red-500/10   text-red-700   dark:text-red-300   border-red-500/30"   :
                      "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30";
  const bannerLabel =
    tone === "good" ? `Workspace looks healthy across ${data.totals.runs} run${data.totals.runs === 1 ? "" : "s"}.`
    : `${concerns.length} issue${concerns.length === 1 ? "" : "s"}: ${concerns.join(" · ")}`;

  return (
    <div className="flex flex-col gap-3">
      {/* Status banner */}
      <div className={`rounded-xl border px-4 py-3 text-[13px] ${bannerStyle}`}>
        {bannerLabel}
      </div>

      {/* Hero row — the two questions you actually open this page to answer */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Hero
          label="Typical run time"
          help="Half of runs finished in under this. Lower = faster."
          value={fmtMs(data.totals.p50TotalMs)}
          delta={p50d}
        />
        <Hero
          label="Slow-tail run time"
          help="Slowest 5% of runs took this long or more — the painful ones."
          value={fmtMs(data.totals.p95TotalMs)}
          delta={p95d}
        />
      </div>

      {/* Supporting metrics in smaller tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile
          label="Total runs"
          value={String(data.totals.runs)}
          sub={`${data.delta.runs >= 0 ? "+" : ""}${data.delta.runs} vs previous`}
        />
        <Tile
          label="Where time goes"
          value={`${fmtMs(data.totals.avgLlmMs)} LLM`}
          sub={`${fmtMs(data.totals.avgToolMs)} in tools`}
        />
        <Tile
          label="Error rate"
          value={fmtPct(errPct)}
          sub={errd.label}
          subTone={errd.tone}
        />
        <Tile
          label="Outcomes"
          value={`${data.totals.completed}✓`}
          sub={`${data.totals.failed}✗ · ${data.totals.cancelled}⊘`}
        />
        {"uniqueUsers" in data.totals && data.totals.uniqueUsers != null && (
          <Tile
            label="Unique users"
            value={String(data.totals.uniqueUsers)}
            sub="distinct users in this window"
          />
        )}
        {/* The managed number for memory: % of runs that actually recalled
            from the bank. A growing bank with a flat rate here = dead weight. */}
        {"memoryRecall" in data.totals && data.totals.memoryRecall != null && (
          <Tile
            label="Memory usage"
            value={`${Math.round(data.totals.memoryRecall.rate * 100)}%`}
            sub={`${data.totals.memoryRecall.runsWithRecall} runs recalled memory`}
          />
        )}
      </div>

      {/* Token consumption for the window. IN counts fresh + cached input —
          cached context is replayed on every turn and dominates real volume
          on agentic loops; fresh-only "in" understates usage ~10x. Only the
          per-agent endpoint reports tokens, hence the narrowing guard. */}
      {"tokens" in data.totals && data.totals.tokens && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Tile
            label="Tokens in"
            value={fmtTokens(data.totals.tokens.in + data.totals.tokens.cacheRead + data.totals.tokens.cacheWrite)}
            sub={`${fmtTokens(data.totals.tokens.in)} fresh · ${fmtTokens(data.totals.tokens.cacheRead + data.totals.tokens.cacheWrite)} cached`}
          />
          <Tile
            label="Tokens out"
            value={fmtTokens(data.totals.tokens.out)}
          />
          <Tile
            label="Cache hit ratio"
            value={
              data.totals.tokens.in + data.totals.tokens.cacheRead > 0
                ? `${Math.round((data.totals.tokens.cacheRead / (data.totals.tokens.in + data.totals.tokens.cacheRead)) * 100)}%`
                : "—"
            }
            sub="of input context served from cache"
          />
          <Tile
            label="Tokens / run"
            value={
              data.totals.runs > 0
                ? fmtTokens(Math.round((data.totals.tokens.in + data.totals.tokens.cacheRead + data.totals.tokens.cacheWrite + data.totals.tokens.out) / data.totals.runs))
                : "—"
            }
            sub="total processed, avg per run"
          />
        </div>
      )}
    </div>
  );
}

/** 1234567 → "1.2M", 45600 → "45.6K" — token counts read better compact. */
function fmtTokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

function Hero({ label, help, value, delta }: { label: string; help: string; value: string; delta: { label: string; tone: "good" | "bad" | "flat" } }) {
  const toneClass =
    delta.tone === "good" ? "text-green-600 dark:text-green-400" :
    delta.tone === "bad"  ? "text-red-600 dark:text-red-400"   :
                            "text-xyne-fg-muted";
  return (
    <div className="rounded-xl bg-xyne-surface shadow-sm px-5 py-4 flex flex-col">
      <div className="text-[12px] uppercase tracking-wider text-xyne-fg-muted">{label}</div>
      <div className="flex items-baseline gap-3 mt-1">
        <span className="text-[32px] font-semibold text-xyne-fg-primary tabular-nums">{value}</span>
        <span className={`text-[13px] font-medium ${toneClass}`}>{delta.label}</span>
      </div>
      <div className="text-[12px] text-xyne-fg-muted mt-1">{help}</div>
    </div>
  );
}

function Tile({ label, value, sub, subTone = "flat" as "good" | "bad" | "flat" }: { label: string; value: string; sub?: string; subTone?: "good" | "bad" | "flat" }) {
  const toneClass =
    subTone === "good" ? "text-green-600 dark:text-green-400" :
    subTone === "bad"  ? "text-red-600 dark:text-red-400"   :
                         "text-xyne-fg-muted";
  return (
    <div className="rounded-xl bg-xyne-surface shadow-sm px-4 py-3 flex flex-col">
      <span className="text-[11px] uppercase tracking-wider text-xyne-fg-muted">{label}</span>
      <span className="text-[20px] font-semibold text-xyne-fg-primary mt-1 tabular-nums">{value}</span>
      {sub && <span className={`text-[11px] mt-0.5 ${toneClass}`}>{sub}</span>}
    </div>
  );
}

const TRIGGER_LABELS = {
  user: "User",
  automation: "Automation",
  scheduled: "Scheduled",
  api: "CLI",
} as const;

function TriggerTiles({ rows }: { rows: GlobalMetrics["byTrigger"] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      {rows.map((r) => (
        <div key={r.trigger} className="rounded-lg bg-xyne-bg-secondary/40 px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] uppercase tracking-wider text-xyne-fg-muted">{TRIGGER_LABELS[r.trigger]}</span>
            <span className="text-[11px] text-xyne-fg-muted tabular-nums">{r.runs} runs</span>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <MetricChip label="Error" value={fmtPct(r.errorRate)} />
            <MetricChip label="p50" value={fmtMs(r.p50TotalMs)} />
            <MetricChip label="p95" value={fmtMs(r.p95TotalMs)} />
          </div>
        </div>
      ))}
    </div>
  );
}

function MetricChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] text-xyne-fg-muted">{label}</div>
      <div className="text-[13px] font-medium text-xyne-fg-primary tabular-nums truncate">{value}</div>
    </div>
  );
}

/* ── Charts (recharts) ────────────────────────────────────────────────── */

const CHART_HEIGHT = 240;
const GRID_COLOR = "currentColor";
const GRID_OPACITY = 0.10;

// Shared X-axis day formatting and Y-axis number formatting are tiny enough
// to inline at each call site. Tooltip is shared.
const tickStyle = { fontSize: 11, fill: "currentColor", opacity: 0.65 };
const axisStyle = { stroke: "currentColor", opacity: 0.2 };

interface TooltipPayloadItem {
  name?: string;
  value?: number;
  color?: string;
}

function MetricsTooltip({ active, payload, label, valueFormat }: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string;
  valueFormat?: (v: number) => string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-md border border-xyne-border bg-xyne-surface px-3 py-2 text-[12px] shadow-md">
      <div className="font-medium text-xyne-fg-primary mb-1">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 text-xyne-fg-muted">
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: p.color }} />
          <span>{p.name}:</span>
          <span className="tabular-nums text-xyne-fg-primary">{valueFormat && typeof p.value === "number" ? valueFormat(p.value) : p.value}</span>
        </div>
      ))}
    </div>
  );
}

function SessionsBarChart({ perDay }: { perDay: GlobalMetricsDayBucket[] }) {
  const data = perDay.map((d) => ({
    day: d.day.slice(5),
    Completed: d.completed,
    Failed: d.failed,
    Cancelled: d.cancelled,
  }));
  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
      <BarChart data={data} margin={{ top: 16, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} opacity={GRID_OPACITY} vertical={false} />
        <XAxis dataKey="day" tick={tickStyle} axisLine={axisStyle} tickLine={false} />
        <RcYAxis tick={tickStyle} axisLine={axisStyle} tickLine={false} width={40} allowDecimals={false} />
        <Tooltip content={<MetricsTooltip />} cursor={{ fill: "currentColor", opacity: 0.05 }} />
        <RcLegend wrapperStyle={{ fontSize: 12, paddingBottom: 8 }} verticalAlign="top" align="left" />
        <Bar dataKey="Completed" stackId="s" fill="#22c55e" radius={[0, 0, 0, 0]} />
        <Bar dataKey="Failed"    stackId="s" fill="#ef4444" />
        <Bar dataKey="Cancelled" stackId="s" fill="#94a3b8" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function TriggerBarChart({ perDay }: { perDay: GlobalMetricsDayBucket[] }) {
  const data = perDay.map((d) => ({
    day: d.day.slice(5),
    User: d.user ?? 0,
    Automation: d.automation ?? 0,
    Scheduled: d.scheduled ?? 0,
    CLI: d.api ?? 0,
  }));
  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
      <BarChart data={data} margin={{ top: 16, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} opacity={GRID_OPACITY} vertical={false} />
        <XAxis dataKey="day" tick={tickStyle} axisLine={axisStyle} tickLine={false} />
        <RcYAxis tick={tickStyle} axisLine={axisStyle} tickLine={false} width={40} allowDecimals={false} />
        <Tooltip content={<MetricsTooltip />} cursor={{ fill: "currentColor", opacity: 0.05 }} />
        <RcLegend wrapperStyle={{ fontSize: 12, paddingBottom: 8 }} verticalAlign="top" align="left" />
        <Bar dataKey="User" stackId="s" fill="#3b82f6" radius={[0, 0, 0, 0]} />
        <Bar dataKey="Automation" stackId="s" fill="#a855f7" />
        <Bar dataKey="Scheduled" stackId="s" fill="#f59e0b" />
        <Bar dataKey="CLI" stackId="s" fill="#14b8a6" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function SingleLineChart({ perDay, valueKey, color, displayName }: {
  perDay: GlobalMetricsDayBucket[];
  valueKey: "p50TotalMs" | "p95TotalMs";
  color: string;
  displayName: string;
}) {
  const data = perDay.map((d) => ({
    day: d.day.slice(5),
    [displayName]: d[valueKey],
  }));
  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
      <LineChart data={data} margin={{ top: 16, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} opacity={GRID_OPACITY} vertical={false} />
        <XAxis dataKey="day" tick={tickStyle} axisLine={axisStyle} tickLine={false} />
        <RcYAxis tick={tickStyle} axisLine={axisStyle} tickLine={false} width={56} tickFormatter={(v) => fmtMs(Math.round(v))} />
        <Tooltip content={<MetricsTooltip valueFormat={(v) => fmtMs(v)} />} />
        <Line
          type="monotone"
          dataKey={displayName}
          stroke={color}
          strokeWidth={2.5}
          dot={{ r: 3.5, fill: color }}
          activeDot={{ r: 5 }}
          connectNulls
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

function SplitChart({ perDay }: { perDay: GlobalMetricsDayBucket[] }) {
  const data = perDay.map((d) => ({
    day: d.day.slice(5),
    "Avg LLM time":  d.avgLlmMs  ?? 0,
    "Avg Tool time": d.avgToolMs ?? 0,
  }));
  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
      <BarChart data={data} margin={{ top: 16, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} opacity={GRID_OPACITY} vertical={false} />
        <XAxis dataKey="day" tick={tickStyle} axisLine={axisStyle} tickLine={false} />
        <RcYAxis tick={tickStyle} axisLine={axisStyle} tickLine={false} width={56} tickFormatter={(v) => fmtMs(Math.round(v))} />
        <Tooltip content={<MetricsTooltip valueFormat={(v) => fmtMs(v)} />} cursor={{ fill: "currentColor", opacity: 0.05 }} />
        <RcLegend wrapperStyle={{ fontSize: 12, paddingBottom: 8 }} verticalAlign="top" align="left" />
        <Bar dataKey="Avg LLM time"  stackId="s" fill="#6366f1" />
        <Bar dataKey="Avg Tool time" stackId="s" fill="#f59e0b" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function AgentTable({ rows, onAgentClick }: {
  rows: GlobalMetrics["topAgents"];
  onAgentClick?: (slug: string) => void;
}) {
  const showOrgLabels = rows.some((r) => r.orgName || r.orgId);
  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <table className="w-full min-w-[640px] text-[13px]">
        <thead>
          <tr className="text-left text-xyne-fg-muted text-[11px] uppercase tracking-wider">
            <th className="py-2 pr-3">Agent</th>
            <th className="py-2 pr-3 text-right">Runs</th>
            <th className="py-2 pr-3 text-right">p50</th>
            <th className="py-2 pr-3 text-right">p95</th>
            <th className="py-2 pr-3 text-right">Avg LLM</th>
            <th className="py-2 pr-3 text-right">Avg Tool</th>
            <th className="py-2 pr-3 text-right">Errors</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={7} className="py-6 text-center text-xyne-fg-muted">No runs in window.</td></tr>
          )}
          {rows.map((r) => (
            <tr
              key={r.agentSlug}
              className={"border-t border-xyne-border " + (onAgentClick ? "cursor-pointer hover:bg-xyne-bg-secondary/40" : "")}
              onClick={onAgentClick ? () => onAgentClick(r.agentSlug) : undefined}
              title={onAgentClick ? `Drill into ${r.agentSlug}'s metrics` : undefined}
            >
              <td className="py-2 pr-3">
                <div className="font-medium text-xyne-fg-primary">{r.agentSlug}</div>
                {showOrgLabels && (
                  <div className="mt-0.5 text-[11px] text-xyne-fg-muted">{r.orgName ?? r.orgId ?? "unknown org"}</div>
                )}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">{r.runs}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{fmtMs(r.p50TotalMs)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{fmtMs(r.p95TotalMs)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{fmtMs(r.avgLlmMs)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{fmtMs(r.avgToolMs)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{fmtPct(r.errorRate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type ProviderSortKey =
  | "providerModel"
  | "runs"
  | "p50LlmMs"
  | "p95LlmMs"
  | "p50TtftMs"
  | "avgTokensPerSec"
  | "errorRate";

function ProviderLatencyTable({ rows }: { rows: GlobalMetricsProviderRow[] }) {
  const [sortKey, setSortKey] = useState<ProviderSortKey>("runs");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const sortedRows = [...rows].sort((a, b) => {
    const providerModelA = `${a.provider} · ${a.model ?? "unknown"}`;
    const providerModelB = `${b.provider} · ${b.model ?? "unknown"}`;
    const av = sortKey === "providerModel" ? providerModelA : a[sortKey];
    const bv = sortKey === "providerModel" ? providerModelB : b[sortKey];
    if (typeof av === "string" && typeof bv === "string") {
      return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    }
    const na = av ?? (sortDir === "asc" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
    const nb = bv ?? (sortDir === "asc" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
    return sortDir === "asc" ? Number(na) - Number(nb) : Number(nb) - Number(na);
  });

  const toggleSort = (nextKey: ProviderSortKey) => {
    if (sortKey === nextKey) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else {
      setSortKey(nextKey);
      setSortDir(nextKey === "providerModel" ? "asc" : "desc");
    }
  };

  const SortHeader = ({ label, sort }: { label: string; sort: ProviderSortKey }) => (
    <button
      type="button"
      onClick={() => toggleSort(sort)}
      className="inline-flex items-center gap-1 text-inherit hover:text-xyne-fg-primary"
    >
      <span>{label}</span>
      <span className="text-[10px] opacity-60">{sortKey === sort ? (sortDir === "desc" ? "↓" : "↑") : "↕"}</span>
    </button>
  );

  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <table className="w-full min-w-[860px] text-[13px]">
        <thead>
          <tr className="text-left text-xyne-fg-muted text-[11px] uppercase tracking-wider">
            <th className="py-2 pr-3"><SortHeader label="Provider · Model" sort="providerModel" /></th>
            <th className="py-2 pr-3 text-right"><SortHeader label="Runs" sort="runs" /></th>
            <th className="py-2 pr-3 text-right"><SortHeader label="p50 LLM" sort="p50LlmMs" /></th>
            <th className="py-2 pr-3 text-right"><SortHeader label="p95 LLM" sort="p95LlmMs" /></th>
            <th className="py-2 pr-3 text-right"><SortHeader label="p50 TTFT" sort="p50TtftMs" /></th>
            <th className="py-2 pr-3 text-right"><SortHeader label="TPS" sort="avgTokensPerSec" /></th>
            <th className="py-2 pr-3 text-right"><SortHeader label="Error %" sort="errorRate" /></th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={7} className="py-8 text-center text-xyne-fg-muted">No provider-tagged runs yet — populates as new runs complete.</td></tr>
          )}
          {sortedRows.map((r) => (
            <tr key={`${r.provider}:${r.model ?? "unknown"}`} className="border-t border-xyne-border">
              <td className="py-2 pr-3">
                <div className="font-medium text-xyne-fg-primary">{r.provider}</div>
                <div className="font-mono text-[12px] text-xyne-fg-muted">{r.model ?? "unknown"}</div>
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">{r.runs}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{fmtMs(r.p50LlmMs)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{fmtMs(r.p95LlmMs)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{fmtMs(r.p50TtftMs)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{r.avgTokensPerSec == null ? "—" : Math.round(r.avgTokensPerSec).toString()}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{fmtPct(r.errorRate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SentimentPanel({ sentiment }: { sentiment: AgentSentiment }) {
  const ratingPct = sentiment.ratingRatio != null ? sentiment.ratingRatio : null;
  // Tone the headline based on ratio + behavioural signals. The rules are
  // intentionally simple — we want the page to read in 3 seconds.
  const concerns: string[] = [];
  if (ratingPct != null && ratingPct < 0.5)    concerns.push(`thumbs-up rate ${(ratingPct * 100).toFixed(0)}% — users mostly unhappy`);
  if (sentiment.apologeticRate > 0.2)          concerns.push(`${(sentiment.apologeticRate * 100).toFixed(0)}% of replies sound apologetic ("I couldn't…")`);
  if (sentiment.failedRate > 0.1)              concerns.push(`${(sentiment.failedRate * 100).toFixed(0)}% of runs failed outright`);
  if (sentiment.cancelledRate > 0.1)           concerns.push(`${(sentiment.cancelledRate * 100).toFixed(0)}% of runs were cancelled (user gave up)`);
  if (sentiment.retriedRate > 0.2)             concerns.push(`${(sentiment.retriedRate * 100).toFixed(0)}% of runs needed an LLM retry`);
  const tone = concerns.length === 0 ? "good" : concerns.length >= 3 ? "bad" : "warn";
  const bannerStyle =
    tone === "good" ? "bg-green-500/10 text-green-700 dark:text-green-300 border-green-500/30" :
    tone === "bad"  ? "bg-red-500/10   text-red-700   dark:text-red-300   border-red-500/30"   :
                      "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30";
  const headline =
    sentiment.ratingTotal === 0 && concerns.length === 0
      ? `No ratings yet — ${sentiment.totalRuns} runs in window. Behavioural signals look normal.`
      : concerns.length === 0
      ? `Sentiment looks healthy across ${sentiment.totalRuns} runs (${sentiment.ratingTotal} rated, ${sentiment.ratingUp} 👍 vs ${sentiment.ratingDown} 👎).`
      : `${concerns.length} concern${concerns.length === 1 ? "" : "s"}: ${concerns.join(" · ")}`;

  return (
    <div className="flex flex-col gap-4">
      <div className={`rounded-xl border px-4 py-3 text-[13px] ${bannerStyle}`}>{headline}</div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <MiniTile label="Ratings 👍" value={String(sentiment.ratingUp)} sub={sentiment.ratingTotal > 0 ? `${((sentiment.ratingUp / sentiment.ratingTotal) * 100).toFixed(0)}% of rated` : "—"} />
        <MiniTile label="Ratings 👎" value={String(sentiment.ratingDown)} sub={sentiment.ratingTotal > 0 ? `${((sentiment.ratingDown / sentiment.ratingTotal) * 100).toFixed(0)}% of rated` : "—"} />
        <MiniTile label="Apologetic replies" value={`${(sentiment.apologeticRate * 100).toFixed(1)}%`} sub="of completed runs" />
        <MiniTile label="Cancelled" value={`${(sentiment.cancelledRate * 100).toFixed(1)}%`} sub="of all runs" />
        <MiniTile label="Needed retry" value={`${(sentiment.retriedRate * 100).toFixed(1)}%`} sub="LLM retries fired" />
      </div>

      {sentiment.recentComments.length > 0 && (
        <div>
          <div className="text-[11px] uppercase tracking-wider text-xyne-fg-muted mb-2">
            Recent rating comments ({sentiment.recentComments.length})
          </div>
          <div className="flex flex-col gap-2">
            {sentiment.recentComments.map((c) => (
              <div key={c.sessionId} className="flex items-start gap-3 rounded-lg bg-xyne-bg-secondary/40 p-3">
                <span className="text-[18px] leading-none mt-0.5" title={c.rating === "up" ? "thumbs up" : "thumbs down"}>
                  {c.rating === "up" ? "👍" : "👎"}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] text-xyne-fg-primary whitespace-pre-wrap break-words">{c.comment}</div>
                  <div className="text-[11px] text-xyne-fg-muted mt-1 flex items-center gap-2">
                    <span className="font-mono">{c.sessionId.slice(0, 16)}</span>
                    <span>·</span>
                    <span>{new Date(c.completedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Improvement suggestions surfaced by the hourly FailureCurator. Three
 * collapsible buckets (agent_unable_to_do_work / failure / user_frustrated)
 * each containing the curator's findings. Apply marks the candidate as
 * applied; Dismiss kicks off the 7-day cool-down. Both call admin-only
 * endpoints.
 */
function ImprovementsCard({ userId, agentSlug }: { userId: string; agentSlug: string }) {
  const [items, setItems] = useState<ImprovementCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openBucket, setOpenBucket] = useState<ImprovementBucket | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // candidate id currently mutating

  const reload = React.useCallback(() => {
    setError(null);
    fetchAgentImprovements(userId, agentSlug)
      .then(setItems)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [userId, agentSlug]);

  useEffect(() => { reload(); }, [reload]);

  if (error) {
    // Permission failures (admin / owner / contributor gate) — hide the
    // card entirely rather than show a scary banner for users who simply
    // aren't part of this agent's editor group.
    const isAuth = /403|admin|owner|contributor|forbidden/i.test(error);
    if (isAuth) return null;
    return <Card title="Improvement suggestions" subtitle="Auto-generated by the FailureCurator"><div className="text-[13px] text-red-500">Failed to load suggestions: {error}</div></Card>;
  }
  if (items === null) {
    return <Card title="Improvement suggestions" subtitle="Auto-generated by the FailureCurator"><Skeleton className="h-[80px] w-full" /></Card>;
  }
  if (items.length === 0) {
    return <Card title="Improvement suggestions" subtitle="Auto-generated by the FailureCurator hourly worker">
      <div className="text-[13px] text-xyne-fg-muted">No pending suggestions. The curator runs hourly; once it has enough negative-signal sessions to spot a pattern, findings will appear here.</div>
    </Card>;
  }

  const buckets: Array<{ key: ImprovementBucket; label: string; tone: "good" | "warn" | "bad" }> = [
    { key: "agent_unable_to_do_work", label: "Agent unable to do work", tone: "warn" },
    { key: "failure",                 label: "Failures",                tone: "bad" },
    { key: "user_frustrated",         label: "User frustrated",         tone: "bad" },
  ];

  const onApply = async (id: string) => {
    setBusy(id);
    try { await applyImprovement(userId, id); reload(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };
  const onDismiss = async (id: string) => {
    setBusy(id);
    try { await dismissImprovement(userId, id); reload(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  const itemsByBucket: Record<ImprovementBucket, ImprovementCandidate[]> = {
    agent_unable_to_do_work: items.filter((i) => i.bucket === "agent_unable_to_do_work"),
    failure:                 items.filter((i) => i.bucket === "failure"),
    user_frustrated:         items.filter((i) => i.bucket === "user_frustrated"),
  };

  return (
    <Card
      title="Improvement suggestions"
      subtitle={`${items.length} pending — auto-generated hourly from negative-signal sessions. Acting on a suggestion is manual: read the proposed fix, make the change in the agent editor (system prompt, tools, memory…), then click “Mark as handled.” Use “Dismiss” to silence the same root-cause finding for this agent for 7 days.`}
    >
      <div className="flex flex-col gap-2">
        {buckets.map((b) => {
          const rows = itemsByBucket[b.key];
          const open = openBucket === b.key;
          return (
            <div key={b.key} className="rounded-lg border border-xyne-border">
              <button
                onClick={() => setOpenBucket(open ? null : b.key)}
                className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-xyne-bg-secondary/40"
              >
                <span className="flex items-center gap-2">
                  <span className="text-xyne-fg-muted">{open ? "▾" : "▸"}</span>
                  <span className="font-medium text-xyne-fg-primary">{b.label}</span>
                  <span className="text-[12px] text-xyne-fg-muted">
                    {rows.length} finding{rows.length === 1 ? "" : "s"}
                  </span>
                </span>
              </button>
              {open && rows.length > 0 && (
                <div className="border-t border-xyne-border-subtle p-3 flex flex-col gap-3">
                  {rows.map((c) => (
                    <ImprovementRow
                      key={c.id}
                      c={c}
                      onApply={() => onApply(c.id)}
                      onDismiss={() => onDismiss(c.id)}
                      busy={busy === c.id}
                    />
                  ))}
                </div>
              )}
              {open && rows.length === 0 && (
                <div className="border-t border-xyne-border-subtle p-3 text-[12px] text-xyne-fg-muted">Nothing pending in this bucket.</div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function ImprovementRow({ c, onApply, onDismiss, busy }: {
  c: ImprovementCandidate;
  onApply: () => void;
  onDismiss: () => void;
  busy: boolean;
}) {
  const confTone =
    c.confidence === "high" ? "text-green-600 dark:text-green-400 bg-green-500/10" :
    c.confidence === "low"  ? "text-amber-700 dark:text-amber-300 bg-amber-500/10" :
                              "text-xyne-fg-muted bg-xyne-bg-secondary";
  return (
    <div className="rounded-lg bg-xyne-bg-secondary/30 p-3 flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap text-[11px]">
        <span className="font-mono px-2 py-0.5 rounded bg-xyne-bg-secondary text-xyne-fg-primary">{c.rootCause}</span>
        <span className={`px-2 py-0.5 rounded ${confTone}`}>{c.confidence}</span>
        <span className="text-xyne-fg-muted">·</span>
        <span className="text-xyne-fg-muted">{c.evidence.length} session{c.evidence.length === 1 ? "" : "s"} as evidence</span>
      </div>
      <div className="text-[13px] text-xyne-fg-primary">{c.finding}</div>
      <div className="rounded-md bg-xyne-bg-secondary px-3 py-2 text-[12px] flex items-start gap-2">
        <span className="font-mono text-xyne-fg-muted shrink-0">{c.proposedFix.type}:</span>
        <span className="text-xyne-fg-primary whitespace-pre-wrap break-words">{c.proposedFix.description}</span>
      </div>
      <div className="flex items-center gap-3 text-[11px]">
        <span className="text-xyne-fg-muted">Evidence:</span>
        <div className="flex flex-wrap gap-1">
          {c.evidence.slice(0, 8).map((sid) => (
            <span key={sid} className="font-mono px-1.5 py-0.5 rounded bg-xyne-bg-secondary text-xyne-fg-muted">{sid.slice(0, 14)}</span>
          ))}
          {c.evidence.length > 8 && <span className="text-xyne-fg-muted">+{c.evidence.length - 8} more</span>}
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 pt-1">
        <span className="text-[11px] text-xyne-fg-muted italic">
          “Mark as handled” records that you made this change manually — it does <em>not</em> auto-edit the agent.
        </span>
        <div className="flex gap-2">
          <button
            onClick={onDismiss}
            disabled={busy}
            title="Hide this finding and silence the same root cause for this agent for 7 days. Use when the finding isn't actionable."
            className="text-[12px] px-3 py-1 rounded-md bg-xyne-bg-secondary hover:bg-xyne-bg-secondary/70 text-xyne-fg-muted disabled:opacity-40"
          >
            Dismiss
          </button>
          <button
            onClick={onApply}
            disabled={busy}
            title="Mark as handled. Record-keeping only — does not apply the change. Make the edit yourself in the agent editor, then click this."
            className="text-[12px] px-3 py-1 rounded-md bg-xyne-fg-primary text-xyne-fg-inverse hover:opacity-90 disabled:opacity-40"
          >
            {busy ? "..." : "Mark as handled"}
          </button>
        </div>
      </div>
    </div>
  );
}

function MiniTile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg bg-xyne-bg-secondary/40 px-3 py-2 flex flex-col">
      <span className="text-[10px] uppercase tracking-wider text-xyne-fg-muted">{label}</span>
      <span className="text-[18px] font-semibold text-xyne-fg-primary tabular-nums mt-0.5">{value}</span>
      <span className="text-[10px] text-xyne-fg-muted mt-0.5">{sub}</span>
    </div>
  );
}

function ToolLatencyTable({ rows }: { rows: ToolLatencyRow[] }) {
  // Total of all tools' cumulative ms — drives the visual bar so the eye sees
  // proportional share at a glance instead of having to compare numbers.
  const grandTotal = rows.reduce((a, r) => a + (r.totalMs || 0), 0) || 1;
  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <table className="w-full min-w-[720px] text-[13px]">
        <thead>
          <tr className="text-left text-xyne-fg-muted text-[11px] uppercase tracking-wider">
            <th className="py-2 pr-3">Tool</th>
            <th className="py-2 pr-3 text-right">Calls</th>
            <th className="py-2 pr-3 text-right">Avg</th>
            <th className="py-2 pr-3 text-right">p50</th>
            <th className="py-2 pr-3 text-right">p95</th>
            <th className="py-2 pr-3 text-right">Cumulative</th>
            <th className="py-2 pr-3">Share</th>
            <th className="py-2 pr-3 text-right">Errors</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const share = r.totalMs / grandTotal;
            const isHot = share >= 0.25; // tools eating ≥25% of total tool time = headline offender
            return (
              <tr key={r.tool} className="border-t border-xyne-border">
                <td className={"py-2 pr-3 font-mono text-[12px] " + (isHot ? "text-amber-500" : "text-xyne-fg-primary")}>
                  {r.tool}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">{r.calls}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{fmtMs(r.avgMs)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{fmtMs(r.p50Ms)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{fmtMs(r.p95Ms)}</td>
                <td className="py-2 pr-3 text-right tabular-nums font-medium">{fmtMs(r.totalMs)}</td>
                <td className="py-2 pr-3">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-[120px] rounded-full bg-xyne-bg-secondary overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.max(2, share * 100)}%`,
                          background: isHot ? "#f59e0b" : "#6366f1",
                        }}
                      />
                    </div>
                    <span className="text-[11px] text-xyne-fg-muted tabular-nums w-[42px]">
                      {(share * 100).toFixed(1)}%
                    </span>
                  </div>
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {r.errors > 0 ? <span className="text-red-500">{r.errors}</span> : <span className="text-xyne-fg-muted">—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
