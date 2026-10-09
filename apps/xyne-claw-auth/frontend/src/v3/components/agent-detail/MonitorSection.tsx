import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowClockwiseIcon } from "@phosphor-icons/react";
import { closeLostRuns, getAgentRunHealth, type AgentRunHealth, type InflightState, type RunSource } from "../../../lib/api";
import { useSnackbar } from "../ui/Snackbar";
import { RunDetailDialog, SOURCE_LABEL, StatusPill, fmtMs } from "./RunDetailDialog";

const WINDOWS = [1, 7, 30] as const;
const REFRESH_MS = 15000;

type Tab = RunSource | "all";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "all", label: "All" },
  { id: "automation", label: "Automations" },
  { id: "scheduled", label: "Scheduled" },
  { id: "people", label: "People" },
  { id: "workflow", label: "Workflows" },
  { id: "delegated", label: "Called by agents" },
  { id: "awakening", label: "Awakening" },
];

const STATE_COPY: Record<InflightState, { label: string; hint: string }> = {
  live: { label: "Live now", hint: "made progress in the last 5 minutes" },
  stuck: { label: "Stuck", hint: "no progress for 5+ minutes, may still recover" },
  lost: { label: "Lost", hint: "no pod holds it; it will never report back" },
};

const ago = (iso: string) => `${fmtMs(Date.now() - new Date(iso).getTime())} ago`;
const pct = (part: number, whole: number) => (whole === 0 ? "—" : `${Math.round((part / whole) * 1000) / 10}%`);

function Group({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-0.5">
        <span className="text-[13px] font-semibold text-xyne-fg-primary">{title}</span>
        {note && <span className="text-[11px] text-xyne-fg-tertiary">{note}</span>}
      </div>
      {children}
    </div>
  );
}

function Table({ head, rows, onRowClick, empty }: { head: string[]; rows: Array<Array<React.ReactNode>>; onRowClick?: (i: number) => void; empty: string }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-xyne-border bg-xyne-surface">
      <table className="w-full text-[12px] tabular-nums">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-xyne-fg-tertiary">
            {head.map((h) => (
              <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-xyne-border-subtle">
          {rows.length === 0 && (
            <tr>
              <td colSpan={head.length} className="px-3 py-3 text-xyne-fg-tertiary">{empty}</td>
            </tr>
          )}
          {rows.map((r, i) => (
            <tr
              key={i}
              tabIndex={onRowClick ? 0 : undefined}
              onClick={onRowClick ? () => onRowClick(i) : undefined}
              onKeyDown={onRowClick ? (e) => { if (e.key === "Enter") onRowClick(i); } : undefined}
              className={`text-xyne-fg-secondary ${onRowClick ? "cursor-pointer hover:bg-xyne-surface-sunken focus:bg-xyne-surface-sunken focus:outline-none" : ""}`}
            >
              {r.map((c, j) => (
                <td key={j} className="px-3 py-2 align-top">{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StateCard({ state, count, active, onClick }: { state: InflightState; count: number; active: boolean; onClick: () => void }) {
  const tone = state === "stuck" ? "text-xyne-warning-fg" : "text-xyne-error-fg";
  const dot = state === "live" ? "bg-xyne-success" : state === "stuck" ? "bg-xyne-warning-fg" : "bg-xyne-error-fg";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex flex-col gap-0.5 rounded-xl border bg-xyne-surface px-3 py-2.5 text-left transition-colors ${active ? "border-xyne-border-strong" : "border-xyne-border-subtle hover:border-xyne-border"}`}
    >
      <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-xyne-fg-tertiary">
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        {STATE_COPY[state].label}
      </span>
      <span className={`text-[22px] font-semibold tabular-nums ${count > 0 && state !== "live" ? tone : "text-xyne-fg-primary"}`}>{count}</span>
      <span className="text-[11px] leading-snug text-xyne-fg-tertiary">{STATE_COPY[state].hint}</span>
    </button>
  );
}

function Kpi({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className={`flex flex-col gap-0.5 border-l-2 px-3 py-1 ${warn ? "border-xyne-error-border" : "border-xyne-border-subtle"}`}>
      <span className="text-[11px] uppercase tracking-wide text-xyne-fg-tertiary">{label}</span>
      <span className={`text-[16px] font-semibold tabular-nums ${warn ? "text-xyne-error-fg" : "text-xyne-fg-primary"}`}>{value}</span>
      {sub && <span className="text-[11px] text-xyne-fg-tertiary">{sub}</span>}
    </div>
  );
}

function DailyBars({ days }: { days: Array<{ day: string; completed: number; failed: number; lost: number }> }) {
  const max = Math.max(1, ...days.map((d) => d.completed + d.failed + d.lost));
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-xyne-border bg-xyne-surface px-3 pb-2 pt-3">
      <div className="flex h-24 items-end gap-1">
        {days.map((d) => {
          const h = (v: number) => `${(v / max) * 100}%`;
          return (
            <div
              key={d.day}
              className="flex h-full min-w-0 flex-1 flex-col-reverse"
              title={`${d.day}: ${d.completed} completed, ${d.failed} failed, ${d.lost} lost`}
            >
              <div className="bg-xyne-success" style={{ height: h(d.completed) }} />
              <div className="bg-xyne-error-fg" style={{ height: h(d.failed) }} />
              <div className="bg-xyne-warning-fg" style={{ height: h(d.lost) }} />
            </div>
          );
        })}
      </div>
      <div className="flex gap-1">
        {days.map((d) => (
          <span key={d.day} className="min-w-0 flex-1 truncate text-center text-[10px] text-xyne-fg-tertiary">
            {d.day.slice(5)}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-3 text-[11px] text-xyne-fg-secondary">
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-xyne-success" />Completed</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-xyne-error-fg" />Failed</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-xyne-warning-fg" />Lost</span>
      </div>
    </div>
  );
}

export function MonitorSection({ slug }: { slug: string }) {
  const { show } = useSnackbar();
  const [days, setDays] = useState<(typeof WINDOWS)[number]>(7);
  const [data, setData] = useState<AgentRunHealth | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("all");
  const [stateFilter, setStateFilter] = useState<InflightState | null>(null);
  const [openRun, setOpenRun] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await getAgentRunHealth(slug, days));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load run health");
    } finally {
      setLoading(false);
    }
  }, [slug, days]);

  useEffect(() => {
    void load();
  }, [load]);

  const hasActive = data?.inflight.some((r) => r.state !== "lost") ?? false;
  useEffect(() => {
    if (!hasActive) return;
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [hasActive, load]);

  const inTab = useCallback((source: RunSource) => tab === "all" || source === tab, [tab]);

  const visibleTabs = useMemo(
    () =>
      TABS.filter(
        (t) =>
          t.id === "all" ||
          (data?.sources.find((s) => s.id === t.id)?.runs ?? 0) > 0 ||
          (data?.inflight.some((r) => r.source === t.id) ?? false),
      ),
    [data],
  );

  const inflight = useMemo(() => (data?.inflight ?? []).filter((r) => inTab(r.source)), [data, inTab]);
  const counts = useMemo(
    () => ({
      live: inflight.filter((r) => r.state === "live").length,
      stuck: inflight.filter((r) => r.state === "stuck").length,
      lost: inflight.filter((r) => r.state === "lost").length,
    }),
    [inflight],
  );
  const activeState: InflightState =
    stateFilter ?? (counts.live > 0 ? "live" : counts.stuck > 0 ? "stuck" : counts.lost > 0 ? "lost" : "live");

  const stats = data?.sources.find((s) => s.id === tab);
  const lostInTab = inflight.filter((r) => r.state === "lost");

  const dailyRows = useMemo(
    () =>
      (data?.daily ?? []).map((d) => {
        const t = { day: d.day, completed: 0, failed: 0, lost: 0 };
        for (const [source, v] of Object.entries(d.bySource)) {
          if (!v || !inTab(source as RunSource)) continue;
          t.completed += v.completed;
          t.failed += v.failed;
          t.lost += v.lost;
        }
        return t;
      }),
    [data, inTab],
  );

  const reasons = (data?.reasons ?? [])
    .map((r) => ({ ...r, n: tab === "all" ? r.count : r.bySource[tab] ?? 0 }))
    .filter((r) => r.n > 0);

  const models = (data?.models ?? [])
    .map((m) => {
      const s = tab === "all" ? { runs: m.runs, failed: m.failed } : m.bySource[tab] ?? { runs: 0, failed: 0 };
      return { ...m, tabRuns: s.runs, tabFailed: s.failed };
    })
    .filter((m) => m.tabRuns > 0);

  const recent = (data?.recentRuns ?? []).filter((r) => inTab(r.source)).slice(0, 20);
  const listed = inflight.filter((r) => r.state === activeState).slice(0, 50);

  const closeLost = async () => {
    if (lostInTab.length === 0) return;
    setClosing(true);
    try {
      const result = await closeLostRuns(slug, lostInTab.map((r) => r.sessionId));
      show({
        variant: "info",
        title: `Closed ${result.closed.length} lost runs as failed`,
        description: result.skipped.length > 0 ? `${result.skipped.length} were no longer lost and were left alone.` : undefined,
      });
      await load();
    } catch (err) {
      show({ variant: "error", title: "Could not close lost runs", description: err instanceof Error ? err.message : undefined });
    } finally {
      setClosing(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-2">
        <div className="inline-flex overflow-hidden rounded-lg border border-xyne-border">
          {WINDOWS.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setDays(w)}
              className={`px-3 py-1 text-[12px] ${days === w ? "bg-xyne-surface-sunken font-semibold text-xyne-fg-primary" : "text-xyne-fg-tertiary hover:text-xyne-fg-primary"}`}
            >
              {w === 1 ? "24h" : `${w}d`}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1 text-[12px] text-xyne-fg-tertiary hover:text-xyne-fg-primary disabled:opacity-50"
        >
          <ArrowClockwiseIcon size={14} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {error && <div className="rounded-lg border border-xyne-error-border bg-xyne-error-bg px-3 py-2 text-[12px] text-xyne-error-fg">{error}</div>}
      {!data && !error && <div className="text-[12px] text-xyne-fg-tertiary">Loading runs…</div>}

      {data && stats && (
        <>
          <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-xyne-border-subtle">
            {visibleTabs.map((t) => {
              const s = data.sources.find((x) => x.id === t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  onClick={() => {
                    setTab(t.id);
                    setStateFilter(null);
                  }}
                  className={`-mb-px inline-flex items-baseline gap-1.5 whitespace-nowrap border-b-2 px-2.5 pb-2 pt-1 text-[12px] ${tab === t.id ? "border-xyne-fg-primary font-semibold text-xyne-fg-primary" : "border-transparent text-xyne-fg-tertiary hover:text-xyne-fg-primary"}`}
                >
                  {t.label}
                  <span className="font-mono text-[11px] text-xyne-fg-tertiary">{(s?.runs ?? 0).toLocaleString()}</span>
                  {(s?.failed ?? 0) > 0 && <span className="font-mono text-[11px] text-xyne-error-fg">{s!.failed} failed</span>}
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-3 gap-2">
            {(["live", "stuck", "lost"] as const).map((s) => (
              <StateCard key={s} state={s} count={counts[s]} active={activeState === s} onClick={() => setStateFilter(s)} />
            ))}
          </div>

          <div className="grid grid-cols-2 gap-x-2 gap-y-3 sm:grid-cols-4">
            <Kpi
              label="Runs"
              value={data.sampled ? `${stats.runs.toLocaleString()}+` : stats.runs.toLocaleString()}
              sub={`${stats.completed.toLocaleString()} completed`}
            />
            <Kpi label="Success" value={pct(stats.completed, stats.runs + stats.lost)} sub="lost runs count against it" />
            <Kpi label="Failed" value={stats.failed.toLocaleString()} sub={`${pct(stats.failed, stats.runs)} of runs`} warn={stats.failed > 0} />
            <Kpi label="Duration" value={fmtMs(stats.p50Ms)} sub={`p90 ${fmtMs(stats.p90Ms)}`} />
          </div>

          {lostInTab.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-xyne-error-border bg-xyne-error-bg px-3 py-2.5">
              <p className="m-0 max-w-[560px] text-[12px] leading-relaxed text-xyne-fg-primary">
                <strong>{lostInTab.length} runs are not actually running.</strong> No claw pod holds them and nothing has happened for over an
                hour, so the result is never coming back. The oldest started {fmtMs(Math.max(...lostInTab.map((r) => r.ageMs)))} ago.
              </p>
              <button
                type="button"
                disabled={closing}
                onClick={() => void closeLost()}
                className="rounded-lg border border-xyne-error-border bg-xyne-surface px-3 py-1.5 text-[12px] font-semibold text-xyne-error-fg hover:bg-xyne-error-bg disabled:opacity-50"
              >
                {closing ? "Closing…" : `Close ${lostInTab.length} as failed`}
              </button>
            </div>
          )}

          <Group
            title={STATE_COPY[activeState].label}
            note={activeState === "lost" ? "oldest first · click to see where it stopped" : "click a run to watch it"}
          >
            <Table
              head={["Source", "Task", "Running for", "Last activity", "Current step"]}
              empty={`Nothing ${STATE_COPY[activeState].label.toLowerCase()} right now.`}
              onRowClick={(i) => setOpenRun(listed[i]!.sessionId)}
              rows={listed.map((r) => [
                SOURCE_LABEL[r.source],
                <span key="t" className="line-clamp-2 break-words text-xyne-fg-primary">{r.task}</span>,
                fmtMs(r.ageMs),
                `${fmtMs(r.idleMs)} ago`,
                <span key="s" className="font-mono text-[11px]">{r.currentStep ?? "—"}</span>,
              ])}
            />
          </Group>

          {dailyRows.length > 1 && (
            <Group title="Runs per day">
              <DailyBars days={dailyRows} />
            </Group>
          )}

          <Group title="Why runs fail" note="grouped, ids stripped">
            <Table
              head={["Count", "Reason", "Last seen"]}
              empty="No failures in this window."
              rows={reasons.map((r) => [
                <span key="n" className="font-mono text-xyne-error-fg">{r.n}×</span>,
                <span key="e" className="break-words text-xyne-fg-primary">{r.error}</span>,
                ago(r.lastAt),
              ])}
            />
          </Group>

          <Group title="Models" note="LLM time per run, p50">
            <Table
              head={["Model", "Provider", "Runs", "Failed", "LLM time"]}
              empty="No runs in this window."
              rows={models.map((m) => [
                <span key="m" className="font-mono text-[11px]">{m.model}</span>,
                m.provider,
                m.tabRuns.toLocaleString(),
                <span key="f" className={m.tabFailed > 0 ? "text-xyne-error-fg" : ""}>
                  {m.tabFailed} ({pct(m.tabFailed, m.tabRuns)})
                </span>,
                fmtMs(m.llmP50Ms),
              ])}
            />
          </Group>

          <Group title="Recent runs" note="click to open the full run">
            <Table
              head={["Outcome", "Source", "Started by", "Task", "When", "Took"]}
              empty="No finished runs from this source in this window."
              onRowClick={(i) => setOpenRun(recent[i]!.sessionId)}
              rows={recent.map((r) => [
                <StatusPill key="s" status={r.status} />,
                SOURCE_LABEL[r.source],
                r.startedBy ?? "—",
                <span key="t" className="line-clamp-2 break-words">{r.task}</span>,
                ago(r.startedAt),
                fmtMs(r.durationMs),
              ])}
            />
          </Group>
        </>
      )}

      <RunDetailDialog slug={slug} sessionId={openRun} onClose={() => setOpenRun(null)} onChanged={() => void load()} />
    </div>
  );
}
