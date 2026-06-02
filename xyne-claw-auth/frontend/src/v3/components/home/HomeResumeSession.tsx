import { useNavigate } from "react-router-dom";
import { Avatar } from "../ui/Avatar";
import { formatTimeAgo, truncate } from "./homeUtils";
import type { Agent } from "../../../lib/types";
import type { AgentRun } from "../../../lib/api";

interface HomeResumeSessionProps {
  lastRun: AgentRun | null;
  agents: Agent[];
}

const TRIGGER_LABELS: Record<string, string> = {
  spaces: "via Xyne Spaces",
  chat: "via Chat",
  api: "via API",
  scheduled: "Scheduled",
};

const SPACES_APP_URL =
  import.meta.env.VITE_XYNE_BACKEND_URL ||
  (import.meta.env.DEV ? "http://localhost:5173" : window.location.origin);

export function HomeResumeSession({ lastRun, agents }: HomeResumeSessionProps) {
  const navigate = useNavigate();

  if (!lastRun) {
    return (
      <div className="bg-xyne-surface border border-xyne-border rounded-xl overflow-hidden">
        <div className="px-[14px] py-[10px] border-b border-xyne-border-subtle">
          <span className="text-[12px] font-medium text-xyne-fg-primary">
            Resume last session
          </span>
        </div>
        <div className="flex items-center justify-center px-[14px] py-[18px]">
          <span className="text-[11px] text-xyne-fg-tertiary">
            No recent sessions — start a chat to see activity here
          </span>
        </div>
      </div>
    );
  }

  const agent = agents.find((a) => a.slug === lastRun.agentSlug);

  const handleClick = () => {
    if (
      lastRun.triggerSource === "spaces" &&
      lastRun.channelId &&
      lastRun.conversationId
    ) {
      window.open(
        `${SPACES_APP_URL}/chat/dir/${encodeURIComponent(lastRun.channelId)}/${encodeURIComponent(lastRun.conversationId)}`,
        "_blank",
      );
    } else {
      navigate(`/v3/chat?agent=${lastRun.agentSlug}`);
    }
  };

  const isSpacesLink =
    lastRun.triggerSource === "spaces" &&
    lastRun.channelId &&
    lastRun.conversationId;

  return (
    <div className="bg-xyne-surface border border-xyne-border rounded-xl overflow-hidden">
      <div className="px-[14px] py-[10px] border-b border-xyne-border-subtle">
        <span className="text-[12px] font-medium text-xyne-fg-primary">
          Resume last session
        </span>
      </div>
      <div
        onClick={handleClick}
        className="flex items-center gap-3 px-[14px] py-[10px] cursor-pointer hover:bg-xyne-surface-subtle transition-colors"
      >
        <Avatar
          name={agent?.name ?? lastRun.agentSlug}
          color={agent?.color}
          size={36}
          shape="square"
        />
        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
          <span className="text-[12px] font-medium text-xyne-fg-primary">
            {agent?.name ?? lastRun.agentSlug}
          </span>
          <span className="text-[11px] text-xyne-fg-secondary truncate">
            {truncate(lastRun.task, 60)}
          </span>
          <span className="text-[10px] text-xyne-fg-tertiary">
            {TRIGGER_LABELS[lastRun.triggerSource] ?? lastRun.triggerSource} ·{" "}
            {formatTimeAgo(lastRun.startedAt)}
          </span>
        </div>
        <span
          className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${
            isSpacesLink
              ? "border-xyne-border bg-xyne-surface-subtle text-xyne-fg-secondary"
              : "border-xyne-border bg-xyne-surface-subtle text-xyne-fg-secondary"
          }`}
        >
          {isSpacesLink ? "↗ Open in Spaces" : "→ Open Chat"}
        </span>
      </div>
    </div>
  );
}
