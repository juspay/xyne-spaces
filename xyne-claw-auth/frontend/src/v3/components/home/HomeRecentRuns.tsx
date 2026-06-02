import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRightIcon } from "@phosphor-icons/react";
import { Avatar } from "../ui/Avatar";
import { Skeleton } from "../ui/Skeleton";
import { formatTimeAgo, truncate } from "./homeUtils";
import type { Agent } from "../../../lib/types";
import type { AgentRun } from "../../../lib/api";

interface HomeRecentRunsProps {
  runs: AgentRun[];
  agents: Agent[];
  isLoading: boolean;
}

const SPACES_APP_URL =
  import.meta.env.VITE_XYNE_BACKEND_URL ||
  (import.meta.env.DEV ? "http://localhost:5173" : window.location.origin);

const TRIGGER_LABELS: Record<string, string> = {
  spaces: "via Xyne Spaces",
  chat: "via Chat",
  api: "via API",
  scheduled: "Scheduled",
};

function StatusBadge({ status }: { status: string }) {
  if (status === "completed") {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-xyne-success-bg text-xyne-success-fg text-[10px] font-medium">
        <span className="w-[6px] h-[6px] rounded-full bg-xyne-success" />
        completed
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-xyne-error-bg text-xyne-error-fg text-[10px] font-medium">
        <span className="w-[6px] h-[6px] rounded-full bg-xyne-error" />
        failed
      </span>
    );
  }
  if (status === "running") {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-xyne-warning-bg text-xyne-warning-fg text-[10px] font-medium">
        <span className="w-[6px] h-[6px] rounded-full bg-xyne-warning animate-pulse" />
        running
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-xyne-neutral-bg text-xyne-neutral-fg text-[10px] font-medium">
      <span className="w-[6px] h-[6px] rounded-full bg-xyne-neutral" />
      {status}
    </span>
  );
}

function computeElapsed(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime();
  const totalSecs = Math.floor(ms / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return mins === 0 ? `${secs}s` : `${mins}m ${secs}s`;
}

function useElapsed(startedAt: string, enabled: boolean): string {
  const [elapsed, setElapsed] = useState(() =>
    enabled ? computeElapsed(startedAt) : "—",
  );

  useEffect(() => {
    if (!enabled) {
      setElapsed("—");
      return;
    }
    const update = () => setElapsed(computeElapsed(startedAt));
    update();
    const interval = setInterval(update, 5000);
    return () => clearInterval(interval);
  }, [startedAt, enabled]);

  return elapsed;
}

function RunDuration({ run }: { run: AgentRun }) {
  const elapsed = useElapsed(run.startedAt, run.status === "running");

  if (run.completedAt) {
    const ms =
      new Date(run.completedAt).getTime() -
      new Date(run.startedAt).getTime();
    const totalSecs = Math.floor(ms / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return <>{mins === 0 ? `${secs}s` : `${mins}m ${secs}s`}</>;
  }
  if (run.status === "running") {
    return <>{elapsed}</>;
  }
  return <>—</>;
}

export function HomeRecentRuns({ runs, agents, isLoading }: HomeRecentRunsProps) {
  const navigate = useNavigate();

  return (
    <div className="bg-xyne-surface border border-xyne-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-[14px] py-[10px] border-b border-xyne-border-subtle">
        <span className="text-[12px] font-medium text-xyne-fg-primary">
          Recent runs
        </span>
        <button
          onClick={() => navigate("/v3/dashboard")}
          className="flex items-center gap-1 text-[11px] text-xyne-fg-secondary hover:text-xyne-fg-primary transition-colors"
        >
          View all <ArrowRightIcon size={12} />
        </button>
      </div>
      <div className="flex flex-col">
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-3 px-[14px] py-[10px]"
            >
              <Skeleton className="h-7 w-7 rounded-lg" />
              <div className="flex flex-col gap-1 min-w-0 flex-1">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-2.5 w-32" />
              </div>
              <Skeleton className="h-5 w-14 rounded" />
            </div>
          ))
        ) : runs.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-[12px] text-xyne-fg-tertiary">
            No runs yet — start a conversation to see activity here
          </div>
        ) : (
          runs.map((run) => {
            const agent = agents.find((a) => a.slug === run.agentSlug);
            const handleClick = () => {
              if (
                run.triggerSource === "spaces" &&
                run.channelId &&
                run.conversationId
              ) {
                window.open(
                  `${SPACES_APP_URL}/chat/dir/${encodeURIComponent(run.channelId)}/${encodeURIComponent(run.conversationId)}`,
                  "_blank",
                );
              } else {
                navigate(`/v3/chat?agent=${run.agentSlug}`);
              }
            };

            return (
              <div
                key={run.id}
                onClick={handleClick}
                className="flex items-center gap-3 px-[14px] py-[10px] cursor-pointer hover:bg-xyne-surface-subtle transition-colors"
              >
                <Avatar
                  name={agent?.name ?? run.agentSlug}
                  color={agent?.color}
                  size={28}
                  shape="square"
                />
                <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                  <span
                    className={`text-[12px] font-medium truncate ${
                      agent ? "text-xyne-fg-primary" : "text-xyne-fg-secondary"
                    }`}
                  >
                    {agent?.name ?? run.agentSlug}
                  </span>
                  <span className="text-[11px] text-xyne-fg-secondary truncate">
                    {truncate(run.task, 60)}
                  </span>
                  <span className="text-[10px] text-xyne-fg-tertiary">
                    <RunDuration run={run} />
                    {" · "}
                    {TRIGGER_LABELS[run.triggerSource] ?? run.triggerSource}
                    {" · "}
                    {formatTimeAgo(run.startedAt)}
                  </span>
                </div>
                <StatusBadge status={run.status} />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
