import { useState, useEffect } from "react";
import {
  CircleDashedIcon,
  CheckCircleIcon,
  XCircleIcon,
  MinusCircleIcon,
  ClockIcon,
} from "@phosphor-icons/react";
import { listRuns } from "../../../../lib/api";
import type { AgentRun } from "../../../../lib/api";
import { Skeleton } from "../../ui/Skeleton";
import { formatTimeAgo, formatDuration, truncate } from "../../home/homeUtils";

interface Props {
  agentSlug: string;
  userId: string;
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

function triggerLabel(source: AgentRun["triggerSource"]): string {
  return source === "spaces"
    ? "Spaces"
    : source === "scheduled"
      ? "Scheduled"
      : source === "chat"
        ? "Chat"
        : "API";
}

function RunRow({ run }: { run: AgentRun }) {
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
    triggerLabel(run.triggerSource),
    formatTimeAgo(run.startedAt),
    duration,
    tokens,
  ].filter((p): p is string => !!p);

  return (
    <div className="flex items-center gap-3 rounded-lg border border-xyne-border-subtle px-4 py-3 transition-colors hover:bg-xyne-surface-subtle hover:border-xyne-border">
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
    </div>
  );
}

export function RunHistoryTab({ agentSlug, userId }: Props) {
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    listRuns(userId, { agentSlug, limit: 50 })
      .then(setRuns)
      .catch(() => setRuns([]))
      .finally(() => setLoading(false));
  }, [agentSlug, userId]);

  if (loading) {
    // Skeleton mirrors the real RunRow layout (prominent status circle +
    // title + single inline meta row) so the transition to loaded state
    // doesn't jitter.
    return (
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
  }

  if (runs.length === 0) {
    // Asymmetric padding biases the content upward — the tab content sits
    // below the page header + tab title bar, so plain justify-center lands
    // visually low. pt-10 / pb-28 shifts the centered block up by ~36px.
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 pt-10 pb-28 text-center">
        <ClockIcon size={32} className="text-xyne-fg-muted" />
        <p className="text-[14px] font-medium text-xyne-fg-secondary">No runs yet</p>
        <p className="max-w-[280px] text-[13px] text-xyne-fg-tertiary">
          This agent hasn&apos;t been executed yet. Runs will appear here once the agent processes a task.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 p-6">
      {runs.map((run) => (
        <RunRow key={run.sessionId} run={run} />
      ))}
    </div>
  );
}
