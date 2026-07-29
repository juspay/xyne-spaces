import { useState, useEffect, useCallback } from "react";
import {
  ChatCenteredDotsIcon,
  ArrowClockwiseIcon,
  SpinnerGapIcon,
  ArrowLeftIcon,
  ArrowUpIcon,
  ArrowDownIcon,
} from "@phosphor-icons/react";
import { getTwinReplyMetrics, type TwinReplyMetrics, type AdminOrgScope } from "../../../lib/api";

interface Props {
  userId: string;
  isAdmin?: boolean;
  onBack?: () => void;
}

type DayFilter = 7 | 30 | 90 | null;

const DAY_OPTIONS: { label: string; value: DayFilter }[] = [
  { label: "7d", value: 7 },
  { label: "30d", value: 30 },
  { label: "90d", value: 90 },
  { label: "All", value: null },
];

const ACTION_LABELS: Record<string, string> = {
  react: "React",
  reply: "Reply",
  react_and_reply: "React + reply",
};

const SOURCE_LABELS: Record<string, string> = {
  llm: "LLM",
  "rule-dm": "Rule · DM",
  "rule-thread": "Rule · thread",
  "insufficient-data": "Insufficient data",
  "no-patterns": "No patterns",
  "fail-open": "Fail-open",
  unknown: "Unknown",
};

// ── Formatters ───────────────────────────────────────────────────────────────

/** Fraction [0,1] → "NN.N%". */
const fmtPct = (v: number | null): string =>
  v === null || Number.isNaN(v) ? "—" : `${(v * 100).toFixed(1)}%`;

const fmtDurationSec = (sec: number | null): string => {
  if (sec === null || Number.isNaN(sec)) return "—";
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${(sec / 60).toFixed(1)}m`;
  if (sec < 86400) return `${(sec / 3600).toFixed(1)}h`;
  return `${(sec / 86400).toFixed(1)}d`;
};

// ── KPI card with optional prev-period delta (both fractions) ─────────────────

function Kpi({
  label,
  hint,
  value,
  current,
  previous,
  higherIsBetter,
}: {
  label: string;
  hint?: string;
  value: string;
  current?: number | null;
  previous?: number | null;
  higherIsBetter?: boolean;
}) {
  const hasDelta =
    current !== undefined &&
    current !== null &&
    previous !== undefined &&
    previous !== null &&
    !Number.isNaN(current) &&
    !Number.isNaN(previous);
  const diffPts = hasDelta ? (current! - previous!) * 100 : 0;
  const good = higherIsBetter ? diffPts >= 0 : diffPts <= 0;

  return (
    <div className="flex flex-1 flex-col justify-between gap-[16px] px-[24px] py-[20px]">
      <p className="text-[12px] text-xyne-fg-muted">
        {label}
        {hint && <span className="ml-[6px] text-xyne-fg-tertiary">· {hint}</span>}
      </p>
      <div>
        <p className="text-[40px] font-bold leading-none tracking-tight text-xyne-fg-primary">{value}</p>
        {hasDelta && Math.abs(diffPts) >= 0.05 && (
          <p
            className={`mt-[6px] flex items-center gap-[2px] text-[12px] font-medium ${
              good ? "text-xyne-success-fg" : "text-xyne-error-fg"
            }`}
          >
            {diffPts >= 0 ? <ArrowUpIcon size={11} weight="bold" /> : <ArrowDownIcon size={11} weight="bold" />}
            {Math.abs(diffPts).toFixed(1)} pts vs prior period
          </p>
        )}
      </div>
    </div>
  );
}

// ── Small stat tile ──────────────────────────────────────────────────────────

function Tile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-xl border border-xyne-border bg-xyne-surface px-[14px] py-[12px]">
      <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-xyne-fg-muted">{label}</p>
      <p className="mt-[4px] text-[20px] font-bold tabular-nums text-xyne-fg-primary">{value}</p>
      {detail && <p className="mt-[2px] text-[11px] text-xyne-fg-tertiary">{detail}</p>}
    </div>
  );
}

// ── Labeled proportion bar ───────────────────────────────────────────────────

function StatBar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="flex items-center gap-[10px]">
      <span className="w-[120px] shrink-0 text-[12px] text-xyne-fg-secondary">{label}</span>
      <div className="flex h-[6px] flex-1 overflow-hidden rounded-full bg-xyne-surface-sunken">
        <div className="transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="w-[64px] text-right text-[12px] font-semibold tabular-nums text-xyne-fg-primary">
        {value} · {pct}%
      </span>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function DigitalTwinReplyActivityPageV3({ userId, isAdmin = false, onBack }: Props) {
  const [metrics, setMetrics] = useState<TwinReplyMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState<DayFilter>(30);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [allOrgs, setAllOrgs] = useState(false);

  const useCustom = Boolean(from && to);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const orgScope: AdminOrgScope = isAdmin && allOrgs ? "all" : "org";
      const data = await getTwinReplyMetrics(userId, {
        days: useCustom ? null : days,
        from: useCustom ? `${from}T00:00:00.000Z` : null,
        to: useCustom ? `${to}T23:59:59.999Z` : null,
        orgScope,
      });
      setMetrics(data);
    } catch {
      setError("Failed to load reply metrics");
    } finally {
      setLoading(false);
    }
  }, [userId, isAdmin, allOrgs, useCustom, days, from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectPreset = (value: DayFilter) => {
    setFrom("");
    setTo("");
    setDays(value);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Header ── */}
      <div className="shrink-0 border-b border-xyne-border bg-xyne-surface">
        <div className="flex flex-wrap items-center gap-[12px] px-[24px] py-[14px]">
          <ChatCenteredDotsIcon size={20} className="text-xyne-brand" />
          <div>
            <h1 className="text-[15px] font-semibold text-xyne-fg-primary">Reply Activity</h1>
            <p className="text-[12px] text-xyne-fg-secondary">
              Draft approvals, edits, declines &amp; ignored · response time · the respond gate
            </p>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-[4px]">
            {onBack && (
              <button
                onClick={onBack}
                className="mr-[8px] flex items-center gap-[6px] rounded-lg border border-xyne-border bg-xyne-surface px-[10px] py-[5px] text-[12px] font-medium text-xyne-fg-secondary shadow-sm transition hover:bg-xyne-surface-sunken hover:text-xyne-fg-primary"
              >
                <ArrowLeftIcon size={13} />
                Overview
              </button>
            )}
            {isAdmin && (
              <button
                onClick={() => setAllOrgs((v) => !v)}
                className={`mr-[8px] rounded-md px-[10px] py-[4px] text-[12px] font-medium transition ${
                  allOrgs
                    ? "bg-xyne-brand/10 text-xyne-brand"
                    : "text-xyne-fg-muted hover:bg-xyne-surface-sunken hover:text-xyne-fg-primary"
                }`}
              >
                {allOrgs ? "All orgs" : "Your org"}
              </button>
            )}
            {DAY_OPTIONS.map((opt) => (
              <button
                key={opt.label}
                onClick={() => selectPreset(opt.value)}
                className={`rounded-md px-[10px] py-[4px] text-[12px] font-medium transition ${
                  !useCustom && days === opt.value
                    ? "bg-xyne-fg-primary text-xyne-fg-inverse"
                    : "text-xyne-fg-muted hover:bg-xyne-surface-sunken hover:text-xyne-fg-primary"
                }`}
              >
                {opt.label}
              </button>
            ))}
            <input
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded-md border border-xyne-border bg-xyne-surface px-[6px] py-[3px] text-[12px] text-xyne-fg-primary"
            />
            <span className="text-[12px] text-xyne-fg-muted">→</span>
            <input
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
              className="rounded-md border border-xyne-border bg-xyne-surface px-[6px] py-[3px] text-[12px] text-xyne-fg-primary"
            />
            <button
              onClick={() => void load()}
              disabled={loading}
              className="ml-[8px] flex h-[28px] w-[28px] items-center justify-center rounded-md text-xyne-fg-muted transition hover:bg-xyne-surface-sunken hover:text-xyne-fg-primary disabled:opacity-40"
              aria-label="Refresh"
            >
              {loading ? <SpinnerGapIcon size={14} className="animate-spin" /> : <ArrowClockwiseIcon size={14} />}
            </button>
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      {loading && !metrics && (
        <div className="flex flex-1 items-center justify-center">
          <SpinnerGapIcon size={22} className="animate-spin text-xyne-fg-muted" />
        </div>
      )}

      {error && (
        <div className="m-[16px] rounded-lg border border-xyne-border bg-xyne-error-bg p-[12px] text-[12px] text-xyne-error-fg">
          {error}{" "}
          <button onClick={() => void load()} className="underline">
            Retry
          </button>
        </div>
      )}

      {metrics && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-[20px] px-[24px] py-[20px]">
            {/* Scope line */}
            <p className="text-[12px] text-xyne-fg-tertiary">
              {metrics.scope.userCount} user{metrics.scope.userCount === 1 ? "" : "s"} ·{" "}
              {metrics.scope.orgScope === "all" ? "all organizations" : "your organization"}
            </p>

            {/* KPI row */}
            <div className="flex flex-wrap items-stretch divide-x divide-xyne-border rounded-xl border border-xyne-border bg-xyne-surface">
              <Kpi
                label="approval rate"
                hint="sent vs declined"
                value={fmtPct(metrics.replies.approvalRate)}
                current={metrics.replies.approvalRate}
                previous={metrics.replies.previousApprovalRate}
                higherIsBetter
              />
              <Kpi
                label="edit rate"
                hint="tweaked before send"
                value={fmtPct(metrics.replies.editRate)}
                current={metrics.replies.editRate}
                previous={metrics.replies.previousEditRate}
              />
              <Kpi
                label="median response"
                hint={`${metrics.replies.responseTime.count} decided`}
                value={fmtDurationSec(metrics.replies.responseTime.medianSec)}
              />
              <Kpi
                label="gate respond rate"
                hint="chose to respond"
                value={fmtPct(metrics.gate.respondRate)}
                current={metrics.gate.respondRate}
                previous={metrics.gate.previousRespondRate}
                higherIsBetter
              />
            </div>

            {/* Tiles */}
            <div className="grid grid-cols-2 gap-[12px] md:grid-cols-4">
              <Tile
                label="Approved"
                value={String(metrics.replies.totalApproved)}
                detail={`${metrics.replies.accepted} as-is · ${metrics.replies.acceptedEdited} edited`}
              />
              <Tile label="Declined" value={String(metrics.replies.declined)} />
              <Tile label="Ignored" value={String(metrics.replies.ignored)} detail="no owner action" />
              <Tile label="Pending" value={String(metrics.replies.pending)} />
              <Tile
                label="Gate decisions"
                value={String(metrics.gate.respond + metrics.gate.ignore)}
                detail={`${metrics.gate.respond} respond · ${metrics.gate.ignore} ignore`}
              />
              <Tile
                label="Gate errors"
                value={String(metrics.gate.error)}
                detail={metrics.gate.errorRate !== null ? `${fmtPct(metrics.gate.errorRate)} of runs` : ""}
              />
              <Tile
                label="Avg gate latency"
                value={metrics.gate.avgDurationMs !== null ? fmtDurationSec(metrics.gate.avgDurationMs / 1000) : "—"}
                detail={
                  metrics.gate.avgConfidence !== null
                    ? `conf ${(metrics.gate.avgConfidence * 100).toFixed(0)}%`
                    : ""
                }
              />
              <Tile
                label="Wrong silences"
                value={String(metrics.behavior.shouldHaveResponded)}
                detail="gate silent, user replied"
              />
            </div>

            {/* Breakdowns */}
            <div className="grid gap-[16px] lg:grid-cols-2">
              <div className="rounded-xl border border-xyne-border bg-xyne-surface p-[16px]">
                <h2 className="mb-[12px] text-[13px] font-semibold text-xyne-fg-primary">Draft outcomes</h2>
                <div className="flex flex-col gap-[10px]">
                  {(() => {
                    const r = metrics.replies;
                    const t = r.total || 1;
                    const rows = [
                      { label: "Approved (as-is)", value: r.accepted, color: "#22c55e" },
                      { label: "Approved (edited)", value: r.acceptedEdited, color: "#3b82f6" },
                      { label: "Declined", value: r.declined, color: "#ef4444" },
                      { label: "Ignored", value: r.ignored, color: "#f59e0b" },
                      { label: "Pending", value: r.pending, color: "#94a3b8" },
                    ].filter((x) => x.value > 0);
                    return rows.length > 0 ? (
                      rows.map((x) => <StatBar key={x.label} label={x.label} value={x.value} total={t} color={x.color} />)
                    ) : (
                      <p className="text-[12px] text-xyne-fg-tertiary">No drafts yet.</p>
                    );
                  })()}
                </div>
                {metrics.replies.byAction.length > 0 && (
                  <div className="mt-[14px] flex flex-wrap gap-[8px] border-t border-xyne-border pt-[12px]">
                    {metrics.replies.byAction.map((a) => (
                      <span
                        key={a.action}
                        className="rounded-full border border-xyne-border bg-xyne-surface-sunken px-[8px] py-[2px] text-[11px] text-xyne-fg-secondary"
                      >
                        {ACTION_LABELS[a.action] ?? a.action}: {a.count}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-xyne-border bg-xyne-surface p-[16px]">
                <h2 className="mb-[12px] text-[13px] font-semibold text-xyne-fg-primary">Respond gate</h2>
                <div className="flex flex-col gap-[10px]">
                  {(() => {
                    const g = metrics.gate;
                    const t = g.total || 1;
                    const rows = [
                      { label: "Respond", value: g.respond, color: "#22c55e" },
                      { label: "Ignore", value: g.ignore, color: "#f59e0b" },
                      { label: "Error", value: g.error, color: "#ef4444" },
                    ].filter((x) => x.value > 0);
                    return rows.length > 0 ? (
                      rows.map((x) => <StatBar key={x.label} label={x.label} value={x.value} total={t} color={x.color} />)
                    ) : (
                      <p className="text-[12px] text-xyne-fg-tertiary">No gate decisions yet.</p>
                    );
                  })()}
                </div>
                {metrics.gate.byDecisionSource.length > 0 && (
                  <div className="mt-[14px] border-t border-xyne-border pt-[12px]">
                    <p className="mb-[8px] text-[11px] font-medium uppercase tracking-[0.06em] text-xyne-fg-muted">
                      Decision source
                    </p>
                    <div className="flex flex-col gap-[6px]">
                      {metrics.gate.byDecisionSource.map((s) => (
                        <div key={s.source} className="flex items-center justify-between text-[12px]">
                          <span className="text-xyne-fg-secondary">{SOURCE_LABELS[s.source] ?? s.source}</span>
                          <span className="tabular-nums text-xyne-fg-tertiary">
                            {s.respond} respond · {s.ignore} ignore
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Per-user table */}
            <ReplyPerUserTable rows={metrics.byUser} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Per-user table ───────────────────────────────────────────────────────────

function ReplyPerUserTable({ rows }: { rows: TwinReplyMetrics["byUser"] }) {
  return (
    <div className="rounded-xl border border-xyne-border bg-xyne-surface p-[16px]">
      <h2 className="mb-[12px] text-[13px] font-semibold text-xyne-fg-primary">By user</h2>
      {rows.length === 0 ? (
        <p className="text-[12px] text-xyne-fg-tertiary">No user activity in range.</p>
      ) : (
        <div className="max-h-[420px] overflow-auto rounded-lg border border-xyne-border">
          <table className="w-full border-collapse text-[12px]">
            <thead className="sticky top-0 z-10 bg-xyne-surface">
              <tr className="border-b border-xyne-border text-[10px] uppercase tracking-[0.06em] text-xyne-fg-muted">
                <th className="px-[10px] py-[8px] text-left font-medium">User</th>
                <th className="px-[10px] py-[8px] text-right font-medium">Approved</th>
                <th className="px-[10px] py-[8px] text-right font-medium">Declined</th>
                <th className="px-[10px] py-[8px] text-right font-medium">Ignored</th>
                <th className="px-[10px] py-[8px] text-right font-medium">Approval %</th>
                <th className="px-[10px] py-[8px] text-right font-medium">Med. resp</th>
                <th className="px-[10px] py-[8px] text-right font-medium">Gate ✓/✕</th>
                <th className="px-[10px] py-[8px] text-right font-medium">Err</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.userId} className="border-b border-xyne-border/60 last:border-0 hover:bg-xyne-surface-sunken">
                  <td className="px-[10px] py-[8px]">
                    <p className="font-medium text-xyne-fg-primary">{r.name}</p>
                    {r.email && <p className="text-[11px] text-xyne-fg-tertiary">{r.email}</p>}
                  </td>
                  <td className="px-[10px] py-[8px] text-right tabular-nums text-xyne-fg-primary">
                    {r.replies.totalApproved}
                    {r.replies.acceptedEdited > 0 && (
                      <span className="text-[11px] text-xyne-fg-tertiary"> ({r.replies.acceptedEdited}e)</span>
                    )}
                  </td>
                  <td className="px-[10px] py-[8px] text-right tabular-nums text-xyne-fg-primary">{r.replies.declined}</td>
                  <td className="px-[10px] py-[8px] text-right tabular-nums text-xyne-fg-tertiary">{r.replies.ignored}</td>
                  <td className="px-[10px] py-[8px] text-right tabular-nums text-xyne-fg-primary">{fmtPct(r.replies.approvalRate)}</td>
                  <td className="px-[10px] py-[8px] text-right tabular-nums text-xyne-fg-primary">{fmtDurationSec(r.replies.medianResponseSec)}</td>
                  <td className="px-[10px] py-[8px] text-right tabular-nums text-xyne-fg-secondary">
                    {r.gate.respond}/{r.gate.ignore}
                  </td>
                  <td className="px-[10px] py-[8px] text-right tabular-nums">
                    {r.gate.error > 0 ? <span className="text-xyne-error-fg">{r.gate.error}</span> : "0"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
