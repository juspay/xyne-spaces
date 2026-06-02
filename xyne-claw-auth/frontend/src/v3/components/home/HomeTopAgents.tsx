import { useNavigate } from "react-router-dom";
import { ArrowRightIcon } from "@phosphor-icons/react";
import { Avatar } from "../ui/Avatar";
import { Skeleton } from "../ui/Skeleton";
import type { Agent } from "../../../lib/types";

interface HomeTopAgentsProps {
  topAgents: Agent[];
  isLoading: boolean;
}

export function HomeTopAgents({ topAgents, isLoading }: HomeTopAgentsProps) {
  const navigate = useNavigate();

  return (
    <div className="bg-xyne-surface border border-xyne-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-[14px] py-[10px] border-b border-xyne-border-subtle">
        <span className="text-[12px] font-medium text-xyne-fg-primary">
          Frequently used
        </span>
        <button
          onClick={() => navigate("/v3/chat")}
          className="flex items-center gap-1 text-[11px] text-xyne-fg-secondary hover:text-xyne-fg-primary transition-colors"
        >
          Open Chat <ArrowRightIcon size={12} />
        </button>
      </div>
      <div className="flex flex-col">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-3 px-[14px] py-[10px]"
            >
              <Skeleton className="h-8 w-8 rounded-lg" />
              <Skeleton className="h-3 w-24 flex-1" />
              <Skeleton className="h-5 w-12 rounded-full" />
            </div>
          ))
        ) : topAgents.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-[12px] text-xyne-fg-tertiary">
            No agents used yet — start a conversation to see them here
          </div>
        ) : (
          topAgents.map((agent) => (
            <div
              key={agent.slug}
              className="flex items-center gap-3 px-[14px] py-[10px] hover:bg-xyne-surface-subtle transition-colors"
            >
              <Avatar
                name={agent.name}
                color={agent.color}
                size={32}
                shape="square"
              />
              <span className="text-[12px] font-medium text-xyne-fg-primary min-w-0 flex-1 truncate">
                {agent.name}
              </span>
              <button
                onClick={() => navigate(`/v3/chat?agent=${agent.slug}`)}
                className="text-[10px] font-medium px-2 py-0.5 rounded-full border border-xyne-border text-xyne-fg-secondary hover:border-xyne-border-strong hover:bg-xyne-surface-sunken transition-colors"
              >
                Chat
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
