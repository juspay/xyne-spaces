import { useEffect, useMemo, useState } from "react";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { Dialog } from "./ui/Dialog";
import { Button } from "./ui/Button";
import { Badge } from "./ui/Badge";
import { getAvailableTools, type AvailableTools } from "../../lib/api";

export interface AgentToolSelection {
  subagents: string[];
  direct: string[];
  custom: string[];
  gateway: string[];
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: AgentToolSelection;
  onSave: (next: AgentToolSelection) => Promise<void> | void;
}

function toggle(arr: string[], v: string): string[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
}

export function ToolPickerDialog({ open, onOpenChange, initial, onSave }: Props) {
  const [available, setAvailable] = useState<AvailableTools | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [selection, setSelection] = useState<AgentToolSelection>(initial);

  // Reset selection when dialog opens with fresh initial values
  useEffect(() => {
    if (open) setSelection(initial);
  }, [open, initial]);

  // Fetch available tools once
  useEffect(() => {
    if (!open || available) return;
    setLoading(true);
    getAvailableTools()
      .then(setAvailable)
      .catch((err) => console.error("[tool-picker] load error:", err))
      .finally(() => setLoading(false));
  }, [open, available]);

  const totalSelected =
    selection.subagents.length + selection.direct.length + selection.custom.length;

  const matchesSearch = (text: string) =>
    !search.trim() || text.toLowerCase().includes(search.trim().toLowerCase());

  const filteredCustomGroups = useMemo(() => {
    if (!available) return [];
    if (!search.trim()) return available.customGroups;
    return available.customGroups
      .map((g) => ({
        ...g,
        tools: g.tools.filter((t) => matchesSearch(t.name) || matchesSearch(t.slug)),
      }))
      .filter((g) => g.tools.length > 0);
  }, [available, search]);

  const filteredSubagents = useMemo(() => {
    if (!available) return [];
    return available.subagents.filter((s) => matchesSearch(s.name) || matchesSearch(s.description));
  }, [available, search]);

  const filteredWriteTools = useMemo(() => {
    if (!available) return [];
    return available.writeTools.filter((t) => matchesSearch(t.name) || matchesSearch(t.source));
  }, [available, search]);

  // Non-write MCP server tools grouped by source. Source key is the bare
  // server type (the `/tools/available` route strips the `mcp:` prefix), so
  // e.g. webfetch lives under `claw-builtin`, github read tools under
  // `github`, etc. Write tools are surfaced separately in `filteredWriteTools`
  // above; we exclude their names here to avoid duplicate pills. Custom
  // (`custom:...`) sources have their own section already, so we skip those.
  const filteredServerTools = useMemo(() => {
    if (!available) return [] as Array<{ source: string; tools: Array<{ slug: string; name: string }> }>;
    const writeToolNames = new Set(available.writeTools.map((t) => t.name));
    return Object.entries(available.serverTools)
      .filter(([source]) => !source.startsWith("custom:"))
      .map(([source, tools]) => ({
        source,
        tools: (tools as Array<{ slug: string; name: string }>)
          .filter((t) => !writeToolNames.has(t.name))
          .filter((t) => matchesSearch(t.name) || matchesSearch(t.slug) || matchesSearch(source)),
      }))
      .filter((g) => g.tools.length > 0);
  }, [available, search]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(selection);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add tools"
      description="Pick subagents, MCP tools, or custom tools to attach to this agent."
      maxWidth={720}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onClick={() => void handleSave()} disabled={saving}>
            {saving ? "Saving…" : `Save (${totalSelected})`}
          </Button>
        </>
      }
    >
      {/* Search */}
      <div className="relative">
        <MagnifyingGlassIcon
          size={14}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xyne-fg-tertiary"
        />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search tools…"
          className="w-full rounded-full border border-xyne-border bg-xyne-surface py-2 pl-9 pr-3 text-[13px] text-xyne-fg-primary placeholder:text-xyne-fg-placeholder focus:border-xyne-border-focus focus:shadow-[var(--comp-focus-ring)] focus:outline-none"
        />
      </div>

      {/* Tool sections */}
      <div className="space-y-5">
        {loading && (
          <p className="py-8 text-center text-[13px] text-xyne-fg-tertiary">Loading tools…</p>
        )}

        {!loading && available && (
          <>
            {/* Subagents */}
            {filteredSubagents.length > 0 && (
              <CategorySection
                title="Subagents"
                description="Delegate parts of the work to another agent."
              >
                {filteredSubagents.map((sa) => (
                  <ToolPill
                    key={sa.name}
                    label={sa.name}
                    selected={selection.subagents.includes(sa.name)}
                    onToggle={() =>
                      setSelection((s) => ({ ...s, subagents: toggle(s.subagents, sa.name) }))
                    }
                  />
                ))}
              </CategorySection>
            )}

            {/* Direct / Write tools */}
            {filteredWriteTools.length > 0 && (
              <CategorySection
                title="Direct Tools"
                description="Write-capable MCP tools across all connected servers."
              >
                {filteredWriteTools.map((t) => (
                  <ToolPill
                    key={`${t.source}-${t.name}`}
                    label={t.name}
                    selected={selection.direct.includes(t.name)}
                    onToggle={() =>
                      setSelection((s) => ({ ...s, direct: toggle(s.direct, t.name) }))
                    }
                  />
                ))}
              </CategorySection>
            )}

            {/* Custom tools by source */}
            {filteredCustomGroups.length > 0 && (
              <CategorySection
                title="Custom Tools"
                description="Domain-specific tools grouped by their owning agent."
              >
                <div className="flex w-full flex-col gap-3">
                  {filteredCustomGroups.map((g) => (
                    <div key={g.source}>
                      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-tertiary">
                        {g.source.replace(/^custom:/, "")}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {g.tools.map((t) => (
                          <ToolPill
                            key={t.slug}
                            label={t.name}
                            selected={selection.custom.includes(t.slug)}
                            onToggle={() =>
                              setSelection((s) => ({ ...s, custom: toggle(s.custom, t.slug) }))
                            }
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </CategorySection>
            )}

            {/* Non-write MCP server tools (e.g. claw-builtin:webfetch, github
                read-only tools). These were dropped in earlier v3 revisions —
                only subagents/writeTools/custom were rendered, so any tool
                synced from an MCP server but not flagged as write-tool was
                invisible to the picker. Restoring the section. */}
            {filteredServerTools.length > 0 && (
              <CategorySection
                title="MCP Server Tools"
                description="Read-only tools synced from connected MCP servers."
              >
                <div className="flex w-full flex-col gap-3">
                  {filteredServerTools.map((g) => (
                    <div key={g.source}>
                      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-tertiary">
                        {g.source}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {g.tools.map((t) => (
                          <ToolPill
                            key={t.slug}
                            label={t.name}
                            // Select by the unique `slug`, NOT `name`. Two
                            // different MCP servers can expose a tool with the
                            // same `name` (e.g. `ping`, `search_files`); keying
                            // selection on `name` made both pills toggle as one.
                            // `slug` is unique per (source, tool). Mirrors the
                            // custom-tools section above. Legacy configs that
                            // stored the bare name still match via the `||`.
                            selected={selection.direct.includes(t.slug) || selection.direct.includes(t.name)}
                            onToggle={() =>
                              setSelection((s) => ({
                                ...s,
                                // Drop any legacy bare-name entry for this tool
                                // while toggling the slug, so re-saving migrates
                                // the stored id from name → slug cleanly.
                                direct: toggle(s.direct.filter((d) => d !== t.name), t.slug),
                              }))
                            }
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </CategorySection>
            )}

            {filteredSubagents.length === 0 &&
              filteredWriteTools.length === 0 &&
              filteredCustomGroups.length === 0 &&
              filteredServerTools.length === 0 && (
                <p className="py-8 text-center text-[13px] text-xyne-fg-tertiary">
                  No tools match "{search}".
                </p>
              )}
          </>
        )}
      </div>
    </Dialog>
  );
}

function CategorySection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2">
        <p className="text-[13px] font-semibold text-xyne-fg-primary">{title}</p>
        {description && (
          <p className="mt-0.5 text-[12px] text-xyne-fg-tertiary">{description}</p>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function ToolPill({
  label,
  selected,
  onToggle,
}: {
  label: string;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <Badge
      label={label}
      selected={selected}
      variant="neutral"
      interactive
      onClick={onToggle}
    />
  );
}
