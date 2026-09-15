/**
 * CreateAgentModal — 5-step wizard for creating a new agent.
 *
 * The terminology and visual vocabulary match the agent configuration page
 * (AgentDetailLeftColumn) so users see the same words and groupings in both
 * surfaces:
 *
 *   wizard step          ⇄    config tab
 *   ─────────────────────────────────────────
 *   1. Identity                (Identity strip)
 *   2. Persona                 Persona  · system prompt
 *   3. Toolbox                 Toolbox  · tools
 *   4. Knowledge               Knowledge · skills
 *   5. Review                  (n/a)
 *
 * Each step uses the same SectionCaption pattern (small uppercase + friendly
 * name • technical name) and the Toolbox step regroups the previously flat
 * MCP / write tool / subagent chips into the three canonical buckets:
 * Subagents · subagents | Direct actions · write tools | Integrations · MCP tools.
 */

import { useState, useEffect, useRef, useCallback, Fragment } from "react";
import {
  Sparkles,
  ChevronRight,
  ChevronLeft,
  Loader2,
  Check,
  AlertCircle,
  X,
  Info,
} from "lucide-react";
import {
  createAgent,
  checkAgentName,
  getAvailableTools,
  listSkills,
  suggestTools,
  listResearchAgentProducts,
  listResearchAgentRepositories,
  type AvailableTools,
  type IntegrationToolEntry,
  type Skill,
  type ToolSuggestion,
  type ResearchAgentOption,
} from "../../../lib/api";
import { Dialog } from "../ui/Dialog";
import { TextField } from "../ui/TextField";
import { Button } from "../ui/Button";
import { ToolboxPicker } from "../ToolboxPicker";
import { KnowledgeBasePicker, type KbSelection } from "../KnowledgeBasePicker";

interface Props {
  userId: string;
  onClose: () => void;
  onCreated: () => void;
}

const STEPS = ["Identity", "Persona", "Toolbox", "Knowledge", "Review"];

/** One-line description for each step — sits below the progress bar so
    the user sees what this step is about without scanning the form. */
const STEP_SUBTITLES: Record<number, string> = {
  0: "Name your agent, give it a permanent handle, and pick a color.",
  1: "Define who this agent is — its voice, role, and constraints.",
  2: "Pick what this agent can do — delegate, act directly, or call out to integrations.",
  3: "Attach reference material this agent can consult during a task.",
  4: "Take a last look before creating.",
};
const COLORS = [
  "#6366f1", "#8b5cf6", "#a855f7", "#ec4899", "#f43f5e",
  "#ef4444", "#f97316", "#eab308", "#22c55e", "#10b981",
  "#14b8a6", "#06b6d4", "#3b82f6",
];
const SUBAGENT_EMOJI: Record<string, string> = {
  spaces: "🔍", bitbucket: "🔀", grafana: "📊", deepwiki: "📚",
  context7: "📖", git: "🔧",
};

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

interface State {
  step: number;
  name: string; description: string; color: string; slug: string; slugManual: boolean; repoUrl: string;
  systemPrompt: string; aiIntent: string; generating: boolean;
  availableTools: AvailableTools | null; toolsLoading: boolean;
  subagents: string[]; direct: string[]; custom: string[]; gateway: string[];
  availableSkills: Skill[]; skillsLoading: boolean; selectedSkillIds: string[];
  /** No explicit scope choice — an empty selectedKbResources means the agent
   *  matches the running user's own spaces access; a non-empty one scopes it
   *  to that allowlist. Computed at create time (see handleCreate). */
  selectedKbResources: KbSelection[];
  researchAgentProducts: ResearchAgentOption[]; researchAgentRepositories: ResearchAgentOption[];
  researchAgentProductId: string; researchAgentRepositoryId: string; researchAgentOptionsLoading: boolean;
  /** AI-suggested starter toolkit. Auto-fetched once step 2 opens with a
      system prompt or description present. The card sits at the top of
      step 2 and offers one-click apply. */
  suggestion: ToolSuggestion | null;
  suggestionLoading: boolean;
  suggestionApplied: boolean;
  suggestionDismissed: boolean;
  suggestionError: string | null;
  /** Refine input — user-driven follow-up. After the auto-suggest, the
      user can type "I also need X" and get a new (additive) suggestion
      using the same backend endpoint with a free-form intent. */
  refineIntent: string;
  /** "all" | "subagents" | "direct" | <mcp-source-key e.g. "github"> | <custom-source e.g. "custom:sandbox"> */
  toolTab: string;
  nameError: string | null; slugError: string | null; checking: boolean; nameValid: boolean;
  creating: boolean; error: string | null;
}

const INIT: State = {
  step: 0,
  name: "", description: "", color: COLORS[0]!, slug: "", slugManual: false, repoUrl: "",
  systemPrompt: "", aiIntent: "", generating: false,
  availableTools: null, toolsLoading: false,
  subagents: [], direct: [], custom: [], gateway: [],
  availableSkills: [], skillsLoading: false, selectedSkillIds: [],
  selectedKbResources: [],
  researchAgentProducts: [], researchAgentRepositories: [],
  researchAgentProductId: "", researchAgentRepositoryId: "", researchAgentOptionsLoading: false,
  suggestion: null, suggestionLoading: false, suggestionApplied: false,
  suggestionDismissed: false, suggestionError: null,
  refineIntent: "",
  toolTab: "all",
  nameError: null, slugError: null, checking: false, nameValid: false,
  creating: false, error: null,
};

/* ─────────────────────────────────────────────────────────────────────
 * Shared visual primitives — mirror the agent slide-over / config page
 * so the wizard reads as continuous with those surfaces.
 * ───────────────────────────────────────────────────────────────────── */

function SectionCaption({
  friendly,
  technical,
}: {
  friendly: React.ReactNode;
  technical?: string;
}) {
  return (
    <div className="text-[11px] font-medium uppercase tracking-[0.07em] text-xyne-fg-tertiary mb-2 inline-flex items-baseline gap-1.5">
      {friendly}
      {technical && (
        <>
          <span className="text-xyne-fg-tertiary normal-case">·</span>
          <span className="normal-case font-normal">{technical}</span>
        </>
      )}
    </div>
  );
}

interface ToolGroupHeaderProps {
  label: string;
  technical: string;
  count: number;
  total: number;
  description: string;
  allSelected: boolean;
  onToggleAll: () => void;
}

/* SuggestionLoading — multi-phase progress for the AI tool-suggestion call.
   The backend hits an LLM that has to read the full tool catalog (~250+
   descriptions) which typically takes 10–25s. Rotating the message every
   ~3s + showing an elapsed counter keeps the wait from feeling stuck. */

const SUGGESTION_PHASES = [
  "Reading the tool catalog…",
  "Matching tools to your persona…",
  "Picking subagents that fit…",
  "Finalizing the starter toolkit…",
];

function SuggestionLoading() {
  const [phase, setPhase] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const phaseTimer = setInterval(() => {
      setPhase((p) => (p + 1) % SUGGESTION_PHASES.length);
    }, 3000);
    const elapsedTimer = setInterval(() => {
      setElapsed((s) => s + 1);
    }, 1000);
    return () => {
      clearInterval(phaseTimer);
      clearInterval(elapsedTimer);
    };
  }, []);

  return (
    <div className="flex items-center justify-between gap-2 text-[12px] text-[#7c3aed] dark:text-[#a78bfa]">
      <span className="flex items-center gap-2 min-w-0">
        <Loader2 size={12} className="animate-spin flex-shrink-0" />
        <span className="truncate">{SUGGESTION_PHASES[phase]}</span>
      </span>
      <span className="text-[11px] tabular-nums text-[#7c3aed]/70 dark:text-[#a78bfa]/70 flex-shrink-0">
        {elapsed}s · usually 10–25s
      </span>
    </div>
  );
}

function ToolGroupHeader({
  label,
  technical,
  count,
  total,
  description,
  allSelected,
  onToggleAll,
}: ToolGroupHeaderProps) {
  return (
    <div className="flex items-baseline justify-between gap-3 mb-2">
      <div className="min-w-0">
        <div className="text-[13px] font-semibold text-xyne-fg-primary inline-flex items-baseline gap-1.5">
          {label}
          <span className="text-xyne-fg-tertiary">·</span>
          <span className="font-normal text-xyne-fg-tertiary">{technical}</span>
        </div>
        <p className="text-[11px] text-xyne-fg-tertiary mt-0.5">{description}</p>
      </div>
      <div className="flex items-center gap-2.5 shrink-0">
        <span className="text-[11px] tabular-nums text-xyne-fg-tertiary">
          {count}/{total}
        </span>
        <button
          onClick={onToggleAll}
          className="text-[11px] font-medium text-xyne-fg-secondary hover:text-xyne-fg-primary transition-colors"
        >
          {allSelected ? "Deselect all" : "Select all"}
        </button>
      </div>
    </div>
  );
}

/** Strip a server-type prefix and convert snake_case → Sentence case for display.
 *  Raw identifier is preserved as the value sent to the backend. */
function humanizeToolName(name: string, prefix?: string): string {
  let n = name;
  if (prefix) {
    const p = prefix.toLowerCase().replace(/-/g, "_") + "_";
    if (n.toLowerCase().startsWith(p)) n = n.slice(p.length);
  }
  return n.replace(/_/g, " ").replace(/^[a-z]/, (c) => c.toUpperCase());
}

/** Tailwind class for the 6×6 px risk status dot.
 *  Unknown tools default to "write" (amber) — never green-washed. */
function riskDotCls(
  riskLevel: "read" | "write" | "destructive" | undefined,
  _selected?: boolean,
): string {
  if (riskLevel === "read") return "bg-emerald-500";
  if (riskLevel === "destructive") return "bg-red-500";
  return "bg-amber-500";
}

export function CreateAgentModal({ userId, onClose, onCreated }: Props) {
  const [w, setW] = useState<State>(INIT);
  // Pinned detail = last clicked tool. Hovered detail = transient on hover/focus.
  const [pinnedDetail, setPinnedDetail] = useState<IntegrationToolEntry | null>(null);
  const [hoveredDetail, setHoveredDetail] = useState<IntegrationToolEntry | null>(null);
  // Collapsible section state — empty = all collapsed; auto-populates on suggestion apply.
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  // Live text filter for tool names.
  const [toolSearch, setToolSearch] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const u = useCallback((p: Partial<State>) => setW((prev) => ({ ...prev, ...p })), []);

  const effectiveSlug = w.slugManual ? w.slug : slugify(w.name);

  useEffect(() => {
    if (w.step === 2 && !w.availableTools) {
      u({ toolsLoading: true });
      getAvailableTools().then((d) => u({ availableTools: d })).catch(() => {}).finally(() => u({ toolsLoading: false }));
    }
  }, [w.step, w.availableTools, u]);

  useEffect(() => {
    if (w.step !== 2) return;
    if (w.researchAgentProducts.length || w.researchAgentRepositories.length || w.researchAgentOptionsLoading) return;
    u({ researchAgentOptionsLoading: true });
    Promise.all([
      listResearchAgentProducts().catch(() => [] as ResearchAgentOption[]),
      listResearchAgentRepositories().catch(() => [] as ResearchAgentOption[]),
    ])
      .then(([researchAgentProducts, researchAgentRepositories]) => u({ researchAgentProducts, researchAgentRepositories }))
      .finally(() => u({ researchAgentOptionsLoading: false }));
  }, [w.step, w.researchAgentProducts.length, w.researchAgentRepositories.length, w.researchAgentOptionsLoading, u]);

  // The AI-suggested starter toolkit + refine flow now lives inside
  // ToolboxPicker (shared with the config page). The wizard just passes
  // `autoSuggest` + `suggestContext`; the component owns the fetch/apply.

  // Translate a `ToolSuggestion` into the wizard's state shape.
  //
  // CRITICAL: the chips on step 2 render from `availableTools.writeTools`,
  // `availableTools.serverTools`, and `availableTools.customGroups`. We must
  // match suggested tool names against those *same* arrays — not against
  // `availableTools.integrations` (a parallel unified view) — otherwise the
  // identifiers we push into `direct`/`custom` may not line up with what the
  // chips check (`w.direct.includes(t.name)` / `w.custom.includes(t.slug)`),
  // and the visual selection silently no-ops. Additive merge — never strips
  // manual picks.
  const applySuggestion = useCallback(() => {
    if (!w.suggestion || !w.availableTools) return;

    const subagentSet = new Set(w.subagents);
    for (const name of w.suggestion.subagents ?? []) subagentSet.add(name);

    // Flatten every suggested tool name across all integrations into one set
    // so we can scan the chip catalogs in O(n) instead of nested lookups.
    const suggestedNames = new Set<string>();
    for (const sugg of w.suggestion.integrations ?? []) {
      for (const n of sugg.readTools ?? []) suggestedNames.add(n);
      for (const n of sugg.writeTools ?? []) suggestedNames.add(n);
    }

    const directSet = new Set(w.direct);
    const customSet = new Set(w.custom);

    // Direct actions (write tools) — selected by tool name.
    for (const t of w.availableTools.writeTools) {
      if (suggestedNames.has(t.name)) directSet.add(t.name);
    }
    // MCP server tools — also selected via the `direct` array by name.
    for (const tools of Object.values(w.availableTools.serverTools)) {
      for (const t of tools) {
        if (suggestedNames.has(t.name)) directSet.add(t.name);
      }
    }
    // Custom MCP tools — selected via the `custom` array by slug.
    for (const g of w.availableTools.customGroups) {
      for (const t of g.tools) {
        if (suggestedNames.has(t.name)) customSet.add(t.slug);
      }
    }

    u({
      subagents: Array.from(subagentSet),
      direct: Array.from(directSet),
      custom: Array.from(customSet),
      suggestionApplied: true,
    });
  }, [w.suggestion, w.availableTools, w.subagents, w.direct, w.custom, u]);

  // Re-roll: clear the cached suggestion so the auto-fetch effect runs again.
  const reRollSuggestion = useCallback(() => {
    u({ suggestion: null, suggestionApplied: false, suggestionDismissed: false, suggestionError: null });
  }, [u]);

  // Refine: user-driven follow-up suggestion. Sends the free-form refine
  // text as `description` to the same /suggest-tools endpoint and lets the
  // result flow back into the same preview card. Additive — `applySuggestion`
  // merges over any tools the user already accepted.
  const handleRefine = useCallback(async () => {
    const intent = w.refineIntent.trim();
    if (!intent) return;
    u({
      suggestionLoading: true,
      suggestionError: null,
      // Reset so the preview card re-renders for the new suggestion.
      suggestion: null,
      suggestionApplied: false,
      suggestionDismissed: false,
    });
    try {
      const data = await suggestTools({ description: intent });
      u({ suggestion: data, suggestionLoading: false, refineIntent: "" });
    } catch (err) {
      u({
        suggestionError: err instanceof Error ? err.message : "Couldn't load suggestions",
        suggestionLoading: false,
      });
    }
  }, [w.refineIntent, u]);

  useEffect(() => {
    if (w.step === 3 && w.availableSkills.length === 0) {
      u({ skillsLoading: true });
      listSkills(userId).then((d) => u({ availableSkills: d })).catch(() => {}).finally(() => u({ skillsLoading: false }));
    }
  }, [w.step, w.availableSkills.length, u, userId]);

  useEffect(() => {
    u({ nameError: null, slugError: null, nameValid: false });
    if (!w.name.trim() || !effectiveSlug) return;
    if (timer.current) clearTimeout(timer.current);
    u({ checking: true });
    timer.current = setTimeout(async () => {
      try {
        const r = await checkAgentName(w.name.trim(), effectiveSlug);
        u({
          nameError: r.nameAvailable ? null : "Agent name already taken",
          slugError: r.slugAvailable ? null : "Handle already taken",
          nameValid: r.nameAvailable && r.slugAvailable,
          checking: false,
        });
      } catch { u({ nameValid: true, checking: false }); }
    }, 500);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [w.name, effectiveSlug, u]);

  // Reset toolbox UI state when the user leaves / re-enters step 2.
  useEffect(() => {
    if (w.step !== 2) {
      setExpandedSections(new Set());
      setToolSearch("");
      setPinnedDetail(null);
      setHoveredDetail(null);
    }
  }, [w.step]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-expand sections that received AI-suggested tools so the user can
  // immediately verify what "Accept all" applied.
  useEffect(() => {
    if (!w.suggestionApplied || !w.suggestion || !w.availableTools) return;
    const toExpand = new Set<string>();
    if ((w.suggestion.subagents ?? []).length > 0) toExpand.add("subagents");
    const suggestedNames = new Set<string>();
    for (const s of w.suggestion.integrations ?? [])
      for (const n of [...(s.readTools ?? []), ...(s.writeTools ?? [])]) suggestedNames.add(n);
    if (w.availableTools.writeTools.some((t) => suggestedNames.has(t.name))) toExpand.add("direct");
    for (const [src, tools] of Object.entries(w.availableTools.serverTools))
      if (tools.some((t) => suggestedNames.has(t.name))) toExpand.add(src);
    for (const g of w.availableTools.customGroups)
      if (g.tools.some((t) => suggestedNames.has(t.name))) toExpand.add(g.source);
    setExpandedSections((prev) => new Set([...prev, ...toExpand]));
  }, [w.suggestionApplied]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (key: "subagents" | "direct" | "custom", val: string) =>
    setW((p) => ({ ...p, [key]: p[key].includes(val) ? p[key].filter((x) => x !== val) : [...p[key], val] }));

  const toggleAll = (key: "subagents" | "direct" | "custom", all: string[]) =>
    setW((p) => ({ ...p, [key]: p[key].length === all.length ? [] : all }));

  const toggleCustomGroup = (slugs: string[], allSelected: boolean) =>
    setW((p) => ({ ...p, custom: allSelected ? p.custom.filter((x) => !slugs.includes(x)) : [...new Set([...p.custom, ...slugs])] }));

  const toggleSection = (key: string) =>
    setExpandedSections((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const formatServerLabel = (serverType: string): string =>
    serverType.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  const generatePrompt = async () => {
    if (!w.aiIntent.trim()) return;
    u({ generating: true });
    try {
      const res = await fetch("/claw/api/v1/agents/generate-prompt", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: w.aiIntent, agentName: w.name }),
      });
      if (res.ok) {
        const data = (await res.json()) as { success: boolean; data?: { prompt: string } };
        if (data.success && data.data?.prompt) u({ systemPrompt: data.data.prompt });
      }
    } catch (err) { console.error("[create-agent] generate prompt error:", err); }
    finally { u({ generating: false }); }
  };

  const handleCreate = async () => {
    u({ creating: true, error: null });
    try {
      // No explicit scope choice in the UI — an empty allowlist means the
      // agent matches the running user's own spaces access.
      const isUserScopedKb = w.selectedKbResources.length === 0;
      await createAgent({
        slug: effectiveSlug,
        name: w.name.trim(),
        description: w.description.trim(),
        systemPrompt: w.systemPrompt.trim(),
        color: w.color,
        ownerUserId: userId,
        // Send kbScope on create so a USER-scoped agent gets KB tools wired
        // up immediately without needing the follow-up updateAgent call.
        kbScope: isUserScopedKb ? "USER" : "COLLECTIONS",
        ...(isUserScopedKb ? {} : { knowledgeBase: w.selectedKbResources }),
      });
      const hasTools = w.subagents.length || w.direct.length || w.custom.length || w.gateway.length;
      const hasSkills = w.selectedSkillIds.length > 0;
      const trimmedRepoUrl = w.repoUrl.trim();
      const hasRepoUrl = trimmedRepoUrl.length > 0;
      const hasResearchAgentConfig = w.custom.includes("query-codebase") || w.custom.includes("review-pull-request") || w.researchAgentProductId || w.researchAgentRepositoryId;
      if (hasTools || hasSkills || hasResearchAgentConfig || hasRepoUrl) {
        const { updateAgent } = await import("../../../lib/api");
        const config: Record<string, unknown> = {};
        if (hasTools) config["tools"] = { subagents: w.subagents, direct: w.direct, custom: w.custom, gateway: w.gateway };
        if (hasResearchAgentConfig) {
          config["product_id"] = w.researchAgentProductId || null;
          config["repository_id"] = w.researchAgentRepositoryId || null;
        }
        await updateAgent(effectiveSlug, {
          ...(Object.keys(config).length > 0 ? { config } : {}),
          ...(hasSkills ? { skills: w.selectedSkillIds } : {}),
        });
      }
      onCreated();
    } catch (err) { u({ error: err instanceof Error ? err.message : "Failed to create agent" }); }
    finally { u({ creating: false }); }
  };

  const canNext = w.step === 0 ? w.name.trim().length > 0 && effectiveSlug.length > 0 && w.nameValid && !w.checking
    : w.step === 1 ? w.systemPrompt.trim().length > 0 : true;

  // Pre-computed selection counts used by the Toolbox step's group headers.
  const writeToolNames = w.availableTools
    ? new Set(w.availableTools.writeTools.map((t) => t.name))
    : new Set<string>();

  // MCP tools = serverTools entries (excluding "custom:*" which is its own
  // section) minus anything that's already a write tool. This matches the
  // mental model in the config page's "Integrations · MCP tools" group.
  const mcpEntries = w.availableTools
    ? Object.entries(w.availableTools.serverTools)
        .filter(([source, tools]) => {
          if (source.startsWith("custom:")) return false;
          if (!Array.isArray(tools) || tools.length === 0) return false;
          return tools.some((t) => !writeToolNames.has(t.name));
        })
    : [];

  // Description + risk-level lookup keyed by tool name. Populated from the
  // `integrations` field (already computed by the backend with descriptions)
  // and from subagent definitions. Used by the click-to-detail chip panel.
  const toolInfoMap = new Map<string, IntegrationToolEntry>();
  if (w.availableTools) {
    for (const sa of w.availableTools.subagents) {
      toolInfoMap.set(sa.name, { slug: sa.name, name: sa.name, description: sa.description, riskLevel: "read" });
    }
    for (const intg of w.availableTools.integrations) {
      for (const t of [...intg.readTools, ...intg.writeTools]) {
        if (!toolInfoMap.has(t.name)) toolInfoMap.set(t.name, t);
      }
    }
  }

  const pinDetail = (name: string) =>
    setPinnedDetail((prev) => (prev?.name === name ? null : (toolInfoMap.get(name) ?? null)));
  const hoverDetail = (name: string | null) =>
    setHoveredDetail(name ? (toolInfoMap.get(name) ?? null) : null);

  const isLargeToolbox = w.step === 2;
  const activeDetail = hoveredDetail ?? pinnedDetail;

  // ── Toolbox search helpers (safe to compute here; no-ops when tools not loaded) ──
  const searchQ = toolSearch.trim().toLowerCase();
  const toolMatchesSearch = (name: string) =>
    !searchQ ||
    name.toLowerCase().includes(searchQ) ||
    humanizeToolName(name).toLowerCase().includes(searchQ);
  const sectionOpen = (key: string, toolNames: string[]) =>
    searchQ ? toolNames.some((n) => toolMatchesSearch(n)) : expandedSections.has(key);
  const sectionVisible = (toolNames: string[]) =>
    !searchQ || toolNames.some((n) => toolMatchesSearch(n));

  // Selection summary items — built from the three selection arrays.
  const selectionItems: Array<{
    label: string;
    key: string;
    riskLevel: "read" | "write" | "destructive" | undefined;
    onRemove: () => void;
  }> = [
    ...w.subagents.map((name) => ({
      label: name,
      key: `sa-${name}`,
      riskLevel: "read" as const,
      onRemove: () => toggle("subagents", name),
    })),
    ...w.direct.map((name) => ({
      label: humanizeToolName(name),
      key: `d-${name}`,
      riskLevel: (toolInfoMap.get(name)?.riskLevel) ?? ("write" as const),
      onRemove: () => toggle("direct", name),
    })),
    ...(w.availableTools?.customGroups.flatMap((g) =>
      g.tools
        .filter((t) => w.custom.includes(t.slug))
        .map((t) => ({
          label: humanizeToolName(t.name),
          key: `c-${t.slug}`,
          riskLevel: (toolInfoMap.get(t.name)?.riskLevel) ?? ("write" as const),
          onRemove: () => toggle("custom", t.slug),
        }))
    ) ?? []),
  ];

  // Rail items for the large-mode left nav.
  const railItems: Array<{
    key: string;
    label: string;
    dot?: string;
    selCount: number;
    totalCount: number;
    hasDestructive: boolean;
  }> = w.availableTools ? (() => {
    const serverRailItems = mcpEntries
      .map(([source, tools]) => {
        const serverReadTools = tools.filter((t) => !writeToolNames.has(t.name));
        return {
          key: source,
          label: formatServerLabel(source),
          dot: "bg-emerald-500",
          selCount: serverReadTools.filter((t) => w.direct.includes(t.name)).length,
          totalCount: serverReadTools.length,
          hasDestructive: serverReadTools.some((t) => toolInfoMap.get(t.name)?.riskLevel === "destructive"),
        };
      })
      .filter((item) => item.totalCount > 0);
    const customRailItems = w.availableTools!.customGroups.map((g) => ({
      key: g.source,
      label: g.source.replace("custom:", "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      dot: "bg-slate-400",
      selCount: g.tools.filter((t) => w.custom.includes(t.slug)).length,
      totalCount: g.tools.length,
      hasDestructive: g.tools.some((t) => toolInfoMap.get(t.name)?.riskLevel === "destructive"),
    }));
    const allCount =
      w.availableTools!.subagents.length +
      w.availableTools!.writeTools.length +
      serverRailItems.reduce((s, r) => s + r.totalCount, 0) +
      customRailItems.reduce((s, r) => s + r.totalCount, 0);
    return [
      { key: "all", label: "All tools", dot: undefined, selCount: selectionItems.length, totalCount: allCount, hasDestructive: false },
      ...(w.availableTools!.subagents.length > 0 ? [{
        key: "subagents", label: "Subagents", dot: "bg-violet-500",
        selCount: w.subagents.length, totalCount: w.availableTools!.subagents.length, hasDestructive: false,
      }] : []),
      ...(w.availableTools!.writeTools.length > 0 ? [{
        key: "direct", label: "Direct actions", dot: "bg-amber-500",
        selCount: w.direct.filter((n) => writeToolNames.has(n)).length,
        totalCount: w.availableTools!.writeTools.length,
        hasDestructive: w.availableTools!.writeTools.some((t) => toolInfoMap.get(t.name)?.riskLevel === "destructive"),
      }] : []),
      ...serverRailItems,
      ...customRailItems,
    ];
  })() : [];

  return (
    <Dialog
      open={true}
      onOpenChange={(o) => { if (!o) onClose(); }}
      title="Create agent"
      maxWidth={920}
      maxHeight="min(880px, 90vh)"
      height="min(880px, 90vh)"
      bodyClassName={isLargeToolbox ? "flex-1 overflow-hidden flex flex-col" : undefined}
      description={STEP_SUBTITLES[w.step]}
      footer={
        <div className="flex w-full items-center justify-between">
          <Button
            variant="secondary"
            size="lg"
            onClick={() => w.step > 0 ? u({ step: w.step - 1 }) : onClose()}
          >
            <ChevronLeft size={15} /> {w.step > 0 ? "Back" : "Cancel"}
          </Button>
          {w.step < STEPS.length - 1 ? (
            <Button variant="primary" size="lg" onClick={() => u({ step: w.step + 1 })} disabled={!canNext}>
              Next <ChevronRight size={16} />
            </Button>
          ) : (
            <Button variant="primary" size="lg" onClick={handleCreate} disabled={w.creating || !canNext}>
              {w.creating ? <Loader2 size={14} className="animate-spin" /> : <Check size={15} />} Create agent
            </Button>
          )}
        </div>
      }
    >
      {/* ── Named step indicator ───────────────────────────────────── */}
      <div className={isLargeToolbox ? "flex justify-center px-6 pt-5 pb-2 shrink-0" : "flex justify-center py-2"}>
        {STEPS.map((s, i) => (
          <Fragment key={s}>
            <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
              <div className={`h-6 w-6 rounded-full flex items-center justify-center text-[11px] font-semibold transition-all duration-200 ${
                i < w.step
                  ? "bg-xyne-brand text-xyne-fg-inverse"
                  : i === w.step
                  ? "ring-2 ring-xyne-brand bg-xyne-surface text-xyne-fg-primary"
                  : "bg-xyne-surface-subtle text-xyne-fg-tertiary"
              }`}>
                {i < w.step ? <Check size={11} strokeWidth={2.5} /> : i + 1}
              </div>
              <span className={`text-[10px] font-medium leading-none transition-colors duration-200 ${
                i === w.step ? "text-xyne-fg-primary" : "text-xyne-fg-tertiary"
              }`}>{s}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`h-px w-16 flex-shrink-0 mt-3 mx-3 transition-colors duration-300 ${i < w.step ? "bg-xyne-brand" : "bg-xyne-border-subtle"}`} />
            )}
          </Fragment>
        ))}
      </div>

      <div key={w.step} className={`step-enter ${isLargeToolbox ? "flex-1 min-h-0 flex flex-col" : "min-h-[320px] w-full max-w-[600px] mx-auto"}`}>

        {/* ─── Step 0: Identity ─────────────────────────────────────── */}
        {w.step === 0 && (
          <div className="space-y-4">
            <SectionCaption friendly="Identity" />
            <div className="grid grid-cols-12 gap-3">
              {/* Name + Handle share a row (matches the config page's
                  compressed identity strip). */}
              <div className="col-span-7">
                <label className="mb-1.5 block text-[12px] font-medium text-xyne-fg-secondary">
                  Name
                </label>
                <div className="relative">
                  <input
                    value={w.name}
                    onChange={(e) => u({ name: e.target.value, ...(!w.slugManual ? { slug: slugify(e.target.value) } : {}) })}
                    placeholder="e.g. PR Reviewer, Onboarding Guide"
                    autoFocus
                    className={`w-full rounded-[var(--comp-input-radius)] border bg-xyne-surface px-3 py-2 pr-8 text-[14px] text-xyne-fg-primary placeholder:text-xyne-fg-placeholder focus:outline-none focus:shadow-[var(--comp-focus-ring)] transition-[border-color,box-shadow] ${w.nameError ? "border-xyne-border-error" : w.nameValid ? "border-green-500" : "border-xyne-border focus:border-xyne-border-focus"}`}
                  />
                  {w.name.trim() && (
                    <span className="absolute right-2.5 top-2.5">
                      {w.checking ? <Loader2 size={14} className="animate-spin text-xyne-fg-muted" /> : w.nameError ? <AlertCircle size={14} className="text-xyne-error-fg" /> : w.nameValid ? <Check size={14} className="text-green-600" /> : null}
                    </span>
                  )}
                </div>
                {w.nameError && <p className="mt-1 text-[11px] text-xyne-error-fg">{w.nameError}</p>}
              </div>
              <div className="col-span-5">
                <label className="mb-1.5 flex items-center justify-between gap-2 text-[12px] font-medium text-xyne-fg-secondary">
                  Handle
                  <button
                    onClick={() => u({ slugManual: !w.slugManual })}
                    className="text-[11px] font-normal text-xyne-fg-tertiary hover:text-xyne-fg-primary transition"
                  >
                    {w.slugManual ? "auto" : "edit"}
                  </button>
                </label>
                <input
                  value={effectiveSlug}
                  onChange={(e) => u({ slugManual: true, slug: e.target.value })}
                  disabled={!w.slugManual}
                  className={`w-full rounded-[var(--comp-input-radius)] border bg-xyne-surface-subtle px-3 py-2 font-mono text-[13px] text-xyne-fg-secondary focus:outline-none focus:shadow-[var(--comp-focus-ring)] disabled:opacity-60 transition-[border-color,box-shadow] ${w.slugError ? "border-xyne-border-error" : "border-xyne-border focus:border-xyne-border-focus"}`}
                />
                {w.slugError && <p className="mt-1 text-[11px] text-xyne-error-fg">{w.slugError}</p>}
              </div>
            </div>

            <TextField
              label="Description"
              placeholder="What does this agent do?"
              value={w.description}
              onChange={(e) => u({ description: e.target.value })}
            />

            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-xyne-fg-secondary">Color</label>
              <div className="flex flex-wrap gap-2 px-2 py-2">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => u({ color: c })}
                    className={`h-7 w-7 rounded-full transition ${w.color === c ? "ring-2 ring-xyne-border-focus ring-offset-2 ring-offset-xyne-surface" : "hover:scale-110"}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ─── Step 1: Persona (was "System Prompt") ────────────────── */}
        {w.step === 1 && (
          <div className="space-y-4">
            <SectionCaption friendly="Persona" technical="system prompt" />

            {/* Generate-with-AI — single compact row, mirrors the
                "Update with AI" bar on the agent configuration page so the
                same affordance reads the same in both surfaces. */}
            <div className="flex items-center gap-2.5 rounded-lg border border-[#c4b5fd]/70 dark:border-[#6d28d9]/40 bg-[#faf5ff] dark:bg-[#2e1065]/20 px-3 py-2">
              <Sparkles size={13} className="shrink-0 text-[#7c3aed] dark:text-[#a78bfa]" />
              <input
                value={w.aiIntent}
                onChange={(e) => u({ aiIntent: e.target.value })}
                placeholder="Describe what this agent should do…"
                onKeyDown={(e) => { if (e.key === "Enter") generatePrompt(); }}
                className="min-w-0 flex-1 bg-transparent text-[12px] text-xyne-fg-primary placeholder:text-[#a78bfa]/80 focus:outline-none"
              />
              <button
                type="button"
                onClick={generatePrompt}
                disabled={w.generating || !w.aiIntent.trim()}
                className="shrink-0 inline-flex items-center gap-1 rounded-md bg-[#7c3aed] px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-[#6d28d9] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {w.generating && <Loader2 size={12} className="animate-spin" />}
                Generate with AI
              </button>
            </div>

            {/* System prompt textarea — mono font, larger so the user can
                actually read what they're writing. */}
            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-xyne-fg-secondary">
                System prompt
              </label>
              <textarea
                value={w.systemPrompt}
                onChange={(e) => u({ systemPrompt: e.target.value })}
                placeholder="You are a…"
                rows={10}
                className="w-full resize-y rounded-lg border border-xyne-border bg-xyne-surface-subtle px-3 py-2 font-mono text-[12px] leading-relaxed text-xyne-fg-primary placeholder:text-xyne-fg-placeholder focus:border-xyne-border-focus focus:shadow-[var(--comp-focus-ring)] focus:outline-none"
              />
              <p className="mt-1 text-[11px] text-xyne-fg-tertiary">
                {w.systemPrompt.length.toLocaleString()} characters
              </p>
            </div>
          </div>
        )}

        {/* ─── Step 2: Toolbox ──────────────────────────────────────── */}
        {w.step === 2 && (
          <ToolboxPicker
            variant="large"
            availableTools={w.availableTools}
            loading={w.toolsLoading}
            value={{ subagents: w.subagents, direct: w.direct, custom: w.custom, gateway: w.gateway }}
            onChange={(next) => setW((p) => ({
              ...p,
              subagents: next.subagents,
              direct: next.direct,
              custom: next.custom,
              gateway: next.gateway ?? [],
            }))}
            autoSuggest
            suggestContext={{ systemPrompt: w.systemPrompt, description: w.description }}
            researchAgent={{
              productId: w.researchAgentProductId,
              onProductIdChange: (v) => u({ researchAgentProductId: v }),
              products: w.researchAgentProducts,
              repositoryId: w.researchAgentRepositoryId,
              onRepositoryIdChange: (v) => u({ researchAgentRepositoryId: v }),
              repositories: w.researchAgentRepositories,
              loading: w.researchAgentOptionsLoading,
            }}
          />
        )}

        {/* ─── Step 3: Knowledge (was "Skills") ─────────────────────── */}
        {w.step === 3 && (
          <div className="space-y-4">
            <SectionCaption friendly="Knowledge" technical="skills" />
            <p className="text-[13px] text-xyne-fg-secondary leading-relaxed">
              Skills give this agent reference knowledge it can draw on during a task — things like your coding conventions, writing style, or domain glossary. You can skip this and add skills later.
            </p>
            {w.skillsLoading ? (
              <div className="flex items-center gap-2 text-[13px] text-xyne-fg-muted">
                <Loader2 size={14} className="animate-spin" /> Loading…
              </div>
            ) : w.availableSkills.length === 0 ? (
              <div className="rounded-lg border border-dashed border-xyne-border-subtle px-3 py-8 text-center">
                <p className="text-[13px] font-medium text-xyne-fg-secondary">No skills yet</p>
                <p className="mt-1 text-[12px] text-xyne-fg-tertiary">Create skills from the Skills page to attach reference material to your agents.</p>
              </div>
            ) : (
              <>
                {w.availableSkills.filter((s) => s.scope === "global").length > 0 && (
                  <div>
                    <p className="text-[11px] font-medium text-xyne-fg-tertiary mb-2 uppercase tracking-[0.06em]">
                      Global skills
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {w.availableSkills.filter((s) => s.scope === "global").map((skill) => (
                        <button
                          key={skill.id}
                          onClick={() => setW((p) => ({ ...p, selectedSkillIds: p.selectedSkillIds.includes(skill.id) ? p.selectedSkillIds.filter((x) => x !== skill.id) : [...p.selectedSkillIds, skill.id] }))}
                          className={`rounded-full border px-2.5 py-1 text-[12px] transition ${
                            w.selectedSkillIds.includes(skill.id)
                              ? "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-500/50 dark:bg-indigo-900/20 dark:text-indigo-300"
                              : "border-xyne-border bg-xyne-surface text-xyne-fg-secondary hover:border-xyne-border-strong"
                          }`}
                          title={skill.description || skill.slug}
                        >
                          {skill.label || skill.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {w.availableSkills.filter((s) => s.ownerUserId === userId).length > 0 && (
                  <div>
                    <p className="text-[11px] font-medium text-xyne-fg-tertiary mb-2 uppercase tracking-[0.06em]">
                      My skills
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {w.availableSkills.filter((s) => s.ownerUserId === userId).map((skill) => (
                        <button
                          key={skill.id}
                          onClick={() => setW((p) => ({ ...p, selectedSkillIds: p.selectedSkillIds.includes(skill.id) ? p.selectedSkillIds.filter((x) => x !== skill.id) : [...p.selectedSkillIds, skill.id] }))}
                          className={`rounded-full border px-2.5 py-1 text-[12px] transition ${
                            w.selectedSkillIds.includes(skill.id)
                              ? "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-500/50 dark:bg-indigo-900/20 dark:text-indigo-300"
                              : "border-xyne-border bg-xyne-surface text-xyne-fg-secondary hover:border-xyne-border-strong"
                          }`}
                          title={skill.description || skill.slug}
                        >
                          {skill.label || skill.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <p className="text-[11px] text-xyne-fg-tertiary">
                  {w.selectedSkillIds.length === 0
                    ? "No skills attached — you can add them later from the agent settings."
                    : `${w.selectedSkillIds.length} skill${w.selectedSkillIds.length === 1 ? "" : "s"} attached`}
                </p>
              </>
            )}

            {/* Knowledge Base — no explicit scope choice. Attaching specific
                collections/files scopes the agent to that allowlist; leaving
                it empty falls back to matching the running user's own spaces
                access (computed at create time from selectedKbResources). */}
            <div className="mt-6 space-y-2 border-t border-xyne-border-subtle pt-5">
              <SectionCaption friendly="Knowledge Base" technical="knowledge-base" />
              <p className="text-[13px] text-xyne-fg-secondary leading-relaxed">
                Attach spaces documents this agent can read. The agent automatically gets read-only tools (search, list, read) over the chosen scope.
              </p>

              <KnowledgeBasePicker
                value={w.selectedKbResources}
                onChange={(next) => setW((p) => ({ ...p, selectedKbResources: next }))}
              />
              <p className="text-[11px] text-xyne-fg-tertiary">
                {w.selectedKbResources.length === 0
                  ? "No specific KB resources attached — this agent will match your access (inherits the running user's spaces access)."
                  : `${w.selectedKbResources.length} grant${w.selectedKbResources.length === 1 ? "" : "s"} attached`}
              </p>
            </div>
          </div>
        )}

        {/* ─── Step 4: Review ───────────────────────────────────────── */}
        {w.step === 4 && (
          <div className="space-y-4">
            <SectionCaption friendly="Review" />

            {/* Identity preview card */}
            <div className="flex items-start gap-3 rounded-xl border border-xyne-border bg-xyne-surface p-3">
              <span className="inline-block h-8 w-8 rounded-full shrink-0" style={{ backgroundColor: w.color }} />
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-[14px] text-xyne-fg-primary">{w.name || "Untitled"}</h3>
                <p className="text-[11px] text-xyne-fg-tertiary font-mono">{effectiveSlug} · personal</p>
                {w.description && (
                  <p className="mt-1 text-[12px] text-xyne-fg-secondary leading-relaxed">{w.description}</p>
                )}
              </div>
            </div>

            {/* Persona */}
            <div>
              <SectionCaption friendly="Persona" technical="system prompt" />
              <pre className="max-h-32 overflow-auto rounded-lg border border-xyne-border-subtle bg-xyne-surface-sunken p-3 font-mono text-[11px] leading-relaxed text-xyne-fg-secondary whitespace-pre-wrap">
                {w.systemPrompt.slice(0, 500)}{w.systemPrompt.length > 500 ? "…" : ""}
              </pre>
            </div>

            {(w.researchAgentProductId || w.researchAgentRepositoryId || w.custom.includes("query-codebase") || w.custom.includes("review-pull-request")) && (
              <div>
                <SectionCaption friendly="Research Agent" technical="context" />
                <p className="text-[12px] text-xyne-fg-secondary">
                  Product: {w.researchAgentProductId || "None"} · Repository: {w.researchAgentRepositoryId || "None"}
                </p>
              </div>
            )}

            {/* Toolbox summary */}
            {(w.subagents.length > 0 || w.direct.length > 0 || w.custom.length > 0) && (
              <div>
                <SectionCaption friendly="Toolbox" technical="tools" />
                <div className="space-y-2">
                  {w.subagents.length > 0 && (
                    <div>
                      <p className="text-[11px] text-xyne-fg-tertiary mb-1">Subagents · {w.subagents.length}</p>
                      <div className="flex flex-wrap gap-1">
                        {w.subagents.map((x) => (
                          <span key={x} className="rounded-full bg-xyne-surface-subtle px-2 py-0.5 text-[11px] text-xyne-fg-primary border border-xyne-border">{x}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {w.direct.length > 0 && (
                    <div>
                      <p className="text-[11px] text-xyne-fg-tertiary mb-1">Direct actions · {w.direct.length}</p>
                      <div className="flex flex-wrap gap-1">
                        {w.direct.map((x) => (
                          <span key={x} className="rounded-full bg-xyne-surface-subtle px-2 py-0.5 text-[11px] text-xyne-fg-primary border border-xyne-border">{x}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {w.custom.length > 0 && (
                    <div>
                      <p className="text-[11px] text-xyne-fg-tertiary mb-1">Integrations · {w.custom.length}</p>
                      <div className="flex flex-wrap gap-1">
                        {w.custom.map((x) => (
                          <span key={x} className="rounded-full bg-xyne-surface-subtle px-2 py-0.5 text-[11px] text-xyne-fg-primary border border-xyne-border">{x}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Knowledge summary */}
            {w.selectedSkillIds.length > 0 && (
              <div>
                <SectionCaption friendly="Knowledge" technical="skills" />
                <div className="flex flex-wrap gap-1">
                  {w.selectedSkillIds.map((id) => {
                    const s = w.availableSkills.find((x) => x.id === id);
                    return (
                      <span key={id} className="rounded-full bg-xyne-surface-subtle px-2 py-0.5 text-[11px] text-xyne-fg-secondary border border-xyne-border">
                        {s?.label || s?.name || id}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            {w.error && (
              <p className="rounded-lg bg-xyne-error-bg border border-xyne-error-border px-3 py-2 text-[12px] text-xyne-error-fg">
                {w.error}
              </p>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
