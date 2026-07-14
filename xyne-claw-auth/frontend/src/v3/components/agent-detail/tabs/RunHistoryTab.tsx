import { useState, useEffect, useMemo, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  CircleDashedIcon,
  CheckCircleIcon,
  XCircleIcon,
  MinusCircleIcon,
  ClockIcon,
  CaretRightIcon,
} from "@phosphor-icons/react";
import { listRuns } from "../../../../lib/api";
import type { AgentRun } from "../../../../lib/api";
import { Skeleton } from "../../ui/Skeleton";
import { formatTimeAgo, formatDuration, truncate } from "../../home/homeUtils";

interface Props {
  agentSlug: string;
  userId: string;
  canViewAllRuns: boolean;
}

// Status icon size bumped from 16 → 22 and switched to filled weight so it
// reads as a real status anchor (replaces the old text "completed" badge).
function StatusIcon({ status }: { status: AgentRun["status"] }) {
  switch (status) {
    case "running":
      return <CircleDashedIcon size={22} className="animate-spin text-xyne-info" />;
    case "completed":
      return <CheckCircleIcon size={22} weight="fill" className="text-xyne-success" />;
    case "failed":
      return <XCircleIcon size={22} weight="fill" className="text-xyne-error" />;
    case "cancelled":
      return <MinusCircleIcon size={22} weight="fill" className="text-xyne-fg-muted" />;
  }
}

// Human label for a run's owner — real name/email if the admin All-Runs listing
// hydrated it, else a short id. Shared by the row and the user-filter dropdown
// so a user reads the same everywhere.
function runOwnerLabel(run: AgentRun): string {
  return run.userName || run.userEmail || `user ${run.userId.slice(0, 8)}`;
}

function triggerLabel(source: AgentRun["triggerSource"]): string {
  return source === "spaces"
    ? "Spaces"
    : source === "scheduled"
      ? "Scheduled"
      : source === "chat"
        ? "Chat"
        : source === "automation"
          ? "Automation"
          : "API";
}

function RunRow({ run, showOwner, onOpen }: { run: AgentRun; showOwner?: boolean; onOpen?: () => void }) {
  const duration =
    run.completedAt
      ? formatDuration(run.startedAt, run.completedAt)
      : run.status === "running"
        ? "Running…"
        : null;

  const tokens =
    run.tokensIn != null || run.tokensOut != null
      ? `${run.tokensIn ?? 0} → ${run.tokensOut ?? 0} tok`
      : null;

  // Collected meta facts rendered on the second line with `·` separators
  // — e.g. "Chat · 1d ago · 7s · 27994 → 336 tok".
  const metaParts = [
    // In admin "All Runs" mode, lead with the owning user so runs are
    // attributable — real name/email when the scope=all listing hydrated it,
    // falling back to a short id.
    showOwner ? runOwnerLabel(run) : null,
    triggerLabel(run.triggerSource),
    formatTimeAgo(run.startedAt),
    duration,
    tokens,
  ].filter((p): p is string => !!p);

  const clickable = !!onOpen;
  return (
    <div
      onClick={onOpen}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpen?.();
              }
            }
          : undefined
      }
      className={`group flex items-center gap-3 rounded-lg border border-xyne-border-subtle px-4 py-3 transition-colors hover:bg-xyne-surface-subtle hover:border-xyne-border ${
        clickable ? "cursor-pointer" : ""
      }`}
    >
      <StatusIcon status={run.status} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[13px] font-medium text-xyne-fg-primary">
          {truncate(run.task, 80)}
        </span>
        <div className="flex items-center flex-wrap gap-x-1.5 text-[11px] text-xyne-fg-tertiary">
          {metaParts.map((part, i) => (
            <span key={i} className="inline-flex items-center gap-1.5">
              {i > 0 && <span className="text-xyne-fg-muted">·</span>}
              {part}
            </span>
          ))}
        </div>
      </div>
      {clickable && (
        <CaretRightIcon
          size={16}
          className="shrink-0 text-xyne-fg-muted opacity-0 transition-opacity group-hover:opacity-100"
        />
      )}
    </div>
  );
}

export function RunHistoryTab({ agentSlug, userId, canViewAllRuns }: Props) {
  const navigate = useNavigate();
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [loading, setLoading] = useState(true);
  // Elevated view: admins, owners, and contributors can show every user's runs
  // of this agent. The server ACL-filters by usedUserToken, so other users'
  // runs that touched their private token are never returned.
  const [allUsers, setAllUsers] = useState(false);
  // "All Runs" filters (client-side over the loaded set).
  const [userFilter, setUserFilter] = useState<string>(""); // "" = every user
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (canViewAllRuns) return;
    setAllUsers(false);
    setUserFilter("");
    setQuery("");
  }, [canViewAllRuns]);

  useEffect(() => {
    setLoading(true);
    // Pull a bigger pool in All-Runs mode so the user/text filter has something
    // meaningful to work over (server caps at 200).
    listRuns(userId, { agentSlug, limit: allUsers ? 200 : 50, allUsers })
      .then(setRuns)
      .catch(() => setRuns([]))
      .finally(() => setLoading(false));
  }, [agentSlug, userId, allUsers]);

  // Distinct owners present in the loaded rows — drives the dropdown so its
  // options always match what's actually filterable.
  const userOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of runs) if (!m.has(r.userId)) m.set(r.userId, runOwnerLabel(r));
    return [...m.entries()]
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [runs]);

  // Apply the user + free-text filters (only meaningful in All-Runs mode; the
  // controls are hidden otherwise so the state stays inert).
  const visibleRuns = useMemo(() => {
    const q = query.trim().toLowerCase();
    return runs.filter((r) => {
      if (userFilter && r.userId !== userFilter) return false;
      if (q && !`${r.task} ${runOwnerLabel(r)}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [runs, userFilter, query]);

  // Elevated toggle — rendered above the body so it's reachable even when YOUR
  // own runs are empty (the common "No runs yet" case).
  const allRunsToggle = canViewAllRuns ? (
    <div className="flex flex-col gap-2.5 border-b border-xyne-border-subtle px-6 py-2.5">
      <div className="flex items-center justify-end gap-2">
        <span className="text-[12px] text-xyne-fg-tertiary">All Runs</span>
        <label
          className="flex items-center gap-2 select-none"
          title="Show every user's runs of this agent. Runs that used a user's private token are hidden."
        >
          <input
            type="checkbox"
            checked={allUsers}
            onChange={(e) => {
              setAllUsers(e.target.checked);
              if (!e.target.checked) {
                setUserFilter("");
                setQuery("");
              }
            }}
            className="h-4 w-4 cursor-pointer accent-xyne-accent"
            aria-label="Show all users' runs"
          />
          <span className="text-[12px] text-xyne-fg-primary">{allUsers ? "On" : "Off"}</span>
        </label>
      </div>
      {allUsers && (
        <div className="flex items-center gap-2">
          {/* User filter — the primary "find runs by who ran them" control. */}
          <select
            value={userFilter}
            onChange={(e) => setUserFilter(e.target.value)}
            className="h-8 min-w-[160px] max-w-[220px] rounded-md border border-xyne-border-subtle bg-xyne-surface px-2 text-[12px] text-xyne-fg-primary focus:border-xyne-border focus:outline-none"
            aria-label="Filter by user"
          >
            <option value="">All users ({userOptions.length})</option>
            {userOptions.map((u) => (
              <option key={u.id} value={u.id}>
                {u.label}
              </option>
            ))}
          </select>
          {/* Free-text — task or owner, so you can also "find anything". */}
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search task or user…"
            className="h-8 flex-1 rounded-md border border-xyne-border-subtle bg-xyne-surface px-2.5 text-[12px] text-xyne-fg-primary placeholder:text-xyne-fg-muted focus:border-xyne-border focus:outline-none"
            aria-label="Search runs"
          />
          {(userFilter || query) && (
            <span className="shrink-0 text-[11px] text-xyne-fg-tertiary">
              {visibleRuns.length} / {runs.length}
            </span>
          )}
        </div>
      )}
    </div>
  ) : null;

  let body: ReactNode;
  if (loading) {
    // Skeleton mirrors the real RunRow layout so the transition doesn't jitter.
    body = (
      <div className="flex flex-col gap-2 p-6">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-lg border border-xyne-border-subtle px-4 py-3"
          >
            <Skeleton className="h-[22px] w-[22px] shrink-0 rounded-full" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Skeleton className="h-3 w-[60%] rounded" />
              <Skeleton className="h-2.5 w-[40%] rounded" />
            </div>
          </div>
        ))}
      </div>
    );
  } else if (runs.length === 0) {
    body = (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 pt-10 pb-28 text-center">
        <ClockIcon size={32} className="text-xyne-fg-muted" />
        <p className="text-[14px] font-medium text-xyne-fg-secondary">
          {allUsers ? "No runs from any user yet" : "No runs yet"}
        </p>
        <p className="max-w-[280px] text-[13px] text-xyne-fg-tertiary">
          This agent hasn&apos;t been executed yet. Runs will appear here once the agent processes a task.
        </p>
      </div>
    );
  } else if (visibleRuns.length === 0) {
    // Have runs, but the active user/text filter excluded them all.
    body = (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 pt-10 pb-28 text-center">
        <ClockIcon size={32} className="text-xyne-fg-muted" />
        <p className="text-[14px] font-medium text-xyne-fg-secondary">No matching runs</p>
        <p className="max-w-[280px] text-[13px] text-xyne-fg-tertiary">
          No runs match the current filter. Clear the user or search filter to see all runs.
        </p>
      </div>
    );
  } else {
    body = (
      <div className="flex flex-col gap-2 p-6">
        {visibleRuns.map((run) => (
          <RunRow
            key={run.sessionId}
            run={run}
            showOwner={allUsers}
            // Open the in-app debug conversation view (chat replay + tool-call
            // groups). Needs a conversationId — API/scheduled runs without one
            // stay non-clickable. Admin "All Runs" rows for other users load via
            // the chat-messages route's admin (listByConversation) path.
            onOpen={
              run.conversationId
                ? () =>
                    navigate(
                      `/v3/chat?agent=${encodeURIComponent(run.agentSlug)}&conversation=${encodeURIComponent(run.conversationId!)}`,
                    )
                : undefined
            }
          />
        ))}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {allRunsToggle}
      {body}
    </div>
  );
}
