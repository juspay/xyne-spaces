import { CaretRightIcon } from "@phosphor-icons/react";
import type { SubagentDef } from "../../../lib/api";
import { Badge } from "../ui/Badge";
import { Switch } from "../ui/Switch";
import { Avatar } from "../ui/Avatar";

interface SubagentRowProps {
  subagent: SubagentDef;
  isBuiltIn: boolean;
  onSelect: (subagent: SubagentDef) => void;
  onToggleEnabled: (subagent: SubagentDef, value: boolean) => void;
  toggling: boolean;
}

export function SubagentRow({
  subagent,
  isBuiltIn,
  onSelect,
  onToggleEnabled,
  toggling,
}: SubagentRowProps) {
  const toolCount =
    (subagent.tools?.direct?.length ?? 0) +
    (subagent.tools?.custom?.length ?? 0);

  return (
    <div
      onClick={() => onSelect(subagent)}
      className={[
        "flex items-center gap-[12px] px-[14px] py-[10px]",
        "bg-xyne-surface border rounded-xl",
        "cursor-pointer mb-[6px]",
        "transition-[border-color,opacity]",
        subagent.enabled
          ? "border-xyne-border hover:border-xyne-success/30"
          : "border-xyne-border hover:border-xyne-error/30",
        !subagent.enabled ? "opacity-60" : "",
      ].join(" ")}
    >
      {/* Avatar */}
      <Avatar
        name={subagent.name}
        size={24}
        shape="circle"
        className={
          isBuiltIn
            ? "!bg-xyne-surface-sunken !text-xyne-fg-secondary border border-xyne-border"
            : "!bg-xyne-brand/10 !text-xyne-brand border border-xyne-brand/20"
        }
      />

      {/* Status dot */}
      <div
        className={[
          "w-[6px] h-[6px] rounded-full shrink-0",
          subagent.enabled ? "bg-xyne-success" : "bg-xyne-warning",
        ].join(" ")}
      />

      {/* Name + badges */}
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <div className="flex items-center gap-[6px]">
          <span className="text-[13px] font-medium font-mono text-xyne-fg-primary truncate">
            {subagent.name}
          </span>
          {isBuiltIn ? (
            <Badge
              as="span"
              label="built-in"
              variant="neutral"
              size="sm"
            />
          ) : (
            <span className="text-[11px] font-medium px-[8px] py-[1px] rounded-full bg-xyne-brand/10 text-xyne-brand border border-xyne-brand/20">
              custom
            </span>
          )}
        </div>
        {subagent.description && (
          <span className="text-[11px] text-xyne-fg-secondary truncate">
            {subagent.description}
          </span>
        )}
      </div>

      {/* Count pills */}
      <span className={`text-[10px] px-[6px] py-[1px] rounded-full shrink-0 ${
        (subagent.skills?.length ?? 0) > 0
          ? "bg-xyne-success-bg text-xyne-success-fg border border-xyne-success-border"
          : "bg-xyne-warning-bg text-xyne-warning-fg border border-xyne-warning-border"
      }`}>
        {subagent.skills?.length ?? 0} skills
      </span>
      <span className={`text-[10px] px-[6px] py-[1px] rounded-full shrink-0 ${
        toolCount > 0
          ? "bg-xyne-success-bg text-xyne-success-fg border border-xyne-success-border"
          : "bg-xyne-warning-bg text-xyne-warning-fg border border-xyne-warning-border"
      }`}>
        {toolCount} tools
      </span>

      {/* Creator label for custom */}
      {!isBuiltIn && subagent.createdByUserId && (
        <span className="text-[10px] text-xyne-fg-tertiary shrink-0">
          Custom
        </span>
      )}

      {/* Toggle */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex items-center gap-[5px] shrink-0"
      >
        <Switch
          checked={subagent.enabled}
          onChange={(v) => onToggleEnabled(subagent, v)}
          disabled={toggling}
        />
        <span className="text-[10px] text-xyne-fg-tertiary whitespace-nowrap">
          {subagent.enabled ? "Enabled" : "Disabled"}
        </span>
      </div>

      {/* Caret */}
      <CaretRightIcon
        size={14}
        className="text-xyne-fg-tertiary shrink-0"
      />
    </div>
  );
}
