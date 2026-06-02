import {
  CaretLeftIcon,
  LockIcon,
} from "@phosphor-icons/react";
import type { SubagentDef } from "../../../lib/api";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Switch } from "../ui/Switch";

interface SubagentEditHeaderProps {
  subagent: SubagentDef;
  isBuiltIn: boolean;
  dirty: boolean;
  saving: boolean;
  canEdit: boolean;
  onSave: () => void;
  onToggleEnabled: (value: boolean) => void;
  onBack: () => void;
}

/* Format an ISO string into a compact relative-or-date label suitable for a
   meta line. "3m ago" / "2h ago" / "Jan 12". Keeps the header dense. */
function formatRelative(iso: string | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const diffMs = Date.now() - d.getTime();
  const min = 60 * 1000;
  const hr = 60 * min;
  const day = 24 * hr;
  if (diffMs < min) return "just now";
  if (diffMs < hr) return `${Math.floor(diffMs / min)}m ago`;
  if (diffMs < day) return `${Math.floor(diffMs / hr)}h ago`;
  if (diffMs < 7 * day) return `${Math.floor(diffMs / day)}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function SubagentEditHeader({
  subagent,
  isBuiltIn,
  dirty,
  saving,
  canEdit,
  onSave,
  onToggleEnabled,
  onBack,
}: SubagentEditHeaderProps) {
  const created = formatRelative(subagent.createdAt);
  const updated = formatRelative(subagent.updatedAt);

  /* Source provenance + timestamps used to live in a separate "Details" tab
     on the right column. They're glance-info, not interactive, so they get
     absorbed into the header as a small meta-line under the name. */
  const metaParts: string[] = [];
  if (subagent.source) metaParts.push(subagent.source);
  if (created) metaParts.push(`created ${created}`);
  if (updated && updated !== created) metaParts.push(`updated ${updated}`);

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-xyne-border-subtle px-5 py-3">
      {/* Left cluster */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-[12px] text-xyne-fg-tertiary transition-colors hover:text-xyne-fg-secondary shrink-0"
        >
          <CaretLeftIcon size={14} />
          Subagents
        </button>

        <div className="h-4 w-px bg-xyne-border-subtle shrink-0" />

        <div className="flex min-w-0 flex-col">
          {/* Row 1: name + lock + badges.
              Name uses `font-mono` because it doubles as the permanent
              identifier — agents reference this specialist by name in
              their `config.tools.subagents` array, so it can't be renamed
              (backend returns 400 "name is immutable" on rename). Styling
              it as an ID visually signals "this is a slug, not a label".
              The Persona tab no longer carries a separate Name field. */}
          <div className="flex items-center gap-1.5 min-w-0">
            <span
              className="max-w-[260px] truncate font-mono text-[13px] font-medium text-xyne-fg-primary"
              title="Permanent — agents reference this specialist by name. Edit other fields below."
            >
              {subagent.name}
            </span>
            {isBuiltIn && (
              <LockIcon size={12} className="text-xyne-fg-tertiary shrink-0" />
            )}
            <Badge
              as="span"
              label={isBuiltIn ? "built-in" : "custom"}
              variant={isBuiltIn ? "neutral" : "info"}
              size="sm"
            />
            <Badge
              as="span"
              label={subagent.enabled ? "Active" : "Disabled"}
              variant={subagent.enabled ? "success" : "warning"}
              size="sm"
            />
          </div>
          {/* Row 2: provenance / timestamps. Absorbed from old Details tab —
              just enough glance info that users don't need a separate tab
              to see where this subagent came from or when it last changed. */}
          {metaParts.length > 0 && (
            <span className="mt-0.5 truncate text-[11px] text-xyne-fg-tertiary">
              {metaParts.join(" · ")}
            </span>
          )}
        </div>
      </div>

      {/* Right cluster */}
      <div className="ml-auto flex items-center gap-2 shrink-0">
        {!isBuiltIn && canEdit && dirty && (
          <Button
            variant="primary"
            size="sm"
            disabled={saving}
            onClick={onSave}
          >
            {saving ? "Saving…" : "Save changes"}
          </Button>
        )}

        {!isBuiltIn && canEdit && (
          <div className="flex items-center gap-1.5">
            <Switch
              checked={subagent.enabled}
              onChange={onToggleEnabled}
            />
            <span className="text-[11px] text-xyne-fg-tertiary">
              {subagent.enabled ? "Enabled" : "Disabled"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
