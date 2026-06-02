import { useNavigate } from "react-router-dom";
import {
  RobotIcon,
  WrenchIcon,
  PlugsConnectedIcon,
  ShareNetworkIcon,
} from "@phosphor-icons/react";
import type { Agent, McpServer, Gateway } from "../../../lib/types";
import type { Skill } from "../../../lib/api";
import { Skeleton } from "../ui/Skeleton";

interface HomeHealthStripProps {
  agents: Agent[];
  activeAgents: number;
  skills: Skill[];
  unusedSkills: number;
  servers: McpServer[];
  enabledMcps: number;
  gateways: Gateway[];
  enabledGateways: number;
  isLoading: boolean;
}

export function HomeHealthStrip({
  agents,
  activeAgents,
  skills,
  unusedSkills,
  servers,
  enabledMcps,
  gateways,
  enabledGateways,
  isLoading,
}: HomeHealthStripProps) {
  const navigate = useNavigate();

  const cards = [
    {
      label: "Agents",
      value: agents.length,
      icon: RobotIcon,
      dotClass: activeAgents === agents.length ? "bg-xyne-success" : "bg-xyne-warning",
      signalText:
        activeAgents === agents.length
          ? "All active"
          : `${agents.length - activeAgents} paused`,
      href: "/v3/agents",
    },
    {
      label: "Skills",
      value: skills.length,
      icon: WrenchIcon,
      dotClass: unusedSkills > 0 ? "bg-xyne-warning" : "bg-xyne-success",
      signalText: unusedSkills > 0 ? `${unusedSkills} unused` : "All attached",
      href: "/v3/skills",
    },
    {
      label: "MCPs",
      value: servers.length,
      icon: PlugsConnectedIcon,
      dotClass: enabledMcps > 0 ? "bg-xyne-success" : "bg-xyne-neutral",
      signalText: `${enabledMcps} connected`,
      href: "/v3/mcp",
    },
    {
      label: "Gateways",
      value: gateways.length,
      icon: ShareNetworkIcon,
      dotClass: enabledGateways === 0 ? "bg-xyne-error" : "bg-xyne-success",
      signalText: `${enabledGateways} enabled`,
      href: "/v3/gateways",
    },
  ];

  if (isLoading) {
    return (
      <div className="grid grid-cols-4 gap-[10px]">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="bg-xyne-surface border border-xyne-border rounded-xl p-[10px_14px] flex items-center gap-[10px]"
          >
            <Skeleton className="h-8 w-8 rounded-lg" />
            <div className="flex flex-col gap-1">
              <Skeleton className="h-5 w-8" />
              <Skeleton className="h-3 w-16" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-4 gap-[10px]">
      {cards.map((card) => (
        <div
          key={card.label}
          onClick={() => navigate(card.href)}
          className="bg-xyne-surface border border-xyne-border rounded-xl p-[10px_14px] flex items-center gap-[10px] cursor-pointer transition-[border-color] hover:border-xyne-border-strong"
        >
          <div className="text-xyne-fg-secondary">
            <card.icon size={24} />
          </div>
          <div className="flex flex-col">
            <span className="text-[16px] font-semibold text-xyne-fg-primary leading-tight">
              {card.value}
            </span>
            <span className="text-[11px] text-xyne-fg-secondary leading-tight">
              {card.label}
            </span>
            <span className="flex items-center gap-[4px] text-[10px] text-xyne-fg-tertiary mt-0.5">
              <span className={`w-[6px] h-[6px] rounded-full ${card.dotClass}`} />
              {card.signalText}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
