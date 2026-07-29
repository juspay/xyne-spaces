/**
 * AgentsDashboardPageV3 — Global analytics dashboard.
 *
 * Sections:
 *   1. Overview stat cards (global agents, runs, users, tokens)
 *   2. Global Agents table (searchable + sortable)
 *   3. Agent Inventory breakdown
 *   4. Top Users (expandable per-agent drill-down)
 */
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  RobotIcon,
  UsersIcon,
  ChartBarIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  MagnifyingGlassIcon,
  WarningCircleIcon,
  SpinnerGapIcon,
  LightningIcon,
  CoinIcon,
  CaretDownIcon,
  CaretRightIcon,
  ChatTextIcon,
  ArrowSquareOutIcon,
  SparkleIcon,
  GitPullRequestIcon,
  GitCommitIcon,
  ArrowClockwiseIcon,
  XIcon,
} from "@phosphor-icons/react";
import { PageLayout } from "./ui/PageLayout";
import { Badge } from "./ui/Badge";
import {
  getAgentDashboard,
  getDoctorBitbucketStats,
  type AgentDashboardData,
  type DashboardAgentRow,
  type AdminUserActivityRow,
  type SkillUsageRow,
  type SubagentUsageRow,
  type DoctorBitbucketStats,
} from "../../lib/api";
import { ProjectInsightsSection } from "./ProjectInsightsSection";

// ── Types ──────────────────────────────────────────────────────────────
type Days = 7 | 30 | 90 | "all";
type AgentSortKey =
  | "agentName"
  | "totalRuns"
  | "uniqueUsers"
  | "avgDurationMs"
  | "totalTokensIn"
  | "negativeRate"
  | "agentRegistered";

// ── Helpers ────────────────────────────────────────────────────────────
export function fmtNum(n: number): string {
  // B tier so cache-inclusive token totals don't render as "4970.4M".
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + "B";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

export function fmtDuration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1_000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

export function fmtPct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function fmtRelativeTime(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

// ── StatCard ───────────────────────────────────────────────────────────
function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon?: React.ElementType;
  accent?: "green" | "red" | "blue" | "purple" | "amber";
}) {
  const accentCls: Record<string, string> = {
    green: "text-emerald-600 dark:text-emerald-400",
    red: "text-red-500",
    blue: "text-xyne-brand",
    purple: "text-purple-500",
    amber: "text-amber-500",
  };
  const iconColor = accent ? accentCls[accent] : "text-xyne-fg-tertiary";
  return (
    <div
      data-id="stat-card"
      className="flex flex-col gap-1.5 rounded-xl border border-xyne-border-subtle bg-xyne-surface p-4 shadow-sm"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-medium uppercase tracking-wide text-xyne-fg-muted">
          {label}
        </span>
        {Icon && <Icon size={15} className={iconColor} />}
      </div>
      <div className="text-[26px] font-bold leading-none text-xyne-fg-primary">
        {value}
      </div>
      {sub && (
        <div className="text-[12px] text-xyne-fg-tertiary">{sub}</div>
      )}
    </div>
  );
}

// ── AgentTable ────────────────────────────────────────────────────────
function SortIcon({
  col,
  activeCol,
  dir,
}: {
  col: string;
  activeCol: string;
  dir: "asc" | "desc";
}) {
  if (col !== activeCol) return null;
  return dir === "asc" ? (
    <ArrowUpIcon size={10} className="inline ml-0.5" />
  ) : (
    <ArrowDownIcon size={10} className="inline ml-0.5" />
  );
}

export function AgentTable({
  rows,
  search: searchProp,
  onSearchChange,
}: {
  rows: DashboardAgentRow[];
  /** Optional controlled search value. When both `search` and
   *  `onSearchChange` are provided, the table treats search as
   *  externally controlled — its internal `<input>` is hidden so the
   *  parent can render the input wherever it wants (e.g. inline with
   *  the section heading on the Projects page). */
  search?: string;
  onSearchChange?: (value: string) => void;
}) {
  const navigate = useNavigate();
  const isControlled = searchProp !== undefined && onSearchChange !== undefined;
  const [internalSearch, setInternalSearch] = useState("");
  const search = isControlled ? searchProp! : internalSearch;
  const setSearch = (v: string) =>
    isControlled ? onSearchChange!(v) : setInternalSearch(v);
  const [sortKey, setSortKey] = useState<AgentSortKey>("totalRuns");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [expandedSlug, setExpandedSlug] = useState<string | null>(null);

  const toggleExpand = (slug: string) =>
    setExpandedSlug((prev) => (prev === slug ? null : slug));

  const handleSort = (key: AgentSortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return rows
      .filter(
        (r) =>
          !q ||
          r.agentName.toLowerCase().includes(q) ||
          r.agentSlug.toLowerCase().includes(q),
      )
      .sort((a, b) => {
        const aVal = a[sortKey] ?? 0;
        const bVal = b[sortKey] ?? 0;
        if (aVal === null && bVal === null) return 0;
        if (aVal === null) return 1;
        if (bVal === null) return -1;
        const cmp =
          typeof aVal === "string"
            ? aVal.localeCompare(bVal as string)
            : (aVal as number) - (bVal as number);
        return sortDir === "asc" ? cmp : -cmp;
      });
  }, [rows, search, sortKey, sortDir]);

  const headerCls =
    "cursor-pointer select-none px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-muted hover:text-xyne-fg-primary";

  return (
    <div data-id="agent-table" className="flex flex-col gap-2">
      {/* Internal search input — only rendered when the table is
          uncontrolled. When controlled, the parent renders its own
          input (e.g. inline with a section heading). */}
      {!isControlled && (
        <div className="relative w-64">
          <MagnifyingGlassIcon
            size={13}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xyne-fg-tertiary"
          />
          <input
            type="text"
            placeholder="Search agents…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-full rounded-lg border border-xyne-border bg-xyne-surface pl-7 pr-3 text-[13px] text-xyne-fg-primary placeholder:text-xyne-fg-tertiary focus:border-xyne-brand focus:outline-none focus-visible:outline-none focus:shadow-none focus:ring-0"
            style={{ outline: "none", boxShadow: "none" }}
          />
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-xyne-border-subtle">
        <table className="min-w-full text-[13px]">
          <thead className="border-b border-xyne-border-subtle bg-xyne-surface-subtle">
            <tr>
              <th
              className={`${headerCls} min-w-40`}
                onClick={() => handleSort("agentName")}
              >
                Agent
                <SortIcon col="agentName" activeCol={sortKey} dir={sortDir} />
              </th>
              <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-muted">
                Scope
              </th>
              <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-muted">
                Status
              </th>
              <th
                className={headerCls}
                onClick={() => handleSort("agentRegistered")}
              >
                Spaces
                <SortIcon col="agentRegistered" activeCol={sortKey} dir={sortDir} />
              </th>
              <th
                className={headerCls}
                onClick={() => handleSort("totalRuns")}
              >
                Runs
                <SortIcon col="totalRuns" activeCol={sortKey} dir={sortDir} />
              </th>
              <th
                className={headerCls}
                onClick={() => handleSort("uniqueUsers")}
              >
                Users
                <SortIcon col="uniqueUsers" activeCol={sortKey} dir={sortDir} />
              </th>
              <th
                className={headerCls}
                onClick={() => handleSort("avgDurationMs")}
              >
                Avg Duration
                <SortIcon col="avgDurationMs" activeCol={sortKey} dir={sortDir} />
              </th>
              <th
                className={headerCls}
                onClick={() => handleSort("totalTokensIn")}
              >
                Tokens In
                <SortIcon col="totalTokensIn" activeCol={sortKey} dir={sortDir} />
              </th>
              <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-muted">
                Success
              </th>
              <th
                className={headerCls}
                onClick={() => handleSort("negativeRate")}
              >
                👎 Rate
                <SortIcon col="negativeRate" activeCol={sortKey} dir={sortDir} />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-xyne-border-subtle">
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={10}
                  className="py-8 text-center text-[13px] text-xyne-fg-tertiary"
                >
                  {search.trim()
                    ? `No agents match "${search.trim()}" — try clearing the search or widening the time range.`
                    : "No global agents in this window yet. Register an agent under /v3/agents to start collecting metrics."}
                </td>
              </tr>
            ) : (
              filtered.map((r) => {
                const successRate =
                  r.totalRuns > 0
                    ? ((r.completedRuns / r.totalRuns) * 100).toFixed(0)
                    : null;
                const isExpanded = expandedSlug === r.agentSlug;
                return (
                  <React.Fragment key={r.agentSlug}>
                  <tr
                    onClick={() => toggleExpand(r.agentSlug)}
                    className={`cursor-pointer bg-xyne-surface transition-colors hover:bg-xyne-surface-subtle ${isExpanded ? "bg-xyne-surface-subtle" : ""}`}
                  >
                    <td className="py-2.5 pl-3 pr-2">
                      <div className="font-medium text-xyne-fg-primary">
                        {r.agentName}
                      </div>
                      <div className="text-[11px] text-xyne-fg-tertiary">
                        {r.agentSlug}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge
                        as="span"
                        label={r.agentScope ?? "—"}
                        variant={r.agentScope === "global" ? "info" : "neutral"}
                        size="sm"
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge
                        as="span"
                        label={r.agentEnabled ? "enabled" : "disabled"}
                        variant={r.agentEnabled ? "success" : "neutral"}
                        size="sm"
                        dot
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge
                        as="span"
                        label={r.agentRegistered ? "registered" : "not registered"}
                        variant={r.agentRegistered ? "info" : "neutral"}
                        size="sm"
                      />
                    </td>
                    <td className="px-3 py-2.5 font-medium text-xyne-fg-primary">
                      {fmtNum(r.totalRuns)}
                    </td>
                    <td className="px-3 py-2.5 text-xyne-fg-secondary">
                      {fmtNum(r.uniqueUsers)}
                    </td>
                    <td className="px-3 py-2.5 text-xyne-fg-secondary">
                      {fmtDuration(r.avgDurationMs)}
                    </td>
                    <td className="px-3 py-2.5 text-xyne-fg-secondary">
                      {fmtNum(r.totalTokensIn)}
                    </td>
                    <td className="px-3 py-2.5">
                      {successRate != null ? (
                        <span
                          className={
                            Number(successRate) >= 80
                              ? "text-emerald-600 dark:text-emerald-400"
                              : Number(successRate) >= 50
                                ? "text-amber-500"
                                : "text-red-500"
                          }
                        >
                          {successRate}%
                        </span>
                      ) : (
                        <span className="text-xyne-fg-tertiary">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {r.ratedCount > 0 ? (
                        <span
                          className={
                            r.negativeRate >= 0.5
                              ? "text-red-500"
                              : r.negativeRate >= 0.2
                                ? "text-amber-500"
                                : "text-xyne-fg-secondary"
                          }
                        >
                          {fmtPct(r.negativeRate)}{" "}
                          <span className="text-xyne-fg-tertiary text-[11px]">
                            ({r.ratedCount})
                          </span>
                        </span>
                      ) : (
                        <span className="text-xyne-fg-tertiary">—</span>
                      )}
                    </td>
                  </tr>
                  {/* Expandable detail panel */}
                  {isExpanded && (
                    <tr className="bg-xyne-surface-subtle">
                      <td colSpan={10} className="px-4 pb-4 pt-2">
                        <div className="flex flex-col gap-3">
                          {/* Quick-stat pills */}
                          <div className="flex flex-wrap gap-3 text-[12px] text-xyne-fg-secondary">
                            <span className="rounded-lg bg-xyne-surface px-3 py-1.5 border border-xyne-border-subtle">
                              <span className="font-semibold text-xyne-fg-primary">{fmtNum(r.totalRuns)}</span> runs
                            </span>
                            <span className="rounded-lg bg-xyne-surface px-3 py-1.5 border border-xyne-border-subtle">
                              <span className="font-semibold text-xyne-fg-primary">{fmtNum(r.uniqueUsers)}</span> users
                            </span>
                            <span className="rounded-lg bg-xyne-surface px-3 py-1.5 border border-xyne-border-subtle">
                              <span className="font-semibold text-xyne-fg-primary">{successRate != null ? `${successRate}%` : "—"}</span> success
                            </span>
                            <span className="rounded-lg bg-xyne-surface px-3 py-1.5 border border-xyne-border-subtle">
                              avg <span className="font-semibold text-xyne-fg-primary">{fmtDuration(r.avgDurationMs)}</span>
                            </span>
                            <span className="rounded-lg bg-xyne-surface px-3 py-1.5 border border-xyne-border-subtle">
                              tokens in <span className="font-semibold text-xyne-fg-primary">{fmtNum(r.totalTokensIn)}</span>
                              {" / "} out <span className="font-semibold text-xyne-fg-primary">{fmtNum(r.totalTokensOut)}</span>
                            </span>
                          </div>
                          {/* Action buttons */}
                          <div className="flex gap-2">
                            <button
                              onClick={(e) => { e.stopPropagation(); navigate(`/v3/agents/${r.agentSlug}`); }}
                              className="flex items-center gap-1.5 rounded-lg border border-xyne-border bg-xyne-surface px-3 py-1.5 text-[12px] font-medium text-xyne-fg-primary hover:bg-xyne-surface-sunken transition-colors"
                            >
                              <ArrowSquareOutIcon size={13} />
                              View Details
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); window.location.href = `/claw/chat?agent=${r.agentSlug}`; }}
                              className="flex items-center gap-1.5 rounded-lg border border-xyne-brand bg-xyne-brand px-3 py-1.5 text-[12px] font-medium text-xyne-fg-inverse hover:opacity-90 transition-opacity"
                            >
                              <ChatTextIcon size={13} />
                              Chat
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <div className="text-[11px] text-xyne-fg-tertiary">
        {filtered.length} of {rows.length} agents
      </div>
    </div>
  );
}

// ── UnifiedUsersTable (admin view) ─────────────────────────────────────
export function UnifiedUsersTable({ rows }: { rows: AdminUserActivityRow[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (userId: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });

  return (
    <div className="overflow-x-auto rounded-xl border border-xyne-border-subtle">
      <table className="min-w-full text-[13px]">
        <thead className="border-b border-xyne-border-subtle bg-xyne-surface-subtle">
          <tr>
            <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-muted w-6"></th>
            <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-muted">User</th>
            <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-muted">Runs</th>
            <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-muted">Unique Agents</th>
            <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-muted">Tokens In</th>
            <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-muted">Tokens Out</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-xyne-border-subtle">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6} className="py-8 text-center text-[13px] text-xyne-fg-tertiary">
                No user activity in this window — pick a longer time range to see more.
              </td>
            </tr>
          ) : (
            rows.map((u) => (
              <React.Fragment key={u.userId}>
                <tr
                  className="cursor-pointer bg-xyne-surface hover:bg-xyne-surface-subtle"
                  onClick={() => toggle(u.userId)}
                >
                  <td className="pl-3 py-2.5 text-xyne-fg-tertiary">
                    {expanded.has(u.userId)
                      ? <CaretDownIcon size={12} />
                      : <CaretRightIcon size={12} />}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="font-medium text-xyne-fg-primary">{u.name ?? "—"}</div>
                    <div className="text-[11px] text-xyne-fg-tertiary">{u.email ?? u.userId}</div>
                  </td>
                  <td className="px-3 py-2.5 text-right font-medium text-xyne-fg-primary">{fmtNum(u.totalRuns)}</td>
                  <td className="px-3 py-2.5 text-right text-xyne-fg-secondary">{u.uniqueAgents}</td>
                  <td className="px-3 py-2.5 text-right text-xyne-fg-secondary">{fmtNum(u.totalTokensIn)}</td>
                  <td className="px-3 py-2.5 text-right text-xyne-fg-secondary">{fmtNum(u.totalTokensOut)}</td>
                </tr>
                {expanded.has(u.userId) && (
                  <tr className="bg-xyne-surface-subtle">
                    <td colSpan={6} className="px-6 pb-3 pt-1">
                      <table className="min-w-full text-[12px]">
                        <thead>
                          <tr className="text-xyne-fg-muted">
                            <th className="pb-1 text-left font-semibold uppercase tracking-wide text-[10px]">Agent</th>
                            <th className="pb-1 pr-3 text-right font-semibold uppercase tracking-wide text-[10px]">Runs</th>
                            <th className="pb-1 pr-3 text-right font-semibold uppercase tracking-wide text-[10px]">Completed</th>
                            <th className="pb-1 pr-3 text-right font-semibold uppercase tracking-wide text-[10px]">Failed</th>
                            <th className="pb-1 pr-3 text-right font-semibold uppercase tracking-wide text-[10px]">Avg Dur.</th>
                            <th className="pb-1 pr-3 text-right font-semibold uppercase tracking-wide text-[10px]">Tokens</th>
                            <th className="pb-1 text-right font-semibold uppercase tracking-wide text-[10px]">Last Run</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-xyne-border-subtle">
                          {u.agents.map((a) => (
                            <tr key={a.agentSlug} className={a.runCount === 0 ? "opacity-50" : ""}>
                              <td className="py-1.5 pr-3">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="font-medium text-xyne-fg-primary">{a.agentName}</span>
                                  <span className="text-xyne-fg-tertiary text-[10px]">{a.agentSlug}</span>
                                  {a.agentScope && (
                                    <Badge as="span" label={a.agentScope} variant={a.agentScope === "global" ? "info" : "neutral"} size="sm" />
                                  )}
                                  {a.owned && (
                                    <Badge as="span" label="owner" variant="warning" size="sm" />
                                  )}
                                  {a.agentRegistered && (
                                    <Badge as="span" label="registered" variant="success" size="sm" />
                                  )}
                                </div>
                              </td>
                              <td className="py-1.5 pr-3 text-right text-xyne-fg-primary font-medium">
                                {a.runCount === 0
                                  ? <span className="text-xyne-fg-tertiary text-[11px]">no runs in window</span>
                                  : fmtNum(a.runCount)}
                              </td>
                              <td className="py-1.5 pr-3 text-right text-xyne-fg-secondary">{a.runCount > 0 ? fmtNum(a.completedRuns) : "—"}</td>
                              <td className="py-1.5 pr-3 text-right text-xyne-fg-secondary">{a.runCount > 0 ? fmtNum(a.failedRuns) : "—"}</td>
                              <td className="py-1.5 pr-3 text-right text-xyne-fg-secondary">{fmtDuration(a.avgDurationMs)}</td>
                              <td className="py-1.5 pr-3 text-right text-xyne-fg-secondary">{a.runCount > 0 ? fmtNum(a.totalTokens) : "—"}</td>
                              <td className="py-1.5 text-right text-xyne-fg-tertiary">{a.lastRunAt ?? "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── SkillUsageTable ────────────────────────────────────────────────────
export function SkillUsageTable({ rows }: { rows: SkillUsageRow[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (skillSlug: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(skillSlug)) next.delete(skillSlug);
      else next.add(skillSlug);
      return next;
    });

  return (
    <div className="overflow-x-auto rounded-xl border border-xyne-border-subtle">
      <table className="min-w-full text-[13px]">
        <thead className="border-b border-xyne-border-subtle bg-xyne-surface-subtle">
          <tr>
            <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-muted w-6"></th>
            <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-muted">Skill</th>
            <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-muted">Agents</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-xyne-border-subtle">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={3} className="py-8 text-center text-[13px] text-xyne-fg-tertiary">
                No skills attached to global agents yet. Create or attach one at /v3/skills.
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <React.Fragment key={r.skillSlug}>
                <tr
                  className="cursor-pointer bg-xyne-surface hover:bg-xyne-surface-subtle transition-colors"
                  onClick={() => toggle(r.skillSlug)}
                >
                  <td className="pl-3 py-2.5 text-xyne-fg-tertiary">
                    {expanded.has(r.skillSlug) ? <CaretDownIcon size={12} /> : <CaretRightIcon size={12} />}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <SparkleIcon size={14} className="text-xyne-fg-tertiary shrink-0" />
                      <span className="font-medium text-xyne-fg-primary">{r.skillName}</span>
                      <span className="text-[11px] text-xyne-fg-tertiary">{r.skillSlug}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right font-medium text-xyne-fg-primary">{r.agentCount}</td>
                </tr>
                {expanded.has(r.skillSlug) && r.agentNames.length > 0 && (
                  <tr className="bg-xyne-surface-subtle">
                    <td colSpan={3} className="px-6 pb-3 pt-1">
                      <div className="text-[11px] text-xyne-fg-muted mb-1">Used by:</div>
                      <div className="flex flex-wrap gap-1.5">
                        {r.agentNames.map((name) => (
                          <span key={name} className="rounded-md bg-xyne-surface px-2 py-0.5 text-[11px] text-xyne-fg-secondary border border-xyne-border-subtle">
                            {name}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── SubagentUsageTable ────────────────────────────────────────────────
export function SubagentUsageTable({ rows }: { rows: SubagentUsageRow[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (name: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  return (
    <div className="overflow-x-auto rounded-xl border border-xyne-border-subtle">
      <table className="min-w-full text-[13px]">
        <thead className="border-b border-xyne-border-subtle bg-xyne-surface-subtle">
          <tr>
            <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-muted w-6"></th>
            <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-muted">Subagent</th>
            <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-muted">Agents</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-xyne-border-subtle">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={3} className="py-8 text-center text-[13px] text-xyne-fg-tertiary">
                No subagents configured yet. Define one at /v3/subagents to see adoption here.
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <React.Fragment key={r.subagentName}>
                <tr
                  className="cursor-pointer bg-xyne-surface hover:bg-xyne-surface-subtle transition-colors"
                  onClick={() => toggle(r.subagentName)}
                >
                  <td className="pl-3 py-2.5 text-xyne-fg-tertiary">
                    {expanded.has(r.subagentName) ? <CaretDownIcon size={12} /> : <CaretRightIcon size={12} />}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <RobotIcon size={14} className="text-xyne-fg-tertiary shrink-0" />
                      <span className="font-medium text-xyne-fg-primary">{r.subagentName}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right font-medium text-xyne-fg-primary">{r.agentCount}</td>
                </tr>
                {expanded.has(r.subagentName) && r.agentNames.length > 0 && (
                  <tr className="bg-xyne-surface-subtle">
                    <td colSpan={3} className="px-6 pb-3 pt-1">
                      <div className="text-[11px] text-xyne-fg-muted mb-1">Used by:</div>
                      <div className="flex flex-wrap gap-1.5">
                        {r.agentNames.map((name) => (
                          <span key={name} className="rounded-md bg-xyne-surface px-2 py-0.5 text-[11px] text-xyne-fg-secondary border border-xyne-border-subtle">
                            {name}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── Section wrapper ────────────────────────────────────────────────────
function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section data-id="dashboard-section" className="flex flex-col gap-3">
      <h2 className="text-[13px] font-semibold text-xyne-fg-secondary">
        {title}
        {count != null && (
          <span className="ml-1.5 text-xyne-fg-tertiary font-normal">({count})</span>
        )}
      </h2>
      {children}
    </section>
  );
}

// ── Main component ─────────────────────────────────────────────────────
interface Props {
  userId: string;
}

const DAY_OPTIONS: { label: string; value: Days }[] = [
  { label: "7 days", value: 7 },
  { label: "30 days", value: 30 },
  { label: "90 days", value: 90 },
  { label: "All time", value: "all" },
];

export function AgentsDashboardPageV3({ userId }: Props) {
  const [days, setDays] = useState<Days>(30);
  const [data, setData] = useState<AgentDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Doctor Bitbucket stats load independently so a slow/missing Bitbucket
  // integration never blocks the rest of the dashboard.
  const [bitbucketStats, setBitbucketStats] = useState<DoctorBitbucketStats | null>(null);
  /** Accordion below the donut: collapsed by default so the landing
   *  view is "donut + a single hint bar." Clicking the bar reveals the
   *  pre-existing dashboard sections (Overview KPIs, Xyne Doctor,
   *  Global Agents, Skill / Subagent Adoption, Top Users). */
  const [platformExpanded, setPlatformExpanded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getAgentDashboard(userId, days, 10);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, [userId, days]);

  const loadBitbucketStats = useCallback(async () => {
    try {
      const result = await getDoctorBitbucketStats(userId);
      setBitbucketStats(result);
    } catch (err) {
      // Non-fatal: the cards will show "—" if this fails (e.g. non-admin user).
      console.warn("[dashboard] failed to load bitbucket stats:", err);
      setBitbucketStats(null);
    }
  }, [userId]);

  const refresh = useCallback(() => {
    load();
    loadBitbucketStats();
  }, [load, loadBitbucketStats]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadBitbucketStats(); }, [loadBitbucketStats]);

  const globalAgentRows = useMemo(() => data?.agentTable.filter((r) => r.agentScope === "global") ?? [], [data]);

  const timeRangeSelector = (
    <div className="flex items-center gap-1">
      {DAY_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => setDays(opt.value)}
          className={`rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors ${
            days === opt.value
              ? "bg-xyne-brand text-xyne-fg-inverse"
              : "text-xyne-fg-muted hover:bg-xyne-surface-sunken hover:text-xyne-fg-primary"
          }`}
        >
          {opt.label}
        </button>
      ))}
      <button
        onClick={refresh}
        disabled={loading}
        title="Refresh dashboard"
        aria-label="Refresh dashboard"
        className="ml-1 inline-flex items-center justify-center rounded-lg p-1.5 text-xyne-fg-muted hover:bg-xyne-surface-sunken hover:text-xyne-fg-primary disabled:opacity-50"
      >
        <ArrowClockwiseIcon size={14} className={loading ? "animate-spin" : ""} />
      </button>
    </div>
  );

  const renderLayout = (d: AgentDashboardData) => {
    const totalRuns = d.overview.totalRuns;
    const successRate = totalRuns > 0
      ? ((d.overview.completedRuns / totalRuns) * 100).toFixed(1)
      : null;

    // xyne-doctor PR/commit cards: show real Bitbucket counts when the
    // backend has creds configured, otherwise show "—" with a hint.
    const bb = bitbucketStats;
    const bbConfigured = bb != null && bb.reason !== "bitbucket_token_missing";
    const bbLastRefreshed = bb?.lastRefreshedAt
      ? `updated ${fmtRelativeTime(bb.lastRefreshedAt)}`
      : "never refreshed";
    const bbErrorSub = bb?.reason === "fetch_failed"
      ? "Bitbucket fetch failed · serving cached counts"
      : null;
    const bbAuthorEmail = bb?.authorEmail ?? "john.doe@gmail.com";

    const prValue = bbConfigured && bb?.prsCreated != null ? fmtNum(bb.prsCreated) : "—";
    const commitValue = bbConfigured && bb?.commitsCreated != null ? fmtNum(bb.commitsCreated) : "—";
    const bbPrSub = bbConfigured
      ? `${bbAuthorEmail} · all states · ${bbErrorSub ?? bbLastRefreshed}`
      : "Bitbucket not configured";
    const bbCommitSub = bbConfigured
      ? `${bbAuthorEmail} · main branch · ${bbErrorSub ?? bbLastRefreshed}`
      : "Bitbucket not configured";

    return (
      <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-6 px-[20px] py-4">
        {/* Accordion bar — collapsed by default. Sits ABOVE the donut
            section so the user can opt into the platform KPIs/inventory
            before scrolling past the headline visualisation. Tells the
            user exactly what's hiding beneath it. */}
        <button
          type="button"
          onClick={() => setPlatformExpanded((v) => !v)}
          aria-expanded={platformExpanded}
          aria-controls="platform-overview-content"
          data-id="platform-overview-toggle"
          className="flex w-full items-center justify-between gap-4 rounded-xl border border-xyne-border-subtle bg-xyne-surface p-4 text-left shadow-sm transition-colors hover:bg-xyne-surface-sunken"
        >
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[14px] font-semibold text-xyne-fg-primary">
              {platformExpanded ? "Hide platform overview" : "Show platform overview"}
            </span>
            <span className="truncate text-[12px] text-xyne-fg-tertiary">
              Overview KPIs · Xyne Doctor activity · Global agents · Skill &amp; subagent adoption · Top users
            </span>
          </div>
          <CaretDownIcon
            size={16}
            className={`shrink-0 text-xyne-fg-tertiary transition-transform duration-200 ${
              platformExpanded ? "rotate-180" : ""
            }`}
          />
        </button>

        {/* Accordion content — the original Dashboard sections, unchanged
            in shape, just hidden behind the toggle. */}
        {platformExpanded && (
          <div id="platform-overview-content" className="flex flex-col gap-6">
            {/* Overview cards */}
            <Section title="Overview">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                <StatCard label="Global Agents" value={fmtNum(d.agentStats.global.total)} sub={`${d.agentStats.global.enabled} enabled · ${d.agentStats.global.disabled} disabled`} icon={RobotIcon} accent="blue" />
                <StatCard label="Spaces Registered" value={fmtNum(d.agentStats.registration.registered)} sub={`${d.agentStats.registration.notRegistered} not registered`} icon={LightningIcon} accent="green" />
                <StatCard label="Total Runs" value={fmtNum(totalRuns)} sub={successRate != null ? `${successRate}% success rate` : undefined} icon={ChartBarIcon} accent="blue" />
                <StatCard label="Unique Users" value={fmtNum(d.overview.uniqueUsers)} icon={UsersIcon} accent="purple" />
                <div data-id="stat-card" className="flex flex-col gap-1.5 rounded-xl border border-xyne-border-subtle bg-xyne-surface p-4 shadow-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] font-medium uppercase tracking-wide text-xyne-fg-muted">Tokens</span>
                    <CoinIcon size={15} className="text-amber-500" />
                  </div>
                  {/* IN = fresh + cached input actually processed. tokensIn alone
                      understated cache-heavy agents ~10x (cacheRead dominates). */}
                  <div className="flex items-end gap-3">
                    <div className="flex flex-col">
                      <span className="text-[10px] font-medium uppercase tracking-wide text-xyne-fg-tertiary">In</span>
                      <span className="text-[22px] font-bold leading-none text-xyne-fg-primary">{fmtNum(d.overview.totalTokensIn + (d.overview.totalTokensCached ?? 0))}</span>
                    </div>
                    <span className="mb-0.5 text-[16px] text-xyne-fg-muted">/</span>
                    <div className="flex flex-col">
                      <span className="text-[10px] font-medium uppercase tracking-wide text-xyne-fg-tertiary">Out</span>
                      <span className="text-[22px] font-bold leading-none text-xyne-fg-primary">{fmtNum(d.overview.totalTokensOut)}</span>
                    </div>
                  </div>
                  <span className="text-[10px] text-xyne-fg-tertiary">
                    {fmtNum(d.overview.totalTokensIn)} fresh · {fmtNum(d.overview.totalTokensCached ?? 0)} cached
                  </span>
                </div>
              </div>
            </Section>

            {/* Xyne Doctor — Bitbucket-authored PRs & commits */}
            <Section title="Xyne Doctor — Bitbucket Activity">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <StatCard
                  label="PRs by Xyne Doctor"
                  value={prValue}
                  sub={bbPrSub}
                  icon={GitPullRequestIcon}
                  accent="blue"
                />
                <StatCard
                  label="Commits by Xyne Doctor"
                  value={commitValue}
                  sub={bbCommitSub}
                  icon={GitCommitIcon}
                  accent="green"
                />
              </div>
            </Section>

            {/* Global Agents table */}
            <Section title="Global Agents" count={globalAgentRows.length}>
              <AgentTable rows={globalAgentRows} />
            </Section>

            {/* Skill Usage */}
            <Section title="Skill Adoption" count={d.skillUsage.length}>
              <SkillUsageTable rows={d.skillUsage} />
            </Section>

            {/* Subagent Usage */}
            <Section title="Subagent Adoption" count={(d.subagentUsage ?? []).length}>
              <SubagentUsageTable rows={d.subagentUsage ?? []} />
            </Section>

            {/* Top Users */}
            <Section title="Top Users" count={d.userActivityBreakdown.length}>
              <UnifiedUsersTable rows={d.userActivityBreakdown} />
            </Section>
          </div>
        )}

        {/* Project Overview — donut + drill-down. Sits BELOW the
            platform-overview accordion: the donut remains the visual
            hero of the page, but anyone wanting raw KPIs gets to opt
            into them via the bar above without scrolling past the
            chart. Renders WITHOUT a Section wrapper so its larger
            "Project Overview" title + project picker sit on one row
            and establish the section as the page's headline.
            Was a standalone page at /v3/projects before the merge. */}
        <ProjectInsightsSection
          userId={userId}
          days={days}
          // ProjectInsightsSection.setDays takes the wider DaysProp
          // (number | "all"); our local state is the narrower Days
          // (7 | 30 | 90 | "all"). Cast on the way in — the section
          // only ever emits valid values.
          setDays={(d) => setDays(d as Days)}
        />
      </div>
    );
  };

  return (
    <PageLayout
      header={
        <div className="shrink-0 border-b border-xyne-border-subtle">
          <div className="mx-auto w-full max-w-[1100px] px-[20px] py-xyne-header">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-xl font-semibold text-xyne-fg-primary">
                  Agent Dashboard
                </h1>
                <p className="mt-1 text-[14px] text-xyne-fg-muted">
                  Analytics and usage metrics across all global agents
                </p>
              </div>
              <div className="shrink-0">{timeRangeSelector}</div>
            </div>
          </div>
        </div>
      }
      body={
        loading && !data ? (
          <div className="flex h-full items-center justify-center gap-2 text-[14px] text-xyne-fg-muted">
            <SpinnerGapIcon size={18} className="animate-spin" />
            Loading…
          </div>
        ) : error && !data ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-[14px] text-xyne-fg-muted">
            <WarningCircleIcon size={24} className="text-red-400" />
            <p>{error}</p>
            <button
              onClick={load}
              className="mt-1 rounded-lg border border-xyne-border px-3 py-1.5 text-[12px] hover:bg-xyne-surface-sunken"
            >
              Retry
            </button>
          </div>
        ) : data ? (
          <>
            {error && (
              <div
                data-id="dashboard-error-banner"
                className="mx-auto mt-3 flex w-full max-w-[1100px] items-start justify-between gap-3 rounded-lg border border-red-400/40 bg-red-50 px-4 py-2.5 text-[13px] text-red-700 dark:bg-red-900/20 dark:text-red-300"
              >
                <div className="flex items-start gap-2">
                  <WarningCircleIcon size={16} className="mt-0.5 shrink-0" />
                  <span>
                    Couldn’t refresh dashboard: {error}. Showing last loaded data.
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    onClick={load}
                    className="rounded-md border border-red-400/50 px-2 py-0.5 text-[12px] hover:bg-red-100 dark:hover:bg-red-900/40"
                  >
                    Retry
                  </button>
                  <button
                    onClick={() => setError(null)}
                    aria-label="Dismiss error"
                    className="rounded-md p-0.5 hover:bg-red-100 dark:hover:bg-red-900/40"
                  >
                    <XIcon size={14} />
                  </button>
                </div>
              </div>
            )}
            {renderLayout(data)}
          </>
        ) : null
      }
    />
  );
}

