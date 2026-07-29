import { useMemo, useState } from "react";
import {
  CaretDownIcon,
  CaretRightIcon,
  EyeIcon,
  PencilSimpleIcon,
} from "@phosphor-icons/react";
import type { Integration, IntegrationToolEntry } from "../../../lib/api";
import { Switch } from "../ui/Switch";

/* ── selection model ───────────────────────────────────────────────────
   The IntegrationCard doesn't own the agent-tools state. It receives the
   subset of selection it cares about (the `selected` set of tool keys —
   either MCP tool *names* for mcp/builtin kinds, or tool *slugs* for
   custom kinds) and emits add/remove operations against it. The parent
   wires those into agent.config.tools accordingly. */

type SelectionKey = string;

interface Props {
  integration: Integration;
  /** Set of selected tool keys (names for mcp/builtin, slugs for custom). */
  selected: ReadonlySet<SelectionKey>;
  onToggle: (key: SelectionKey, next: boolean) => void;
  /** Bulk toggle — emitted when the user clicks the read/write group toggle. */
  onBulkToggle: (keys: SelectionKey[], next: boolean) => void;
  disabled?: boolean;
}

/* ── helpers ───────────────────────────────────────────────────────── */

function entryKey(entry: IntegrationToolEntry, kind: Integration["kind"]): SelectionKey {
  // Custom-source tools are addressed by slug at runtime; MCP and builtin
  // sources use the bare tool name. Mirrors the existing AgentToolSelection
  // shape in ToolPickerDialog.
  return kind === "custom" ? entry.slug : entry.name;
}

/* ── component ─────────────────────────────────────────────────────── */

export function IntegrationCard({ integration, selected, onToggle, onBulkToggle, disabled }: Props) {
  // Cards expand by default to match the new design — users see Read/Write
  // groups + tool rows immediately. They can collapse if they want a more
  // compact view.
  const [expanded, setExpanded] = useState(true);

  const selectedRead = integration.readTools.filter((e) =>
    selected.has(entryKey(e, integration.kind)),
  ).length;
  const selectedWrite = integration.writeTools.filter((e) =>
    selected.has(entryKey(e, integration.kind)),
  ).length;
  const destructiveCount = integration.writeTools.filter(
    (e) => e.riskLevel === "destructive",
  ).length;

  const totalSelected = selectedRead + selectedWrite;
  const hasAnySelected = totalSelected > 0;

  const kindLabel =
    integration.kind === "mcp"
      ? "MCP integration"
      : integration.kind === "builtin"
        ? "Sandbox"
        : integration.kind === "gateway"
          ? "ACL"
          : "Custom tools";

  // True when the backend has no tools at all for this integration — server
  // is registered but its tool list was never synced to the DB.
  const hasNoTools =
    integration.readTools.length === 0 && integration.writeTools.length === 0;

  return (
    <div
      className={`flex flex-col overflow-hidden rounded-xl border bg-xyne-surface transition-colors ${
        hasAnySelected ? "border-xyne-border-strong" : "border-xyne-border"
      }`}
    >
      {/* ── Integration header row ────────────────────────────────────
            Click to expand/collapse the per-group sections beneath. */}
      <div className="flex items-center gap-3 px-4 py-3">
        {hasNoTools ? (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="w-3 shrink-0" />
            <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-xyne-fg-primary opacity-50">
              {integration.label}
            </span>
            <span className="shrink-0 text-[11px] text-xyne-fg-tertiary">
              {kindLabel}
            </span>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex min-w-0 flex-1 items-center gap-2 text-left focus:outline-none"
          >
            {expanded ? (
              <CaretDownIcon size={12} className="shrink-0 text-xyne-fg-tertiary" />
            ) : (
              <CaretRightIcon size={12} className="shrink-0 text-xyne-fg-tertiary" />
            )}
            <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-xyne-fg-primary">
              {integration.label}
              {integration.kind === "gateway" && integration.backendIds && integration.backendIds.length > 0 && (
                <span className="ml-1.5 text-[11px] font-normal text-xyne-fg-muted">
                  ({integration.backendIds.join(", ")})
                </span>
              )}
            </span>
            {integration.kind === "gateway" ? (
              <span className="shrink-0 rounded border border-xyne-brand/40 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-xyne-brand/70">
                ACL
              </span>
            ) : (
              <span className="shrink-0 text-[11px] text-xyne-fg-tertiary">
                {kindLabel}
              </span>
            )}
          </button>
        )}

        {/* Service-level enable/disable switch for gateway integrations */}
        {integration.kind === "gateway" && !hasNoTools && (
          <Switch
            checked={hasAnySelected}
            onChange={() => {
              const allKeys = [
                ...integration.readTools.map((e) => entryKey(e, integration.kind)),
                ...integration.writeTools.map((e) => entryKey(e, integration.kind)),
              ];
              onBulkToggle(allKeys, !hasAnySelected);
            }}
            disabled={disabled}
          />
        )}

        {/* Selection summary — visible regardless of expanded state. */}
        <span className="shrink-0 text-[11px] text-xyne-fg-muted">
          {hasNoTools
            ? "Not synced"
            : hasAnySelected
              ? `${totalSelected} enabled`
              : "Nothing enabled"}
        </span>
      </div>

      {/* ── Not-synced hint row ────────────────────────────────────── */}
      {hasNoTools && (
        <div className="border-t border-xyne-border-subtle px-4 py-2 text-[11px] italic text-xyne-fg-tertiary">
          No tools found for this integration. Ask your admin to run a tool sync.
        </div>
      )}

      {/* ── Per-group sections ───────────────────────────────────────
            Two stacked sections (Read Tools / Write Tools) using the
            new design: tinted icon box, group title + count subtitle,
            "Enable all" toggle, then a divider-separated tool list. */}
      {!hasNoTools && expanded && (
        <div className="border-t border-xyne-border-subtle">
          {integration.readTools.length > 0 && (
            <GroupSection
              kind="read"
              entries={integration.readTools}
              integrationKind={integration.kind}
              selected={selected}
              selectedCount={selectedRead}
              onToggle={onToggle}
              onBulkToggle={onBulkToggle}
              disabled={disabled}
            />
          )}
          {integration.writeTools.length > 0 && (
            <GroupSection
              kind="write"
              entries={integration.writeTools}
              integrationKind={integration.kind}
              selected={selected}
              selectedCount={selectedWrite}
              destructiveCount={destructiveCount}
              onToggle={onToggle}
              onBulkToggle={onBulkToggle}
              disabled={disabled}
            />
          )}
        </div>
      )}
    </div>
  );
}

/* ── GroupSection ─────────────────────────────────────────────────────
   One section per kind (read or write). Matches the agreed design:
     [tinted icon box]  Group title           Enable all  [switch]
                        N of M on · risk hint
     ───────────────────────────────────────────────────────────────
     [✓] tool_name      Description                       [read]
     [ ] other_tool     Description                       [read]
     …
*/
interface GroupSectionProps {
  kind: "read" | "write";
  entries: IntegrationToolEntry[];
  integrationKind: Integration["kind"];
  selected: ReadonlySet<SelectionKey>;
  selectedCount: number;
  destructiveCount?: number;
  onToggle: (key: SelectionKey, next: boolean) => void;
  onBulkToggle: (keys: SelectionKey[], next: boolean) => void;
  disabled?: boolean;
}

function GroupSection({
  kind,
  entries,
  integrationKind,
  selected,
  selectedCount,
  destructiveCount = 0,
  onToggle,
  onBulkToggle,
  disabled,
}: GroupSectionProps) {
  const isRead = kind === "read";
  const allOn = selectedCount === entries.length;

  // Group palette — soft blue tint for Read (safe), soft orange for Write
  // (mutating). The icon sits in a small rounded tile next to the title.
  const palette = isRead
    ? {
        iconBg:    "bg-[#eff6ff] dark:bg-[#1e3a8a]/20",
        iconColor: "text-[#2563eb] dark:text-[#60a5fa]",
        pillCls:
          "border-[#bfdbfe] bg-[#eff6ff] text-[#2563eb] dark:border-[#1e3a8a] dark:bg-[#1e3a8a]/30 dark:text-[#93c5fd]",
      }
    : {
        iconBg:    "bg-[#fff7ed] dark:bg-[#7c2d12]/20",
        iconColor: "text-[#ea580c] dark:text-[#fdba74]",
        pillCls:
          "border-[#fed7aa] bg-[#fff7ed] text-[#c2410c] dark:border-[#7c2d12] dark:bg-[#7c2d12]/30 dark:text-[#fdba74]",
      };
  const Icon = isRead ? EyeIcon : PencilSimpleIcon;

  // Subtitle hint per group:
  //   Read  — "safe, read-only"
  //   Write — "N can delete permanently" when there are destructives,
  //           else "mutates external systems"
  const subtitle = isRead
    ? "safe, read-only"
    : destructiveCount > 0
      ? `${destructiveCount} can delete permanently`
      : "mutates external systems";

  const handleBulk = () => {
    const keys = entries.map((e) => entryKey(e, integrationKind));
    onBulkToggle(keys, !allOn);
  };

  return (
    <section
      data-id={`integration-group-${kind}`}
      className="border-b border-xyne-border-subtle last:border-b-0"
    >
      {/* Group header */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${palette.iconBg}`}
        >
          <Icon size={16} className={palette.iconColor} weight="fill" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-xyne-fg-primary">
            {isRead ? "Read Tools" : "Write Tools"}
          </div>
          <div className="text-[11px] text-xyne-fg-tertiary">
            <span className="tabular-nums">{selectedCount} of {entries.length} on</span>
            <span className="mx-1.5 text-xyne-fg-muted">·</span>
            <span className={!isRead && destructiveCount > 0 ? "text-xyne-error-fg" : ""}>
              {subtitle}
            </span>
          </div>
        </div>
        <span className="hidden text-[12px] text-xyne-fg-tertiary sm:inline">
          Enable all
        </span>
        <Switch
          checked={allOn}
          onChange={handleBulk}
          disabled={disabled || entries.length === 0}
        />
      </div>

      {/* Tool rows */}
      <div className="divide-y divide-xyne-border-subtle border-t border-xyne-border-subtle">
        {entries.map((entry) => {
          const key = entryKey(entry, integrationKind);
          const isSel = selected.has(key);
          return (
            <label
              key={key}
              className={`flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors hover:bg-xyne-surface-subtle ${
                disabled ? "cursor-not-allowed opacity-60" : ""
              }`}
            >
              <input
                type="checkbox"
                checked={isSel}
                disabled={disabled}
                onChange={(e) => onToggle(key, e.target.checked)}
                className="h-3.5 w-3.5 shrink-0 cursor-pointer rounded border-xyne-border-strong accent-xyne-brand disabled:cursor-not-allowed"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="font-mono text-[12px] text-xyne-fg-primary">
                    {entry.name}
                  </span>
                  {entry.description && (
                    <span className="text-[12px] text-xyne-fg-tertiary">
                      {entry.description}
                    </span>
                  )}
                </div>
              </div>
              <span
                className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${palette.pillCls}`}
              >
                {isRead ? "read" : entry.riskLevel === "destructive" ? "destructive" : "write"}
              </span>
            </label>
          );
        })}
      </div>
    </section>
  );
}
