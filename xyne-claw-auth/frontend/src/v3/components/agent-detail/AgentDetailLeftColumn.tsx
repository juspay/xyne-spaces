import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import {
  RobotIcon,
  PlugIcon,
  GearSixIcon,
  SlidersIcon,
  MagicWandIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  XIcon,
  CaretDownIcon,
  CaretRightIcon,
  LockSimpleIcon,
  InfoIcon,
  CheckIcon,
  ArrowDownIcon,
  PencilSimpleIcon,
} from "@phosphor-icons/react";
import type { Agent } from "../../../lib/types";
import type { AgentPermissions } from "../../lib/agentPermissions";
import type { ClaudeModelInfo, AvailableTools, Skill, ProviderCredential } from "../../../lib/api";
import type { AgentProvider } from "../../hooks/useAgents";
import type { AgentToolSelection } from "../ToolPickerDialog";
import { useSnackbar } from "../ui/Snackbar";
import { Tabs, type TabItem } from "../ui/Tabs";
import { Dialog } from "../ui/Dialog";
import { IntegrationCard } from "./IntegrationCard";

/* ── Tab model ─────────────────────────────────────────────────────────
   Four-layer mental model: who the agent is (Persona), what it knows
   (Knowledge), what it can do (Toolbox), and how it behaves on the job
   (Behavior — combines per-turn reminders and reactive tool triggers).
   Identity (name/slug/description + provider) stays above the tab strip
   as always-relevant context.

   Removed from this surface:
   - Git URL — backend reads `repoUrl`, V3 wrote `gitRepoUrl`; field is
     dead config on the chat/scheduled path. Re-add when the backend
     migrates or aligns the key.
   - Model dropdown — `agent.modelId` is never read at runtime. The
     actual model lives on per-provider credentials, so model belongs
     in the Provider Credentials screen, not in the agent config. */
type ConfigTabKey =
  | "persona"
  | "knowledge"
  | "toolbox"
  | "behavior";

/* ── constants ─────────────────────────────────────────────────────── */



const KIND_ICON = {
  subagent: RobotIcon,
  direct:   PlugIcon,
  custom:   GearSixIcon,
} as const;

const KIND_LABEL: Record<keyof typeof KIND_ICON, string> = {
  subagent: "delegate",
  direct:   "direct action",
  custom:   "integration",
};

/* ── tool-tab taxonomy ─────────────────────────────────────────────
   Maps backend `kind` values to stable UI tab keys. Any unknown kind
   falls into "other" so future kinds are never silently dropped. */

const TOOL_TAB_LABELS = {
  subagents:     "Specialists",    // user-facing term; technical term is "subagents"
  integrations:  "Integrations",   // kind: "mcp"
  platform:      "Platform",       // kind: "custom" (Xyne-provided tools)
  sandbox:       "Sandbox",        // kind: "builtin" (filesystem tools)
  miscellaneous: "Miscellaneous",  // future / unknown kinds — tab only appears when ≥1 exists
} as const;

type ToolTabKey = keyof typeof TOOL_TAB_LABELS;

function kindToTab(kind: string): Exclude<ToolTabKey, "subagents"> {
  const map: Record<string, Exclude<ToolTabKey, "subagents">> = {
    mcp:     "integrations",
    custom:  "platform",
    builtin: "sandbox",
  };
  return map[kind] ?? "miscellaneous";
}

/* ── shimmer skeletons ─────────────────────────────────────────────
   Used when `availableTools` is still null (initial load). Each
   skeleton mirrors the shape of the real content so the layout
   doesn't shift when data arrives. */

function Shimmer({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-xyne-surface-subtle ${className}`} />;
}

function IntegrationCardSkeleton() {
  return (
    <div className="rounded-lg border border-xyne-border bg-xyne-surface">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <Shimmer className="h-3 w-3 rounded-full" />
        <Shimmer className="h-3 w-32" />
        <Shimmer className="ml-auto h-3 w-16" />
      </div>
      <div className="flex divide-x divide-xyne-border-subtle border-t border-xyne-border-subtle">
        {[0, 1].map((i) => (
          <div key={i} className="flex flex-1 items-center gap-2.5 px-3 py-2">
            <Shimmer className="h-[18px] w-[18px] shrink-0 rounded-md" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Shimmer className="h-3 w-20" />
              <Shimmer className="h-2.5 w-14" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SubagentPillsSkeleton() {
  const widths = [56, 88, 72, 64, 96, 56, 80, 64, 72, 56, 88, 64];
  return (
    <div className="flex flex-wrap gap-1.5">
      {widths.map((w, i) => (
        <div
          key={i}
          className="animate-pulse h-[26px] rounded-full bg-xyne-surface-subtle"
          style={{ width: w }}
        />
      ))}
    </div>
  );
}

/* ── section info content ──────────────────────────────────────────────
   Each toolbox tab has an info card that explains what the section contains,
   when to use it, and concrete examples. Opens as a modal via the ⓘ button
   in each section header. */

interface SectionInfoDef {
  title: string;
  tagline: string;
  what: string;
  when: string;
  examples: Array<{ name: string; note: string }>;
}

const SECTION_INFO: Record<ToolTabKey, SectionInfoDef> = {
  subagents: {
    title: "Specialists",
    tagline: "Domain-expert agents the agent can delegate to",
    what: "Specialists are purpose-built AI agents that handle tasks in a specific domain. When you enable a specialist, the parent agent can call on it during a conversation — delegating work rather than handling it directly.",
    when: "Enable a specialist when the agent needs deep expertise in a particular system (e.g. reading Grafana dashboards, creating GitHub PRs, managing Jira tickets). The parent agent decides which specialist to call based on the user's request.",
    examples: [
      { name: "spaces",       note: "Manages tickets, canvases, and calls inside Xyne Spaces" },
      { name: "github",       note: "Reads and writes code, PRs, issues, and reviews on GitHub" },
      { name: "grafana",      note: "Queries metrics, dashboards, and alert states from Grafana" },
      { name: "user-tickets", note: "Looks up and updates support tickets for a specific user" },
    ],
  },
  integrations: {
    title: "Integrations",
    tagline: "Connected third-party services via MCP",
    what: "Integration tools connect the agent directly to external platforms using the Model Context Protocol (MCP). Each integration exposes read tools (fetch data) and write tools (take action). You control exactly which tools are enabled.",
    when: "Enable integration tools when you want the agent to read from or act on an external service without going through a specialist. Useful when the agent needs targeted access — for example, only reading Slack messages without the full Slack specialist.",
    examples: [
      { name: "Slack",     note: "Read channels, post messages, reply to threads" },
      { name: "BigQuery",  note: "Run SQL queries against your data warehouse" },
      { name: "HubSpot",   note: "Read and update CRM contacts and deals" },
      { name: "Excalidraw", note: "Create and modify diagrams in a live canvas" },
    ],
  },
  platform: {
    title: "Platform tools",
    tagline: "Xyne-provided tools built into the platform",
    what: "Platform tools are shipped directly by Xyne and are always available — no external connections needed. They cover capabilities like web research, document processing, and data retrieval that are useful across many agent types.",
    when: "Enable platform tools when the agent needs general-purpose capabilities (e.g. browsing the web for up-to-date information, processing uploaded documents, or running internal search queries).",
    examples: [
      { name: "pgm",             note: "Package manager tool for looking up library versions" },
      { name: "google",          note: "Search Google and retrieve page content" },
      { name: "research-agent",  note: "Deep research across multiple sources" },
    ],
  },
  sandbox: {
    title: "Sandbox tools",
    tagline: "Sandboxed filesystem — read, write, and execute",
    what: "Sandbox tools give the agent access to a session-scoped filesystem. The agent can read files, write new ones, edit existing content, search with grep, and run shell commands — all confined to the session workspace. Nothing can escape the sandbox.",
    when: "Enable sandbox tools for coding agents that need to create or modify files, run tests, or execute scripts. Essential for any agent doing software development tasks.",
    examples: [
      { name: "read",  note: "Read the contents of a file by path" },
      { name: "write", note: "Create or overwrite a file" },
      { name: "edit",  note: "Apply precise string replacements to a file" },
      { name: "bash",  note: "Execute shell commands within the sandbox" },
      { name: "grep",  note: "Search file contents with a regular expression" },
    ],
  },
  miscellaneous: {
    title: "Miscellaneous tools",
    tagline: "Additional tools that don't fit standard categories",
    what: "This section contains tools added by future integrations or custom deployments that don't map to any of the standard categories. They follow the same read / write / destructive risk model as other integration tools.",
    when: "Check here if you've connected a new integration and can't find its tools in another tab, or if your deployment includes experimental or custom tool sources.",
    examples: [],
  },
};

interface SectionInfoModalProps {
  tab: ToolTabKey | null;
  onClose: () => void;
}

function SectionInfoModal({ tab, onClose }: SectionInfoModalProps) {
  if (!tab) return null;
  const info = SECTION_INFO[tab];
  return (
    <Dialog
      open={tab !== null}
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={info.title}
      description={info.tagline}
      maxWidth={520}
    >
      <div className="flex flex-col gap-4">
        {/* What */}
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-tertiary">
            What it is
          </div>
          <p className="text-[13px] leading-relaxed text-xyne-fg-secondary">{info.what}</p>
        </div>

        {/* When */}
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-tertiary">
            When to enable
          </div>
          <p className="text-[13px] leading-relaxed text-xyne-fg-secondary">{info.when}</p>
        </div>

        {/* Examples */}
        {info.examples.length > 0 && (
          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-tertiary">
              Examples
            </div>
            <div className="flex flex-col divide-y divide-xyne-border-subtle overflow-hidden rounded-lg border border-xyne-border">
              {info.examples.map((ex) => (
                <div key={ex.name} className="flex items-baseline gap-3 px-3 py-2">
                  <span className="shrink-0 font-mono text-[12px] font-medium text-xyne-fg-primary">
                    {ex.name}
                  </span>
                  <span className="text-[12px] text-xyne-fg-tertiary">{ex.note}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}

/* ── helper components ─────────────────────────────────────────────── */

/* Circular ⓘ button — click opens a modal with contextual explanation.
   Sits inline next to a section title. Styled as a plain outlined circle
   (matches the design reference: border + InfoIcon, no fill). */
function TabInfoBubble({
  modalTitle,
  modalDescription,
  content,
}: {
  modalTitle: string;
  modalDescription?: string;
  content: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`What is ${modalTitle}?`}
        className="shrink-0 text-xyne-fg-tertiary transition-colors hover:text-xyne-fg-secondary focus:outline-none"
      >
        <InfoIcon size={18} weight="regular" />
      </button>

      <Dialog
        open={open}
        onOpenChange={(o) => { if (!o) setOpen(false); }}
        title={modalTitle}
        description={modalDescription}
        maxWidth={480}
      >
        {content}
      </Dialog>
    </>
  );
}

function Section({
  title,
  description,
  action,
  info,
  children,
}: {
  /** ReactNode so callers can inline a small technical hint next to the
      friendly heading (e.g. "Constant Reminders <code>promptInjection</code>"). */
  title: React.ReactNode;
  description?: string;
  action?: React.ReactNode;
  /** Props for the ⓘ bubble — click opens a modal. Omit to hide the bubble. */
  info?: { title: string; description?: string; content: React.ReactNode };
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <div className="text-[13px] font-semibold text-xyne-fg-primary">{title}</div>
            {info && (
              <TabInfoBubble
                modalTitle={info.title}
                modalDescription={info.description}
                content={info.content}
              />
            )}
          </div>
          {description && (
            <p className="mt-0.5 text-[12px] text-xyne-fg-tertiary">{description}</p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </div>
  );
}

function NarrowConfigToolRow({
  kind,
  name,
  description,
  onRemove,
}: {
  kind: keyof typeof KIND_ICON;
  name: string;
  description?: string;
  onRemove: () => void;
}) {
  const Icon = KIND_ICON[kind];
  return (
    <div className="flex flex-col gap-0.5 border-b border-xyne-border-subtle px-3 py-2 last:border-b-0">
      <div className="flex items-center gap-2">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-xyne-surface-subtle text-xyne-fg-secondary">
          <Icon size={12} />
        </div>
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-xyne-fg-primary">
          {name}
        </span>
        <button
          onClick={onRemove}
          className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-xyne-fg-tertiary transition-colors hover:bg-xyne-surface-subtle hover:text-xyne-error-fg"
        >
          Remove
        </button>
      </div>
      <span className="pl-8 text-[10px] uppercase tracking-wide text-xyne-fg-tertiary">
        {KIND_LABEL[kind]}
      </span>
      {description && (
        <span className="pl-8 text-[11px] text-xyne-fg-tertiary">{description}</span>
      )}
    </div>
  );
}

function ToolGroup({
  icon: Icon,
  label,
  /** Inline technical tag rendered after a middot separator on the same
      line — matches the friendly+technical pattern used in Section titles
      (e.g. "Delegation • subagents"). Preserves traceability to backend
      naming without dominating the UI. */
  subLabel,
  selectedCount,
  totalCount,
  open,
  onToggle,
  children,
}: {
  icon: React.ElementType;
  label: string;
  subLabel?: string;
  selectedCount: number;
  totalCount: number;
  open: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-xyne-surface-subtle"
      >
        <Icon size={14} className="shrink-0 text-xyne-fg-tertiary" />
        <span className="min-w-0 flex-1 truncate text-[12px] leading-tight">
          <span className="font-medium text-xyne-fg-primary">{label}</span>
          {subLabel && (
            <>
              <span className="mx-1.5 text-xyne-fg-tertiary">•</span>
              <span className="font-normal text-xyne-fg-tertiary">{subLabel}</span>
            </>
          )}
        </span>
        <span className="shrink-0 text-[11px] text-xyne-fg-muted">
          {selectedCount}/{totalCount}
        </span>
        {open ? (
          <CaretDownIcon size={12} className="shrink-0 text-xyne-fg-tertiary" />
        ) : (
          <CaretRightIcon size={12} className="shrink-0 text-xyne-fg-tertiary" />
        )}
      </button>
      {open && children && (
        <div className="border-t border-xyne-border-subtle bg-xyne-surface-subtle">
          {children}
        </div>
      )}
    </div>
  );
}

/* ── tool selection helpers (IntegrationCard wiring) ───────────────────
   IntegrationCard emits opaque "keys": tool names for mcp/builtin kinds,
   tool slugs for custom kinds. The agent's AgentToolSelection has them
   split into `direct` (names) and `custom` (slugs). These helpers translate
   between the two and let the toolbox tab stay declarative. */

function selectedKeysForIntegration(
  kind: "mcp" | "builtin" | "custom",
  tools: AgentToolSelection,
): Set<string> {
  return new Set(kind === "custom" ? tools.custom : tools.direct);
}

function applyToggle(
  tools: AgentToolSelection,
  kind: "mcp" | "builtin" | "custom",
  key: string,
  next: boolean,
): AgentToolSelection {
  const field: "direct" | "custom" = kind === "custom" ? "custom" : "direct";
  const current = tools[field];
  const exists = current.includes(key);
  if (next && !exists) return { ...tools, [field]: [...current, key] };
  if (!next && exists) return { ...tools, [field]: current.filter((x) => x !== key) };
  return tools;
}

function applyBulkToggle(
  tools: AgentToolSelection,
  kind: "mcp" | "builtin" | "custom",
  keys: string[],
  next: boolean,
): AgentToolSelection {
  const field: "direct" | "custom" = kind === "custom" ? "custom" : "direct";
  const set = new Set(tools[field]);
  if (next) for (const k of keys) set.add(k);
  else for (const k of keys) set.delete(k);
  return { ...tools, [field]: Array.from(set) };
}

/* ── subagent picker ──────────────────────────────────────────────────
   Click-to-toggle pill grid. We render *all* available subagents — not
   just the selected ones — because subagents are the high-leverage choice
   in agent design and discoverability matters. With ~60 of them this still
   fits on one screen at the column width.

   Click behaviour:
   - Unselected pill → select + focus (opens skill panel below).
   - Selected + focused pill → deselect + clear focus (removes its triggers too).
   - Selected + unfocused pill → focus only (move configuration panel to it).

   Selected pills show a small count badge when skills are attached so the
   user can see at a glance which subagents have extra context wired in. */

type SkillTrigger = {
  toolName: string;
  skillSlug: string;
  when: "before" | "after";
  prompt: string;
};

function SubagentPicker({
  available,
  selected,
  focusedSubagent,
  skillTriggers,
  onToggle,
  onFocus,
  disabled,
}: {
  available: Array<{ name: string; description: string }>;
  selected: string[];
  focusedSubagent: string | null;
  skillTriggers: SkillTrigger[];
  onToggle: (name: string) => void;
  onFocus: (name: string | null) => void;
  disabled?: boolean;
}) {
  if (available.length === 0) {
    return (
      <div className="rounded-lg border border-xyne-border-subtle py-6 text-center text-[12px] text-xyne-fg-tertiary">
        No specialists available
      </div>
    );
  }
  const selSet = new Set(selected);

  const skillCountFor = (name: string) =>
    skillTriggers.filter((t) => {
      const base = t.toolName.includes(":") ? t.toolName.split(":")[0] : t.toolName;
      return base === name;
    }).length;

  const handleClick = (name: string) => {
    if (disabled) return;
    if (!selSet.has(name)) {
      // Unselected → select and focus
      onToggle(name);
      onFocus(name);
    } else if (focusedSubagent === name) {
      // Focused → deselect and clear focus
      onToggle(name);
      onFocus(null);
    } else {
      // Selected but unfocused → just focus
      onFocus(name);
    }
  };

  return (
    <div className="flex flex-wrap gap-1.5">
      {available.map((sa) => {
        const isSel = selSet.has(sa.name);
        const isFocused = focusedSubagent === sa.name;
        const skillCount = isSel ? skillCountFor(sa.name) : 0;
        return (
          <button
            key={sa.name}
            type="button"
            onClick={() => handleClick(sa.name)}
            disabled={disabled}
            title={sa.description}
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              isFocused
                ? "bg-xyne-brand text-xyne-fg-inverse ring-2 ring-xyne-brand ring-offset-1 ring-offset-xyne-surface"
                : isSel
                ? "bg-xyne-brand text-xyne-fg-inverse hover:bg-xyne-brand-hover"
                : "border border-xyne-border bg-xyne-surface text-xyne-fg-secondary hover:border-xyne-border-strong hover:text-xyne-fg-primary"
            }`}
          >
            {sa.name}
            {skillCount > 0 && (
              <span className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-white/25 px-1 text-[9px] font-semibold leading-none">
                {skillCount}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ── skill dropdown ────────────────────────────────────────────────────
   Replaces the native <select> for attaching skills. Renders a trigger
   button that opens a floating list on click; closes on outside click or
   after a selection. */

function SkillDropdown({
  skills,
  onSelect,
  disabled,
}: {
  skills: Skill[];
  onSelect: (slug: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  if (skills.length === 0) return null;

  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-dashed border-xyne-border bg-transparent px-3 py-2 text-[12px] font-medium text-xyne-fg-tertiary transition-colors hover:border-xyne-border-strong hover:bg-xyne-surface hover:text-xyne-fg-secondary disabled:cursor-not-allowed disabled:opacity-50"
      >
        <div className="flex items-center gap-1.5">
          <PlusIcon size={12} />
          <span>Add skill</span>
        </div>
        <CaretDownIcon
          size={11}
          className={`shrink-0 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <>
          {/* Transparent backdrop — closes dropdown on outside click */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-20 overflow-hidden rounded-xl border border-xyne-border bg-xyne-surface shadow-[0_8px_24px_rgba(0,0,0,0.10)]">
            <div className="py-1">
              {skills.map((skill) => (
                <button
                  key={skill.id}
                  type="button"
                  onClick={() => {
                    onSelect(skill.slug);
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-xyne-surface-subtle"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] font-medium text-xyne-fg-primary">
                      {skill.label || skill.name}
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] text-xyne-fg-tertiary">
                      {skill.slug}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ── compact trigger dropdown ─────────────────────────────────────────
   Reusable micro-select used in Contextual Response trigger cards.
   Follows the same floating-panel + backdrop pattern as SkillDropdown
   but is more compact and handles a generic { value, label }[] options
   list. An empty placeholder option clears the value. */

function TriggerDropdown({
  value,
  options,
  placeholder,
  onChange,
  disabled,
  className,
}: {
  value: string;
  options: { value: string; label: string }[];
  placeholder: string;
  onChange: (val: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    <div className={`relative ${className ?? ""}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center justify-between gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] text-left transition-colors focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${
          open
            ? "border-xyne-border-focus bg-xyne-surface text-xyne-fg-primary"
            : "border-xyne-border bg-xyne-surface text-xyne-fg-primary hover:border-xyne-border-strong"
        }`}
      >
        <span className={`truncate ${selected ? "text-xyne-fg-primary" : "text-xyne-fg-placeholder"}`}>
          {selected?.label ?? placeholder}
        </span>
        <CaretDownIcon
          size={10}
          className={`shrink-0 text-xyne-fg-muted transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-[calc(100%+4px)] z-20 min-w-full overflow-hidden rounded-xl border border-xyne-border bg-xyne-surface shadow-[0_8px_24px_rgba(0,0,0,0.10)]">
            <div className="max-h-[200px] overflow-y-auto py-1">
              {placeholder && (
                <button
                  type="button"
                  onClick={() => { onChange(""); setOpen(false); }}
                  className="flex w-full px-3 py-2 text-left text-[11px] text-xyne-fg-placeholder transition-colors hover:bg-xyne-surface-subtle"
                >
                  {placeholder}
                </button>
              )}
              {options.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => { onChange(opt.value); setOpen(false); }}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] transition-colors hover:bg-xyne-surface-subtle ${
                    opt.value === value ? "font-medium text-xyne-brand" : "text-xyne-fg-primary"
                  }`}
                >
                  <span className="w-[10px] shrink-0">
                    {opt.value === value && <CheckIcon size={10} weight="bold" />}
                  </span>
                  <span className="truncate">{opt.label}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ── subagent skill panel ──────────────────────────────────────────────
   Appears below the pill grid when a subagent is focused. Mirrors V1's
   "No skills. Add to propagate into this subagent." UX. Skills are stored
   as skillTriggers with toolName = subagentName (no inner-tool qualifier),
   meaning the skill is injected whenever that subagent runs any tool. */

function SubagentSkillPanel({
  subagentName,
  availableSkills,
  skillTriggers,
  onSkillTriggersChange,
  disabled,
}: {
  subagentName: string;
  availableSkills: Skill[];
  skillTriggers: SkillTrigger[];
  onSkillTriggersChange: Dispatch<SetStateAction<SkillTrigger[]>>;
  disabled?: boolean;
}) {
  // Only triggers whose toolName is exactly the subagent name (no inner tool).
  const attached = skillTriggers.filter((t) => t.toolName === subagentName);

  const handleAdd = (skillSlug: string) => {
    if (!skillSlug || attached.some((t) => t.skillSlug === skillSlug)) return;
    onSkillTriggersChange((prev) => [
      ...prev,
      { toolName: subagentName, skillSlug, when: "after" as const, prompt: "" },
    ]);
  };

  const handleRemove = (skillSlug: string) => {
    onSkillTriggersChange((prev) =>
      prev.filter((t) => !(t.toolName === subagentName && t.skillSlug === skillSlug)),
    );
  };

  const unattached = availableSkills.filter(
    (s) => !attached.some((t) => t.skillSlug === s.slug),
  );

  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-xyne-brand/30 bg-xyne-brand/5 px-3 py-2.5">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-semibold text-xyne-fg-primary">
          {subagentName}
        </span>
        <span className="text-[11px] text-xyne-fg-tertiary">
          {attached.length === 0
            ? "no skills attached"
            : `${attached.length} skill${attached.length === 1 ? "" : "s"} attached`}
        </span>
      </div>

      {attached.length === 0 && (
        <p className="text-[11px] text-xyne-fg-tertiary">
          No skills. Add one to propagate into this subagent.
        </p>
      )}

      {/* Attached skill chips */}
      {attached.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {attached.map((t) => {
            const skill = availableSkills.find((s) => s.slug === t.skillSlug);
            return (
              <span
                key={t.skillSlug}
                className="inline-flex items-center gap-1 rounded-full border border-xyne-brand/25 bg-xyne-brand/10 px-2.5 py-0.5 text-[11px] font-medium text-xyne-fg-primary"
              >
                {skill?.label || skill?.name || t.skillSlug}
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => handleRemove(t.skillSlug)}
                    className="ml-0.5 rounded-full text-xyne-fg-tertiary transition-colors hover:text-xyne-error-fg"
                    aria-label={`Remove ${t.skillSlug}`}
                  >
                    <XIcon size={10} />
                  </button>
                )}
              </span>
            );
          })}
        </div>
      )}

      {/* Add skill dropdown */}
      {!disabled && availableSkills.length === 0 && (
        <p className="text-[11px] italic text-xyne-fg-tertiary">
          No skills available — create one in the Knowledge tab first.
        </p>
      )}
      {!disabled && availableSkills.length > 0 && unattached.length === 0 && (
        <p className="text-[11px] text-xyne-fg-tertiary">
          All available skills are already attached.
        </p>
      )}
      {!disabled && unattached.length > 0 && (
        <SkillDropdown skills={unattached} onSelect={handleAdd} />
      )}
    </div>
  );
}

/* ── specialist category mapping ────────────────────────────────────────
   Frontend-side grouping until the backend adds a `category` field to
   the subagent manifest. Unknown names fall into "Other" and always
   appear — no specialist is silently dropped. Extend this map when new
   specialists are added to the platform. */

const SPECIALIST_CATEGORY_MAP: Record<string, string> = {
  "context7":          "Docs & Research",
  "deepwiki":          "Docs & Research",
  "research-agent":    "Docs & Research",
  "perplexity":        "Docs & Research",
  "github":            "Engineering",
  "bitbucket":         "Engineering",
  "sandbox":           "Engineering",
  "grafana":           "Engineering",
  "kibana":            "Engineering",
  "victoria-metrics":  "Engineering",
  "linear":            "Engineering",
  "spaces":            "Productivity",
  "jira":              "Productivity",
  "slack":             "Productivity",
  "user-tickets":      "Productivity",
  "google-calendar":   "Productivity",
  "notion":            "Productivity",
  "figma":             "Design",
  "excalidraw":        "Design",
  "hubspot":           "Sales & CRM",
  "salesforce":        "Sales & CRM",
  "zoho":              "Sales & CRM",
};

function getCategoryFor(name: string): string {
  return SPECIALIST_CATEGORY_MAP[name] ?? "Other";
}

// Deterministic avatar colours derived from the specialist's name so the
// colour is stable across renders and doesn't flash on update.
const AVATAR_COLORS = [
  "bg-[#3b82f6]", // blue-500
  "bg-[#8b5cf6]", // violet-500
  "bg-[#10b981]", // emerald-500
  "bg-[#f59e0b]", // amber-500
  "bg-[#ef4444]", // red-500
  "bg-[#ec4899]", // pink-500
  "bg-[#6366f1]", // indigo-500
  "bg-[#14b8a6]", // teal-500
  "bg-[#06b6d4]", // cyan-500
  "bg-[#f97316]", // orange-500
];

function specialistInitials(name: string): string {
  // Strip hyphens/underscores and take the first two letters uppercased.
  // e.g. "context7" → "CO", "research-agent" → "RE".
  return name.replace(/[-_]/g, "").slice(0, 2).toUpperCase();
}

function specialistAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) & 0xffff;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length] ?? "bg-[#3b82f6]";
}

/* ── SpecialistsPanelSkeleton ─────────────────────────────────────────
   Loading shimmer that mirrors the two-panel shape. */

function SpecialistsPanelSkeleton() {
  const leftWidths = [52, 64, 48, 72, 56, 80, 48, 60, 52];
  return (
    <div className="flex min-h-[400px] overflow-hidden rounded-xl border border-xyne-border">
      {/* Left column */}
      <div className="flex w-[192px] shrink-0 flex-col gap-1 border-r border-xyne-border-subtle p-2">
        <Shimmer className="mb-2 h-7 w-full rounded-md" />
        {leftWidths.map((w, i) => (
          <div key={i} className="flex items-center gap-2 px-1 py-1">
            <div className="h-[7px] w-[7px] shrink-0 animate-pulse rounded-full bg-xyne-surface-subtle" />
            <div
              className="h-2.5 animate-pulse rounded bg-xyne-surface-subtle"
              style={{ width: w }}
            />
          </div>
        ))}
      </div>
      {/* Right column */}
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start gap-3">
          <Shimmer className="h-10 w-10 shrink-0 rounded-lg" />
          <div className="flex flex-1 flex-col gap-2">
            <Shimmer className="h-4 w-28" />
            <Shimmer className="h-3 w-20" />
          </div>
        </div>
        <Shimmer className="h-3 w-full" />
        <Shimmer className="h-3 w-4/5" />
      </div>
    </div>
  );
}

/* ── SpecialistsPanel ──────────────────────────────────────────────────
   Two-mode layout with a smooth cross-fade transition:

   "grid" mode (default) — compact pill grid, identical to the previous
     SubagentPicker UX. Clicking any pill slides into "detail" mode.

   "detail" mode — fixed-height two-column panel:
     Left  : search + flat scrollable list (no category dividers).
     Right : avatar, name, enable/remove button, description, attached
             skills + SkillDropdown, footer hint.
   A "← View all" link returns to the grid. */

function SpecialistsPanel({
  available,
  selected,
  skillTriggers,
  availableSkills,
  onToggle,
  onSkillTriggersChange,
  disabled,
}: {
  available: Array<{ name: string; description: string }>;
  selected: string[];
  skillTriggers: SkillTrigger[];
  availableSkills: Skill[];
  /** Called with (name, true) to enable, (name, false) to disable. */
  onToggle: (name: string, next: boolean) => void;
  onSkillTriggersChange: Dispatch<SetStateAction<SkillTrigger[]>>;
  disabled?: boolean;
}) {
  const [viewMode, setViewMode] = useState<"grid" | "detail">("grid");
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const selSet = new Set(selected);

  // Filter by search — used in the detail panel's left column.
  const filtered = useMemo(() => {
    if (!search.trim()) return available;
    const q = search.toLowerCase();
    return available.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q),
    );
  }, [available, search]);

  const skillCountFor = (name: string) =>
    skillTriggers.filter((t) => t.toolName === name).length;

  const detail = selectedName
    ? (available.find((s) => s.name === selectedName) ?? null)
    : null;
  const isEnabled = selectedName ? selSet.has(selectedName) : false;

  const attachedTriggers = selectedName
    ? skillTriggers.filter((t) => t.toolName === selectedName)
    : [];

  // Open the detail panel for a specific specialist.
  const openDetail = (name: string) => {
    setSelectedName(name);
    setViewMode("detail");
  };

  // Return to the pill grid.
  const backToGrid = () => {
    setViewMode("grid");
    setSearch("");
    // Keep selectedName briefly so the outgoing animation still shows content.
    setTimeout(() => setSelectedName(null), 200);
  };

  const handleToggleEnable = () => {
    if (!selectedName || disabled) return;
    const enabling = !isEnabled;
    onToggle(selectedName, enabling);
    if (!enabling) {
      onSkillTriggersChange((prev) =>
        prev.filter((t) => {
          const base = t.toolName.includes(":") ? t.toolName.split(":")[0] : t.toolName;
          return base !== selectedName;
        }),
      );
    }
  };

  const handleAddSkill = (skillSlug: string) => {
    if (!selectedName || !skillSlug) return;
    if (attachedTriggers.some((t) => t.skillSlug === skillSlug)) return;
    onSkillTriggersChange((prev) => [
      ...prev,
      { toolName: selectedName, skillSlug, when: "after" as const, prompt: "" },
    ]);
  };

  const handleRemoveSkill = (skillSlug: string) => {
    if (!selectedName) return;
    onSkillTriggersChange((prev) =>
      prev.filter((t) => !(t.toolName === selectedName && t.skillSlug === skillSlug)),
    );
  };

  const unattachedSkills = availableSkills.filter(
    (s) => !attachedTriggers.some((t) => t.skillSlug === s.slug),
  );

  return (
    // Relative container — both views are always mounted so CSS transitions
    // play on both enter and exit. The inactive view is position:absolute so
    // it doesn't affect the container's scroll height.
    <div className="relative">

      {/* ── GRID VIEW (default) ────────────────────────────────────── */}
      <div
        className={`transition-all duration-200 ease-in-out ${
          viewMode === "grid"
            ? "relative opacity-100 translate-x-0"
            : "pointer-events-none absolute inset-0 opacity-0 -translate-x-3"
        }`}
      >
        {available.length === 0 ? (
          <div className="rounded-lg border border-xyne-border-subtle py-6 text-center text-[12px] text-xyne-fg-tertiary">
            No specialists available
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {available.map((sp) => {
              const isSel = selSet.has(sp.name);
              const skillCount = isSel ? skillCountFor(sp.name) : 0;
              return (
                <button
                  key={sp.name}
                  type="button"
                  title={sp.description}
                  onClick={() => openDetail(sp.name)}
                  disabled={disabled && !isSel}
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                    isSel
                      ? "bg-xyne-brand text-xyne-fg-inverse hover:bg-xyne-brand-hover"
                      : "border border-xyne-border bg-xyne-surface text-xyne-fg-secondary hover:border-xyne-border-strong hover:text-xyne-fg-primary"
                  }`}
                >
                  {sp.name}
                  {skillCount > 0 && (
                    <span className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-white/25 px-1 text-[9px] font-semibold leading-none">
                      {skillCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── DETAIL VIEW ────────────────────────────────────────────── */}
      <div
        className={`transition-all duration-200 ease-in-out ${
          viewMode === "detail"
            ? "relative opacity-100 translate-x-0"
            : "pointer-events-none absolute inset-0 opacity-0 translate-x-3"
        }`}
      >
        {/* "View all" back-link row */}
        <div className="mb-2">
          <button
            type="button"
            onClick={backToGrid}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-xyne-fg-tertiary transition-colors hover:text-xyne-fg-primary"
          >
            ← View all
          </button>
        </div>

        {/* Fixed-height two-column panel */}
        <div className="flex h-[380px] overflow-hidden rounded-xl border border-xyne-border bg-xyne-surface">

          {/* Left: flat scrollable list */}
          <div className="flex w-[180px] shrink-0 flex-col border-r border-xyne-border-subtle">
            {/* Search */}
            <div className="border-b border-xyne-border-subtle p-2">
              <div className="relative">
                <MagnifyingGlassIcon
                  size={12}
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xyne-fg-tertiary"
                />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search"
                  className="w-full rounded-md border border-xyne-border bg-xyne-surface-sunken py-1.5 pl-7 pr-2 text-[11px] text-xyne-fg-primary placeholder:text-xyne-fg-tertiary focus:border-xyne-border-focus focus:outline-none"
                />
              </div>
            </div>
            {/* Flat list — no category dividers */}
            <div className="flex-1 overflow-y-auto py-1">
              {filtered.length === 0 ? (
                <div className="px-3 py-4 text-center text-[11px] text-xyne-fg-tertiary">
                  No results
                </div>
              ) : (
                filtered.map((sp) => {
                  const isSel = selSet.has(sp.name);
                  const isFocused = selectedName === sp.name;
                  const skillCount = skillCountFor(sp.name);
                  return (
                    <button
                      key={sp.name}
                      type="button"
                      onClick={() => setSelectedName(sp.name)}
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors ${
                        isFocused ? "bg-xyne-surface-subtle" : "hover:bg-xyne-surface-subtle/60"
                      }`}
                    >
                      <span
                        className={`h-[7px] w-[7px] shrink-0 rounded-full transition-colors ${
                          isSel ? "bg-[#22c55e]" : "bg-xyne-border-strong"
                        }`}
                      />
                      <span
                        className={`min-w-0 flex-1 truncate text-[12px] transition-colors ${
                          isFocused
                            ? "font-semibold text-xyne-fg-primary"
                            : isSel
                            ? "text-xyne-fg-primary"
                            : "text-xyne-fg-secondary"
                        }`}
                      >
                        {sp.name}
                      </span>
                      {skillCount > 0 && (
                        <span className="shrink-0 rounded-full bg-xyne-brand/15 px-1.5 py-0.5 text-[9px] font-semibold leading-none text-xyne-brand">
                          {skillCount}
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Right: specialist detail */}
          <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
            {!detail ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
                <RobotIcon size={28} className="text-xyne-fg-muted" weight="light" />
                <p className="text-[12px] text-xyne-fg-tertiary">
                  Select a specialist to configure it
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-4 p-4">
                {/* Header: avatar + name + subtitle + enable/remove button */}
                <div className="flex items-start gap-3">
                  <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[13px] font-bold text-white ${specialistAvatarColor(detail.name)}`}
                  >
                    {specialistInitials(detail.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-bold text-xyne-fg-primary">
                      {detail.name}
                    </div>
                    <div className="text-[11px] text-xyne-fg-tertiary">
                      {getCategoryFor(detail.name)} · specialist
                    </div>
                  </div>
                  {!disabled && (
                    <button
                      type="button"
                      onClick={handleToggleEnable}
                      className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold transition-colors ${
                        isEnabled
                          ? "bg-[#dcfce7] text-[#16a34a] hover:bg-[#fee2e2] hover:text-[#dc2626]"
                          : "bg-xyne-brand text-xyne-fg-inverse hover:bg-xyne-brand-hover"
                      }`}
                    >
                      {isEnabled ? (
                        <><CheckIcon size={11} weight="bold" /> Enabled</>
                      ) : (
                        <><PlusIcon size={11} /> Enable</>
                      )}
                    </button>
                  )}
                </div>

                {/* Description */}
                {detail.description && (
                  <p className="text-[12px] leading-relaxed text-xyne-fg-secondary">
                    {detail.description}
                  </p>
                )}

                {/* ── Attached Skills — inset card showing current state ── */}
                <div className="rounded-lg border border-xyne-border-subtle bg-xyne-surface-subtle p-2.5">
                  <div className="mb-2 flex items-center gap-1">
                    <span className="text-[9px] font-semibold uppercase tracking-widest text-xyne-fg-muted">
                      ✦ Attached Skills
                    </span>
                    {attachedTriggers.length > 0 && (
                      <span className="rounded-full bg-xyne-brand/15 px-1.5 py-0.5 text-[9px] font-semibold leading-none text-xyne-brand">
                        {attachedTriggers.length}
                      </span>
                    )}
                  </div>
                  {attachedTriggers.length === 0 ? (
                    <p className="text-[11px] italic text-xyne-fg-tertiary">No skills yet…</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {attachedTriggers.map((t) => {
                        const skill = availableSkills.find((s) => s.slug === t.skillSlug);
                        return (
                          <span
                            key={t.skillSlug}
                            className="inline-flex items-center gap-1 rounded-full border border-xyne-brand/25 bg-xyne-brand/10 px-2.5 py-0.5 text-[11px] font-medium text-xyne-fg-primary"
                          >
                            {skill?.label || skill?.name || t.skillSlug}
                            {!disabled && (
                              <button
                                type="button"
                                onClick={() => handleRemoveSkill(t.skillSlug)}
                                className="ml-0.5 rounded-full text-xyne-fg-tertiary transition-colors hover:text-xyne-error-fg"
                                aria-label={`Remove ${t.skillSlug}`}
                              >
                                <XIcon size={10} />
                              </button>
                            )}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* ── Add Skill — action area below the card ── */}
                {!disabled && (
                  <div>
                    {availableSkills.length === 0 ? (
                      <p className="text-[11px] italic text-xyne-fg-tertiary">
                        No skills available — create one in the Knowledge tab first.
                      </p>
                    ) : unattachedSkills.length === 0 ? (
                      <p className="text-[11px] text-xyne-fg-tertiary">
                        All available skills are already attached.
                      </p>
                    ) : (
                      <SkillDropdown skills={unattachedSkills} onSelect={handleAddSkill} />
                    )}
                  </div>
                )}

                {/* Footer hint */}
                <div className="mt-auto flex items-start gap-1.5 border-t border-xyne-border-subtle pt-3 text-[11px] text-xyne-fg-tertiary">
                  <ArrowDownIcon size={11} className="mt-0.5 shrink-0" />
                  <span>Skills you attach here travel with this specialist every time it's invoked.</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── props ─────────────────────────────────────────────────────────── */

interface Props {
  agent: Agent;
  permissions: AgentPermissions;

  // Identity (name + description editable; slug is immutable — see notes
  // in AgentDetailPageV3 for the scope decision).
  draftName: string;
  onDraftNameChange: (v: string) => void;
  draftDescription: string;
  onDraftDescriptionChange: (v: string) => void;

  // Model
  draftProvider: AgentProvider;
  onDraftProviderChange: (p: AgentProvider) => void;
  draftModel: string | null;
  onDraftModelChange: (m: string | null) => void;
  availableModels: ClaudeModelInfo[];
  /** User's configured provider credentials. Spaces is always available
      (the platform default); other providers are only selectable when the
      user has set up creds — otherwise the menu entry is disabled with a
      "Not configured" hint. */
  providerCredentials: ProviderCredential[];

  // Instructions
  prompt: string;
  onPromptChange: (v: string) => void;

  // Tools
  draftTools: AgentToolSelection;
  onDraftToolsChange: Dispatch<SetStateAction<AgentToolSelection>>;
  availableTools: AvailableTools | null;

  // Skills
  draftSkillIds: string[];
  onToggleSkill: (id: string) => void;
  availableSkills: Skill[];

  // Triggers
  skillTriggers: Array<{
    toolName: string;
    skillSlug: string;
    when: "before" | "after";
    prompt: string;
  }>;
  onSkillTriggersChange: Dispatch<SetStateAction<Array<{
    toolName: string;
    skillSlug: string;
    when: "before" | "after";
    prompt: string;
  }>>>;

  // Behavior — Constant Reminders. Lives on agent.config.promptInjection
  // and gets appended as a [System Reminder] user message each turn.
  draftPromptInjection: string;
  onDraftPromptInjectionChange: (v: string) => void;

  // Dialog callbacks
  onOpenToolPicker: () => void;
  onOpenSkillPicker: () => void;
  /** Opens the RenameHandleDialog. Only shown to the owner — admins use
      their own moderation path; contributors can't rename. */
  onRequestRenameHandle: () => void;
}

/* ── main component ────────────────────────────────────────────────── */

export function AgentDetailLeftColumn({
  agent,
  permissions,
  draftName,
  onDraftNameChange,
  draftDescription,
  onDraftDescriptionChange,
  draftProvider,
  onDraftProviderChange,
  draftModel,
  onDraftModelChange,
  availableModels,
  providerCredentials,
  prompt,
  onPromptChange,
  draftTools,
  onDraftToolsChange,
  availableTools,
  draftSkillIds,
  onToggleSkill,
  availableSkills,
  skillTriggers,
  onSkillTriggersChange,
  draftPromptInjection,
  onDraftPromptInjectionChange,
  onOpenToolPicker,
  onOpenSkillPicker,
  onRequestRenameHandle,
}: Props) {
  const { show: showSnackbar } = useSnackbar();
  const [briefInput, setBriefInput] = useState("");
  const [toolGroupOpen, setToolGroupOpen] = useState<Record<string, boolean>>({
    subagents: false,
    direct: false,
    custom: false,
    system: false,
  });
  const [activeTab, setActiveTab] = useState<ConfigTabKey>("persona");
  const [toolSearch, setToolSearch] = useState("");
  const [toolTab, setToolTab] = useState<ToolTabKey>("subagents");
  const [infoSection, setInfoSection] = useState<ToolTabKey | null>(null);


  // Description textarea uses a fixed initial size (rows={3}) + manual
  // resize-y, matching the labeled-form design. No auto-grow ref needed.

  /** Currently-focused subagent in the Toolbox → Specialists tab; opens
   *  the inline SubagentSkillPanel beneath the picker so the operator
   *  can wire triggers without leaving the tab. */
  const [focusedSubagent, setFocusedSubagent] = useState<string | null>(null);

  const totalTools = draftTools.subagents.length + draftTools.direct.length + draftTools.custom.length;
  const totalSubagents = availableTools?.subagents.length ?? 0;
  const totalWriteTools = availableTools?.writeTools.length ?? 0;
  const totalMcpTools = availableTools?.customGroups.flatMap((g) => g.tools).length ?? 0;
  /** Subagents filtered by the toolSearch box. Empty string → all. Used
   *  by the Specialists picker AND by the search-input placeholder to
   *  show a "Search N of M" count when a filter is active. */
  const filteredSubagents = useMemo(() => {
    const all = availableTools?.subagents ?? [];
    const q = toolSearch.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.description ?? "").toLowerCase().includes(q),
    );
  }, [availableTools, toolSearch]);

  // Toolbox summary — total enabled tools including subagents.
  // The total is what the user cares about ("how capable is this agent?").
  const toolboxSummary = useMemo(() => {
    if (!availableTools) return { totalEnabled: 0, totalAvailable: 0 };
    let enabledIntegrationTools = 0;
    let totalIntegrationTools = 0;
    for (const intg of availableTools.integrations) {
      const selSet = new Set<string>(intg.kind === "custom" ? draftTools.custom : draftTools.direct);
      for (const t of intg.readTools) {
        totalIntegrationTools++;
        if (selSet.has(intg.kind === "custom" ? t.slug : t.name)) enabledIntegrationTools++;
      }
      for (const t of intg.writeTools) {
        totalIntegrationTools++;
        const k = intg.kind === "custom" ? t.slug : t.name;
        if (selSet.has(k)) enabledIntegrationTools++;
      }
    }
    const totalEnabled = draftTools.subagents.length + enabledIntegrationTools;
    const totalAvailable = availableTools.subagents.length + totalIntegrationTools;
    return { totalEnabled, totalAvailable };
  }, [availableTools, draftTools]);

  // Filtered lists for search — narrows integration cards (Specialists tab has its own search).
  const filteredIntegrations = useMemo(() => {
    const intgs = availableTools?.integrations ?? [];
    if (!toolSearch.trim()) return intgs;
    const q = toolSearch.toLowerCase();
    return intgs.filter((intg) => {
      if (intg.label.toLowerCase().includes(q)) return true;
      return [...intg.readTools, ...intg.writeTools].some(
        (t) => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q),
      );
    });
  }, [availableTools, toolSearch]);

  const canEdit = permissions.canEdit;

  // Tab labels carry counts when non-zero so users see at a glance which
  // surfaces have configured items vs. which are still empty.
  // Skill triggers live under Knowledge alongside Skills (they're both
  // "what reference material can flow into the conversation"), so they
  // contribute to the Knowledge count, not Behavior.
  const hasReminder = draftPromptInjection.trim().length > 0;
  const knowledgeCount = draftSkillIds.length + skillTriggers.length;
  const behaviorCount = hasReminder ? 1 : 0;
  const tabItems: TabItem<ConfigTabKey>[] = [
    { id: "persona", label: "Persona" },
    {
      id: "knowledge",
      label: knowledgeCount > 0 ? `Knowledge (${knowledgeCount})` : "Knowledge",
    },
    {
      id: "toolbox",
      label: totalTools > 0 ? `Toolbox (${totalTools})` : "Toolbox",
    },
    // Behavior now holds only per-turn Reminders (promptInjection).
    // Hidden for non-editors since it's read-only and already implicit
    // in the running prompt — nothing to do here as a viewer.
    ...(canEdit
      ? [
          {
            id: "behavior" as const,
            label: behaviorCount > 0 ? `Behavior (${behaviorCount})` : "Behavior",
          },
        ]
      : []),
  ];

  const toggleToolGroup = (group: string) => {
    setToolGroupOpen((prev) => ({ ...prev, [group]: !prev[group] }));
  };

  return (
    // Surface roles in this column (intentional inversion):
    //   • Outer container: bg-xyne-surface (white) — sits on the shell's
    //     subtle-gray background, so the form clearly reads as its own
    //     surface instead of bleeding into the sidebar.
    //   • Cards/inputs inside: bg-xyne-surface-subtle (gray) — the inset
    //     look the design tokens were designed for, and gives each control
    //     visual presence against the white container.
    //   • Interactive buttons within cards: bg-xyne-surface (white) — pop
    //     back up to the container's surface so they're tappable-looking.
    <div className="flex w-[60%] shrink-0 flex-col overflow-hidden border-l border-r border-xyne-border bg-xyne-surface">
      {/* Always-visible top: identity + provider/model + git url. These
          aren't tabbed because they're either short or define the agent's
          basic identity (you want to see them regardless of which detail
          tab is open). */}
      <div className="flex flex-col gap-2 border-b border-xyne-border-subtle px-5 py-3">
      {/* View-only banner for non-editors */}
      {!canEdit && (
        <div className="rounded-lg border border-xyne-info-border bg-xyne-info-bg px-3 py-1.5 text-[11px] text-xyne-info-fg">
          View-only access
        </div>
      )}

      {/* Identity — compressed to a single row of 3 inset-labeled fields.
            (Was: 3 stacked sections w/ caption rows + helper paragraph.)
            Each field is a self-contained box with the field name as a
            tiny caption above the value, and a single focus-within ring
            so the editor reads as a clean tri-column form. Drops ~150px
            of vertical chrome so the tab content below gets the room. */}
      <div className="grid grid-cols-12 gap-3 items-stretch">
        {/* Name — col-span-4. Uses `surface-sunken` (not `surface-subtle`)
              because in dark mode `surface-subtle = #0a0a0a` is *darker*
              than `surface = #171717` — that made the fields look like
              black voids punched out of the page. `surface-sunken` is
              the token semantically meant for inputs (~#f3f4f6 light,
              #262626 dark), and reads as inset in both modes. */}
        <label
          className={`col-span-4 min-w-0 flex flex-col rounded-lg border border-xyne-border bg-xyne-surface-sunken px-3 pt-1.5 pb-2 transition-colors ${
            canEdit
              ? "hover:border-xyne-border-strong focus-within:border-xyne-border-focus"
              : ""
          }`}
        >
          <span className="text-[10px] font-semibold uppercase tracking-[0.07em] text-xyne-fg-tertiary">
            Name
          </span>
          <input
            type="text"
            value={draftName}
            onChange={(e) => onDraftNameChange(e.target.value)}
            readOnly={!canEdit}
            aria-label="Agent name"
            placeholder="Untitled agent"
            className={`w-full bg-transparent border-0 outline-none px-0 py-0 text-[14px] font-medium text-xyne-fg-primary placeholder:text-xyne-fg-muted ${
              canEdit ? "" : "cursor-default"
            }`}
          />
        </label>

        {/* Handle — col-span-3. Readonly handle inside; Rename / Locked
              affordance collapsed into a tiny icon in the caption row
              (full text was redundant chrome). The "permanent reference"
              helper line is now folded into the tooltip on these icons. */}
        <div
          data-id="url-slug-display"
          className="col-span-3 min-w-0 flex flex-col rounded-lg border border-xyne-border bg-xyne-surface-sunken px-3 pt-1.5 pb-2"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.07em] text-xyne-fg-tertiary">
              Handle
            </span>
            {permissions.role === "owner" ? (
              <button
                type="button"
                onClick={onRequestRenameHandle}
                className="inline-flex items-center justify-center w-[18px] h-[18px] rounded text-xyne-fg-tertiary hover:bg-xyne-surface hover:text-xyne-fg-primary transition-colors"
                title="Rename. The handle is a permanent reference — existing links will break."
                aria-label="Rename handle"
              >
                <PencilSimpleIcon size={11} weight="fill" />
              </button>
            ) : (
              <span
                data-id="url-slug-lock-badge"
                className="inline-flex items-center justify-center w-[18px] h-[18px] text-xyne-fg-tertiary"
                title="Permanent reference — only the owner can rename it."
                aria-label="Locked"
              >
                <LockSimpleIcon size={11} weight="fill" />
              </span>
            )}
          </div>
          <span
            data-id="url-slug-locked"
            className="font-mono text-[14px] font-medium text-xyne-fg-secondary select-text truncate"
            title="The agent's permanent handle — can't be renamed."
          >
            {agent.slug}
          </span>
        </div>

        {/* Description — col-span-5. Single-line input (was textarea); if
              users need multi-line they can keep typing and the field
              scrolls horizontally. Kept compact so the row reads as one
              clean band of inputs.
              Note: dropped the focus-ring shadow on the wrapper. The ring
              token is a 3px halo designed for stand-alone <input>s; on a
              container that already has its own border + bg-change on
              focus, the halo stacked into a chunky "double-border" look.
              Border + bg flip alone is enough focus signal here. */}
        <label
          className={`col-span-5 min-w-0 flex flex-col rounded-lg border border-xyne-border bg-xyne-surface-sunken px-3 pt-1.5 pb-2 transition-colors ${
            canEdit
              ? "hover:border-xyne-border-strong focus-within:border-xyne-border-focus"
              : ""
          }`}
        >
          <span className="text-[10px] font-semibold uppercase tracking-[0.07em] text-xyne-fg-tertiary">
            Description
          </span>
          <input
            type="text"
            value={draftDescription}
            onChange={(e) => onDraftDescriptionChange(e.target.value)}
            readOnly={!canEdit}
            aria-label="Agent description"
            placeholder="What does this agent do?"
            className={`w-full bg-transparent border-0 outline-none px-0 py-0 text-[14px] font-medium text-xyne-fg-primary placeholder:text-xyne-fg-muted ${
              canEdit ? "" : "cursor-default"
            }`}
          />
        </label>
      </div>
      </div>

      {/* Tab strip — centered horizontally to anchor the configuration
          area visually. The Tabs primitive owns the underline indicator
          + keyboard nav. */}
      <div className="shrink-0 flex justify-center px-4 pt-2">
        <Tabs items={tabItems} selected={activeTab} onSelect={setActiveTab} />
      </div>

      {/* Tab content — outer fills height (no scroll), inner is a
          centered max-width column. Persona's textarea grows to fill
          the remaining vertical space (flex-1 chain below), so the
          field "touches the bottom" of the visible area. Other tabs
          fall back to natural height inside the centered column. */}
      <div className="flex flex-1 flex-col overflow-hidden">
      <div className="mx-auto flex w-full max-w-[720px] flex-1 flex-col gap-6 overflow-y-auto p-4 min-h-0">
      {/* Placeholder so the indentation/markup below stays intact when the
          structural Section blocks are reorganized into tabs. */}
      <div className="hidden" />

      {/* Persona — the long-form "who this agent is" expression. The
            short identity (name / description) lives in the always-visible
            strip above; this tab holds the full system prompt + AI rewrite
            affordance for shaping voice, persona, and constraints.

            Bypasses the `Section` helper because we need the textarea
            to flex-grow into the column's remaining height ("touches
            the bottom"). Section's outer div has a fixed `flex-col`
            sizing that can't propagate flex-1 to a deep child. */}
      {activeTab === "persona" && (
      <div className="flex flex-1 flex-col gap-2.5 min-h-0">

        {/* Header row: "Persona • system prompt" + info bubble */}
        <div className="flex items-center gap-2">
          <span className="inline-flex items-baseline gap-2 min-w-0">
            <span className="text-[14px] font-semibold text-xyne-fg-primary">Persona</span>
            <span className="text-xyne-fg-tertiary">•</span>
            <span className="text-[13px] font-normal text-xyne-fg-tertiary">system prompt</span>
          </span>
          <TabInfoBubble
            modalTitle="Persona"
            modalDescription="The system prompt that shapes this agent's voice, role, and constraints"
            content={
              <div className="flex flex-col gap-4">
                <div>
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-tertiary">What it is</div>
                  <p className="text-[13px] leading-relaxed text-xyne-fg-secondary">The persona is sent to the model as a system-level instruction before any user message. It defines the agent's role, personality, tone, and constraints for every conversation.</p>
                </div>
                <div>
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-tertiary">When to update it</div>
                  <p className="text-[13px] leading-relaxed text-xyne-fg-secondary">Use the persona to give the agent an identity ("You are Kiwi, a travel assistant…"), restrict its scope ("Only answer billing questions"), or enforce a consistent output style.</p>
                </div>
                <div>
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-tertiary">Technical note</div>
                  <p className="text-[13px] leading-relaxed text-xyne-fg-secondary">The <code className="rounded bg-xyne-surface-sunken px-1 font-mono text-[11px] text-xyne-fg-primary">assistant</code> built-in agent overrides this field with a hardcoded internal prompt. For all other agents, this is the primary behavioral definition.</p>
                </div>
              </div>
            }
          />
        </div>

        {/* One-line subtitle */}
        <p className="-mt-1 text-[12px] text-xyne-fg-tertiary">
          The voice and constraints that shape every reply.
        </p>

        {/* Update with AI — single compact row */}
        {canEdit && (
          <div className="flex items-center gap-2.5 rounded-lg border border-[#c4b5fd]/70 bg-[#faf5ff] px-3 py-2">
            <MagicWandIcon size={13} weight="fill" className="shrink-0 text-[#7c3aed]" />
            <input
              type="text"
              value={briefInput}
              onChange={(e) => setBriefInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && briefInput.trim()) {
                  showSnackbar({ variant: "info", title: "AI update not yet wired" });
                  setBriefInput("");
                }
              }}
              placeholder="Describe what to change in the persona…"
              className="min-w-0 flex-1 bg-transparent text-[12px] text-xyne-fg-primary placeholder:text-[#a78bfa]/80 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => {
                if (briefInput.trim()) {
                  showSnackbar({ variant: "info", title: "AI update not yet wired" });
                  setBriefInput("");
                }
              }}
              disabled={!briefInput.trim()}
              className="shrink-0 rounded-md bg-[#7c3aed] px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-[#6d28d9] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Update with AI
            </button>
          </div>
        )}
        {/* flex-1 + min-h-0 lets this textarea consume the rest of the
              vertical space. `resize-none` because manual resize would
              fight the flex-grow behavior. */}
        <textarea
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          placeholder="You are an agent that…"
          readOnly={!canEdit}
          className="flex-1 min-h-[120px] w-full resize-none rounded-lg border border-xyne-border bg-xyne-surface-sunken px-3 py-2 font-mono text-[12px] leading-relaxed text-xyne-fg-primary placeholder:text-xyne-fg-placeholder focus:border-xyne-border-focus focus:outline-none disabled:opacity-60"
        />
        <span className="shrink-0 text-[11px] text-xyne-fg-tertiary">
          {prompt.length.toLocaleString()} character{prompt.length === 1 ? "" : "s"}
        </span>
      </div>
      )}

      {/* Toolbox — what the agent can actually do.
          Layout: summary bar + search + four tabs (Subagents / MCP Tools /
          Custom / System). "Advanced" icon button in the header opens the
          raw tool picker for power users. */}
      {activeTab === "toolbox" && (
      <Section
        title={
          <span className="inline-flex items-baseline gap-2">
            Toolbox
            <span className="text-xyne-fg-tertiary">•</span>
            <span className="font-normal text-xyne-fg-tertiary">tools</span>
          </span>
        }
        description="Bring in a helper agent, or grant access to connected integrations"
        info={{
          title: "Toolbox",
          description: "Everything the agent can act on",
          content: (
            <div className="flex flex-col gap-4">
              <div>
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-tertiary">What it is</div>
                <p className="text-[13px] leading-relaxed text-xyne-fg-secondary">The Toolbox controls everything the agent can do — specialists to delegate work to, integration tools to read from or write to external services, and sandbox tools for file and code operations.</p>
              </div>
              <div>
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-tertiary">When to configure it</div>
                <p className="text-[13px] leading-relaxed text-xyne-fg-secondary">Enable only the tools the agent actually needs. Fewer tools means faster, more focused responses — the model has less to reason about on every turn.</p>
              </div>
            </div>
          ),
        }}
        action={
          canEdit ? (
            /* Advanced: icon-only circle that expands to "(icon) Advanced" on hover */
            <button
              onClick={onOpenToolPicker}
              title="Open the raw tool picker (every tool name + slug)"
              className="group inline-flex items-center overflow-hidden rounded-full border border-xyne-border bg-xyne-surface p-1.5 text-xyne-fg-secondary transition-all duration-150 hover:bg-xyne-surface-subtle hover:text-xyne-fg-primary"
            >
              <SlidersIcon size={14} className="shrink-0" />
              <span className="max-w-0 overflow-hidden whitespace-nowrap text-[12px] font-medium opacity-0 transition-all duration-150 group-hover:ml-1.5 group-hover:max-w-[64px] group-hover:opacity-100 group-hover:pr-0.5">
                Advanced
              </span>
            </button>
          ) : undefined
        }
      >
        {/* ── Summary bar (total enabled including subagents) ──────── */}
        <div className="flex items-center gap-3 rounded-xl border border-xyne-border bg-xyne-surface px-4 py-3">
          {availableTools ? (
            <>
              <span className="text-[22px] font-bold leading-none text-xyne-fg-primary">
                {toolboxSummary.totalEnabled}
              </span>
              <span className="text-[13px] text-xyne-fg-secondary">
                of {toolboxSummary.totalAvailable} tools enabled
              </span>
            </>
          ) : (
            <>
              <Shimmer className="h-7 w-8" />
              <Shimmer className="h-4 w-36" />
            </>
          )}
        </div>

        {/* ── Inner tabs ───────────────────────────────────────────── */}
        <div className="flex gap-0.5 rounded-lg border border-xyne-border-subtle bg-xyne-surface-subtle p-0.5">
          {(Object.keys(TOOL_TAB_LABELS) as ToolTabKey[])
            .filter((key) => {
              // Always show Subagents. For integration tabs, only show if
              // there's at least one integration of that kind (or loading).
              if (key === "subagents") return true;
              if (!availableTools) return key !== "miscellaneous"; // show skeleton tabs while loading
              if (key === "miscellaneous") {
                return availableTools.integrations.some(
                  (i) => !["mcp", "custom", "builtin"].includes(i.kind),
                );
              }
              const kindMap: Record<string, string> = { integrations: "mcp", platform: "custom", sandbox: "builtin" };
              return availableTools.integrations.some((i) => i.kind === kindMap[key]);
            })
            .map((key) => {
              const count = key === "subagents" ? draftTools.subagents.length : null;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setToolTab(key)}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] font-medium transition-colors ${
                    toolTab === key
                      ? "bg-xyne-surface text-xyne-fg-primary shadow-sm"
                      : "text-xyne-fg-tertiary hover:text-xyne-fg-secondary"
                  }`}
                >
                  {TOOL_TAB_LABELS[key]}
                  {count != null && count > 0 && (
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none ${
                      toolTab === key
                        ? "bg-xyne-brand text-xyne-fg-inverse"
                        : "bg-xyne-surface text-xyne-fg-tertiary"
                    }`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
        </div>

        {/* ── Search (per-tab; hidden on Specialists — the panel has its own search) */}
        {toolTab !== "subagents" && (
        <div className="relative">
          <MagnifyingGlassIcon
            size={13}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xyne-fg-tertiary"
          />
          <input
            type="text"
            value={toolSearch}
            onChange={(e) => setToolSearch(e.target.value)}
            placeholder="Search"
            disabled={!availableTools}
            className="w-full rounded-lg border border-xyne-border bg-xyne-surface-sunken py-2 pl-8 pr-3 text-[12px] text-xyne-fg-primary placeholder:text-xyne-fg-tertiary focus:border-xyne-border-focus focus:outline-none disabled:opacity-50"
          />
        </div>
        )}

        {/* ── Info modal — shared across all tabs ──────────────────── */}
        <SectionInfoModal tab={infoSection} onClose={() => setInfoSection(null)} />

        {/* ── Specialists tab ──────────────────────────────────────── */}
        {toolTab === "subagents" && (
          <>
            {/* Section header with info button + enabled count */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-tertiary">
                  Specialists
                </span>
                <button
                  type="button"
                  onClick={() => setInfoSection("subagents")}
                  className="rounded-full p-0.5 text-xyne-fg-muted transition-colors hover:text-xyne-fg-secondary"
                  title="What are specialists?"
                >
                  <InfoIcon size={13} />
                </button>
              </div>
              <span className="text-[11px] text-xyne-fg-muted">
                {draftTools.subagents.length}
                {availableTools ? ` / ${availableTools.subagents.length}` : ""} enabled
              </span>
            </div>
            {availableTools ? (
              <SpecialistsPanel
                available={availableTools.subagents}
                selected={draftTools.subagents}
                skillTriggers={skillTriggers}
                availableSkills={availableSkills}
                onToggle={(name, next) => {
                  onDraftToolsChange((t: AgentToolSelection) => ({
                    ...t,
                    subagents: next
                      ? [...t.subagents, name]
                      : t.subagents.filter((x) => x !== name),
                  }));
                }}
                onSkillTriggersChange={onSkillTriggersChange}
                disabled={!canEdit}
              />
            ) : (
              <SpecialistsPanelSkeleton />
            )}
          </>
        )}

        {/* ── Integration tabs (Integrations / Platform / Sandbox / Other) */}
        {toolTab !== "subagents" && (() => {
          const kindMap: Record<string, string> = {
            integrations: "mcp",
            platform:     "custom",
            sandbox:      "builtin",
          };
          const targetKind = kindMap[toolTab]; // undefined for "miscellaneous"
          const list = availableTools
            ? filteredIntegrations.filter((i) =>
                targetKind ? i.kind === targetKind : !Object.values(kindMap).includes(i.kind),
              )
            : null;

          if (!list) {
            // Loading skeleton — show 3 placeholder cards
            return (
              <div className="flex flex-col gap-2">
                {[0, 1, 2].map((i) => <IntegrationCardSkeleton key={i} />)}
              </div>
            );
          }

          return (
            <>
              {/* Section header with info button */}
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-tertiary">
                  {TOOL_TAB_LABELS[toolTab]}
                </span>
                <button
                  type="button"
                  onClick={() => setInfoSection(toolTab)}
                  className="rounded-full p-0.5 text-xyne-fg-muted transition-colors hover:text-xyne-fg-secondary"
                  title={`What are ${TOOL_TAB_LABELS[toolTab].toLowerCase()}?`}
                >
                  <InfoIcon size={13} />
                </button>
              </div>
              {list.length > 0 ? (
                <div className="flex flex-col gap-2">
                  {list.map((intg) => (
                    <IntegrationCard
                      key={intg.slug}
                      integration={intg}
                      selected={selectedKeysForIntegration(intg.kind, draftTools)}
                      onToggle={(key, next) => onDraftToolsChange((t) => applyToggle(t, intg.kind, key, next))}
                      onBulkToggle={(keys, next) => onDraftToolsChange((t) => applyBulkToggle(t, intg.kind, keys, next))}
                      disabled={!canEdit}
                    />
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-xyne-border-subtle py-8 text-center text-[12px] text-xyne-fg-tertiary">
                  {toolSearch
                    ? `No ${TOOL_TAB_LABELS[toolTab].toLowerCase()} tools match "${toolSearch}"`
                    : `No ${TOOL_TAB_LABELS[toolTab].toLowerCase()} tools available`}
                </div>
              )}
            </>
          );
        })()}
      </Section>
      )}

      {/* Knowledge — the agent's onboarding library. Two related blocks:
              (A) Skills: markdown "reading material" the agent consults
                  during a task. Static attachments.
              (B) Contextual Responses (skill triggers): a skill's content
                  is injected into a specific tool's result when it fires.
                  Reactive attachments tied to tool execution.
            Both are "knowledge that can flow into the conversation",
            which is why they share this tab — moved from Behavior to
            match V1's grouping. */}
      {activeTab === "knowledge" && (
      <div className="flex flex-col gap-5">
        <Section
          title={
            <span className="inline-flex items-baseline gap-2">
              Knowledge
              <span className="text-xyne-fg-tertiary">•</span>
              <span className="font-normal text-xyne-fg-tertiary">skills</span>
            </span>
          }
          description="Reference material the agent can pull up when relevant"
          info={{
            title: "Knowledge",
            description: "Skills and contextual responses that inform the agent",
            content: (
              <div className="flex flex-col gap-4">
                <div>
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-tertiary">Skills</div>
                  <p className="text-[13px] leading-relaxed text-xyne-fg-secondary">Markdown documents the agent reads when relevant — background reading it can consult during a task, like runbooks, guidelines, or reference material.</p>
                </div>
                <div>
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-tertiary">Contextual Responses</div>
                  <p className="text-[13px] leading-relaxed text-xyne-fg-secondary">Rules that automatically inject a skill into a specific tool's output when that tool fires. Useful for enriching tool results with relevant context without manual effort.</p>
                </div>
              </div>
            ),
          }}
          action={
            canEdit ? (
              <button
                onClick={onOpenSkillPicker}
                className="flex items-center gap-1 rounded-md border border-xyne-border bg-xyne-surface px-2.5 py-1 text-[11px] font-medium text-xyne-fg-secondary transition-colors hover:border-xyne-border-strong hover:text-xyne-fg-primary"
              >
                Configure skills
              </button>
            ) : undefined
          }
        >
          {availableSkills.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {availableSkills.map((skill) => {
                const selected = draftSkillIds.includes(skill.id);
                return (
                  <button
                    key={skill.id}
                    onClick={() => canEdit && onToggleSkill(skill.id)}
                    disabled={!canEdit}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                      selected
                        ? "bg-xyne-brand text-xyne-fg-inverse"
                        : "border border-xyne-border bg-xyne-surface-subtle text-xyne-fg-secondary hover:border-xyne-brand hover:bg-xyne-surface hover:text-xyne-fg-primary"
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    {skill.name}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="rounded-lg border border-xyne-border-subtle py-6 text-center text-[12px] text-xyne-fg-tertiary">
              No skills available
            </div>
          )}
        </Section>

        {/* ── section divider ────────────────────────────────────── */}
        {canEdit && (
          <hr className="border-xyne-border-subtle" />
        )}

        {/* Contextual Responses — tool-level skill injection only.
              Subagent-level skill attachments (toolName with no colon) are
              managed exclusively from Toolbox → Subagents to avoid editing
              the same triggers from two places. Contextual Responses only
              shows and creates triggers that target a specific inner tool
              (toolName format: "subagentName:toolName").
              Gated on canEdit because the Add button + selects need write
              access. Non-editors don't see this block. */}
        {canEdit && (
          <Section
            title={
              <span className="inline-flex items-baseline gap-2">
                Contextual Responses
                <span className="text-xyne-fg-tertiary">•</span>
                <span className="font-normal text-xyne-fg-tertiary">skill triggers</span>
              </span>
            }
            description="When a specific tool finishes, inject a skill into its result"
            action={
              <button
                onClick={() =>
                  onSkillTriggersChange([
                    ...skillTriggers,
                    // Default to an empty inner-tool slot so the user is guided
                    // to pick a specific tool (subagent-level = Toolbox tab).
                    { toolName: "", skillSlug: "", when: "after", prompt: "" },
                  ])
                }
                className="flex items-center gap-1 text-[12px] font-medium text-xyne-fg-secondary transition-colors hover:text-xyne-fg-primary"
              >
                <PlusIcon size={12} />
                Add response
              </button>
            }
          >
            {/* Only show tool-specific triggers (contain ":"). Subagent-level
                triggers (no colon) live in Toolbox → Subagents tab. */}
            {skillTriggers.filter((t) => t.toolName.includes(":") || t.toolName === "").length > 0 ? (
              <div className="flex flex-col gap-2.5">
                {skillTriggers.map((trigger, idx) => {
                  // Skip subagent-level triggers — they are managed in Toolbox.
                  if (!trigger.toolName.includes(":") && trigger.toolName !== "") return null;
                  const colonIdx = trigger.toolName.indexOf(":");
                  const selectedSubagent = colonIdx > 0 ? trigger.toolName.slice(0, colonIdx) : trigger.toolName;
                  const selectedInnerTool = colonIdx > 0 ? trigger.toolName.slice(colonIdx + 1) : "";
                  const subagentDef = availableTools?.subagents.find((s) => s.name === selectedSubagent);
                  const innerTools = subagentDef ? (availableTools?.serverTools[subagentDef.serverType] ?? []) : [];

                  return (
                    <div key={idx} className="flex flex-col gap-2 rounded-xl border border-xyne-border bg-xyne-surface p-3 shadow-sm">
                      {/* ── Row 1: timing + subagent (+ optional tool) + remove ── */}
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        {/* Timing: Before / After */}
                        <TriggerDropdown
                          value={trigger.when}
                          options={[
                            { value: "after", label: "After" },
                            { value: "before", label: "Before" },
                          ]}
                          placeholder=""
                          onChange={(val) =>
                            onSkillTriggersChange(
                              skillTriggers.map((t, i) =>
                                i === idx ? { ...t, when: val as "before" | "after" } : t
                              )
                            )
                          }
                          className="w-[76px] shrink-0"
                        />

                        {/* Subagent picker */}
                        <TriggerDropdown
                          value={selectedSubagent}
                          options={(availableTools?.subagents ?? []).map((s) => ({
                            value: s.name,
                            label: s.name,
                          }))}
                          placeholder="Select subagent…"
                          onChange={(sa) =>
                            onSkillTriggersChange(
                              skillTriggers.map((t, i) => (i === idx ? { ...t, toolName: sa } : t))
                            )
                          }
                          className="min-w-[120px] flex-1"
                        />

                        {/* Separator + inner tool picker (only when a subagent is selected) */}
                        {selectedSubagent && innerTools.length > 0 && (
                          <>
                            <span className="shrink-0 select-none text-[11px] text-xyne-fg-muted">›</span>
                            <TriggerDropdown
                              value={selectedInnerTool}
                              options={innerTools.map((t) => ({
                                value: t.name,
                                label: t.name,
                              }))}
                              placeholder="Any tool"
                              onChange={(inner) =>
                                onSkillTriggersChange(
                                  skillTriggers.map((t, i) =>
                                    i === idx
                                      ? {
                                          ...t,
                                          toolName: inner
                                            ? `${selectedSubagent}:${inner}`
                                            : selectedSubagent,
                                        }
                                      : t
                                  )
                                )
                              }
                              className="min-w-[100px] flex-1"
                            />
                          </>
                        )}

                        {/* Remove button */}
                        <button
                          type="button"
                          onClick={() =>
                            onSkillTriggersChange(skillTriggers.filter((_, i) => i !== idx))
                          }
                          className="ml-auto shrink-0 rounded-md p-1 text-xyne-fg-muted transition-colors hover:bg-xyne-error-bg hover:text-xyne-error-fg"
                          aria-label="Remove trigger"
                        >
                          <XIcon size={12} />
                        </button>
                      </div>

                      {/* ── Row 2: skill to inject ── */}
                      <TriggerDropdown
                        value={trigger.skillSlug}
                        options={availableSkills.map((s) => ({
                          value: s.slug,
                          label: s.label || s.name,
                        }))}
                        placeholder="Inject skill…"
                        onChange={(slug) =>
                          onSkillTriggersChange(
                            skillTriggers.map((t, i) =>
                              i === idx ? { ...t, skillSlug: slug } : t
                            )
                          )
                        }
                      />

                      {/* ── Row 3: optional instruction ── */}
                      <input
                        type="text"
                        value={trigger.prompt}
                        onChange={(e) =>
                          onSkillTriggersChange(
                            skillTriggers.map((t, i) =>
                              i === idx ? { ...t, prompt: e.target.value } : t
                            )
                          )
                        }
                        placeholder="Custom instruction (optional)"
                        className="w-full rounded-md border border-xyne-border bg-xyne-surface px-2.5 py-1.5 text-[11px] text-xyne-fg-primary placeholder:text-xyne-fg-placeholder focus:border-xyne-border-focus focus:outline-none"
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-lg border border-xyne-border-subtle py-6 text-center text-[12px] text-xyne-fg-tertiary">
                No contextual responses configured.{" "}
                <span className="not-italic">
                  To attach a skill to a whole subagent, use the Toolbox → Subagents tab.
                </span>
              </div>
            )}
          </Section>
        )}
      </div>
      )}

      {/* Behavior — Constant Reminders (per-turn promptInjection appended
            as a [System Reminder]). Contextual Responses / skill triggers
            were relocated to the Knowledge tab to keep skills-related UI
            together (see the Knowledge block above). */}
      {activeTab === "behavior" && canEdit && (
        <Section
          title={
            <span className="inline-flex items-baseline gap-2">
              Constant Reminders
              <span className="text-xyne-fg-tertiary">•</span>
              <span className="font-normal text-xyne-fg-tertiary">prompt injection</span>
            </span>
          }
          description="A system message appended on every turn (e.g. ‘always respond in JSON’)"
          info={{
            title: "Constant Reminders",
            description: "Persistent instructions appended to every message",
            content: (
              <div className="flex flex-col gap-4">
                <div>
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-tertiary">What it is</div>
                  <p className="text-[13px] leading-relaxed text-xyne-fg-secondary">A block of text appended as a system instruction on every turn — the model always sees it, regardless of the conversation topic.</p>
                </div>
                <div>
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-tertiary">When to use it</div>
                  <p className="text-[13px] leading-relaxed text-xyne-fg-secondary">Use it for global rules the agent must never break — output format requirements (e.g. "always respond in JSON"), language preferences, safety guardrails, or compliance constraints.</p>
                </div>
              </div>
            ),
          }}
        >
          <textarea
            value={draftPromptInjection}
            onChange={(e) => onDraftPromptInjectionChange(e.target.value)}
            placeholder="Add a constant reminder…"
            rows={3}
            readOnly={!canEdit}
            className="min-w-0 w-full resize-y rounded-lg border border-xyne-border bg-xyne-surface-sunken px-3 py-2 text-[12px] leading-relaxed text-xyne-fg-primary placeholder:text-xyne-fg-placeholder focus:border-xyne-border-focus focus:outline-none disabled:opacity-60"
          />
        </Section>
      )}

      {/* Delete moved to the page header (owner-only Trash button there) so
          it's reachable without scrolling to the bottom of the config.
          Git URL and Model deliberately omitted — see notes at top of file. */}
      </div>
      </div>
    </div>
  );
}
