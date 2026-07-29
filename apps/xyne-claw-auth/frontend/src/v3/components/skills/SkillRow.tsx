import { CaretRightIcon } from "@phosphor-icons/react";
import { Badge } from "../ui/Badge";
import { Switch } from "../ui/Switch";
import { Avatar } from "../ui/Avatar";
import type { Skill } from "../../../lib/api";

interface SkillRowProps {
  skill: Skill;
  showScopeBadge: boolean;
  isOwner: boolean;
  onSelect: (skill: Skill) => void;
  onToggleEnabled: (skill: Skill, value: boolean) => void;
  toggling: boolean;
}

export function SkillRow({
  skill,
  showScopeBadge,
  isOwner,
  onSelect,
  onToggleEnabled,
  toggling,
}: SkillRowProps) {
  const statusDotCls = skill.enabled
    ? "bg-xyne-success"
    : "bg-xyne-warning";

  const sourceBadge =
    skill.source === "seeded"
      ? { label: "built-in", type: "neutral" as const }
      : skill.source === "user-created"
        ? { label: "custom", type: "brand" as const }
        : skill.source === "uploaded"
          ? { label: "uploaded", type: "brand" as const }
          : { label: skill.source, type: "neutral" as const };

  const scopeBadge =
    skill.scope === "global"
      ? { label: "global", variant: "info" as const }
      : { label: "personal", variant: "neutral" as const };

  return (
    <div
      data-id="skill-row"
      className={[
        "flex items-center gap-[12px]",
        "px-[14px] py-[10px] bg-xyne-surface",
        "border rounded-xl",
        "cursor-pointer mb-[6px]",
        "transition-[border-color,opacity] duration-150",
        skill.enabled
          ? "border-xyne-border hover:border-xyne-success/30 hover:bg-xyne-surface-subtle"
          : "border-xyne-border hover:border-xyne-error/30",
        !skill.enabled ? "opacity-60" : "",
      ].join(" ")}
      onClick={() => onSelect(skill)}
    >
      {/* Avatar */}
      <Avatar
        name={skill.name || skill.slug}
        size={24}
        shape="circle"
        className={
          skill.source !== "seeded"
            ? "!bg-xyne-brand/10 !text-xyne-brand border border-xyne-brand/20"
            : "!bg-xyne-surface-sunken !text-xyne-fg-secondary border border-xyne-border"
        }
      />

      {/* Status dot */}
      <span
        className={[
          "w-[6px] h-[6px] rounded-full flex-shrink-0",
          statusDotCls,
        ].join(" ")}
      />

      {/* Name + slug + description */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-[8px]">
          <span className="text-[13px] font-medium text-xyne-fg-primary truncate">
            {skill.name || skill.slug}
          </span>
          {sourceBadge.type === "brand" ? (
            <span className="text-[11px] font-medium px-[8px] py-[1px] rounded-full bg-xyne-brand/10 text-xyne-brand border border-xyne-brand/20">
              {sourceBadge.label}
            </span>
          ) : (
            <Badge
              as="span"
              label={sourceBadge.label}
              variant="neutral"
              size="sm"
            />
          )}
          {showScopeBadge && (
            <Badge
              as="span"
              label={scopeBadge.label}
              variant={scopeBadge.variant}
              size="sm"
            />
          )}
        </div>
        <div className="flex items-center gap-[6px] mt-[2px]">
          <span className="text-[11px] font-mono text-xyne-fg-tertiary">
            {skill.slug}
          </span>
          {skill.description && (
            <>
              <span className="text-[11px] text-xyne-fg-tertiary">·</span>
              <span className="text-[11px] text-xyne-fg-secondary truncate">
                {skill.description}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Toggle */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex items-center gap-[5px] flex-shrink-0"
      >
        <Switch
          checked={skill.enabled}
          onChange={(v) => onToggleEnabled(skill, v)}
          disabled={toggling || !isOwner || skill.source === "seeded"}
        />
        <span className="text-[10px] text-xyne-fg-tertiary whitespace-nowrap">
          {skill.enabled ? "Enabled" : "Disabled"}
        </span>
      </div>

      {/* Caret */}
      <CaretRightIcon
        size={14}
        className="text-xyne-fg-tertiary flex-shrink-0"
      />
    </div>
  );
}
