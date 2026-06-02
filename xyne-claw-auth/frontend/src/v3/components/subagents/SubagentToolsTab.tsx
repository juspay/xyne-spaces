/**
 * SubagentToolsTab — categorized tool picker.
 *
 * Replaces the previous free-text textarea inputs with a chip-based picker
 * that mirrors V1's SubagentDetailPage UX. Backend shape (from
 * /api/v1/tools/available) gives us three buckets, each grouped by source:
 *
 *   - Write Tools           backend `availableTools.writeTools`, an array of
 *                           `{name, source}`. Selection is by name and lives
 *                           in the subagent's `tools.direct[]` array.
 *   - MCP Server Tools      backend `availableTools.serverTools`, a record of
 *                           `source → [{slug, name}]`. We exclude any name
 *                           that's already a write tool so a tool only shows
 *                           up in one place. Selection is by name, also into
 *                           `tools.direct[]`.
 *   - System Tools          backend `availableTools.customGroups`, an array of
 *                           `{source, tools: [{slug, name}]}`. Selection is by
 *                           *slug* (not name — custom names aren't globally
 *                           unique) and lives in `tools.custom[]`.
 *
 * The parent page stores draft tool selections as newline-joined strings
 * (matches the backend save shape). Internally we parse to Sets for O(1)
 * lookups during render, then join back on every toggle. Re-parsing on each
 * render is negligible at this size (~76 tools max in current catalog).
 */

import { useMemo } from "react";
import { CaretRightIcon } from "@phosphor-icons/react";
import type { AvailableTools, SubagentDef } from "../../../lib/api";

interface SubagentToolsTabProps {
  subagent: SubagentDef;
  isBuiltIn: boolean;
  canEdit: boolean;

  availableTools: AvailableTools | null;
  toolsLoading: boolean;

  draftDirectTools: string;
  onDraftDirectToolsChange: (v: string) => void;

  draftCustomTools: string;
  onDraftCustomToolsChange: (v: string) => void;
}

/* ── helpers ───────────────────────────────────────────────────────── */

function parseSelection(s: string): Set<string> {
  return new Set(
    s
      .split(/[\n,]+/)
      .map((x) => x.trim())
      .filter(Boolean),
  );
}

function formatSelection(set: Set<string>): string {
  return [...set].join("\n");
}

/** Toggle a value in a Set without mutating the input. */
function toggleInSet(set: Set<string>, value: string): Set<string> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

/* ── primitives ────────────────────────────────────────────────────── */

/* Collapsible section using native <details> — keyboard accessible and
   styleable without dragging in another component. */
function ToolSection({
  title,
  badge,
  defaultOpen = true,
  children,
}: {
  title: string;
  badge: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details
      open={defaultOpen}
      className="group/sec rounded-xl border border-xyne-border-subtle bg-xyne-surface"
    >
      <summary className="flex cursor-pointer items-center justify-between gap-2 px-4 py-3 list-none [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2">
          <CaretRightIcon
            size={12}
            weight="bold"
            className="text-xyne-fg-tertiary transition-transform group-open/sec:rotate-90"
          />
          <span className="text-[13px] font-semibold text-xyne-fg-primary">
            {title}
          </span>
        </span>
        <span className="text-[11px] tabular-nums text-xyne-fg-tertiary">
          {badge}
        </span>
      </summary>
      <div className="px-4 pb-4 pt-1 flex flex-col gap-4">{children}</div>
    </details>
  );
}

/* Chip — single tool button. Same shape used for direct + custom; only the
   identifier passed in differs. */
function ToolChip({
  label,
  selected,
  disabled,
  onClick,
}: {
  label: string;
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`rounded-md border px-2.5 py-1 text-[12px] transition disabled:cursor-not-allowed disabled:opacity-50 ${
        selected
          ? "border-xyne-brand bg-xyne-brand text-xyne-fg-inverse"
          : "border-xyne-border bg-xyne-surface-sunken text-xyne-fg-secondary hover:border-xyne-border-strong"
      }`}
    >
      {label}
    </button>
  );
}

/* Source sub-header — small label above a wrap of chips. */
function SourceLabel({
  source,
  selected,
  total,
}: {
  source: string;
  selected: number;
  total: number;
}) {
  return (
    <p className="text-[11px] text-xyne-fg-tertiary mb-1.5">
      {source}
      <span className="ml-1.5 tabular-nums text-xyne-fg-muted">
        {selected}/{total}
      </span>
    </p>
  );
}

/* ── component ─────────────────────────────────────────────────────── */

export function SubagentToolsTab({
  isBuiltIn,
  canEdit,
  availableTools,
  toolsLoading,
  draftDirectTools,
  onDraftDirectToolsChange,
  draftCustomTools,
  onDraftCustomToolsChange,
}: SubagentToolsTabProps) {
  const disabled = isBuiltIn || !canEdit;

  /* Parse selection strings to Sets for O(1) hit-testing during render. */
  const directSet = useMemo(
    () => parseSelection(draftDirectTools),
    [draftDirectTools],
  );
  const customSet = useMemo(
    () => parseSelection(draftCustomTools),
    [draftCustomTools],
  );

  const toggleDirect = (name: string) => {
    onDraftDirectToolsChange(formatSelection(toggleInSet(directSet, name)));
  };
  const toggleCustom = (slug: string) => {
    onDraftCustomToolsChange(formatSelection(toggleInSet(customSet, slug)));
  };

  /* Loading state */
  if (toolsLoading || !availableTools) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-semibold text-xyne-fg-primary">
              Toolbox
            </span>
            <span className="text-xyne-fg-tertiary">•</span>
            <span className="text-[13px] font-normal text-xyne-fg-tertiary">
              tools
            </span>
          </div>
        </div>
        <p className="text-[13px] text-xyne-fg-muted">Loading tools…</p>
      </div>
    );
  }

  /* Group write tools by their backend `source` field. */
  const writeToolNames = new Set(
    availableTools.writeTools.map((t) => t.name),
  );
  const writeGroups = Object.entries(
    availableTools.writeTools.reduce<Record<string, Array<{ name: string }>>>(
      (acc, t) => {
        (acc[t.source] ??= []).push({ name: t.name });
        return acc;
      },
      {},
    ),
  ).map(([source, tools]) => ({ source, tools }));

  /* Group MCP server tools, excluding any name already in writeTools so a
     tool appears in only one section. */
  const serverGroups = Object.entries(availableTools.serverTools ?? {})
    .map(([source, tools]) => ({
      source,
      tools: tools.filter((t) => !writeToolNames.has(t.name)),
    }))
    .filter((g) => g.tools.length > 0);
  const serverToolNames = new Set(
    serverGroups.flatMap((g) => g.tools.map((t) => t.name)),
  );

  /* System (custom) tools come pre-grouped from the backend. */
  const customGroups = availableTools.customGroups;
  const totalCustom = customGroups.reduce(
    (sum, g) => sum + g.tools.length,
    0,
  );

  /* Selection counts per section. */
  const selectedWriteCount = [...directSet].filter((n) =>
    writeToolNames.has(n),
  ).length;
  const selectedServerCount = [...directSet].filter((n) =>
    serverToolNames.has(n),
  ).length;
  const selectedCustomCount = customSet.size;

  return (
    <div className="flex flex-col gap-5">
      {/* Tab header */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-baseline gap-2 min-w-0">
            <span className="text-[14px] font-semibold text-xyne-fg-primary">
              Toolbox
            </span>
            <span className="text-xyne-fg-tertiary">•</span>
            <span className="text-[13px] font-normal text-xyne-fg-tertiary">
              tools
            </span>
          </span>
        </div>
        <p className="text-[12px] text-xyne-fg-tertiary">
          Pick what this specialist can call directly. Write tools and MCP
          server tools land in <span className="font-mono">tools.direct</span>;
          system tools land in <span className="font-mono">tools.custom</span>.
        </p>
      </div>

      {/* Write Tools */}
      {writeGroups.length > 0 && (
        <ToolSection
          title="Write Tools"
          badge={`${selectedWriteCount} / ${availableTools.writeTools.length} selected`}
        >
          {writeGroups.map((g) => {
            const groupSelected = g.tools.filter((t) =>
              directSet.has(t.name),
            ).length;
            return (
              <div key={g.source}>
                <SourceLabel
                  source={g.source}
                  selected={groupSelected}
                  total={g.tools.length}
                />
                <div className="flex flex-wrap gap-1.5">
                  {g.tools.map((t) => (
                    <ToolChip
                      key={`${g.source}-${t.name}`}
                      label={t.name}
                      selected={directSet.has(t.name)}
                      disabled={disabled}
                      onClick={() => toggleDirect(t.name)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </ToolSection>
      )}

      {/* MCP Server Tools */}
      {serverGroups.length > 0 && (
        <ToolSection
          title="MCP Server Tools"
          badge={`${selectedServerCount} / ${serverToolNames.size} selected`}
        >
          {serverGroups.map((g) => {
            const groupSelected = g.tools.filter((t) =>
              directSet.has(t.name),
            ).length;
            return (
              <div key={g.source}>
                <SourceLabel
                  source={g.source}
                  selected={groupSelected}
                  total={g.tools.length}
                />
                <div className="flex flex-wrap gap-1.5">
                  {g.tools.map((t) => (
                    <ToolChip
                      key={`${g.source}-${t.slug}`}
                      label={t.name}
                      selected={directSet.has(t.name)}
                      disabled={disabled}
                      onClick={() => toggleDirect(t.name)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </ToolSection>
      )}

      {/* System (custom MCP) Tools */}
      {customGroups.length > 0 && (
        <ToolSection
          title="System Tools"
          badge={`${selectedCustomCount} / ${totalCustom} selected`}
        >
          {customGroups.map((g) => {
            const groupSelected = g.tools.filter((t) =>
              customSet.has(t.slug),
            ).length;
            const friendly = g.source.replace("custom:", "");
            return (
              <div key={g.source}>
                <SourceLabel
                  source={friendly}
                  selected={groupSelected}
                  total={g.tools.length}
                />
                <div className="flex flex-wrap gap-1.5">
                  {g.tools.map((t) => (
                    <ToolChip
                      key={t.slug}
                      label={t.name}
                      selected={customSet.has(t.slug)}
                      disabled={disabled}
                      onClick={() => toggleCustom(t.slug)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </ToolSection>
      )}

      {writeGroups.length === 0 &&
        serverGroups.length === 0 &&
        customGroups.length === 0 && (
          <p className="text-[13px] text-xyne-fg-muted">
            No tools available.
          </p>
        )}
    </div>
  );
}
