/**
 * HomePickupRow — single "pick up where you left off" card.
 *
 * Shows only the most recent session: agent name, last task, time ago, and
 * an Open button that either deep-links into the Spaces channel conversation
 * or falls back to /v3/chat?agent=slug.
 */

import { useNavigate } from "react-router-dom";
import { ArrowRightIcon } from "@phosphor-icons/react";
import type { Agent } from "../../../lib/types";
import type { AgentRun } from "../../../lib/api";
import { Skeleton } from "../ui/Skeleton";
import { formatTimeAgo, getInitials, truncate } from "./homeUtils";

const SPACES_APP_URL =
  import.meta.env.VITE_XYNE_BACKEND_URL ||
  (import.meta.env.DEV ? "http://localhost:5173" : window.location.origin);

interface HomePickupRowProps {
  lastRun: AgentRun | null;
  lastRunAgent: Agent | null;
  isLoading: boolean;
}

export function HomePickupRow({ lastRun, lastRunAgent, isLoading }: HomePickupRowProps) {
  const navigate = useNavigate();

  if (isLoading) {
    return (
      <div className="bg-xyne-surface border border-xyne-border rounded-[14px] p-[14px] flex items-center gap-[14px]">
        <Skeleton className="h-[36px] w-[36px] rounded-full flex-shrink-0" />
        <div className="flex-1 flex flex-col gap-[6px]">
          <Skeleton className="h-[13px] w-[40%]" />
          <Skeleton className="h-[11px] w-[60%]" />
        </div>
        <Skeleton className="h-[32px] w-[80px] rounded-[10px] flex-shrink-0" />
      </div>
    );
  }

  if (!lastRun) {
    return (
      <div className="bg-xyne-surface border border-xyne-border border-dashed rounded-[14px] px-[16px] py-[14px] flex items-center justify-between">
        <div className="flex flex-col gap-[2px]">
          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-xyne-fg-tertiary">
            Pick up where you left off
          </span>
          <span className="text-[12px] text-xyne-fg-tertiary">No recent sessions yet</span>
        </div>
        <button
          onClick={() => navigate("/v3/agents")}
          className="text-[12px] text-xyne-fg-secondary hover:text-xyne-fg-primary transition-colors flex items-center gap-[4px]"
        >
          Browse agents
          <ArrowRightIcon size={11} />
        </button>
      </div>
    );
  }

  const name = lastRunAgent?.name ?? lastRun.agentSlug;

  const open = () => {
    if (lastRun.channelId && lastRun.conversationId) {
      window.open(
        `${SPACES_APP_URL}/chat/dir/${encodeURIComponent(lastRun.channelId)}/${encodeURIComponent(lastRun.conversationId)}`,
        "_blank",
      );
    } else {
      navigate(`/v3/chat?agent=${lastRun.agentSlug}`);
    }
  };

  return (
    <div className="bg-xyne-surface border border-xyne-border rounded-[14px] px-[16px] py-[13px] flex items-center gap-[14px]">
      {/* Agent avatar */}
      <div className="w-[36px] h-[36px] rounded-full bg-xyne-surface-sunken border border-xyne-border flex items-center justify-center text-[12px] font-medium text-xyne-fg-secondary flex-shrink-0">
        {getInitials(name)}
      </div>

      {/* Session info */}
      <div className="flex-1 min-w-0 flex flex-col gap-[2px]">
        <div className="flex items-center gap-[8px]">
          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-xyne-fg-tertiary flex-shrink-0">
            Resume
          </span>
          <span className="text-[13px] font-medium text-xyne-fg-primary truncate">
            {name}
          </span>
          <span className="text-[11px] text-xyne-fg-tertiary flex-shrink-0">
            {formatTimeAgo(lastRun.startedAt)}
          </span>
        </div>
        <span className="text-[12px] text-xyne-fg-secondary truncate pl-[calc(3ch+8px)]">
          &ldquo;{truncate(lastRun.task ?? "", 80)}&rdquo;
        </span>
      </div>

      {/* Open button */}
      <button
        onClick={open}
        className="flex items-center gap-[5px] px-[14px] py-[7px] rounded-[10px] border border-xyne-border text-[12px] font-medium text-xyne-fg-secondary hover:bg-xyne-surface-sunken hover:text-xyne-fg-primary transition-colors flex-shrink-0"
      >
        Open
        <ArrowRightIcon size={11} />
      </button>
    </div>
  );
}
