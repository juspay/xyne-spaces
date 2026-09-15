import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import {
  RobotIcon,
  PlugIcon,
  GearSixIcon,
  SlidersIcon,
  BookOpenIcon,
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
import type { Agent, AgentLight } from "../../../lib/types";
import { PromptVersionHistory } from "../../../components/PromptVersionHistory";
import type { AgentPermissions } from "../../lib/agentPermissions";
import type { AgentDelegationGrant, ClaudeModelInfo, AvailableTools, DelegationIdentityMode, Skill, ProviderCredential, SandboxRepoOption, SbxGitRepoOption, ResearchAgentOption } from "../../../lib/api";
import { generateOutputFormat } from "../../../lib/api";
import type { AgentProvider } from "../../hooks/useAgents";
import type { AgentToolSelection } from "../ToolPickerDialog";
import { useSnackbar } from "../ui/Snackbar";
import { Dialog } from "../ui/Dialog";
import { IntegrationCard } from "./IntegrationCard";
import { ToolboxPicker } from "../ToolboxPicker";
import { KnowledgeBasePicker } from "../KnowledgeBasePicker";
import { parseGatewaySource } from "../../lib/gatewayKeys";
import { MAX_DELEGATIONS_PER_RUN_OPTIONS, MAX_DELEGATIONS_PER_RUN_BOUNDS } from "../../lib/delegationBudget";

/* ── Tab model ─────────────────────────────────────────────────────────
   Four-layer mental model: who the agent is (Persona), what it knows
   (Knowledge), what it can do (Toolbox), and how it behaves on the job
   (Behavior — combines per-turn reminders and reactive tool triggers).
   Identity (name/slug/description + provider) stays above the tab strip
   as always-relevant context.

   Removed from this surface:
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
  subagents:     "Subagents",    // user-facing term; technical term is "subagents"
  integrations:  "Integrations",   // kind: "mcp" | "gateway" (gateway folds in here)
  platform:      "Platform",       // kind: "custom" (Xyne-provided tools)
  sandbox:       "Sandbox",        // kind: "builtin" (opt-in sandbox actions: bash, edit)
  miscellaneous: "Miscellaneous",  // future / unknown kinds — tab only appears when ≥1 exists
} as const;

type ToolTabKey = keyof typeof TOOL_TAB_LABELS;

function kindToTab(kind: string): Exclude<ToolTabKey, "subagents"> {
  const map: Record<string, Exclude<ToolTabKey, "subagents">> = {
    mcp:     "integrations",
    gateway: "integrations", // gateway tools surface in the Integrations tab
    custom:  "platform",
    builtin: "sandbox",
  };
  return map[kind] ?? "miscellaneous";
}

/**
 * Resolve which tab an integration belongs to. Kind alone isn't sufficient
 * because some `custom`-kind integrations (notably the `custom:sandbox`
 * tool source — sandbox-create, sandbox-run, sandbox-pw-*, etc.) belong in
 * the Sandbox tab next to the builtin bash/edit, not in Platform alongside
 * Google/Microsoft/research-agent. Special-case those by slug.
 */
function integrationTab(intg: { kind: string; slug: string }): Exclude<ToolTabKey, "subagents"> {
  if (intg.kind === "custom" && intg.slug === "custom:sandbox") return "sandbox";
  return kindToTab(intg.kind);
}

function gatewayServiceFromIntegrationSlug(slug: string): string | null {
  return parseGatewaySource(slug)?.serviceName ?? null;
}

function integrationToolSelected(
  intg: { kind: string; slug: string },
  tool: { slug: string; name: string },
  tools: AgentToolSelection,
): boolean {
  if (intg.kind === "custom") return tools.custom.includes(tool.slug);
  if (intg.kind === "gateway") {
    const serviceName = gatewayServiceFromIntegrationSlug(intg.slug);
    return tools.direct.includes(tool.slug)
      || tools.gateway.includes(intg.slug)
      || (serviceName ? tools.gateway.includes(serviceName) : false);
  }
  return tools.direct.includes(tool.name);
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
    title: "Subagents",
    tagline: "Domain-expert agents the agent can delegate to",
    what: "Subagents are purpose-built AI agents that handle tasks in a specific domain. When you enable a subagent, the parent agent can call on it during a conversation — delegating work rather than handling it directly.",
    when: "Enable a subagent when the agent needs deep expertise in a particular system (e.g. reading Grafana dashboards, creating GitHub PRs, managing Jira tickets). The parent agent decides which subagent to call based on the user's request.",
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
    when: "Enable integration tools when you want the agent to read from or act on an external service without going through a subagent. Useful when the agent needs targeted access — for example, only reading Slack messages without the full Slack subagent.",
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
      { name: "google",          note: "Search Google and retrieve page content" },
      { name: "research-agent",  note: "Deep research across multiple sources" },
    ],
  },
  sandbox: {
    title: "Sandbox tools",
    tagline: "Opt-in workspace actions — bash, edit, full sandbox sessions",
    what: "Sandbox tools give the agent the ability to mutate the session workspace, run shell commands, and spin up isolated full-OS sandboxes for richer execution (e.g. running tests, browser automation via Playwright, file delivery). Read-only filesystem tools (read, write, grep, find, ls) are enabled by default at the runtime layer and aren't shown here — they're always on for every agent.",
    when: "Enable sandbox tools when the agent needs to run code, edit files beyond simple writes, or operate a full isolated environment. Essential for coding agents and automation flows. Leave them off for chat-only agents to keep the action surface minimal.",
    examples: [
      { name: "bash",                 note: "Execute shell commands within the workspace" },
      { name: "edit",                 note: "Apply precise string replacements to a file" },
      { name: "sandbox-create",       note: "Spin up a fresh isolated sandbox session" },
      { name: "sandbox-run",          note: "Run commands inside a sandbox session" },
      { name: "sandbox-pw-navigate",  note: "Drive a browser inside a sandbox via Playwright" },
      { name: "sandbox-deliver-files",note: "Send sandbox-produced files to the user" },
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
  kind: "mcp" | "builtin" | "custom" | "gateway",
  tools: AgentToolSelection,
): Set<string> {
  if (kind === "custom") return new Set(tools.custom);
  if (kind === "gateway") return new Set(tools.gateway);
  return new Set(tools.direct);
}

function applyToggle(
  tools: AgentToolSelection,
  kind: "mcp" | "builtin" | "custom" | "gateway",
  key: string,
  next: boolean,
): AgentToolSelection {
  const field: "direct" | "custom" | "gateway" = 
    kind === "custom" ? "custom" : 
    kind === "gateway" ? "gateway" : 
    "direct";
  const current = tools[field];
  const exists = current.includes(key);
  if (next && !exists) return { ...tools, [field]: [...current, key] };
  if (!next && exists) return { ...tools, [field]: current.filter((x) => x !== key) };
  return tools;
}

function applyBulkToggle(
  tools: AgentToolSelection,
  kind: "mcp" | "builtin" | "custom" | "gateway",
  keys: string[],
  next: boolean,
): AgentToolSelection {
  const field: "direct" | "custom" | "gateway" = 
    kind === "custom" ? "custom" : 
    kind === "gateway" ? "gateway" : 
    "direct";
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
        No subagents available
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

/* ── dropdown (styled like a select but with a fixed-height scrollable panel) ──
   Same floating-panel + backdrop pattern as TriggerDropdown, but sized for
   form fields (text-[12px], py-2) rather than the compact trigger-card
   micro-select. Used for Research Agent product / repository picks. */

function Dropdown({
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
        className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-[12px] text-left transition-colors focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 ${
          open
            ? "border-xyne-border-focus bg-xyne-surface text-xyne-fg-primary"
            : "border-xyne-border bg-xyne-surface-sunken text-xyne-fg-primary hover:border-xyne-border-strong"
        }`}
      >
        <span className={`truncate ${selected ? "text-xyne-fg-primary" : "text-xyne-fg-placeholder"}`}>
          {selected?.label ?? placeholder}
        </span>
        <CaretDownIcon
          size={12}
          className={`shrink-0 text-xyne-fg-muted transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 overflow-hidden rounded-xl border border-xyne-border bg-xyne-surface shadow-[0_8px_24px_rgba(0,0,0,0.10)]">
            <div className="max-h-[240px] overflow-y-auto py-1">
              <button
                type="button"
                onClick={() => { onChange(""); setOpen(false); }}
                className="flex w-full px-3 py-2 text-left text-[12px] text-xyne-fg-placeholder transition-colors hover:bg-xyne-surface-subtle"
              >
                {placeholder}
              </button>
              {options.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => { onChange(opt.value); setOpen(false); }}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] transition-colors hover:bg-xyne-surface-subtle ${
                    opt.value === value ? "font-medium text-xyne-brand" : "text-xyne-fg-primary"
                  }`}
                >
                  <span className="w-[14px] shrink-0">
                    {opt.value === value && <CheckIcon size={12} weight="bold" />}
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

/* ── subagent category mapping ────────────────────────────────────────
   Frontend-side grouping until the backend adds a `category` field to
   the subagent manifest. Unknown names fall into "Other" and always
   appear — no subagent is silently dropped. Extend this map when new
   subagents are added to the platform. */

const SUBAGENT_CATEGORY_MAP: Record<string, string> = {
  "context7":          "Docs & Research",
  "deepwiki":          "Docs & Research",
  "research-agent":    "Docs & Research",
  "perplexity":        "Docs & Research",
  "github":            "Engineering",
  "bitbucket":         "Engineering",
  // "sandbox" removed 2026-06-09 — see SUBAGENT_DEFINITIONS in xyne-claw-shared.
  // Sandbox tools (sandbox-run, sandbox-pw-*, etc.) now mount directly on the
  // parent via the `custom:sandbox` integration card under Toolbox → Sandbox.
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
  return SUBAGENT_CATEGORY_MAP[name] ?? "Other";
}

// Deterministic avatar colours derived from the subagent's name so the
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

function subagentInitials(name: string): string {
  // Strip hyphens/underscores and take the first two letters uppercased.
  // e.g. "context7" → "CO", "research-agent" → "RE".
  return name.replace(/[-_]/g, "").slice(0, 2).toUpperCase();
}

function subagentAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) & 0xffff;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length] ?? "bg-[#3b82f6]";
}

/* ── SubagentsPanelSkeleton ─────────────────────────────────────────
   Loading shimmer that mirrors the two-panel shape. */

function SubagentsPanelSkeleton() {
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

/* ── SubagentsPanel ──────────────────────────────────────────────────
   Two-mode layout with a smooth cross-fade transition:

   "grid" mode (default) — compact pill grid, identical to the previous
     SubagentPicker UX. Clicking any pill slides into "detail" mode.

   "detail" mode — fixed-height two-column panel:
     Left  : search + flat scrollable list (no category dividers).
     Right : avatar, name, enable/remove button, description, attached
             skills + SkillDropdown, footer hint.
   A "← View all" link returns to the grid. */

function SubagentsPanel({
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

  // Open the detail panel for a specific subagent.
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
            No subagents available
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

          {/* Right: subagent detail */}
          <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
            {!detail ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
                <RobotIcon size={28} className="text-xyne-fg-muted" weight="light" />
                <p className="text-[12px] text-xyne-fg-tertiary">
                  Select a subagent to configure it
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-4 p-4">
                {/* Header: avatar + name + subtitle + enable/remove button */}
                <div className="flex items-start gap-3">
                  <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[13px] font-bold text-white ${subagentAvatarColor(detail.name)}`}
                  >
                    {subagentInitials(detail.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-bold text-xyne-fg-primary">
                      {detail.name}
                    </div>
                    <div className="text-[11px] text-xyne-fg-tertiary">
                      {getCategoryFor(detail.name)} · subagent
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
                  <span>Skills you attach here travel with this subagent every time it's invoked.</span>
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
  userId: string;
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
  allAgents: AgentLight[];
  delegationGrants: AgentDelegationGrant[];
  delegationLoading: boolean;
  currentUserId: string;
  onAddDelegationGrant: (calleeSlug: string, identityMode: DelegationIdentityMode, requestReason?: string) => Promise<void>;
  onDeleteDelegationGrant: (grant: AgentDelegationGrant) => Promise<void>;
  onAddDelegationConfigEntry: (calleeSlug: string) => Promise<void>;
  onCreateDelegationGrantForConfig: (calleeSlug: string) => Promise<void>;
  onRemoveDelegationConfigEntry: (calleeSlug: string) => Promise<void>;

  // Skills
  draftSkillIds: string[];
  onToggleSkill: (id: string) => void;
  availableSkills: Skill[];

  // Knowledge Base — per-agent grants over spaces collections / files.
  // The picker only shows what THIS user can already access in spaces;
  // selection is enforced again at the MCP-tool layer when the agent runs.
  draftKbResources: import("../KnowledgeBasePicker").KbSelection[];
  onDraftKbResourcesChange: (next: import("../KnowledgeBasePicker").KbSelection[]) => void;
  // KB scope mode: "COLLECTIONS" = use draftKbResources (picker).
  //                "USER"        = inherit caller's full KB; picker hidden.
  draftKbScope: "COLLECTIONS" | "USER";
  onDraftKbScopeChange: (next: "COLLECTIONS" | "USER") => void;

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

  // Sandbox repo pin (agent.config.sandboxRepo). When set, the runtime forces
  // sandbox-repo-setup onto this repo so the agent can't pick the wrong one.
  draftSandboxRepo: string;
  onDraftSandboxRepoChange: (v: string) => void;
  sandboxRepoOptions: SandboxRepoOption[];
  // Reviewer read-only multi-repo sandbox (agent.config.forceReadOnlySandbox):
  // route every run to the shared sbx-git sandbox (grep all repos, no clone/write).
  draftForceReadOnlySandbox: boolean;
  onDraftForceReadOnlySandboxChange: (v: boolean) => void;
  // Operator-selected repo focus for read-only agents (agent.config.sbxGitRepos).
  draftSbxGitRepos: string[];
  onDraftSbxGitReposChange: (v: string[]) => void;
  sbxGitRepoOptions: SbxGitRepoOption[];

  // Research Agent product/repository context. Product takes precedence at runtime.
  draftResearchAgentProductId: string;
  onDraftResearchAgentProductIdChange: (v: string) => void;
  researchAgentProductOptions: ResearchAgentOption[];
  draftResearchAgentRepositoryId: string;
  onDraftResearchAgentRepositoryIdChange: (v: string) => void;
  researchAgentRepositoryOptions: ResearchAgentOption[];

  // Suggest Goals opt-in (agent.config.suggestGoal). When on, xyne-claw injects
  // the `suggest-goal` tool + a /goal-awareness primer so the agent can propose
  // a one-click "Run autonomously" button at the end of multi-turn planning.
  draftSuggestGoal: boolean;
  onDraftSuggestGoalChange: (v: boolean) => void;
  /** Query prefetch opt-in (agent.config.prefetchContext). Resolves the
   *  entities named in a question to ids before the agent's first turn. */
  draftPrefetchContext: boolean;
  onDraftPrefetchContextChange: (v: boolean) => void;
  // Post TODOs to Spaces opt-OUT (agent.config.postTodos). Default ON: the
  // live plan/TODO card from the todo-write tool is posted into the thread.
  // Turning it OFF sets postTodos=false, suppressing the card at claw-auth's
  // doRenderPlanCard. The agent still tracks TODOs internally for loop
  // discipline — only the Spaces render is hidden.
  draftPostTodos: boolean;
  onDraftPostTodosChange: (v: boolean) => void;
  // Plan tracking opt-OUT (agent.config.planTracking). Default ON. Unlike
  // postTodos (which only hides the card), turning this OFF removes the
  // todo-write/todo-read tools AND the primer that mandates them, so the agent
  // spends no turns on plan bookkeeping.
  draftPlanTracking: boolean;
  onDraftPlanTrackingChange: (v: boolean) => void;
  // Verify-responses opt-in (agent.config.verifyResponses). When on, the agent
  // delivers its final answer via the submit-response tool, which checks the
  // draft's factual claims against gathered tool evidence before it's posted.
  draftVerifyResponses: boolean;
  onDraftVerifyResponsesChange: (v: boolean) => void;
  // Citation reflection opt-in (agent.config.citationReflection). When on, the
  // runtime nudges the agent to add inline [clf-…] citations post-response if it
  // used citeable sources but cited none.
  draftCitationReflection: boolean;
  onDraftCitationReflectionChange: (v: boolean) => void;
  // Generic auto-citations opt-in (agent.config.autoToolCitations). When on,
  // every tool result is chunked + [clf-…]-tokenized so the model can cite any
  // tool's output (tools that self-cite are left untouched).
  draftAutoToolCitations: boolean;
  onDraftAutoToolCitationsChange: (v: boolean) => void;
  // Per-agent delivery criteria, layered on top of the default factual check
  // (only meaningful when verifyResponses is on).
  draftVerifyResponseCriteria: string;
  onDraftVerifyResponseCriteriaChange: (v: string) => void;

  // Structured output (agent.config.outputFormat). When on, xyne-claw injects a
  // `submit-result` tool the agent must deliver its final answer through. Type
  // "json" uses draftOutputSchema (+ optional markdown render template); type
  // "markdown" uses draftOutputTemplate as an optional outline.
  draftOutputFormatEnabled: boolean;
  onDraftOutputFormatEnabledChange: (v: boolean) => void;
  draftOutputType: "json" | "markdown";
  onDraftOutputTypeChange: (v: "json" | "markdown") => void;
  draftOutputSchema: string;
  onDraftOutputSchemaChange: (v: string) => void;
  draftOutputTemplate: string;
  onDraftOutputTemplateChange: (v: string) => void;
  // Process guard (outputFormat.requireToolsBeforeSubmit): comma/newline-
  // separated tool-name substrings that must run before submit-result is
  // accepted. Stops the agent short-circuiting a pipeline with an empty payload.
  draftOutputRequireTools: string;
  onDraftOutputRequireToolsChange: (v: string) => void;

  // Always Goal opt-in (agent.config.autoGoal). When on, claw-auth's webhook
  // wraps every user message as `/goal <text>` before parsing, so EVERY
  // interaction with this agent runs autonomously. User-typed `/stop` and
  // `/goal status` still work (they start with `/` and bypass the wrap).
  draftAutoGoal: boolean;
  onDraftAutoGoalChange: (v: boolean) => void;
  // Plan mode opt-in (agent.config.planMode). When on, non-twin thread mentions
  // propose a plan and wait for the user's approval before doing multi-step work.
  draftPlanMode: boolean;
  onDraftPlanModeChange: (v: boolean) => void;
  // Editable plan-mode primer (agent.config.planModePrompt) — how the agent scopes
  // a plan. Pre-filled with the default; only shown/saved when plan mode is on.
  draftPlanModePrompt: string;
  onDraftPlanModePromptChange: (v: string) => void;
  // Per-run delegation budget (agent.config.maxDelegationsPerRun). Bounds how
  // many child-agent delegations one top-level run may make. Default 3.
  draftMaxDelegations: number;
  onDraftMaxDelegationsChange: (v: number) => void;

  // Dialog callbacks
  onOpenSkillPicker: () => void;
  /** Opens the RenameHandleDialog. Only shown to the owner — admins use
      their own moderation path; contributors can't rename. */
  onRequestRenameHandle: () => void;
}

/* ── accordion disclosure header ───────────────────────────────────────
   The left column is a calm vertical list of disclosure cards (it replaces
   the old four-tab strip). Each card's header shows a friendly label + the
   technical term, a one-line subtitle, optional micro-notes, and a summary
   chip of the section's current state; the editor body reveals below when
   the section is expanded. Single-open accordion. */
function DisclosureHeader({
  icon: Icon,
  label,
  tech,
  subtitle,
  notes,
  summary,
  open,
  onToggle,
}: {
  icon: React.ComponentType<{ size?: number; weight?: "regular" | "fill" | "bold" }>;
  label: string;
  tech?: string;
  subtitle: string;
  notes?: string[];
  summary: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="flex w-full items-center gap-3 px-4 py-3 text-left"
    >
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-xyne-surface-subtle text-xyne-fg-secondary">
        <Icon size={18} weight={open ? "fill" : "regular"} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="inline-flex items-baseline gap-1.5">
          <span className="text-[13.5px] font-semibold text-xyne-fg-primary">{label}</span>
          {tech && <span className="text-xyne-fg-tertiary">•</span>}
          {tech && <span className="text-[12px] font-normal text-xyne-fg-tertiary">{tech}</span>}
        </span>
        <span className="truncate text-[11.5px] text-xyne-fg-tertiary">{subtitle}</span>
        {notes && notes.length > 0 && (
          <span className="mt-0.5 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[10.5px] text-xyne-fg-muted">
            {notes.map((n) => (
              <span key={n} className="inline-flex items-center gap-1">
                <span className="h-[3px] w-[3px] rounded-full bg-xyne-fg-muted" />
                {n}
              </span>
            ))}
          </span>
        )}
      </span>
      <span className="shrink-0 rounded-full bg-xyne-surface-sunken px-2.5 py-1 text-[11px] font-medium tabular-nums text-xyne-fg-secondary">
        {summary}
      </span>
      <CaretDownIcon
        size={15}
        weight="bold"
        className={`shrink-0 text-xyne-fg-tertiary transition-transform ${open ? "rotate-180" : ""}`}
      />
    </button>
  );
}

/* ── main component ────────────────────────────────────────────────── */

export function AgentDetailLeftColumn({
  agent,
  userId,
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
  allAgents,
  delegationGrants,
  delegationLoading,
  currentUserId,
  onAddDelegationGrant,
  onDeleteDelegationGrant,
  onAddDelegationConfigEntry,
  onCreateDelegationGrantForConfig,
  onRemoveDelegationConfigEntry,
  draftSkillIds,
  onToggleSkill,
  availableSkills,
  draftKbResources,
  onDraftKbResourcesChange,
  draftKbScope,
  onDraftKbScopeChange,
  skillTriggers,
  onSkillTriggersChange,
  draftPromptInjection,
  onDraftPromptInjectionChange,
  draftSandboxRepo,
  onDraftSandboxRepoChange,
  draftForceReadOnlySandbox,
  onDraftForceReadOnlySandboxChange,
  draftSbxGitRepos,
  onDraftSbxGitReposChange,
  sbxGitRepoOptions,
  draftResearchAgentProductId,
  onDraftResearchAgentProductIdChange,
  researchAgentProductOptions,
  draftResearchAgentRepositoryId,
  onDraftResearchAgentRepositoryIdChange,
  researchAgentRepositoryOptions,
  draftSuggestGoal,
  onDraftSuggestGoalChange,
  draftPrefetchContext,
  onDraftPrefetchContextChange,
  draftPostTodos,
  onDraftPostTodosChange,
  draftPlanTracking,
  onDraftPlanTrackingChange,
  draftVerifyResponses,
  draftVerifyResponseCriteria,
  onDraftVerifyResponseCriteriaChange,
  onDraftVerifyResponsesChange,
  draftCitationReflection,
  onDraftCitationReflectionChange,
  draftAutoToolCitations,
  onDraftAutoToolCitationsChange,
  draftAutoGoal,
  onDraftAutoGoalChange,
  draftPlanMode,
  onDraftPlanModeChange,
  draftPlanModePrompt,
  onDraftPlanModePromptChange,
  draftMaxDelegations,
  onDraftMaxDelegationsChange,
  draftOutputFormatEnabled,
  onDraftOutputFormatEnabledChange,
  draftOutputType,
  onDraftOutputTypeChange,
  draftOutputSchema,
  onDraftOutputSchemaChange,
  draftOutputTemplate,
  onDraftOutputTemplateChange,
  draftOutputRequireTools,
  onDraftOutputRequireToolsChange,
  sandboxRepoOptions,
  onOpenSkillPicker,
  onRequestRenameHandle,
}: Props) {
  const { show: showSnackbar } = useSnackbar();
  const [briefInput, setBriefInput] = useState("");
  // Structured-output "describe in plain text → generate schema+template" helper.
  const [outputGenInput, setOutputGenInput] = useState("");
  const [outputGenLoading, setOutputGenLoading] = useState(false);
  const [outputGenNotes, setOutputGenNotes] = useState<string>("");
  const [outputGenWarnings, setOutputGenWarnings] = useState<string[]>([]);
  const runOutputGenerate = async () => {
    if (!outputGenInput.trim() || outputGenLoading) return;
    setOutputGenLoading(true);
    setOutputGenNotes("");
    setOutputGenWarnings([]);
    try {
      const result = await generateOutputFormat({
        description: outputGenInput.trim(),
        format: draftOutputType,
        ...(draftOutputSchema.trim() ? { existingSchema: draftOutputSchema } : {}),
        ...(draftOutputTemplate.trim() ? { existingTemplate: draftOutputTemplate } : {}),
        agentName: agent.name,
      });
      if (draftOutputType === "json") onDraftOutputSchemaChange(result.schema);
      onDraftOutputTemplateChange(result.template);
      setOutputGenNotes(result.notes);
      setOutputGenWarnings(result.warnings ?? []);
      showSnackbar({ variant: "success", title: "Generated — review and tweak before saving" });
    } catch (err) {
      showSnackbar({ variant: "error", title: err instanceof Error ? err.message : "Failed to generate output format" });
    } finally {
      setOutputGenLoading(false);
    }
  };
  const [toolGroupOpen, setToolGroupOpen] = useState<Record<string, boolean>>({
    subagents: false,
    direct: false,
    custom: false,
    system: false,
  });
  const [activeTab, setActiveTab] = useState<ConfigTabKey | null>("persona");
  const toggleSection = (id: ConfigTabKey) => setActiveTab((p) => (p === id ? null : id));
  const [toolSearch, setToolSearch] = useState("");
  const [toolTab, setToolTab] = useState<ToolTabKey>("subagents");
  const [infoSection, setInfoSection] = useState<ToolTabKey | null>(null);


  // Description textarea uses a fixed initial size (rows={3}) + manual
  // resize-y, matching the labeled-form design. No auto-grow ref needed.

  /** Currently-focused subagent in the Toolbox → Subagents tab; opens
   *  the inline SubagentSkillPanel beneath the picker so the operator
   *  can wire triggers without leaving the tab. */
  const [focusedSubagent, setFocusedSubagent] = useState<string | null>(null);

  const totalTools = draftTools.subagents.length + draftTools.direct.length + draftTools.custom.length + draftTools.gateway.length + draftTools.callableAgents.length;
  const totalSubagents = availableTools?.subagents.length ?? 0;
  const totalWriteTools = availableTools?.writeTools.length ?? 0;
  const totalMcpTools = availableTools?.customGroups.flatMap((g) => g.tools).length ?? 0;
  /** Subagents filtered by the toolSearch box. Empty string → all. Used
   *  by the Subagents picker AND by the search-input placeholder to
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
      for (const t of intg.readTools) {
        totalIntegrationTools++;
        if (integrationToolSelected(intg, t, draftTools)) enabledIntegrationTools++;
      }
      for (const t of intg.writeTools) {
        totalIntegrationTools++;
        if (integrationToolSelected(intg, t, draftTools)) enabledIntegrationTools++;
      }
    }
    const totalEnabled = draftTools.subagents.length + draftTools.callableAgents.length + enabledIntegrationTools;
    const totalAvailable = availableTools.subagents.length + totalIntegrationTools;
    return { totalEnabled, totalAvailable };
  }, [availableTools, draftTools]);

  // Filtered lists for search — narrows integration cards (Subagents tab has its own search).
  const filteredIntegrations = useMemo(() => {
    const intgs = availableTools?.integrations ?? [];
    const q = toolSearch.trim().toLowerCase();
    const matched = q
      ? intgs.filter((intg) => {
          if (intg.label.toLowerCase().includes(q)) return true;
          return [...intg.readTools, ...intg.writeTools].some(
            (t) => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q),
          );
        })
      : intgs;
    // Hoist the integrations THIS agent already uses to the top. Within each
    // group (selected / not) the backend order is preserved — that's
    // most-used-by-other-agents first — because Array.sort is stable.
    const hasSelection = (intg: (typeof matched)[number]) => {
      return [...intg.readTools, ...intg.writeTools].some((t) =>
        integrationToolSelected(intg, t, draftTools),
      );
    };
    return [...matched].sort((a, b) => Number(hasSelection(b)) - Number(hasSelection(a)));
  }, [availableTools, toolSearch, draftTools]);

  const canEdit = permissions.canEdit;

  // Tab labels carry counts when non-zero so users see at a glance which
  // surfaces have configured items vs. which are still empty.
  // Skill triggers live under Knowledge alongside Skills (they're both
  // "what reference material can flow into the conversation"), so they
  // contribute to the Knowledge count, not Behavior.
  const hasReminder = draftPromptInjection.trim().length > 0;
  const knowledgeCount = draftSkillIds.length + skillTriggers.length;
  const behaviorCount = hasReminder ? 1 : 0;
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
      {/* Always-visible top: identity + provider/model. These
          aren't tabbed because they're either short or define the agent's
          basic identity (you want to see them regardless of which detail
          tab is open). */}
      <div className="flex shrink-0 flex-col gap-2 border-b border-xyne-border-subtle px-5 py-3">
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

      {/* Define the agent — a calm vertical list of disclosure cards
          (replaces the old tab strip). Each card summarizes its state and
          expands to the full editor. Single-open accordion; the outer div
          owns the scroll, cards stack with a small gap. */}
      <div className="flex flex-1 flex-col overflow-hidden min-h-0">
      <div className="flex w-full flex-col gap-3 overflow-y-auto px-5 py-4 min-h-0">
      <div className="px-0.5 pb-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-xyne-fg-tertiary">
        Define the agent
      </div>

      {/* Persona & behaviour card */}
      <div className={`rounded-xl border bg-xyne-surface transition-colors ${activeTab === "persona" ? "border-xyne-border-strong" : "border-xyne-border-subtle"}`}>
      <DisclosureHeader
        icon={SlidersIcon}
        label="Persona"
        tech="system prompt"
        subtitle="the voice & rules behind every reply"
        summary={`${prompt.length.toLocaleString()} chars`}
        open={activeTab === "persona"}
        onToggle={() => toggleSection("persona")}
      />

      {/* Persona — the long-form "who this agent is" expression. The
            short identity (name / description) lives in the always-visible
            strip above; this tab holds the full system prompt + AI rewrite
            affordance for shaping voice, persona, and constraints.

            Bypasses the `Section` helper because we need the textarea
            to flex-grow into the column's remaining height ("touches
            the bottom"). Section's outer div has a fixed `flex-col`
            sizing that can't propagate flex-1 to a deep child. */}
      {activeTab === "persona" && (
      <div className="flex flex-col gap-2.5 border-t border-xyne-border-subtle px-4 py-4">

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
          className="min-h-[200px] w-full resize-y rounded-lg border border-xyne-border bg-xyne-surface-sunken px-3 py-2 font-mono text-[12px] leading-relaxed text-xyne-fg-primary placeholder:text-xyne-fg-placeholder focus:border-xyne-border-focus focus:outline-none disabled:opacity-60"
        />
        <span className="shrink-0 text-[11px] text-xyne-fg-tertiary">
          {prompt.length.toLocaleString()} character{prompt.length === 1 ? "" : "s"}
        </span>
        <PromptVersionHistory
          agentSlug={agent.slug}
          activeVersion={agent.activePromptVersion}
          readOnly={!canEdit}
          onActivated={(restored) => onPromptChange(restored)}
        />
      </div>
      )}
      </div>

      {/* Tools card */}
      <div className={`rounded-xl border bg-xyne-surface transition-colors ${activeTab === "toolbox" ? "border-xyne-border-strong" : "border-xyne-border-subtle"}`}>
      <DisclosureHeader
        icon={PlugIcon}
        label="Tools"
        tech="what it can do"
        subtitle="what it's allowed to do"
        notes={["acts on real systems", "credentials live with each integration"]}
        summary={availableTools ? `${toolboxSummary.totalEnabled} of ${toolboxSummary.totalAvailable}` : `${totalTools} on`}
        open={activeTab === "toolbox"}
        onToggle={() => toggleSection("toolbox")}
      />

      {activeTab === "toolbox" && (
       <div className="border-t border-xyne-border-subtle px-4 py-4">
        <ToolboxPicker
          availableTools={availableTools}
          loading={!availableTools}
          value={draftTools}
          onChange={(next) => onDraftToolsChange((prev) => ({ ...prev, ...next, gateway: next.gateway ?? prev.gateway, callableAgents: next.callableAgents ?? prev.callableAgents }))}
          largeHeight="560px"
          showCaption={false}
          suggestContext={{ systemPrompt: prompt, description: agent.description ?? undefined }}
          delegatedAgents={permissions.role === "owner" ? {
            currentAgentSlug: agent.slug,
            currentUserId,
            isOrchestratorTier: agent.delegationTier === "orchestrator",
            agents: allAgents,
            grants: delegationGrants,
            loading: delegationLoading,
            disabled: !permissions.canEdit,
            onAddGrant: onAddDelegationGrant,
            onDeleteGrant: onDeleteDelegationGrant,
            onAddConfigEntry: onAddDelegationConfigEntry,
            onCreateGrantForConfig: onCreateDelegationGrantForConfig,
            onRemoveConfigEntry: onRemoveDelegationConfigEntry,
          } : undefined}
        />
      </div>
      )}
      </div>

      {/* Knowledge card */}
      <div className={`rounded-xl border bg-xyne-surface transition-colors ${activeTab === "knowledge" ? "border-xyne-border-strong" : "border-xyne-border-subtle"}`}>
      <DisclosureHeader
        icon={BookOpenIcon}
        label="Knowledge"
        tech="skills"
        subtitle="reference material it can pull on"
        summary={knowledgeCount > 0 ? `${knowledgeCount} configured` : "None configured"}
        open={activeTab === "knowledge"}
        onToggle={() => toggleSection("knowledge")}
      />

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
      <div className="flex flex-col gap-5 border-t border-xyne-border-subtle px-4 py-4">
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
        <hr className="border-xyne-border-subtle" />

        {/* Knowledge Base — per-agent grants over spaces collections / files.
            Two scoping modes:
              • COLLECTIONS — picker selects an explicit allowlist.
              • USER        — agent inherits the calling user's full spaces KB
                              at runtime; picker is hidden / locked. When
                              User A runs the agent it sees User A's docs;
                              User B sees only User B's. Spaces is the
                              security boundary.
            When the agent has ≥1 grant OR is USER-scoped, four read-only KB
            tools (kb-list-resources, kb-search, kb-list-files, kb-read-file)
            are auto-added to its tool roster. */}
        <Section
          title={
            <span className="inline-flex items-baseline gap-2">
              Knowledge Base
              <span className="text-xyne-fg-tertiary">•</span>
              <span className="font-normal text-xyne-fg-tertiary">collections &amp; files</span>
            </span>
          }
          description="Spaces documents this agent can read at runtime"
          info={{
            title: "Knowledge Base",
            description: "Per-agent access to spaces knowledge base content",
            content: (
              <div className="flex flex-col gap-3">
                <p className="text-[13px] leading-relaxed text-xyne-fg-secondary">
                  <strong>Selected collections &amp; files</strong> — pick whole collections (every file inside is accessible) or expand a collection to grant access to individual files. The agent's scope is fixed: every user who runs it sees the same set.
                </p>
                <p className="text-[13px] leading-relaxed text-xyne-fg-secondary">
                  <strong>Match my access</strong> — the agent inherits the spaces access of whoever is running it. User A sees User A's docs, User B sees only User B's. Use when the agent should follow each operator's permissions automatically.
                </p>
                <p className="text-[13px] leading-relaxed text-xyne-fg-secondary">
                  Read-only tools (search, list, read) are added automatically. The agent can never read anything outside the active scope.
                </p>
              </div>
            ),
          }}
        >
          {/* Scope toggle — two cards, single-select. Hidden tool surface
              behaves the same regardless; the scope decides what the agent
              can SEE inside that surface. */}
          <fieldset
            className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2"
            disabled={!canEdit}
          >
            {([
              {
                value: "COLLECTIONS" as const,
                label: "Selected collections & files",
                hint: "Pick an explicit allowlist. Same scope for every user who runs the agent.",
              },
              {
                value: "USER" as const,
                label: "Match my access",
                hint: "Agent inherits whatever the running user can already see in spaces.",
              },
            ]).map((opt) => {
              const selected = draftKbScope === opt.value;
              return (
                <label
                  key={opt.value}
                  className={`flex cursor-pointer flex-col gap-1 rounded-lg border px-3 py-2 transition-colors ${
                    selected
                      ? "border-xyne-accent bg-xyne-accent/5"
                      : "border-xyne-border-subtle hover:border-xyne-border"
                  } ${canEdit ? "" : "cursor-not-allowed opacity-60"}`}
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="kb-scope"
                      value={opt.value}
                      checked={selected}
                      onChange={() => canEdit && onDraftKbScopeChange(opt.value)}
                      className="h-3.5 w-3.5"
                    />
                    <span className="text-[13px] font-medium text-xyne-fg-primary">{opt.label}</span>
                  </span>
                  <span className="pl-[22px] text-[11px] leading-snug text-xyne-fg-tertiary">{opt.hint}</span>
                </label>
              );
            })}
          </fieldset>

          {draftKbScope === "USER" ? (
            <div className="rounded-lg border border-xyne-border-subtle bg-xyne-surface-muted px-3 py-3">
              <p className="text-[12px] leading-relaxed text-xyne-fg-secondary">
                This agent is scoped at the user level — its Knowledge Base reach is whatever the running user can already see in spaces. No per-collection picker; each session is gated by that user's own permissions.
              </p>
            </div>
          ) : (
            <>
              <KnowledgeBasePicker
                value={draftKbResources}
                onChange={(next) => canEdit && onDraftKbResourcesChange(next)}
              />
              <p className="mt-2 text-[11px] text-xyne-fg-tertiary">
                {draftKbResources.length === 0
                  ? "No KB grants — the agent will not be able to read documents."
                  : `${draftKbResources.length} grant${draftKbResources.length === 1 ? "" : "s"} attached`}
              </p>
            </>
          )}
        </Section>

        {/* ── section divider ────────────────────────────────────── */}
        {canEdit && (
          <hr className="border-xyne-border-subtle" />
        )}

        {/* Contextual Responses — the single home for ALL skill triggers,
              both subagent-level (toolName = bare subagent name; inner tool
              left as "Any tool") and tool-level (toolName = "subagent:tool").
              Subagent-level triggers used to live in Toolbox → Subagents; now
              that the Toolbox uses the shared ToolboxPicker (selection only),
              they're managed here so the capability is preserved in one place.
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
            description="When a subagent — or one of its tools — finishes, inject a skill into its result"
            action={
              <button
                onClick={() =>
                  onSkillTriggersChange([
                    ...skillTriggers,
                    // Blank toolName — the user then picks a subagent (and,
                    // optionally, a specific inner tool) in the card below.
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
            {/* Show every trigger — subagent-level (bare name) and tool-level
                (name:tool) are both edited from this one place. */}
            {skillTriggers.length > 0 ? (
              <div className="flex flex-col gap-2.5">
                {skillTriggers.map((trigger, idx) => {
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
                  Add one to inject a skill after a subagent — or a specific tool — finishes.
                </span>
              </div>
            )}
          </Section>
        )}
      </div>
      )}
      </div>

      {/* Behaviour card */}
      <div className={`rounded-xl border bg-xyne-surface transition-colors ${activeTab === "behavior" ? "border-xyne-border-strong" : "border-xyne-border-subtle"}`}>
      <DisclosureHeader
        icon={GearSixIcon}
        label="Behaviour"
        tech="rules & autonomy"
        subtitle="extra rules applied on every turn"
        summary={behaviorCount > 0 || draftSuggestGoal || draftPrefetchContext || draftAutoGoal || draftPlanMode || !draftPostTodos || draftMaxDelegations !== MAX_DELEGATIONS_PER_RUN_BOUNDS.DEFAULT ? "Customised" : "Defaults"}
        open={activeTab === "behavior"}
        onToggle={() => toggleSection("behavior")}
      />

      {activeTab === "behavior" && (
      <div className="flex flex-col gap-5 border-t border-xyne-border-subtle px-4 py-4">

      {/* Behavior — Constant Reminders (per-turn promptInjection appended
            as a [System Reminder]). Contextual Responses / skill triggers
            were relocated to the Knowledge tab to keep skills-related UI
            together (see the Knowledge block above). */}
      {canEdit && (
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

      {/* Sandbox repository — pins which REPO_CONFIGS setup the sandbox uses, so
          the runtime forces sandbox-repo-setup onto this repo (deterministic). */}
      {(canEdit || draftSandboxRepo) && (
        <div className="rounded-xl border border-xyne-border bg-xyne-surface p-4">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-tertiary">Sandbox repository</div>
          <p className="mb-2 text-[12px] leading-relaxed text-xyne-fg-secondary">
            Pin this agent to a sandbox setup. When set, the runtime forces <code className="text-xyne-fg-tertiary">sandbox-repo-setup</code> onto this repo — the agent can&apos;t pick the wrong one. &quot;None&quot; lets the agent choose.
          </p>
          <select
            value={draftSandboxRepo}
            onChange={(e) => onDraftSandboxRepoChange(e.target.value)}
            disabled={!canEdit}
            className="min-w-0 w-full rounded-lg border border-xyne-border bg-xyne-surface-sunken px-3 py-2 text-[12px] text-xyne-fg-primary focus:border-xyne-border-focus focus:outline-none disabled:opacity-60"
          >
            <option value="">None (agent chooses)</option>
            {sandboxRepoOptions.map((r) => (
              <option key={r.key} value={r.key}>{r.name} ({r.key})</option>
            ))}
          </select>
        </div>
      )}

      {/* Read-only multi-repo sandbox (reviewer agents). Routes EVERY run to the
          shared sbx-git sandbox: grep across all cloned repos read-only, no
          per-project clone, mutating sandbox tools (run/build/write) stripped.
          Off by default. Show when canEdit OR already on. */}
      {(canEdit || draftForceReadOnlySandbox) && (
        <div className="rounded-xl border border-xyne-border bg-xyne-surface p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-tertiary">Read-only multi-repo sandbox</div>
              <p className="text-[12px] leading-relaxed text-xyne-fg-secondary">
                Route every run to the shared <code className="text-xyne-fg-tertiary">sbx-git</code> sandbox — the agent greps across all cloned repos read-only, with no per-project clone or snapshot. Mutating sandbox tools (run/build/write) are stripped.
                {" "}
                <span className="text-xyne-fg-tertiary">Best for code-review agents that only read code.</span>
              </p>
            </div>
            <label className="flex shrink-0 items-center gap-2 select-none">
              <input
                type="checkbox"
                checked={draftForceReadOnlySandbox}
                onChange={(e) => onDraftForceReadOnlySandboxChange(e.target.checked)}
                disabled={!canEdit}
                className="h-4 w-4 cursor-pointer accent-xyne-accent disabled:cursor-not-allowed disabled:opacity-60"
                aria-label="Enable read-only multi-repo sandbox"
              />
              <span className="text-[12px] text-xyne-fg-primary">{draftForceReadOnlySandbox ? "On" : "Off"}</span>
            </label>
          </div>

          {/* Repo context — advisory scope surfaced to the agent. Empty = all repos. */}
          {draftForceReadOnlySandbox && (
            <div className="mt-3 border-t border-xyne-border pt-3">
              <div className="mb-1 flex items-center justify-between">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-tertiary">Repo context</div>
                <span className="text-[11px] text-xyne-fg-tertiary">
                  {draftSbxGitRepos.length > 0 ? `${draftSbxGitRepos.length} selected` : "all repos"}
                </span>
              </div>
              <p className="mb-2 text-[12px] leading-relaxed text-xyne-fg-secondary">
                Focus this reviewer on specific repos — the selection is surfaced to the agent as its scope. Leave empty to use all {sbxGitRepoOptions.length}. Advisory: every repo stays on disk in the shared sandbox.
              </p>
              <div className="max-h-48 overflow-y-auto rounded-lg border border-xyne-border bg-xyne-surface-sunken p-2">
                {sbxGitRepoOptions.map((r) => {
                  const checked = draftSbxGitRepos.includes(r.key);
                  return (
                    <label key={r.key} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-[12px] text-xyne-fg-primary hover:bg-xyne-surface">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!canEdit}
                        onChange={(e) => {
                          if (e.target.checked) onDraftSbxGitReposChange([...draftSbxGitRepos, r.key]);
                          else onDraftSbxGitReposChange(draftSbxGitRepos.filter((k) => k !== r.key));
                        }}
                        className="h-3.5 w-3.5 cursor-pointer accent-xyne-accent disabled:opacity-60"
                      />
                      <span className="truncate">{r.key}</span>
                    </label>
                  );
                })}
              </div>
              {canEdit && draftSbxGitRepos.length > 0 && (
                <button
                  type="button"
                  onClick={() => onDraftSbxGitReposChange([])}
                  className="mt-2 text-[11px] text-xyne-fg-tertiary underline hover:text-xyne-fg-primary"
                >
                  Clear selection (use all repos)
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Research Agent context — used by query-codebase and review-pull-request. */}
      {(canEdit || draftResearchAgentProductId || draftResearchAgentRepositoryId) && (
        <div className="rounded-xl border border-xyne-border bg-xyne-surface p-4">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-tertiary">Research Agent context</div>
          <p className="mb-3 text-[12px] leading-relaxed text-xyne-fg-secondary">
            Pick the product or repository used by <code className="text-xyne-fg-tertiary">query-codebase</code> and <code className="text-xyne-fg-tertiary">review-pull-request</code>. Product wins when both are set.
          </p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="min-w-0">
              <div className="mb-1 text-[11px] font-medium text-xyne-fg-tertiary">Product</div>
              <Dropdown
                value={draftResearchAgentProductId}
                options={researchAgentProductOptions.map((p) => ({ value: p.id, label: `${p.name} (${p.id})` }))}
                placeholder="None"
                onChange={onDraftResearchAgentProductIdChange}
                disabled={!canEdit}
              />
            </label>
            <label className="min-w-0">
              <div className="mb-1 text-[11px] font-medium text-xyne-fg-tertiary">Repository</div>
              <Dropdown
                value={draftResearchAgentRepositoryId}
                options={researchAgentRepositoryOptions.map((r) => ({ value: r.id, label: `${r.name} (${r.id})` }))}
                placeholder="None"
                onChange={onDraftResearchAgentRepositoryIdChange}
                disabled={!canEdit}
              />
            </label>
          </div>
        </div>
      )}

      {/* Suggest Goals — opt-in switch. When on, xyne-claw injects the
          `suggest-goal` tool and a /goal-awareness primer into the agent's
          context. At the end of a planning turn the agent can call the tool;
          the user then sees a one-click "▶ Run autonomously as /goal" button
          in the Spaces thread. Off by default (no behaviour change for
          existing agents). Display when canEdit OR when already on, so
          read-only viewers see the current setting on agents that have it
          enabled. */}
      {/* Prefetch context — opt-IN switch (agent.config.prefetchContext). Before
          the first model turn, a cheap model extracts the names the question
          mentions and the platform resolves each one against channels,
          projects and people in parallel, then attaches the ids to the prompt.
          Measured motivation: runs were spending whole turns (15-25s each)
          re-deriving a user id already in the request payload and mapping
          channel/project names to ids. Off by default. */}
      {(canEdit || draftPrefetchContext) && (
        <div className="rounded-xl border border-xyne-border bg-xyne-surface p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-tertiary">Prefetch Context</div>
              <p className="text-[12px] leading-relaxed text-xyne-fg-secondary">
                Resolve the channels, projects and people a question names before the agent&apos;s first turn, and hand it the ids up front.
                {" "}
                <span className="text-xyne-fg-tertiary">Best for search and reporting agents that otherwise burn turns looking up ids. Results are attached as a hint the agent still verifies.</span>
              </p>
            </div>
            <label className="flex shrink-0 items-center gap-2 select-none">
              <input
                type="checkbox"
                checked={draftPrefetchContext}
                onChange={(e) => onDraftPrefetchContextChange(e.target.checked)}
                disabled={!canEdit}
                className="h-4 w-4 cursor-pointer accent-xyne-accent disabled:cursor-not-allowed disabled:opacity-60"
                aria-label="Enable Prefetch Context"
              />
              <span className="text-[12px] text-xyne-fg-primary">{draftPrefetchContext ? "On" : "Off"}</span>
            </label>
          </div>
        </div>
      )}

      {/* Plan tracking — opt-OUT switch (agent.config.planTracking). Default ON.
          Distinct from "Post TODOs", which only hides the rendered card: this
          removes the todo-write/todo-read tools AND the primer that requires
          them. Worth turning off for agents that answer in one message —
          `todo-write` ends the assistant turn like any tool call, and the primer
          mandates a todo-only turn at BOTH ends of a run (before the first tool
          call, and again immediately before the final answer). On a slow model
          that measured ~50% of wall-clock on ask-ai runs, for zero data. */}
      {(canEdit || !draftPlanTracking) && (
        <div className="rounded-xl border border-xyne-border bg-xyne-surface p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-tertiary">Plan Tracking</div>
              <p className="text-[12px] leading-relaxed text-xyne-fg-secondary">
                Give this agent the <code className="text-xyne-fg-tertiary">todo-write</code> checklist tools and require a plan before it starts work.
                {" "}
                <span className="text-xyne-fg-tertiary">On by default. Turn it off for agents that answer in a single message &mdash; each plan update costs a full model round trip, and the checklist card adds little when there is nothing to track.</span>
              </p>
            </div>
            <label className="flex shrink-0 items-center gap-2 select-none">
              <input
                type="checkbox"
                checked={draftPlanTracking}
                onChange={(e) => onDraftPlanTrackingChange(e.target.checked)}
                disabled={!canEdit}
                className="h-4 w-4 cursor-pointer accent-xyne-accent disabled:cursor-not-allowed disabled:opacity-60"
                aria-label="Enable Plan Tracking"
              />
              <span className="text-[12px] text-xyne-fg-primary">{draftPlanTracking ? "On" : "Off"}</span>
            </label>
          </div>
        </div>
      )}
      {/* Delegation budget — per-run cap on child-agent delegations
          (agent.config.maxDelegationsPerRun). Each delegation is a full nested
          agent run, so the cap is a cost / blast-radius guard. Raise it for
          orchestrators that fan out (analyzer -> N generators -> code-writer);
          leave at the default (3) for simple agents. The runtime re-clamps to
          [1,25], so this control can never widen the real bound. */}
      <div className="rounded-xl border border-xyne-border bg-xyne-surface p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-tertiary">Delegation Budget</div>
            <p className="text-[12px] leading-relaxed text-xyne-fg-secondary">
              Maximum child-agent delegations this agent may make in a single run. Each delegation is a full nested agent run.
              {" "}
              <span className="text-xyne-fg-tertiary">Raise it for orchestrators that fan out to several sub-agents in one run; keep the default ({MAX_DELEGATIONS_PER_RUN_BOUNDS.DEFAULT}) for simple agents. The runtime clamps to [{MAX_DELEGATIONS_PER_RUN_BOUNDS.MIN}, {MAX_DELEGATIONS_PER_RUN_BOUNDS.MAX}].</span>
            </p>
          </div>
          <label className="flex shrink-0 items-center gap-2 select-none">
            <select
              value={draftMaxDelegations}
              onChange={(e) => onDraftMaxDelegationsChange(Number(e.target.value))}
              disabled={!canEdit}
              className="rounded-md border border-xyne-border bg-xyne-surface px-2 py-1 text-[12px] text-xyne-fg-primary disabled:cursor-not-allowed disabled:opacity-60"
              aria-label="Delegation budget (max delegations per run)"
            >
              {MAX_DELEGATIONS_PER_RUN_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                  {n === MAX_DELEGATIONS_PER_RUN_BOUNDS.DEFAULT ? " (default)" : ""}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {(canEdit || draftSuggestGoal) && (
        <div className="rounded-xl border border-xyne-border bg-xyne-surface p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-tertiary">Suggest Goals</div>
              <p className="text-[12px] leading-relaxed text-xyne-fg-secondary">
                Let this agent propose autonomous <code className="text-xyne-fg-tertiary">/goal</code> loops. At the end of a multi-turn plan, the user sees a one-click button to run the work to completion (turn cap + judge enforced).
                {" "}
                <span className="text-xyne-fg-tertiary">Best for agents that handle long-horizon tasks (audits, sweeps, multi-PR reviews).</span>
              </p>
            </div>
            {/* Checkbox styled as a switch — matches the visual weight of the
                sandbox repository dropdown card above. */}
            <label className="flex shrink-0 items-center gap-2 select-none">
              <input
                type="checkbox"
                checked={draftSuggestGoal}
                onChange={(e) => onDraftSuggestGoalChange(e.target.checked)}
                disabled={!canEdit}
                className="h-4 w-4 cursor-pointer accent-xyne-accent disabled:cursor-not-allowed disabled:opacity-60"
                aria-label="Enable Suggest Goals"
              />
              <span className="text-[12px] text-xyne-fg-primary">{draftSuggestGoal ? "On" : "Off"}</span>
            </label>
          </div>
        </div>
      )}

      {/* Post TODOs to Spaces — opt-OUT switch (agent.config.postTodos). The
          todo-write tool renders a live, in-place checklist card in the thread
          by default. Turning this OFF suppresses that card (claw-auth's
          doRenderPlanCard early-returns) — the agent keeps tracking TODOs
          internally, only the Spaces render is hidden. On by default; surface
          when canEdit OR when already OFF so read-only viewers see the state. */}
      {(canEdit || !draftPostTodos) && (
        <div className="rounded-xl border border-xyne-border bg-xyne-surface p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-tertiary">Post TODOs to Spaces</div>
              <p className="text-[12px] leading-relaxed text-xyne-fg-secondary">
                Show this agent&apos;s TODO checklist as a live, in-place-updating card in the thread while it works.
                {" "}
                <span className="text-xyne-fg-tertiary">Turn off for agents where the plan is noise (advice-only or single-shot agents). The agent still tracks its TODOs internally — only the card is hidden.</span>
              </p>
            </div>
            <label className="flex shrink-0 items-center gap-2 select-none">
              <input
                type="checkbox"
                checked={draftPostTodos}
                onChange={(e) => onDraftPostTodosChange(e.target.checked)}
                disabled={!canEdit}
                className="h-4 w-4 cursor-pointer accent-xyne-accent disabled:cursor-not-allowed disabled:opacity-60"
                aria-label="Post TODOs to Spaces"
              />
              <span className="text-[12px] text-xyne-fg-primary">{draftPostTodos ? "On" : "Off"}</span>
            </label>
          </div>
        </div>
      )}

      {/* Always Goal — every user message becomes `/goal <text>` automatically.
          Stronger than Suggest Goals: there's no choice surface, every reply
          this agent gets is run as an autonomous loop. The user can still send
          `/stop` or `/goal status` to control — those start with `/` and bypass
          the wrap. Off by default; turning this on for a chat-style agent
          would be a UX regression, so the help copy spells out the implications. */}
      {(canEdit || draftAutoGoal) && (
        <div className="rounded-xl border border-xyne-border bg-xyne-surface p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-tertiary">Always Goal</div>
              <p className="text-[12px] leading-relaxed text-xyne-fg-secondary">
                Run every message as a <code className="text-xyne-fg-tertiary">/goal</code> loop automatically. Each user reply becomes an autonomous turn budget — the agent works until the judge says done or the turn cap hits.
                {" "}
                <span className="text-xyne-fg-tertiary">Use only when the agent is purpose-built for autonomous execution (PR sweeps, scheduled audits). Users can still type <code className="text-xyne-fg-tertiary">/stop</code> to cancel mid-loop.</span>
              </p>
            </div>
            <label className="flex shrink-0 items-center gap-2 select-none">
              <input
                type="checkbox"
                checked={draftAutoGoal}
                onChange={(e) => onDraftAutoGoalChange(e.target.checked)}
                disabled={!canEdit}
                className="h-4 w-4 cursor-pointer accent-xyne-accent disabled:cursor-not-allowed disabled:opacity-60"
                aria-label="Enable Always Goal"
              />
              <span className="text-[12px] text-xyne-fg-primary">{draftAutoGoal ? "On" : "Off"}</span>
            </label>
          </div>
        </div>
      )}

      {/* Plan mode opt-in (agent.config.planMode). When on, a non-twin thread
          mention or DM that needs multi-step work makes the agent PROPOSE a plan
          (read-only) and STOP for the user's approval; on approve it executes.
          Trivial asks skip the approval prompt. Off = act immediately (today's
          behavior). Show when canEdit OR already on. */}
      {(canEdit || draftPlanMode) && (
        <div className="rounded-xl border border-xyne-border bg-xyne-surface p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-tertiary">Plan Mode</div>
              <p className="text-[12px] leading-relaxed text-xyne-fg-secondary">
                For multi-step requests in threads and DMs, the agent proposes a plan and waits for approval before doing the work — you pick which steps to keep, then it runs.
                {" "}
                <span className="text-xyne-fg-tertiary">Trivial one-step asks run without a prompt. Off = act immediately (default). Twin (@user) flows are never affected.</span>
              </p>
            </div>
            <label className="flex shrink-0 items-center gap-2 select-none">
              <input
                type="checkbox"
                checked={draftPlanMode}
                onChange={(e) => onDraftPlanModeChange(e.target.checked)}
                disabled={!canEdit}
                className="h-4 w-4 cursor-pointer accent-xyne-accent disabled:cursor-not-allowed disabled:opacity-60"
                aria-label="Enable Plan Mode"
              />
              <span className="text-[12px] text-xyne-fg-primary">{draftPlanMode ? "On" : "Off"}</span>
            </label>
          </div>
          {/* Editable plan-mode primer (agent.config.planModePrompt) — how the agent
              scopes a plan. Only shown/saved when plan mode is on; a value equal to
              the default is not persisted. Guidance ONLY — the propose→approve gate
              and propose-plan contract are enforced by the tool palette, not this text. */}
          {draftPlanMode && (
            <div className="mt-3 border-t border-xyne-border-subtle pt-3">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-tertiary">
                Plan-mode prompt <span className="font-normal normal-case text-xyne-fg-tertiary">(optional)</span>
              </div>
              <p className="mb-2 text-[12px] leading-relaxed text-xyne-fg-secondary">
                System prompt the agent follows while it scopes a plan — pre-filled with the default; edit only if you need custom guidance on HOW it plans. The propose-then-approve gate and the propose-plan contract are always enforced regardless of this text.
              </p>
              <textarea
                value={draftPlanModePrompt}
                onChange={(e) => onDraftPlanModePromptChange(e.target.value)}
                disabled={!canEdit}
                rows={10}
                className="w-full resize-y rounded-md border border-xyne-border-subtle bg-xyne-surface px-2.5 py-2 font-mono text-[12px] leading-relaxed text-xyne-fg-primary placeholder:text-xyne-fg-muted focus:border-xyne-border focus:outline-none disabled:opacity-60"
              />
            </div>
          )}
        </div>
      )}

      {/* Verify Responses opt-in (agent.config.verifyResponses). The agent
          delivers its final answer via the submit-response tool, which checks
          the draft's factual claims (counts, dates, IDs) against the tool
          evidence gathered this run before posting — a wrong claim is sent
          back for correction. Adds one LLM call per response (more on a
          rejection). Best for agents that report data; not for casual chat.
          Off by default. Show when canEdit OR already on. */}
      {activeTab === "behavior" && (canEdit || draftVerifyResponses) && (
        <div className="rounded-xl border border-xyne-border bg-xyne-surface p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-tertiary">Verify Responses</div>
              <p className="text-[12px] leading-relaxed text-xyne-fg-secondary">
                Before the final answer is sent, check its factual claims (counts, dates, IDs, totals) against the tool results the agent gathered. A contradicted claim is sent back for correction.
                {" "}
                <span className="text-xyne-fg-tertiary">Adds one LLM call per response (more on a rejection). Best for agents that report data; skip for casual chat.</span>
              </p>
            </div>
            <label className="flex shrink-0 items-center gap-2 select-none">
              <input
                type="checkbox"
                checked={draftVerifyResponses}
                onChange={(e) => onDraftVerifyResponsesChange(e.target.checked)}
                disabled={!canEdit}
                className="h-4 w-4 cursor-pointer accent-xyne-accent disabled:cursor-not-allowed disabled:opacity-60"
                aria-label="Enable Verify Responses"
              />
              <span className="text-[12px] text-xyne-fg-primary">{draftVerifyResponses ? "On" : "Off"}</span>
            </label>
          </div>
          {/* Per-agent delivery criteria — stacked on top of the default factual
              check. Inverted rule: a stated requirement with no supporting
              evidence is a FAILURE (e.g. "must post a POT video before claiming
              done"). Only shown/saved when verification is on. */}
          {draftVerifyResponses && (
            <div className="mt-3 border-t border-xyne-border-subtle pt-3">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-tertiary">
                Delivery criteria <span className="font-normal normal-case text-xyne-fg-tertiary">(optional)</span>
              </div>
              <p className="mb-2 text-[12px] leading-relaxed text-xyne-fg-secondary">
                Extra requirements the response MUST meet before it&apos;s delivered — checked against the run&apos;s evidence. Unlike the factual check above, a requirement with no proof is rejected. One per line.
              </p>
              <textarea
                value={draftVerifyResponseCriteria}
                onChange={(e) => onDraftVerifyResponseCriteriaChange(e.target.value)}
                disabled={!canEdit}
                rows={4}
                placeholder={"e.g.\n- Must post a Proof-of-Testing video to the thread before claiming the fix is done.\n- Must include a PR link when it says a PR was opened."}
                className="w-full resize-y rounded-md border border-xyne-border-subtle bg-xyne-surface px-2.5 py-2 text-[12px] leading-relaxed text-xyne-fg-primary placeholder:text-xyne-fg-muted focus:border-xyne-border focus:outline-none disabled:opacity-60"
              />
            </div>
          )}
        </div>
      )}

      {/* Citation reflection opt-in (agent.config.citationReflection). After the
          agent answers, if it drew on citeable sources (search / KB / subagents
          that emit [clf-…] tokens) but cited none, the runtime nudges it once to
          rewrite with verbatim inline citations. Cheap (regex + ≤1 re-prompt, no
          extra LLM judge call). Off by default. Show when canEdit OR already on. */}
      {activeTab === "behavior" && (canEdit || draftCitationReflection) && (
        <div className="rounded-xl border border-xyne-border bg-xyne-surface p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-tertiary">Enforce Citations</div>
              <p className="text-[12px] leading-relaxed text-xyne-fg-secondary">
                After the answer is written, if the agent used citeable sources but cited none, nudge it once to rewrite with verbatim inline citations.
                {" "}
                <span className="text-xyne-fg-tertiary">Cheap — a token check plus at most one re-prompt; no extra LLM call. Best for agents that answer from retrieved data.</span>
              </p>
            </div>
            <label className="flex shrink-0 items-center gap-2 select-none">
              <input
                type="checkbox"
                checked={draftCitationReflection}
                onChange={(e) => onDraftCitationReflectionChange(e.target.checked)}
                disabled={!canEdit}
                className="h-4 w-4 cursor-pointer accent-xyne-accent disabled:cursor-not-allowed disabled:opacity-60"
                aria-label="Enable Enforce Citations"
              />
              <span className="text-[12px] text-xyne-fg-primary">{draftCitationReflection ? "On" : "Off"}</span>
            </label>
          </div>
        </div>
      )}

      {/* Auto-cite all tools (agent.config.autoToolCitations). Chunks EVERY tool
          result that doesn't already self-cite and injects [clf-…] tokens so the
          model can cite any output — every MCP, sandbox, and built-in tool. Tools
          that emit their own citations are untouched. Off by default. */}
      {activeTab === "behavior" && (canEdit || draftAutoToolCitations) && (
        <div className="rounded-xl border border-xyne-border bg-xyne-surface p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-tertiary">Auto-cite All Tools</div>
              <p className="text-[12px] leading-relaxed text-xyne-fg-secondary">
                Chunk every tool result and inject inline citation tokens so the agent can cite any tool's output — every MCP, sandbox, and built-in tool.
                {" "}
                <span className="text-xyne-fg-tertiary">Tools that already emit their own citations are left untouched. Built-in file/shell output gets cited too.</span>
              </p>
            </div>
            <label className="flex shrink-0 items-center gap-2 select-none">
              <input
                type="checkbox"
                checked={draftAutoToolCitations}
                onChange={(e) => onDraftAutoToolCitationsChange(e.target.checked)}
                disabled={!canEdit}
                className="h-4 w-4 cursor-pointer accent-xyne-accent disabled:cursor-not-allowed disabled:opacity-60"
                aria-label="Enable Auto-cite All Tools"
              />
              <span className="text-[12px] text-xyne-fg-primary">{draftAutoToolCitations ? "On" : "Off"}</span>
            </label>
          </div>
        </div>
      )}

      {/* Structured JSON output (agent.config.outputFormat). When on, xyne-claw
          injects a `submit-result` tool whose input schema is the schema below
          and requires the agent to deliver its final answer through it — the
          agent still uses tools/reasoning normally, only the final answer is
          constrained. Best for trigger/workflow/scheduled runs consumed by a
          machine; in chat threads the reply is raw JSON. Off by default. */}
      {activeTab === "behavior" && (canEdit || draftOutputFormatEnabled) && (
        <div className="rounded-xl border border-xyne-border bg-xyne-surface p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-tertiary">Structured Output</div>
              <p className="text-[12px] leading-relaxed text-xyne-fg-secondary">
                Force the agent to deliver its final answer through a fixed format. The agent works normally (tools, reasoning); only the final answer is constrained.
                {" "}
                <span className="text-xyne-fg-tertiary">JSON suits machine consumers (workflows/triggers); Markdown renders natively in Spaces threads.</span>
              </p>
            </div>
            <label className="flex shrink-0 items-center gap-2 select-none">
              <input
                type="checkbox"
                checked={draftOutputFormatEnabled}
                onChange={(e) => onDraftOutputFormatEnabledChange(e.target.checked)}
                disabled={!canEdit}
                className="h-4 w-4 cursor-pointer accent-xyne-accent disabled:cursor-not-allowed disabled:opacity-60"
                aria-label="Enable Structured Output"
              />
              <span className="text-[12px] text-xyne-fg-primary">{draftOutputFormatEnabled ? "On" : "Off"}</span>
            </label>
          </div>

          {draftOutputFormatEnabled && (
            <div className="mt-3 space-y-3">
              {/* Format type toggle */}
              <div>
                <label className="mb-1.5 block text-[11px] font-medium text-xyne-fg-secondary">Format</label>
                <div className="inline-flex rounded-lg border border-xyne-border bg-xyne-surface-subtle p-0.5">
                  {(["json", "markdown"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      disabled={!canEdit}
                      onClick={() => onDraftOutputTypeChange(t)}
                      className={`px-3 py-1 text-[12px] font-medium rounded-md transition-colors disabled:cursor-not-allowed ${
                        draftOutputType === t
                          ? "bg-xyne-surface text-xyne-fg-primary shadow-[0_1px_2px_rgba(16,24,40,0.08)]"
                          : "text-xyne-fg-tertiary hover:text-xyne-fg-secondary"
                      }`}
                    >
                      {t === "json" ? "JSON" : "Markdown"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Describe-in-plain-text → generate schema+template helper.
                  Mirrors the "generate prompt" affordance: the user writes the
                  shape they want in words; an LLM produces the contract and
                  fills the fields below for review. */}
              {canEdit && (
                <div className="rounded-lg border border-dashed border-xyne-border bg-xyne-surface-subtle p-3">
                  <label className="mb-1.5 block text-[11px] font-medium text-xyne-fg-secondary">
                    Describe the output you want
                  </label>
                  <textarea
                    value={outputGenInput}
                    onChange={(e) => setOutputGenInput(e.target.value)}
                    disabled={outputGenLoading}
                    rows={2}
                    placeholder={draftOutputType === "json"
                      ? "e.g. A daily report: 5 KPIs each with a value and trend arrow, plus a 2-line summary"
                      : "e.g. A short answer with a Summary heading, a bulleted Findings list, then Next steps"}
                    className="w-full resize-y rounded-lg border border-xyne-border bg-xyne-surface px-3 py-2 text-[12px] text-xyne-fg-primary placeholder-xyne-fg-muted focus:border-xyne-border-focus focus:outline-none focus:shadow-[var(--comp-focus-ring)] disabled:opacity-60"
                  />
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void runOutputGenerate()}
                      disabled={outputGenLoading || !outputGenInput.trim()}
                      className="inline-flex items-center gap-1.5 rounded-md bg-xyne-fg-primary px-3 py-1.5 text-[12px] font-medium text-xyne-fg-inverse transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {outputGenLoading
                        ? "Generating…"
                        : (draftOutputSchema.trim() || draftOutputTemplate.trim()) ? "Regenerate from description" : "Generate"}
                    </button>
                    <span className="text-[11px] text-xyne-fg-tertiary">Fills the fields below — review before saving.</span>
                  </div>
                  {outputGenNotes && (
                    <p className="mt-2 text-[11px] text-xyne-fg-secondary whitespace-pre-line">{outputGenNotes}</p>
                  )}
                  {outputGenWarnings.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {outputGenWarnings.map((w, i) => (
                        <li key={i} className="text-[11px] text-amber-600 flex items-start gap-1">
                          <span aria-hidden>⚠</span><span>{w}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {/* JSON: schema (required) + optional markdown render template */}
              {draftOutputType === "json" && (
                <>
                  <div>
                    <label className="mb-1.5 block text-[11px] font-medium text-xyne-fg-secondary">JSON Schema</label>
                    <textarea
                      value={draftOutputSchema}
                      onChange={(e) => onDraftOutputSchemaChange(e.target.value)}
                      disabled={!canEdit}
                      rows={9}
                      spellCheck={false}
                      placeholder={'{\n  "type": "object",\n  "properties": {\n    "summary": { "type": "string" },\n    "severity": { "type": "string", "enum": ["low", "medium", "high"] }\n  },\n  "required": ["summary", "severity"]\n}'}
                      className="w-full resize-y rounded-lg border border-xyne-border bg-xyne-surface px-3 py-2.5 font-mono text-[12px] leading-relaxed text-xyne-fg-primary placeholder-xyne-fg-muted focus:border-xyne-border-focus focus:outline-none focus:shadow-[var(--comp-focus-ring)] disabled:opacity-60"
                    />
                    <p className="mt-1 text-[11px] text-xyne-fg-tertiary">
                      Top-level <code className="text-xyne-fg-tertiary">type</code> is usually <code className="text-xyne-fg-tertiary">"object"</code>. Validated on save.
                    </p>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[11px] font-medium text-xyne-fg-secondary">
                      Markdown render template <span className="font-normal text-xyne-fg-tertiary">(optional)</span>
                    </label>
                    <textarea
                      value={draftOutputTemplate}
                      onChange={(e) => onDraftOutputTemplateChange(e.target.value)}
                      disabled={!canEdit}
                      rows={6}
                      spellCheck={false}
                      placeholder={'## {{summary}}\n\n**Severity:** {{severity}}\n\n{{#each findings}}\n- {{title}}: {{detail}}\n{{/each}}'}
                      className="w-full resize-y rounded-lg border border-xyne-border bg-xyne-surface px-3 py-2.5 font-mono text-[12px] leading-relaxed text-xyne-fg-primary placeholder-xyne-fg-muted focus:border-xyne-border-focus focus:outline-none focus:shadow-[var(--comp-focus-ring)] disabled:opacity-60"
                    />
                    <p className="mt-1 text-[11px] text-xyne-fg-tertiary">
                      If set, the chat reply is this template rendered from the JSON ({"{{field}}"}, {"{{#each list}}…{{/each}}"}). Workflow/trigger consumers still get the raw JSON. Leave blank to show raw JSON in chat.
                    </p>
                  </div>
                </>
              )}

              {/* Markdown: optional structural outline */}
              {draftOutputType === "markdown" && (
                <div>
                  <label className="mb-1.5 block text-[11px] font-medium text-xyne-fg-secondary">
                    Outline <span className="font-normal text-xyne-fg-tertiary">(optional)</span>
                  </label>
                  <textarea
                    value={draftOutputTemplate}
                    onChange={(e) => onDraftOutputTemplateChange(e.target.value)}
                    disabled={!canEdit}
                    rows={8}
                    spellCheck={false}
                    placeholder={'## Summary\n<one-line summary>\n\n## Findings\n<bulleted list>\n\n## Next steps\n<numbered list>'}
                    className="w-full resize-y rounded-lg border border-xyne-border bg-xyne-surface px-3 py-2.5 font-mono text-[12px] leading-relaxed text-xyne-fg-primary placeholder-xyne-fg-muted focus:border-xyne-border-focus focus:outline-none focus:shadow-[var(--comp-focus-ring)] disabled:opacity-60"
                  />
                  <p className="mt-1 text-[11px] text-xyne-fg-tertiary">
                    The agent writes its final answer as Markdown (Spaces renders it). This outline shapes the structure — leave blank to let the agent decide.
                  </p>
                </div>
              )}

              {/* Process guard — required tools before submit. Applies to both
                  json and markdown modes. Stops the agent short-circuiting a
                  multi-step pipeline by submitting an empty/placeholder result
                  without first running its data-gathering tools. */}
              <div>
                <label className="mb-1.5 block text-[11px] font-medium text-xyne-fg-secondary">
                  Required tools before submit <span className="font-normal text-xyne-fg-tertiary">(optional)</span>
                </label>
                <input
                  type="text"
                  value={draftOutputRequireTools}
                  onChange={(e) => onDraftOutputRequireToolsChange(e.target.value)}
                  disabled={!canEdit}
                  spellCheck={false}
                  placeholder={'user-tickets, sandbox-run'}
                  className="w-full rounded-lg border border-xyne-border bg-xyne-surface px-3 py-2.5 font-mono text-[12px] leading-relaxed text-xyne-fg-primary placeholder-xyne-fg-muted focus:border-xyne-border-focus focus:outline-none focus:shadow-[var(--comp-focus-ring)] disabled:opacity-60"
                />
                <p className="mt-1 text-[11px] text-xyne-fg-tertiary">
                  Comma- or newline-separated tool-name fragments that MUST run before the agent can deliver. The agent is blocked from submitting an empty or placeholder result until each has been called (matched as a case-insensitive substring, so <code>sandbox-run</code> matches the sandbox tool). Leave blank for no guard.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      </div>
      )}
      </div>

      {/* Delete moved to the page header (owner-only Trash button there) so
          it's reachable without scrolling to the bottom of the config. */}
      </div>
      </div>
    </div>
  );
}
