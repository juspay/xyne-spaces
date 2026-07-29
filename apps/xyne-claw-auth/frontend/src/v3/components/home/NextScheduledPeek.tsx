/**
 * NextScheduledPeek — single-line peek at the soonest upcoming scheduled job.
 *
 * If no upcoming job exists, the card collapses to a quiet "no upcoming runs"
 * line. Click anywhere on the card to navigate to /v3/workflows for the full
 * scheduled list.
 */

import { useNavigate } from "react-router-dom";
import { ClockIcon, ArrowRightIcon } from "@phosphor-icons/react";
import { Skeleton } from "../ui/Skeleton";
import type { AgentLight } from "../../../lib/types";
import type { ScheduledJob } from "../../../lib/types";
import { formatTimeUntil, truncate } from "./homeUtils";

interface NextScheduledPeekProps {
  job: ScheduledJob | null;
  agents: AgentLight[];
  isLoading: boolean;
}

export function NextScheduledPeek({
  job,
  agents,
  isLoading,
}: NextScheduledPeekProps) {
  const navigate = useNavigate();

  if (isLoading) {
    return (
      <div className="bg-xyne-surface border border-xyne-border rounded-[14px] px-[16px] py-[12px]">
        <div className="flex items-center gap-[10px]">
          <Skeleton className="h-[16px] w-[16px] rounded-full" />
          <Skeleton className="h-[12px] flex-1" />
          <Skeleton className="h-[12px] w-[60px]" />
        </div>
      </div>
    );
  }

  if (!job) {
    return null;
  }

  const agent = agents.find((a) => a.slug === job.agentSlug);
  const agentName = agent?.name ?? job.agentSlug;
  const label = job.label ?? truncate(job.task ?? "", 60);

  return (
    <button
      type="button"
      onClick={() => navigate("/v3/workflows")}
      className="group bg-xyne-surface border border-xyne-border rounded-[14px] px-[16px] py-[12px] flex items-center gap-[12px] hover:border-xyne-border-strong transition-colors text-left"
    >
      <div className="w-[24px] h-[24px] rounded-full bg-xyne-surface-sunken border border-xyne-border flex items-center justify-center text-xyne-fg-tertiary flex-shrink-0">
        <ClockIcon size={12} />
      </div>
      <div className="flex-1 min-w-0 flex items-baseline gap-[8px] min-w-0">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-xyne-fg-tertiary flex-shrink-0">
          Next
        </span>
        <span className="text-[12px] text-xyne-fg-primary font-medium truncate">
          {agentName}
        </span>
        <span className="text-[12px] text-xyne-fg-secondary truncate">
          {label}
        </span>
      </div>
      <span className="text-[11px] text-xyne-fg-tertiary flex-shrink-0">
        {job.nextRunAt ? formatTimeUntil(job.nextRunAt) : "—"}
      </span>
      <ArrowRightIcon
        size={12}
        className="text-xyne-fg-tertiary group-hover:text-xyne-fg-secondary flex-shrink-0"
      />
    </button>
  );
}
