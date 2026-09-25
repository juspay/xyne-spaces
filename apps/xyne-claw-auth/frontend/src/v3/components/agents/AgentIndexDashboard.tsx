/**
 * AgentIndexDashboard — org-wide view of the Hindsight agent-index bank.
 *
 * Sections:
 *   1. Coverage (indexed vs roster) — anything not indexed can't be routed to
 *   2. Staleness + bank size
 *   3. Bank health (id, resolved config, chunks-mode assertion)
 *   4. Inventory table (searchable, status-filterable, sortable)
 *   5. Rebuild all (admin only, behind a confirm)
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowClockwiseIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  CheckCircleIcon,
  ClockCounterClockwiseIcon,
  DatabaseIcon,
  SpinnerGapIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Search } from "../ui/Search";
import { Skeleton } from "../ui/Skeleton";
import { Tooltip } from "../ui/Tooltip";
import { useAdminStatus } from "../../hooks/useAdminStatus";
import {
  getAgentIndexOverview,
  rebuildAgentIndex,
  type AgentIndexOverview,
  type AgentIndexStatus,
} from "../../../lib/api";
import { fmtNum, fmtRelativeTime, StatCard } from "../AgentsDashboardPageV3";

type RowStatus = "ok" | "stale" | "missing";
type StatusFilter = RowStatus | "all";
type SortKey = "slug" | "name" | "chars" | "status" | "indexedUpdatedAt";
type SortDir = "asc" | "desc";

/** Worst-first when sorted descending — the operator's default reading order. */
const STATUS_RANK: Record<RowStatus, number> = { missing: 2, stale: 1, ok: 0 };

const STATUS_VARIANT: Record<RowStatus, "success" | "warning" | "error"> = {
  ok: "success",
  stale: "warning",
  missing: "error",
};

function rowStatus(agent: AgentIndexStatus): RowStatus {
  if (agent.missing.length > 0) return "missing";
  return agent.stale ? "stale" : "ok";
}

function fmtConfigValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function SortIcon({ col, activeCol, dir }: { col: SortKey; activeCol: SortKey; dir: SortDir }) {
  if (col !== activeCol) return null;
  return dir === "asc" ? (
    <ArrowUpIcon size={10} className="ml-0.5 inline" />
  ) : (
    <ArrowDownIcon size={10} className="ml-0.5 inline" />
  );
}

const CARD_CLS =
  "flex flex-col gap-1.5 rounded-xl border border-xyne-border-subtle bg-xyne-surface p-4 shadow-sm";

function CoverageCard({ indexed, total }: { indexed: number; total: number }) {
  const gap = total - indexed;
  const pct = total > 0 ? Math.round((indexed / total) * 100) : 0;
  const complete = gap === 0 && total > 0;
  return (
    <div
      data-id="agent-index-coverage"
      className={`${CARD_CLS} sm:col-span-2 ${complete ? "" : "border-xyne-error-border"}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-medium uppercase tracking-wide text-xyne-fg-muted">
          Coverage
        </span>
        {complete ? (
          <CheckCircleIcon size={15} className="text-xyne-success-fg" />
        ) : (
          <WarningCircleIcon size={15} className="text-xyne-error-fg" />
        )}
      </div>
      <div className="flex items-baseline gap-2">
        <span
          className={`text-[34px] font-bold leading-none ${complete ? "text-xyne-fg-primary" : "text-xyne-error-fg"}`}
        >
          {fmtNum(indexed)}
        </span>
        <span className="text-[16px] font-medium text-xyne-fg-muted">
          of {fmtNum(total)} agents indexed
        </span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-xyne-surface-sunken">
        <div
          className={`h-full rounded-full ${complete ? "bg-xyne-success" : "bg-xyne-error"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="text-[12px] text-xyne-fg-tertiary">
        {total === 0
          ? "No agents on the roster yet."
          : complete
            ? "Every agent on the roster is searchable."
            : `${fmtNum(gap)} ${gap === 1 ? "agent is" : "agents are"} invisible to routing — an orchestrator cannot find ${gap === 1 ? "it" : "them"} by need.`}
      </div>
    </div>
  );
}

function BankHealthCard({ overview }: { overview: AgentIndexOverview }) {
  const config = overview.bankConfig;
  const mode = fmtConfigValue(config.retain_extraction_mode);
  const observations = fmtConfigValue(config.enable_observations);
  const chunksMode = config.retain_extraction_mode === "chunks";
  const rest = Object.entries(config).filter(
    ([key]) => key !== "retain_extraction_mode" && key !== "enable_observations",
  );

  return (
    <div data-id="agent-index-bank-health" className={CARD_CLS}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-medium uppercase tracking-wide text-xyne-fg-muted">
          Bank health
        </span>
        <DatabaseIcon size={15} className="text-xyne-fg-tertiary" />
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-xyne-fg-secondary">
        <span>
          <span className="font-semibold text-xyne-fg-primary">{fmtNum(overview.entries)}</span>{" "}
          entries
        </span>
        <span>
          <span className="font-semibold text-xyne-fg-primary">{fmtNum(overview.chars)}</span> chars
        </span>
        <Tooltip content={overview.bankId}>
          <span className="max-w-[240px] truncate font-mono text-[11px] text-xyne-fg-tertiary">
            {overview.bankId}
          </span>
        </Tooltip>
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-2">
        <span className="text-[12px] text-xyne-fg-muted">retain_extraction_mode</span>
        <Badge
          as="span"
          size="sm"
          label={mode}
          variant={chunksMode ? "success" : "error"}
          dot
        />
        <span className="ml-2 text-[12px] text-xyne-fg-muted">enable_observations</span>
        <Badge as="span" size="sm" label={observations} variant="neutral" />
      </div>

      {!chunksMode && (
        <div className="mt-1 flex items-start gap-2 rounded-lg border border-xyne-error-border bg-xyne-error-bg px-3 py-2 text-[12px] text-xyne-error-fg">
          <WarningCircleIcon size={14} className="mt-0.5 shrink-0" />
          <span>
            Bank resolved to <span className="font-mono">{mode}</span>, not{" "}
            <span className="font-mono">chunks</span>. Documents are being rewritten by an LLM on
            the write path — rebuild after fixing the bank configuration.
          </span>
        </div>
      )}

      {rest.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {rest.map(([key, value]) => (
            <span
              key={key}
              className="rounded-md border border-xyne-border-subtle bg-xyne-surface-subtle px-2 py-0.5 text-[11px] text-xyne-fg-tertiary"
            >
              {key}: <span className="text-xyne-fg-secondary">{fmtConfigValue(value)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function InventoryTable({ agents }: { agents: AgentIndexStatus[] }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("status");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "slug" || key === "name" ? "asc" : "desc");
    }
  };

  const counts = useMemo(() => {
    const acc: Record<RowStatus, number> = { ok: 0, stale: 0, missing: 0 };
    for (const agent of agents) acc[rowStatus(agent)] += 1;
    return acc;
  }, [agents]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = agents.filter((a) => {
      if (statusFilter !== "all" && rowStatus(a) !== statusFilter) return false;
      if (!q) return true;
      return a.slug.toLowerCase().includes(q) || a.name.toLowerCase().includes(q);
    });
    const sorted = [...rows].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "slug":
          cmp = a.slug.localeCompare(b.slug);
          break;
        case "name":
          cmp = a.name.localeCompare(b.name);
          break;
        case "chars":
          cmp = a.chars - b.chars;
          break;
        case "status":
          cmp = STATUS_RANK[rowStatus(a)] - STATUS_RANK[rowStatus(b)];
          break;
        case "indexedUpdatedAt": {
          const at = a.indexedUpdatedAt ? Date.parse(a.indexedUpdatedAt) : 0;
          const bt = b.indexedUpdatedAt ? Date.parse(b.indexedUpdatedAt) : 0;
          cmp = at - bt;
          break;
        }
      }
      if (cmp === 0) cmp = a.slug.localeCompare(b.slug);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [agents, search, statusFilter, sortKey, sortDir]);

  const headerCls =
    "cursor-pointer select-none px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-muted hover:text-xyne-fg-primary";
  const staticHeaderCls =
    "px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-muted";

  const statusOptions: { value: StatusFilter; label: string }[] = [
    { value: "all", label: `All ${agents.length}` },
    { value: "ok", label: `OK ${counts.ok}` },
    { value: "stale", label: `Stale ${counts.stale}` },
    { value: "missing", label: `Missing ${counts.missing}` },
  ];

  return (
    <div data-id="agent-index-inventory" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Search
          value={search}
          onChange={setSearch}
          placeholder="Search slug or name…"
          className="w-64"
          data-id="agent-index-search"
        />
        <div className="flex flex-wrap items-center gap-1.5">
          {statusOptions.map((opt) => (
            <Badge
              key={opt.value}
              size="sm"
              label={opt.label}
              selected={statusFilter === opt.value}
              onClick={() => setStatusFilter(opt.value)}
            />
          ))}
        </div>
      </div>

      <div className="max-h-[520px] overflow-auto rounded-xl border border-xyne-border-subtle">
        <table className="min-w-full text-[13px]">
          <thead className="sticky top-0 z-10 border-b border-xyne-border-subtle bg-xyne-surface-subtle">
            <tr>
              <th className={`${headerCls} min-w-40`} onClick={() => handleSort("slug")}>
                Slug
                <SortIcon col="slug" activeCol={sortKey} dir={sortDir} />
              </th>
              <th className={headerCls} onClick={() => handleSort("name")}>
                Name
                <SortIcon col="name" activeCol={sortKey} dir={sortDir} />
              </th>
              <th className={staticHeaderCls}>Indexed</th>
              <th className={headerCls} onClick={() => handleSort("chars")}>
                Chars
                <SortIcon col="chars" activeCol={sortKey} dir={sortDir} />
              </th>
              <th className={headerCls} onClick={() => handleSort("indexedUpdatedAt")}>
                Last indexed
                <SortIcon col="indexedUpdatedAt" activeCol={sortKey} dir={sortDir} />
              </th>
              <th className={headerCls} onClick={() => handleSort("status")}>
                Status
                <SortIcon col="status" activeCol={sortKey} dir={sortDir} />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-xyne-border-subtle">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-[13px] text-xyne-fg-tertiary">
                  {agents.length === 0
                    ? "No agents on the roster yet — register one under /v3/agents, then rebuild the index."
                    : "No agents match this search and status filter."}
                </td>
              </tr>
            ) : (
              filtered.map((a) => {
                const status = rowStatus(a);
                return (
                  <tr key={a.slug} className="bg-xyne-surface transition-colors hover:bg-xyne-surface-subtle">
                    <td className="py-2.5 pl-3 pr-2 font-medium text-xyne-fg-primary">{a.slug}</td>
                    <td className="px-3 py-2.5 text-xyne-fg-secondary">{a.name}</td>
                    <td className="px-3 py-2.5">
                      {a.indexed.length === 0 ? (
                        <span className="text-xyne-fg-tertiary">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {a.indexed.map((kind) => (
                            <Badge key={kind} as="span" size="sm" label={kind} variant="neutral" />
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xyne-fg-secondary">{fmtNum(a.chars)}</td>
                    <td className="px-3 py-2.5 text-xyne-fg-tertiary">
                      {fmtRelativeTime(a.indexedUpdatedAt)}
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge
                        as="span"
                        size="sm"
                        dot
                        variant={STATUS_VARIANT[status]}
                        label={
                          status === "missing"
                            ? `missing ${a.missing.join(", ")}`
                            : status
                        }
                      />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <div className="text-[11px] text-xyne-fg-tertiary">
        {filtered.length} of {agents.length} agents
      </div>
    </div>
  );
}

export function AgentIndexDashboard() {
  const { isAdmin } = useAdminStatus();
  const [overview, setOverview] = useState<AgentIndexOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildResult, setRebuildResult] = useState<
    { synced: number; failed: number; purged: number } | null
  >(null);
  const [rebuildError, setRebuildError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setOverview(await getAgentIndexOverview());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load the agent index");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runRebuild = useCallback(async () => {
    setRebuilding(true);
    setRebuildError(null);
    setRebuildResult(null);
    try {
      setRebuildResult(await rebuildAgentIndex());
      await load();
    } catch (err) {
      setRebuildError(err instanceof Error ? err.message : "Rebuild failed");
    } finally {
      setRebuilding(false);
    }
  }, [load]);

  return (
    <section data-id="agent-index-dashboard" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-[13px] font-semibold text-xyne-fg-secondary">
          Agent Index
          {overview && (
            <span className="ml-1.5 font-normal text-xyne-fg-tertiary">
              ({overview.indexed}/{overview.total})
            </span>
          )}
        </h2>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void load()}
            disabled={loading}
            aria-label="Refresh agent index"
            leadingIcon={
              <ArrowClockwiseIcon size={13} className={loading ? "animate-spin" : ""} />
            }
          >
            Refresh
          </Button>
          {isAdmin && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setConfirmOpen(true)}
              disabled={rebuilding || loading}
              leadingIcon={
                rebuilding ? (
                  <SpinnerGapIcon size={13} className="animate-spin" />
                ) : (
                  <ClockCounterClockwiseIcon size={13} />
                )
              }
            >
              {rebuilding ? "Rebuilding…" : "Rebuild all"}
            </Button>
          )}
        </div>
      </div>

      {rebuildResult && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-xyne-success-border bg-xyne-success-bg px-4 py-2.5 text-[13px] text-xyne-success-fg">
          <div className="flex items-start gap-2">
            <CheckCircleIcon size={16} className="mt-0.5 shrink-0" />
            <span>
              Rebuild finished — {rebuildResult.synced} synced, {rebuildResult.failed} failed,{" "}
              {rebuildResult.purged} purged.
            </span>
          </div>
          <button
            onClick={() => setRebuildResult(null)}
            aria-label="Dismiss rebuild result"
            className="shrink-0 rounded-md p-0.5 hover:brightness-95"
          >
            <XIcon size={14} />
          </button>
        </div>
      )}

      {rebuildError && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-xyne-error-border bg-xyne-error-bg px-4 py-2.5 text-[13px] text-xyne-error-fg">
          <div className="flex items-start gap-2">
            <WarningCircleIcon size={16} className="mt-0.5 shrink-0" />
            <span>Rebuild failed: {rebuildError}</span>
          </div>
          <button
            onClick={() => setRebuildError(null)}
            aria-label="Dismiss rebuild error"
            className="shrink-0 rounded-md p-0.5 hover:brightness-95"
          >
            <XIcon size={14} />
          </button>
        </div>
      )}

      {loading && !overview ? (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Skeleton className="h-[116px] sm:col-span-2" />
            <Skeleton className="h-[116px]" />
            <Skeleton className="h-[116px]" />
          </div>
          <Skeleton className="h-[220px] rounded-xl" />
        </div>
      ) : error && !overview ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-xyne-border-subtle bg-xyne-surface px-4 py-10 text-[13px] text-xyne-fg-muted">
          <WarningCircleIcon size={22} className="text-xyne-error-fg" />
          <p>{error}</p>
          <Button variant="secondary" size="sm" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      ) : overview ? (
        <div className="flex flex-col gap-3">
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-xyne-error-border bg-xyne-error-bg px-4 py-2.5 text-[13px] text-xyne-error-fg">
              <WarningCircleIcon size={16} className="mt-0.5 shrink-0" />
              <span>Couldn’t refresh the agent index: {error}. Showing last loaded data.</span>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <CoverageCard indexed={overview.indexed} total={overview.total} />
            <StatCard
              label="Stale"
              value={fmtNum(overview.stale)}
              sub={
                overview.stale === 0
                  ? "Every stored copy matches the live agent"
                  : "Stored copy trails the live agent row"
              }
              icon={ClockCounterClockwiseIcon}
              accent={overview.stale === 0 ? "green" : "amber"}
            />
            <StatCard
              label="Documents"
              value={fmtNum(overview.entries)}
              sub={`${fmtNum(overview.chars)} chars stored`}
              icon={DatabaseIcon}
              accent="blue"
            />
          </div>

          <BankHealthCard overview={overview} />

          <InventoryTable agents={overview.agents} />
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        danger
        title="Rebuild the whole agent index?"
        description="Every agent is re-rendered and written over what the bank holds, and documents for agents that no longer exist are purged. This can take a while on a large roster."
        confirmLabel="Rebuild all"
        onConfirm={() => void runRebuild()}
      />
    </section>
  );
}
