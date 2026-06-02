import { useNavigate } from "react-router-dom";
import {
  RobotIcon,
  WrenchIcon,
  PlugsConnectedIcon,
  ChatTextIcon,
} from "@phosphor-icons/react";

export function HomeQuickCreate() {
  const navigate = useNavigate();

  const items = [
    { label: "New agent", icon: RobotIcon, href: "/v3/agents" },
    { label: "Add skill", icon: WrenchIcon, href: "/v3/skills" },
    { label: "Connect MCP", icon: PlugsConnectedIcon, href: "/v3/mcp" },
    { label: "Start chat", icon: ChatTextIcon, href: "/v3/chat" },
  ];

  return (
    <div className="bg-xyne-surface border border-xyne-border rounded-xl overflow-hidden">
      <div className="px-[14px] py-[10px] border-b border-xyne-border-subtle">
        <span className="text-[12px] font-medium text-xyne-fg-primary">
          Quick create
        </span>
      </div>
      <div className="grid grid-cols-2 gap-[8px] p-[14px]">
        {items.map((item) => (
          <button
            key={item.label}
            onClick={() => navigate(item.href)}
            className="flex flex-col items-center gap-2 p-3 rounded-lg border border-xyne-border bg-xyne-surface-subtle cursor-pointer hover:bg-xyne-surface-sunken hover:border-xyne-border-strong transition-colors"
          >
            <item.icon size={20} className="text-xyne-fg-secondary" />
            <span className="text-[11px] font-medium text-xyne-fg-primary">
              {item.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
