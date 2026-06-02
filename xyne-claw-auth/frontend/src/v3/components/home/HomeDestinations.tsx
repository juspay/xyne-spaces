import { useNavigate } from "react-router-dom";
import {
  ChatCircle,
  ChartBar,
  SlidersHorizontal,
  UserCircle,
  GitBranch,
  CheckSquare,
  ArrowRightIcon,
} from "@phosphor-icons/react";
import type { AgentRun, ChainWorkflow, Approval } from "../../../lib/api";
import { Skeleton } from "../ui/Skeleton";
import { formatTimeAgo } from "./homeUtils";

interface HomeDestinationsProps {
  lastRun: AgentRun | null;
  todayRuns: number;
  runs: AgentRun[];
  workflows: ChainWorkflow[];
  approvals: Approval[];
  digitalTwinEnabled: boolean;
  isLoading: boolean;
}

export function HomeDestinations({
  lastRun,
  todayRuns,
  runs,
  workflows,
  approvals,
  digitalTwinEnabled,
  isLoading,
}: HomeDestinationsProps) {
  const navigate = useNavigate();

  const runningCount = runs.filter((r) => r.status === "running").length;
  const activeWorkflows = workflows.filter((w) => w.isPublished).length;

  const tiles = [
    {
      name: "Chat",
      icon: ChatCircle,
      bg: "#E6F1FB",
      color: "#0C447C",
      dotClass: "bg-xyne-success",
      signalText: lastRun
        ? `Last used ${formatTimeAgo(lastRun.startedAt)}`
        : "Start a conversation",
      href: "/v3/chat",
    },
    {
      name: "Dashboard",
      icon: ChartBar,
      bg: "#E1F5EE",
      color: "#085041",
      dotClass: "bg-xyne-success",
      signalText: `${todayRuns} run${todayRuns !== 1 ? "s" : ""} today`,
      href: "/v3/dashboard",
    },
    {
      name: "Control Center",
      icon: SlidersHorizontal,
      bg: "#EEEDFE",
      color: "#3C3489",
      dotClass: runningCount === 0 ? "bg-xyne-success" : "bg-xyne-warning",
      signalText:
        runningCount === 0
          ? "All clear"
          : `${runningCount} task${runningCount > 1 ? "s" : ""} running`,
      href: "/v3/control-center",
    },
    {
      name: "Digital Twin",
      icon: UserCircle,
      bg: "#FAEEDA",
      color: "#633806",
      dotClass: digitalTwinEnabled ? "bg-xyne-success" : "bg-xyne-warning",
      signalText: digitalTwinEnabled ? "Configured" : "Not configured",
      href: "/v3/digital-twin",
    },
    {
      name: "Workflows",
      icon: GitBranch,
      bg: "#FBEAF0",
      color: "#72243E",
      dotClass: activeWorkflows > 0 ? "bg-xyne-success" : "bg-xyne-neutral",
      signalText: `${activeWorkflows} active`,
      href: "/v3/workflows",
    },
    {
      name: "Approval",
      icon: CheckSquare,
      bg: "#F0FDF4",
      color: "#166534",
      dotClass: approvals.length > 0 ? "bg-xyne-error" : "bg-xyne-success",
      signalText:
        approvals.length > 0
          ? `${approvals.length} pending`
          : "All clear",
      href: "/v3/control-center",
    },
  ];

  if (isLoading) {
    return (
      <div>
        <Skeleton className="h-3 w-32 mb-[6px]" />
        <div className="grid grid-cols-3 gap-[8px]">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="bg-xyne-surface border border-xyne-border rounded-[10px] p-[12px_14px] flex flex-col gap-[6px]"
            >
              <div className="flex justify-between items-center">
                <Skeleton className="h-[28px] w-[28px] rounded-lg" />
                <Skeleton className="h-3.5 w-3.5" />
              </div>
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-2.5 w-20" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-[0.07em] text-xyne-fg-tertiary mb-[6px]">
        Where do you want to go?
      </p>
      <div className="grid grid-cols-3 gap-[8px]">
        {tiles.map((tile) => (
          <div
            key={tile.name}
            onClick={() => navigate(tile.href)}
            className="bg-xyne-surface border border-xyne-border rounded-[10px] p-[12px_14px] cursor-pointer transition-[border-color,box-shadow] duration-150 hover:border-xyne-border-strong hover:shadow-sm flex flex-col gap-[6px]"
          >
            <div className="flex justify-between items-center">
              <div
                className="flex items-center justify-center rounded-lg"
                style={{
                  width: 28,
                  height: 28,
                  backgroundColor: tile.bg,
                  color: tile.color,
                }}
              >
                <tile.icon size={16} />
              </div>
              <ArrowRightIcon size={14} className="text-xyne-fg-tertiary" />
            </div>
            <span className="text-[12px] font-medium text-xyne-fg-primary">
              {tile.name}
            </span>
            <span className="flex items-center gap-[4px] text-[10px] text-xyne-fg-tertiary">
              <span className={`w-[6px] h-[6px] rounded-full ${tile.dotClass}`} />
              {tile.signalText}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}