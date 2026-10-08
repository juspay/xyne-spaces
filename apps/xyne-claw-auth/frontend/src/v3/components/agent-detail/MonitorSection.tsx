import { useCallback, useEffect, useState } from "react";
import { ArrowClockwiseIcon, CopyIcon } from "@phosphor-icons/react";
import { getAgentRunHealth, type AgentRunHealth } from "../../../lib/api";
import { useSnackbar } from "../ui/Snackbar";
import { RunDetailDialog, StatusPill, fmtMs } from "./RunDetailDialog";

const WINDOWS = [1, 7, 30] as const;
const LIVE_REFRESH_MS = 15000;

function pct(part: number, whole: number): string {
  if (whole === 0) return "—";
  return `${Math.round((part / whole) * 1000) / 10}%`;
}

function ago(iso: string): string {
  return `${fmtMs(Date.now() - new Date(iso).getTime())} ago`;
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "error" | "warning" | "success" }) {
  const color =
    tone === "error" ? "text-xyne-error-fg" : tone === "warning" ? "text-xyne-warning-fg" : tone === "success" ? "text-xyne-success-fg" : "text-xyne-fg-primary";
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-xyne-border-subtle bg-xyne-surface-sunken px-3 py-2">
      <span className="text-[11px] uppercase tracking-wide text-xyne-fg-tertiary">{label}</span>
      <span className={`text-[18px] font-semibold tabular-nums ${color}`}>{value}</span>
      {sub && <span className="text-[11px] text-xyne-fg-tertiary">{sub}</span>}
    </div>
  );
}

function Group({ title, children, note }: { title: string; children: React.ReactNode; note?: string }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between px-0.5">
        <span className="text-[13px] font-semibold text-xyne-fg-primary">{title}</span>
        {note && <span className="text-[11px] text-xyne-fg-tertiary">{note}</span>}
      </div>
      {children}
    </div>
  );
}

function Table({ head, rows, onRowClick }: { head: string[]; rows: Array<Array<React.ReactNode>>; onRowClick?: (index: number) => void }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-xyne-border bg-xyne-surface">
      <table className="w-full text-[12px] tabular-nums">
        <thead>
          <tr className="text-left text-xyne-fg-tertiary">
            {head.map((h) => (
              <th key={h} className="px-3 py-2 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-xyne-border-subtle">
          {rows.map((r, i) => (
            <tr
              key={i}
              onClick={onRowClick ? () => onRowClick(i) : undefined}
              className={`text-xyne-fg-secondary ${onRowClick ? "cursor-pointer hover:bg-xyne-surface-sunken" : ""}`}
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

function DailyBars({ daily }: { daily: AgentRunHealth["daily"] }) {
  const max = Math.max(1, ...daily.map((d) => d.runs));
  return (
    <div className="flex h-20 items-end gap-1 rounded-xl border border-xyne-border bg-xyne-surface px-3 pb-2 pt-3">
      {daily.map((d) => {
        const total = (d.runs / max) * 100;
        const failed = d.runs === 0 ? 0 : (d.failed / d.runs) * 100;
        return (
          <div key={d.day} className="flex h-full flex-1 flex-col justify-end" title={`${d.day}: ${d.runs} runs, ${d.failed} failed`}>
            <div className="flex w-full flex-col overflow-hidden rounded-sm bg-xyne-success" style={{ height: `${Math.max(total, 2)}%` }}>
              <div className="w-full bg-xyne-error-fg" style={{ height: `${failed}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SessionId({ id }: { id: string }) {
  const { show } = useSnackbar();
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard.writeText(id).then(() => show({ variant: "info", title: "Session id copied" }));
      }}
      className="inline-flex items-center gap-1 font-mono text-[11px] text-xyne-fg-secondary hover:text-xyne-fg-primary"
      title="Copy session id"
    >
      {id.length > 26 ? `${id.slice(0, 12)}…${id.slice(-10)}` : id}
      <CopyIcon size={12} />
    </button>
  );
}

export function MonitorSection({ slug }: { slug: string }) {
  const [days, setDays] = useState<(typeof WINDOWS)[number]>(7);
  const [data, setData] = useState<AgentRunHealth | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openRun, setOpenRun] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await getAgentRunHealth(slug, days));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load run health");
    } finally {
      setLoading(false);
    }
  }, [slug, days]);

  useEffect(() => {
    void load();
  }, [load]);

  const hasRunning = (data?.runningNow.length ?? 0) > 0;
  useEffect(() => {
    if (!hasRunning) return;
    const timer = setInterval(() => void load(), LIVE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [hasRunning, load]);

  const stuck = data?.runningNow.filter((r) => r.stuck).length ?? 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
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

      {error && (
        <div className="rounded-lg border border-xyne-error-border bg-xyne-error-bg px-3 py-2 text-[12px] text-xyne-error-fg">{error}</div>
      )}
      {!data && !error && <div className="text-[12px] text-xyne-fg-tertiary">Loading runs…</div>}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Runs" value={data.sampled ? `${data.totals.runs}+` : String(data.totals.runs)} sub={data.sampled ? "latest runs only" : `${data.totals.completed} completed`} />
            <Stat
              label="Failed"
              value={String(data.totals.failed)}
              sub={`${pct(data.totals.failed, data.totals.runs)} of runs`}
              tone={data.totals.failed > 0 ? "error" : undefined}
            />
            <Stat
              label="Running now"
              value={String(data.runningNow.length)}
              sub={stuck > 0 ? `${stuck} stuck` : "none stuck"}
              tone={stuck > 0 ? "warning" : undefined}
            />
            <Stat label="Duration" value={fmtMs(data.duration.p50Ms)} sub={`p90 ${fmtMs(data.duration.p90Ms)}`} />
          </div>

          {data.daily.length > 1 && (
            <Group title="Runs per day" note="red = failed">
              <DailyBars daily={data.daily} />
            </Group>
          )}

          {data.runningNow.length > 0 && (
            <Group title="Running now" note={`click a run to watch it · stuck after ${fmtMs(data.stuckAfterMs)}`}>
              <Table
                onRowClick={(i) => setOpenRun(data.runningNow[i]!.sessionId)}
                head={["Session", "Trigger", "Running for", "Current step"]}
                rows={data.runningNow.map((r) => [
                  <SessionId key="s" id={r.sessionId} />,
                  r.trigger,
                  <span key="a" className={r.stuck ? "font-semibold text-xyne-warning-fg" : ""}>
                    {fmtMs(r.ageMs)}{r.stuck ? " · stuck" : ""}
                  </span>,
                  r.currentTool ?? "—",
                ])}
              />
            </Group>
          )}

          {data.byTrigger.length > 0 && (
            <Group title="By trigger">
              <Table
                head={["Trigger", "Runs", "Failed", "p50", "p90"]}
                rows={data.byTrigger.map((t) => [
                  t.trigger,
                  t.runs,
                  <span key="f" className={t.failed > 0 ? "text-xyne-error-fg" : ""}>{t.failed} ({pct(t.failed, t.runs)})</span>,
                  fmtMs(t.p50Ms),
                  fmtMs(t.p90Ms),
                ])}
              />
            </Group>
          )}

          {data.byModel.length > 0 && (
            <Group title="Models" note="LLM time per run, p50">
              <Table
                head={["Model", "Provider", "Runs", "Failed", "LLM time"]}
                rows={data.byModel.map((m) => [
                  m.model,
                  m.provider,
                  m.runs,
                  <span key="f" className={m.failed > 0 ? "text-xyne-error-fg" : ""}>{m.failed} ({pct(m.failed, m.runs)})</span>,
                  fmtMs(m.llmP50Ms),
                ])}
              />
            </Group>
          )}

          {data.topErrors.length > 0 && (
            <Group title="Top failure reasons">
              <Table
                head={["Error", "Count", "Last seen"]}
                rows={data.topErrors.map((e) => [
                  <span key="e" className="break-words text-xyne-fg-primary">{e.error}</span>,
                  e.count,
                  ago(e.lastAt),
                ])}
              />
            </Group>
          )}

          {data.recentFailures.length > 0 && (
            <Group title="Recent failures">
              <Table
                onRowClick={(i) => setOpenRun(data.recentFailures[i]!.sessionId)}
                head={["Session", "Trigger", "When", "Model", "Error"]}
                rows={data.recentFailures.map((f) => [
                  <SessionId key="s" id={f.sessionId} />,
                  f.trigger,
                  ago(f.startedAt),
                  f.model ?? "—",
                  <span key="e" className="line-clamp-2 break-words">{f.error}</span>,
                ])}
              />
            </Group>
          )}

          {data.recentRuns.length > 0 && (
            <Group title="Recent runs" note="click to open">
              <Table
                onRowClick={(i) => setOpenRun(data.recentRuns[i]!.sessionId)}
                head={["Status", "Trigger", "When", "Took", "Task"]}
                rows={data.recentRuns.map((r) => [
                  <StatusPill key="s" status={r.status} />,
                  r.trigger,
                  ago(r.startedAt),
                  fmtMs(r.durationMs),
                  <span key="t" className="line-clamp-2 break-words">{r.task}</span>,
                ])}
              />
            </Group>
          )}

          {data.totals.runs === 0 && data.runningNow.length === 0 && (
            <div className="text-[12px] text-xyne-fg-tertiary">No runs in this window.</div>
          )}
        </>
      )}

      <RunDetailDialog slug={slug} sessionId={openRun} onClose={() => setOpenRun(null)} />
    </div>
  );
}
