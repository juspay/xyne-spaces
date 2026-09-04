/**
 * RecentRunsCard — agent activity feed on Home.
 *
 * Each row supports five interactions:
 *   1. Inline rating  (👍 / 👎) — persisted via rateRun()
 *   2. Origin pill    — derived from run.triggerSource
 *   3. Expand inline  — full reply, duration, tokens, tools used
 *   4. Copy reply     — copies run.result to clipboard, transient feedback
 *   5. Tools chip     — inside expanded panel
 *
 * The "View" button routes per origin:
 *   - channelId + conversationId → xyne-spaces in new tab
 *   - triggerSource "scheduled"   → /v3/workflows
 *   - triggerSource "chat"        → /v3/chat?agent=…
 *   - else                        → /v3/control-center
 */

import { useCallback, useMemo, useState } from "react";

import { useNavigate } from "react-router-dom";
import {
  CaretRightIcon,
  ChatCircleIcon,
  CubeIcon,
  ClockIcon,
  LightningIcon,
  WrenchIcon,
  MagnifyingGlassIcon,
  XIcon,
  ArrowSquareOutIcon,
} from "@phosphor-icons/react";
import type { AgentLight } from "../../../lib/types";
import type { AgentRun } from "../../../lib/api";
import { Skeleton } from "../ui/Skeleton";
import { formatTimeAgo, getInitials } from "./homeUtils";
import { spacesThreadUrl } from "../../../lib/spacesLink";

const COLLAPSED_COUNT = 4;

interface RecentRunsCardProps {
  runs: AgentRun[];
  agents: AgentLight[];
  userId: string;
  isLoading: boolean;
  days?: 1 | 7 | 30;
}

const ORIGIN_META: Record<
  AgentRun["triggerSource"],
  { label: string; icon: typeof ChatCircleIcon }
> = {
  chat: { label: "Chat", icon: ChatCircleIcon },
  spaces: { label: "Spaces", icon: CubeIcon },
  scheduled: { label: "Scheduled", icon: ClockIcon },
  automation: { label: "Automation", icon: LightningIcon },
  api: { label: "API", icon: LightningIcon },
};

function replyPreviewFor(run: AgentRun): { text: string; tone: string } {
  if (run.status === "running")
    return { text: "Running…", tone: "text-xyne-warning-fg" };
  if (run.status === "cancelled")
    return { text: "Cancelled", tone: "text-xyne-fg-tertiary" };
  if (run.status === "failed")
    return {
      text: run.error ?? "Run failed",
      tone: "text-xyne-error",
    };
  return {
    text: run.result ?? "Completed (no reply recorded)",
    tone: "text-xyne-fg-secondary",
  };
}

function durationString(
  startedAt: string,
  completedAt: string | null,
): string {
  if (!completedAt) return "—";
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

function formatTokens(n: number | null): string | null {
  if (n === null || n === undefined) return null;
  if (n < 1000) return `${n}`;
  return `${(n / 1000).toFixed(1)}k`;
}

/* ── Session grouping helpers ────────────────────────────────── */

interface SessionGroup {
  key: string;
  agentSlug: string;
  agentName: string;
  runs: AgentRun[];
  latest: AgentRun;
  first: AgentRun;
  totalToolsUsed: number;
  totalDurationMs: number;
}

function sessionKeyFor(run: AgentRun): string {
  return run.conversationId && run.agentSlug
    ? `${run.conversationId}_${run.agentSlug}`
    : run.sessionId;
}

function groupBySessions(runs: AgentRun[], agents: AgentLight[]): SessionGroup[] {
  const byKey = new Map<string, AgentRun[]>();
  for (const r of runs) {
    const k = sessionKeyFor(r);
    const list = byKey.get(k) ?? [];
    list.push(r);
    byKey.set(k, list);
  }
  const sessions: SessionGroup[] = [];
  for (const [key, list] of byKey) {
    const sorted = list
      .slice()
      .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
    const first = sorted[0]!;
    const latest = sorted[sorted.length - 1]!;
    const totalToolsUsed = sorted.reduce((acc, r) => acc + (r.toolsUsed?.length ?? 0), 0);
    const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours
    const totalDurationMs = sorted.reduce((acc, r) => {
      const s = new Date(r.startedAt).getTime();
      if (r.completedAt) return acc + Math.max(0, new Date(r.completedAt).getTime() - s);
      // Cap live-running duration so stale sessions don't show absurd elapsed times.
      return acc + Math.min(Date.now() - s, STALE_THRESHOLD_MS);
    }, 0);
    const agentName = agents.find((a) => a.slug === latest.agentSlug)?.name ?? latest.agentSlug;
    sessions.push({ key, agentSlug: latest.agentSlug, agentName, runs: sorted, latest, first, totalToolsUsed, totalDurationMs });
  }
  return sessions.sort(
    (a, b) => new Date(b.latest.startedAt).getTime() - new Date(a.latest.startedAt).getTime(),
  );
}

function formatDurationMs(ms: number): string {
  const totalSecs = Math.floor(ms / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}

const AGENT_COLORS_RC = [
  "#00E5FF","#00FF7F","#FFD700","#FF6B35",
  "#4D7CFF","#FF6B9D","#A78BFA","#FF4D4D",
];
function colorForAgentRC(slug: string): string {
  let hash = 0;
  for (let i = 0; i < slug.length; i++) hash = (hash * 31 + slug.charCodeAt(i)) | 0;
  return AGENT_COLORS_RC[Math.abs(hash) % AGENT_COLORS_RC.length]!;
}

function OriginPill({ source }: { source: AgentRun["triggerSource"] }) {
  const meta = ORIGIN_META[source];
  if (!meta) return null;
  const Icon = meta.icon;
  return (
    <span className="inline-flex items-center gap-[3px] text-[11px] text-xyne-fg-tertiary bg-xyne-surface-sunken border border-xyne-border-subtle rounded-full px-[6px] py-[1px] flex-shrink-0">
      <Icon size={10} />
      {meta.label}
    </span>
  );
}

function ToolsChip({ tools }: { tools: string[] }) {
  if (tools.length === 0) return null;
  const display =
    tools.length <= 3
      ? tools.join(" · ")
      : `${tools.slice(0, 3).join(" · ")} +${tools.length - 3}`;
  return (
    <div className="inline-flex items-center gap-[5px] text-[10px] text-xyne-fg-tertiary">
      <WrenchIcon size={10} />
      <span title={tools.join(", ")}>{display}</span>
    </div>
  );
}

function SessionAccordionRow({
  session,
  isExpanded,
  onToggle,
  onOpenSession,
  onOpenRun,
}: {
  session: SessionGroup;
  isExpanded: boolean;
  onToggle: () => void;
  /** Navigate to /v3/chat for the whole session (uses the latest run's
   *  conversationId). No-op when the session has no conversation (e.g.
   *  API/scheduled runs). */
  onOpenSession: (session: SessionGroup) => void;
  /** Navigate to /v3/chat for a specific run within the session. */
  onOpenRun: (run: AgentRun, session: SessionGroup) => void;
}) {
  const rawStatus = session.latest.status;
  const isStale =
    rawStatus === "running" &&
    Date.now() - new Date(session.latest.startedAt).getTime() > 2 * 60 * 60 * 1000;
  const status = isStale ? "stale" : rawStatus;
  const statusColor =
    status === "completed" ? "text-xyne-success-fg" :
    status === "failed"    ? "text-xyne-error" :
    status === "running"   ? "text-xyne-warning-fg" :
    status === "stale"     ? "text-xyne-fg-tertiary" :
    "text-xyne-fg-muted";
  // Sessions triggered from API / scheduled jobs have no conversation
  // thread to open. We still show the row, but hide the Open affordance.
  const canOpen = !!session.latest.conversationId;

  return (
    <div className="rounded-[8px] hover:bg-xyne-surface-sunken/40 transition-colors">
      {/* Session header row */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-[8px] px-[8px] py-[10px] text-left"
      >
        <CaretRightIcon
          size={12}
          className={`text-xyne-fg-tertiary flex-shrink-0 transition-transform duration-150 ${isExpanded ? "rotate-90" : ""}`}
        />
        <span
          className="w-[9px] h-[9px] rounded-full flex-shrink-0"
          style={{ background: colorForAgentRC(session.agentSlug) }}
        />
        <div className="flex-1 min-w-0 flex flex-col gap-[2px]">
          <div className="flex items-center gap-[6px]">
            <span className="text-[13px] font-medium text-xyne-fg-primary truncate">
              {session.agentName}
            </span>
            <span className="text-[11px] text-xyne-fg-tertiary flex-shrink-0">
              {session.runs.length} msg{session.runs.length !== 1 ? "s" : ""}
            </span>
            {session.totalToolsUsed > 0 && (
              <span className="text-[11px] text-xyne-fg-tertiary flex-shrink-0">
                · {session.totalToolsUsed} tool{session.totalToolsUsed !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          <span className="text-[12px] text-xyne-fg-secondary truncate">
            {session.latest.task ?? "—"}
          </span>
        </div>
        <span className={`text-[11px] flex-shrink-0 font-medium ${statusColor}`}>
          {status}
        </span>
        <span className="text-[11px] text-xyne-fg-muted flex-shrink-0">
          {formatDurationMs(session.totalDurationMs)}
        </span>
        <span className="text-[11px] text-xyne-fg-tertiary flex-shrink-0">
          {formatTimeAgo(session.latest.startedAt)}
        </span>
        {canOpen && (
          <span
            role="button"
            tabIndex={0}
            aria-label="Open session in chat"
            title="Open session in chat"
            onClick={(e) => {
              e.stopPropagation();
              onOpenSession(session);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                onOpenSession(session);
              }
            }}
            className="flex-shrink-0 rounded p-[4px] text-xyne-fg-tertiary hover:bg-xyne-surface-sunken hover:text-xyne-fg-primary"
          >
            <ArrowSquareOutIcon size={13} />
          </span>
        )}
      </button>

      {/* Expanded: individual runs */}
      {isExpanded && (
        <div className="ml-[24px] mb-[8px] mr-[8px] border-l-2 border-xyne-border-subtle pl-[12px] flex flex-col gap-[1px]">
          {session.runs.map((run, i) => {
            const runOpenable = !!run.conversationId;
            return (
              <div
                key={run.id}
                role={runOpenable ? "button" : undefined}
                tabIndex={runOpenable ? 0 : undefined}
                onClick={runOpenable ? () => onOpenRun(run, session) : undefined}
                onKeyDown={
                  runOpenable
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onOpenRun(run, session);
                        }
                      }
                    : undefined
                }
                title={runOpenable ? "Open run in chat" : undefined}
                className={`flex flex-col gap-[3px] py-[7px] border-b border-xyne-border-subtle last:border-0 ${
                  runOpenable
                    ? "cursor-pointer hover:bg-xyne-surface-sunken/40 transition-colors rounded-[4px] px-[4px] -mx-[4px]"
                    : ""
                }`}
              >
                <div className="flex items-center gap-[6px]">
                  <span className="text-[11px] text-xyne-fg-muted flex-shrink-0 w-[16px]">
                    {i + 1}
                  </span>
                  <span className="text-[12px] text-xyne-fg-secondary truncate flex-1">
                    {run.task ?? "—"}
                  </span>
                  <span className="text-[11px] text-xyne-fg-tertiary flex-shrink-0">
                    {formatTimeAgo(run.startedAt)}
                  </span>
                </div>
                {run.result && (
                  <p className="text-[11px] text-xyne-fg-tertiary line-clamp-2 ml-[22px] leading-relaxed">
                    {run.result}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function RecentRunsCard({
  runs,
  agents,
  userId,
  isLoading,
  days = 7,
}: RecentRunsCardProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [expandedSessionKeys, setExpandedSessionKeys] = useState<Set<string>>(new Set());
  const [listExpanded, setListExpanded] = useState(false);

  const toggleSessionExpand = useCallback((key: string) => {
    setExpandedSessionKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);


  // Filter all runs to the active time window
  const windowRuns = useMemo(() => {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return runs.filter((r) => new Date(r.startedAt).getTime() >= cutoff);
  }, [runs, days]);

  const sessions = useMemo(() => groupBySessions(windowRuns, agents), [windowRuns, agents]);

  const filteredSessions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter(
      (s) =>
        s.agentName.toLowerCase().includes(q) ||
        (s.latest.task ?? "").toLowerCase().includes(q) ||
        s.runs.some((r) => (r.result ?? "").toLowerCase().includes(q)),
    );
  }, [query, sessions]);

  // Collapse list when filter/window changes
  const filterKey = `${query}|${days}`;
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey);
    setListExpanded(false);
  }

  // Determine visible items and footer label
  const totalSessions = filteredSessions.length;
  const visibleSessions = listExpanded
    ? filteredSessions
    : filteredSessions.slice(0, COLLAPSED_COUNT);

  const showFooter = !isLoading && totalSessions > COLLAPSED_COUNT;

  const footerLabel = listExpanded
    ? "Collapse ↑"
    : `View all ${totalSessions} sessions →`;

  return (
    <div className="bg-xyne-surface border border-xyne-border rounded-[14px] overflow-hidden">
      <div className="flex items-center gap-[12px] px-[16px] py-[12px] border-b border-xyne-border-subtle">
        {/* Search */}
        <div className="flex-1 relative">
          <MagnifyingGlassIcon
            size={12}
            className="absolute left-[10px] top-1/2 -translate-y-1/2 text-xyne-fg-tertiary pointer-events-none"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={days === 1 ? "Search today…" : `Search last ${days} days…`}
            className="w-full text-[13px] bg-xyne-surface-sunken/60 border border-xyne-border-subtle rounded-[8px] pl-[28px] pr-[26px] py-[5px] text-xyne-fg-primary placeholder:text-xyne-fg-tertiary focus:outline-none focus:border-xyne-border-strong transition-colors"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-[6px] top-1/2 -translate-y-1/2 w-[18px] h-[18px] rounded-full flex items-center justify-center text-xyne-fg-tertiary hover:text-xyne-fg-primary hover:bg-xyne-surface-sunken transition-colors"
              aria-label="Clear search"
            >
              <XIcon size={10} />
            </button>
          )}
        </div>
      </div>

      {/* Items body — relative so the gradient overlay can be positioned inside */}
      <div className="relative">
      <div
        className={`px-[10px] pt-[10px] pb-[6px] flex flex-col gap-[2px] ${
          listExpanded ? "max-h-[520px] overflow-y-auto" : "overflow-hidden"
        }`}
      >
        {isLoading ? (
          <>
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-start gap-[10px] px-[8px] py-[8px]">
                <Skeleton className="h-[28px] w-[28px] rounded-full" />
                <div className="flex-1 flex flex-col gap-[5px]">
                  <Skeleton className="h-[12px] w-[40%]" />
                  <Skeleton className="h-[10px] w-[80%]" />
                </div>
                <Skeleton className="h-[24px] w-[52px] rounded-[6px]" />
              </div>
            ))}
          </>
        ) : filteredSessions.length === 0 ? (
          <div className="text-[12px] text-xyne-fg-tertiary text-center py-[12px]">
            {query ? `No sessions match "${query}"` : days === 1 ? "No sessions today" : `No sessions in the last ${days} days`}
          </div>
        ) : (
          visibleSessions.map((session) => (
            <SessionAccordionRow
              key={session.key}
              session={session}
              isExpanded={expandedSessionKeys.has(session.key)}
              onToggle={() => toggleSessionExpand(session.key)}
              onOpenSession={(s) => {
                const run = s.latest;
                if (run.channelId && run.conversationId) {
                  window.open(spacesThreadUrl(run.channelId, run.conversationId), "_blank");
                } else {
                  const convId = run.conversationId;
                  if (!convId) return;
                  navigate(`/v3/chat?agent=${encodeURIComponent(s.agentSlug)}&conversation=${encodeURIComponent(convId)}`);
                }
              }}
              onOpenRun={(run, s) => {
                if (run.channelId && run.conversationId) {
                  window.open(spacesThreadUrl(run.channelId, run.conversationId), "_blank");
                } else {
                  if (!run.conversationId) return;
                  navigate(`/v3/chat?agent=${encodeURIComponent(s.agentSlug)}&conversation=${encodeURIComponent(run.conversationId)}`);
                }
              }}
            />
          ))
        )}
      </div>

      {/* Gradient fade — only when collapsed with more items hidden */}
      {!listExpanded && showFooter && (
        <div
          className="pointer-events-none h-[72px] -mt-[72px] relative z-10"
          style={{ background: "linear-gradient(to bottom, transparent 0%, var(--color-xyne-surface, #fff) 80%)" }}
        />
      )}
      </div>

      {/* View all / Collapse footer */}
      {showFooter && (
        <button
          onClick={() => setListExpanded((e) => !e)}
          className="w-full flex items-center justify-center gap-[6px] py-[10px] text-[12px] font-medium text-xyne-fg-tertiary hover:text-xyne-fg-secondary transition-colors border-t border-xyne-border-subtle rounded-b-[14px] hover:bg-xyne-surface-sunken/40"
        >
          {listExpanded ? (
            <>Collapse</>
          ) : (
            <>{footerLabel}</>
          )}
        </button>
      )}
    </div>
  );
}
