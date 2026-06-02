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
 * Specialists · subagents | Direct actions · write tools | Integrations · MCP tools.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Sparkles,
  ChevronRight,
  ChevronLeft,
  Loader2,
  Check,
  AlertCircle,
} from "lucide-react";
import {
  createAgent,
  checkAgentName,
  getAvailableTools,
  listSkills,
  suggestTools,
  type AvailableTools,
  type Skill,
  type ToolSuggestion,
} from "../../../lib/api";
import { Dialog } from "../ui/Dialog";
import { TextField } from "../ui/TextField";
import { Button } from "../ui/Button";

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
  context7: "📖", pgm: "📋", git: "🔧",
};

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

interface State {
  step: number;
  name: string; description: string; color: string; slug: string; slugManual: boolean; repoUrl: string;
  systemPrompt: string; aiIntent: string; generating: boolean;
  availableTools: AvailableTools | null; toolsLoading: boolean;
  subagents: string[]; direct: string[]; custom: string[];
  availableSkills: Skill[]; skillsLoading: boolean; selectedSkillIds: string[];
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
  nameError: string | null; slugError: string | null; checking: boolean; nameValid: boolean;
  creating: boolean; error: string | null;
}

const INIT: State = {
  step: 0,
  name: "", description: "", color: COLORS[0]!, slug: "", slugManual: false, repoUrl: "",
  systemPrompt: "", aiIntent: "", generating: false,
  availableTools: null, toolsLoading: false,
  subagents: [], direct: [], custom: [],
  availableSkills: [], skillsLoading: false, selectedSkillIds: [],
  suggestion: null, suggestionLoading: false, suggestionApplied: false,
  suggestionDismissed: false, suggestionError: null,
  refineIntent: "",
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
  "Picking specialists that fit…",
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

export function CreateAgentModal({ userId, onClose, onCreated }: Props) {
  const [w, setW] = useState<State>(INIT);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const u = useCallback((p: Partial<State>) => setW((prev) => ({ ...prev, ...p })), []);

  const effectiveSlug = w.slugManual ? w.slug : slugify(w.name);

  useEffect(() => {
    if (w.step === 2 && !w.availableTools) {
      u({ toolsLoading: true });
      getAvailableTools().then((d) => u({ availableTools: d })).catch(() => {}).finally(() => u({ toolsLoading: false }));
    }
  }, [w.step, w.availableTools, u]);

  // Auto-fetch the AI-suggested starter toolkit when the user lands on
  // the Toolbox step. Runs once per session — if the user changes their
  // system prompt after seeing it, they can re-roll via the "Re-suggest"
  // button on the card.
  useEffect(() => {
    if (w.step !== 2) return;
    if (w.suggestion || w.suggestionLoading || w.suggestionDismissed || w.suggestionApplied) return;
    const intent = w.systemPrompt.trim() || w.description.trim();
    if (!intent) return;
    u({ suggestionLoading: true, suggestionError: null });
    suggestTools({
      systemPrompt: w.systemPrompt.trim() || undefined,
      description: !w.systemPrompt.trim() ? w.description.trim() : undefined,
    })
      .then((data) => u({ suggestion: data, suggestionLoading: false }))
      .catch((err) => u({
        suggestionError: err instanceof Error ? err.message : "Couldn't load suggestions",
        suggestionLoading: false,
      }));
  }, [w.step, w.suggestion, w.suggestionLoading, w.suggestionDismissed, w.suggestionApplied, w.systemPrompt, w.description, u]);

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

  const toggle = (key: "subagents" | "direct" | "custom", val: string) =>
    setW((p) => ({ ...p, [key]: p[key].includes(val) ? p[key].filter((x) => x !== val) : [...p[key], val] }));

  const toggleAll = (key: "subagents" | "direct" | "custom", all: string[]) =>
    setW((p) => ({ ...p, [key]: p[key].length === all.length ? [] : all }));

  const toggleCustomGroup = (slugs: string[], allSelected: boolean) =>
    setW((p) => ({ ...p, custom: allSelected ? p.custom.filter((x) => !slugs.includes(x)) : [...new Set([...p.custom, ...slugs])] }));

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
      await createAgent({
        slug: effectiveSlug,
        name: w.name.trim(),
        description: w.description.trim(),
        systemPrompt: w.systemPrompt.trim(),
        color: w.color,
        ownerUserId: userId,
      });
      const hasTools = w.subagents.length || w.direct.length || w.custom.length;
      const hasSkills = w.selectedSkillIds.length > 0;
      const trimmedRepoUrl = w.repoUrl.trim();
      const hasRepoUrl = trimmedRepoUrl.length > 0;
      if (hasTools || hasSkills || hasRepoUrl) {
        const { updateAgent } = await import("../../../lib/api");
        const config: Record<string, unknown> = {};
        if (hasTools) config["tools"] = { subagents: w.subagents, direct: w.direct, custom: w.custom };
        if (hasRepoUrl) config["repoUrl"] = trimmedRepoUrl;
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

  return (
    <Dialog
      open={true}
      onOpenChange={(o) => { if (!o) onClose(); }}
      title="Create agent"
      description={
        // Two-line header: step indicator on top, contextual subtitle
        // below so users see what this step is about without scanning
        // the form body.
        <>
          <span className="block">
            Step {w.step + 1} of {STEPS.length}: {STEPS[w.step]}
          </span>
          <span className="block text-[13px] text-xyne-fg-secondary mt-1">
            {STEP_SUBTITLES[w.step]}
          </span>
        </>
      }
      maxWidth={672}
      footer={
        <div className="flex w-full items-center justify-between">
          <button
            onClick={() => w.step > 0 ? u({ step: w.step - 1 }) : onClose()}
            className="flex items-center gap-1 text-[14px] text-xyne-fg-muted transition hover:text-xyne-fg-primary"
          >
            <ChevronLeft size={16} /> {w.step > 0 ? "Back" : "Cancel"}
          </button>
          {w.step < STEPS.length - 1 ? (
            <Button variant="primary" onClick={() => u({ step: w.step + 1 })} disabled={!canNext}>
              Next <ChevronRight size={16} />
            </Button>
          ) : (
            <Button variant="primary" onClick={handleCreate} disabled={w.creating || !canNext}>
              {w.creating ? <Loader2 size={14} className="animate-spin" /> : null} Create agent
            </Button>
          )}
        </div>
      }
    >
      <div className="flex gap-1">
        {STEPS.map((s, i) => (
          <div key={s} className={`h-1 flex-1 rounded-full transition ${i <= w.step ? "bg-xyne-brand" : "bg-xyne-surface-subtle"}`} />
        ))}
      </div>

      <div className="min-h-[320px]">

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

        {/* ─── Step 2: Toolbox (was "Tools") ────────────────────────── */}
        {w.step === 2 && (
          <div className="space-y-5">
            <SectionCaption friendly="Toolbox" technical="tools" />

            {/* AI-suggested starter pack — purple-tinted card mirroring the
                "Generate with AI" block on step 2 (Persona). Auto-loads
                from the system prompt + description. One-click apply. */}
            {!w.suggestionDismissed && !w.suggestionApplied && (w.suggestionLoading || w.suggestion || w.suggestionError) && (
              <div className="rounded-lg border border-[#c4b5fd] dark:border-[#6d28d9]/40 bg-[#faf5ff] dark:bg-[#2e1065]/20 p-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.07em] text-[#7c3aed] dark:text-[#a78bfa]">
                    <Sparkles size={12} /> Suggested for you
                  </div>
                  <button
                    type="button"
                    onClick={() => u({ suggestionDismissed: true })}
                    className="text-[11px] text-[#7c3aed]/70 dark:text-[#a78bfa]/70 hover:text-[#7c3aed] dark:hover:text-[#a78bfa] transition-colors"
                    aria-label="Dismiss suggestion"
                  >
                    Dismiss
                  </button>
                </div>

                {w.suggestionLoading ? (
                  <SuggestionLoading />
                ) : w.suggestionError ? (
                  <div className="flex items-center justify-between gap-2 text-[12px] text-[#7c3aed] dark:text-[#a78bfa]">
                    <span>{w.suggestionError}</span>
                    <button
                      type="button"
                      onClick={reRollSuggestion}
                      className="text-[11px] font-medium underline hover:no-underline"
                    >
                      Try again
                    </button>
                  </div>
                ) : w.suggestion ? (
                  (() => {
                    // Count what the suggestion adds *over* the current
                    // selection so users see what they're actually agreeing
                    // to. Must mirror applySuggestion's matching logic —
                    // scan writeTools / serverTools / customGroups directly
                    // so the preview count and the resulting chip state
                    // stay in sync. (Earlier we read `integrations[]` which
                    // is a parallel view and routinely diverges, making the
                    // count lie about the apply outcome.)
                    //
                    // Splitting `newDirect` vs `newIntegrations` here so the
                    // preview bucket labels ("Direct actions" / "Integrations")
                    // match the chip group the user will see highlighted in
                    // the form below — write tools live in their own group;
                    // MCP server tools display under Integrations even though
                    // they're stored in the `direct` state array.
                    const newSubagents = (w.suggestion.subagents ?? []).filter(
                      (n) => !w.subagents.includes(n)
                    );
                    const newDirect: string[] = [];
                    const newIntegrationTools: string[] = [];
                    const newCustom: string[] = [];
                    if (w.availableTools) {
                      const suggestedNames = new Set<string>();
                      for (const sugg of w.suggestion.integrations ?? []) {
                        for (const n of sugg.readTools ?? []) suggestedNames.add(n);
                        for (const n of sugg.writeTools ?? []) suggestedNames.add(n);
                      }
                      const writeToolNameSet = new Set(
                        w.availableTools.writeTools.map((t) => t.name),
                      );
                      for (const t of w.availableTools.writeTools) {
                        if (suggestedNames.has(t.name) && !w.direct.includes(t.name)) {
                          newDirect.push(t.name);
                        }
                      }
                      for (const tools of Object.values(w.availableTools.serverTools)) {
                        for (const t of tools) {
                          // Skip anything that's already a write tool — that
                          // group is dedicated and we'd double-count.
                          if (writeToolNameSet.has(t.name)) continue;
                          if (
                            suggestedNames.has(t.name) &&
                            !w.direct.includes(t.name) &&
                            !newIntegrationTools.includes(t.name)
                          ) {
                            newIntegrationTools.push(t.name);
                          }
                        }
                      }
                      for (const g of w.availableTools.customGroups) {
                        for (const t of g.tools) {
                          if (suggestedNames.has(t.name) && !w.custom.includes(t.slug)) {
                            newCustom.push(t.slug);
                          }
                        }
                      }
                    }
                    // Integrations bucket = MCP server tools (stored in `direct`)
                    // + custom MCP tools (stored in `custom`).
                    const newIntegrationsTotal =
                      newIntegrationTools.length + newCustom.length;
                    const total =
                      newSubagents.length +
                      newDirect.length +
                      newIntegrationsTotal;

                    if (total === 0) {
                      return (
                        <p className="text-[12px] text-[#7c3aed] dark:text-[#a78bfa]">
                          Already covered — nothing new to add.
                        </p>
                      );
                    }

                    return (
                      <div className="flex flex-col gap-2.5">
                        <p className="text-[12px] text-[#5b21b6] dark:text-[#c4b5fd] leading-relaxed">
                          Based on what you described, here's a starter toolkit. Accept it, then tweak below.
                        </p>

                        {/* Preview — grouped summary chips so the user can
                            scan what would be added without expanding. */}
                        <div className="flex flex-col gap-1.5">
                          {newSubagents.length > 0 && (
                            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                              <span className="text-[11px] font-medium text-[#7c3aed] dark:text-[#a78bfa]">
                                Specialists · {newSubagents.length}
                              </span>
                              <span className="flex flex-wrap gap-1">
                                {newSubagents.slice(0, 4).map((n) => (
                                  <span
                                    key={n}
                                    className="text-[11px] px-1.5 py-0.5 rounded-full bg-white dark:bg-[#1e1b4b]/40 border border-[#c4b5fd] dark:border-[#6d28d9]/40 text-[#5b21b6] dark:text-[#c4b5fd]"
                                  >
                                    {n}
                                  </span>
                                ))}
                                {newSubagents.length > 4 && (
                                  <span className="text-[11px] text-[#7c3aed] dark:text-[#a78bfa]">
                                    +{newSubagents.length - 4} more
                                  </span>
                                )}
                              </span>
                            </div>
                          )}
                          {newDirect.length > 0 && (
                            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                              <span className="text-[11px] font-medium text-[#7c3aed] dark:text-[#a78bfa]">
                                Direct actions · {newDirect.length}
                              </span>
                              <span className="flex flex-wrap gap-1">
                                {newDirect.slice(0, 4).map((n) => (
                                  <span
                                    key={n}
                                    className="text-[11px] px-1.5 py-0.5 rounded-full bg-white dark:bg-[#1e1b4b]/40 border border-[#c4b5fd] dark:border-[#6d28d9]/40 text-[#5b21b6] dark:text-[#c4b5fd]"
                                  >
                                    {n}
                                  </span>
                                ))}
                                {newDirect.length > 4 && (
                                  <span className="text-[11px] text-[#7c3aed] dark:text-[#a78bfa]">
                                    +{newDirect.length - 4} more
                                  </span>
                                )}
                              </span>
                            </div>
                          )}
                          {newIntegrationsTotal > 0 && (
                            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                              <span className="text-[11px] font-medium text-[#7c3aed] dark:text-[#a78bfa]">
                                Integrations · {newIntegrationsTotal}
                              </span>
                              <span className="flex flex-wrap gap-1">
                                {newIntegrationTools.slice(0, 4).map((n) => (
                                  <span
                                    key={n}
                                    className="text-[11px] px-1.5 py-0.5 rounded-full bg-white dark:bg-[#1e1b4b]/40 border border-[#c4b5fd] dark:border-[#6d28d9]/40 text-[#5b21b6] dark:text-[#c4b5fd]"
                                  >
                                    {n}
                                  </span>
                                ))}
                                {newIntegrationTools.length > 4 && (
                                  <span className="text-[11px] text-[#7c3aed] dark:text-[#a78bfa]">
                                    +{newIntegrationTools.length - 4} more
                                  </span>
                                )}
                                {newCustom.length > 0 && (
                                  <span className="text-[11px] text-[#5b21b6] dark:text-[#c4b5fd]">
                                    {newIntegrationTools.length > 0 ? "· " : ""}
                                    {newCustom.length} custom tool{newCustom.length === 1 ? "" : "s"}
                                  </span>
                                )}
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-2 pt-1">
                          <button
                            type="button"
                            onClick={applySuggestion}
                            className="inline-flex items-center gap-1 rounded-md bg-[#7c3aed] px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-[#6d28d9]"
                          >
                            <Sparkles size={12} />
                            Accept all {total}
                          </button>
                          <button
                            type="button"
                            onClick={reRollSuggestion}
                            className="inline-flex items-center gap-1 rounded-md border border-[#c4b5fd] dark:border-[#6d28d9]/40 bg-transparent px-3 py-1.5 text-[12px] font-medium text-[#7c3aed] dark:text-[#a78bfa] transition-colors hover:bg-white dark:hover:bg-[#1e1b4b]/40"
                          >
                            Re-suggest
                          </button>
                        </div>
                      </div>
                    );
                  })()
                ) : null}
              </div>
            )}

            {/* Confirmation strip — shown right after the user accepts. */}
            {w.suggestionApplied && (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-xyne-success-border bg-xyne-success-bg px-3 py-2 text-[12px] text-xyne-success-fg">
                <span className="inline-flex items-center gap-1.5">
                  <Check size={12} />
                  Suggestions applied. Refine below as needed.
                </span>
                <button
                  type="button"
                  onClick={reRollSuggestion}
                  className="text-[11px] font-medium underline hover:no-underline"
                >
                  Re-suggest
                </button>
              </div>
            )}

            {/* Refine input — user-driven follow-up. Lets the user type
                what they actually need ("I also need a Slack notifier") and
                get a new suggestion through the same backend endpoint. Sits
                below the auto-suggest so the auto path stays the primary
                affordance and refine reads as "still missing something?". */}
            {!w.suggestionLoading && (
              <div className="flex flex-col gap-2 rounded-lg border border-xyne-border-subtle bg-xyne-surface-subtle/40 p-3">
                <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.07em] text-xyne-fg-tertiary">
                  <Sparkles size={12} className="text-[#7c3aed] dark:text-[#a78bfa]" />
                  Need different tools? Tell me what to add
                </div>
                <div className="flex items-center gap-2">
                  <input
                    value={w.refineIntent}
                    onChange={(e) => u({ refineIntent: e.target.value })}
                    placeholder="e.g. I also need Slack notifications and Jira ticket creation"
                    onKeyDown={(e) => { if (e.key === "Enter") handleRefine(); }}
                    className="min-w-0 flex-1 rounded-md border border-xyne-border bg-xyne-surface px-2.5 py-1.5 text-[12px] text-xyne-fg-primary placeholder:text-xyne-fg-placeholder focus:outline-none focus:border-[#7c3aed] focus:shadow-[var(--comp-focus-ring)] transition-[border-color,box-shadow]"
                  />
                  <button
                    type="button"
                    onClick={handleRefine}
                    disabled={!w.refineIntent.trim()}
                    className="inline-flex items-center gap-1 rounded-md bg-[#7c3aed] px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-[#6d28d9] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Sparkles size={12} />
                    Suggest
                  </button>
                </div>
              </div>
            )}

            {w.toolsLoading ? (
              <div className="flex items-center gap-2 text-[13px] text-xyne-fg-muted">
                <Loader2 size={14} className="animate-spin" /> Loading…
              </div>
            ) : w.availableTools ? (
              <>
                {/* Specialists · subagents */}
                {w.availableTools.subagents.length > 0 && (
                  <div>
                    <ToolGroupHeader
                      label="Specialists"
                      technical="subagents"
                      count={w.subagents.length}
                      total={w.availableTools.subagents.length}
                      description="Bring in other agents to handle parts of the work"
                      allSelected={w.subagents.length === w.availableTools.subagents.length}
                      onToggleAll={() => toggleAll("subagents", w.availableTools!.subagents.map((x) => x.name))}
                    />
                    <div className="grid grid-cols-2 gap-2">
                      {w.availableTools.subagents.map((sa) => {
                        const selected = w.subagents.includes(sa.name);
                        return (
                          <button
                            key={sa.name}
                            onClick={() => toggle("subagents", sa.name)}
                            className={`flex items-start gap-2.5 rounded-lg border p-2.5 text-left transition ${
                              selected
                                ? "border-xyne-brand bg-xyne-brand"
                                : "border-xyne-border bg-xyne-surface hover:border-xyne-border-strong"
                            }`}
                          >
                            <span className="text-base">{SUBAGENT_EMOJI[sa.name] ?? "🤖"}</span>
                            <div className="min-w-0">
                              <div className={`text-[12px] font-medium truncate ${selected ? "text-xyne-fg-inverse" : "text-xyne-fg-secondary"}`}>
                                {sa.name}
                              </div>
                              {/* Description fades to a slightly transparent
                                  inverse when the card is selected so it
                                  still reads on the brand fill but stays
                                  subordinate to the name. */}
                              <div className={`text-[11px] line-clamp-2 ${selected ? "text-xyne-fg-inverse/70" : "text-xyne-fg-muted"}`}>
                                {sa.description.slice(0, 80)}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Direct actions · write tools */}
                {w.availableTools.writeTools.length > 0 && (
                  <div>
                    <ToolGroupHeader
                      label="Direct actions"
                      technical="write tools"
                      count={w.direct.filter((n) => writeToolNames.has(n)).length}
                      total={w.availableTools.writeTools.length}
                      description="Built-in actions this agent can perform"
                      allSelected={w.availableTools.writeTools.every((t) => w.direct.includes(t.name))}
                      onToggleAll={() => toggleAll("direct", w.availableTools!.writeTools.map((x) => x.name))}
                    />
                    <div className="flex flex-wrap gap-1.5">
                      {w.availableTools.writeTools.map((t) => (
                        <button
                          key={`${t.source}-${t.name}`}
                          onClick={() => toggle("direct", t.name)}
                          className={`rounded-full border px-2.5 py-1 text-[12px] transition ${
                            w.direct.includes(t.name)
                              ? "border-xyne-brand bg-xyne-brand text-xyne-fg-inverse"
                              : "border-xyne-border bg-xyne-surface text-xyne-fg-secondary hover:border-xyne-border-strong"
                          }`}
                        >
                          {t.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Integrations · MCP tools — grouped by source server. */}
                {(mcpEntries.length > 0 || w.availableTools.customGroups.length > 0) && (
                  <div>
                    {(() => {
                      const allMcpToolNames: string[] = [];
                      const allCustomSlugs: string[] = [];
                      for (const [, tools] of mcpEntries) {
                        for (const t of tools) {
                          if (!writeToolNames.has(t.name)) allMcpToolNames.push(t.name);
                        }
                      }
                      for (const g of w.availableTools.customGroups) {
                        for (const t of g.tools) allCustomSlugs.push(t.slug);
                      }
                      const totalIntegrations = allMcpToolNames.length + allCustomSlugs.length;
                      const selectedIntegrations =
                        w.direct.filter((n) => allMcpToolNames.includes(n)).length +
                        w.custom.filter((s) => allCustomSlugs.includes(s)).length;
                      const allSel =
                        totalIntegrations > 0 &&
                        allMcpToolNames.every((n) => w.direct.includes(n)) &&
                        allCustomSlugs.every((s) => w.custom.includes(s));
                      return (
                        <ToolGroupHeader
                          label="Integrations"
                          technical="MCP tools"
                          count={selectedIntegrations}
                          total={totalIntegrations}
                          description="Tools provided by connected MCP servers"
                          allSelected={allSel}
                          onToggleAll={() => {
                            setW((p) => ({
                              ...p,
                              direct: allSel
                                ? p.direct.filter((n) => !allMcpToolNames.includes(n))
                                : Array.from(new Set([...p.direct, ...allMcpToolNames])),
                              custom: allSel
                                ? p.custom.filter((s) => !allCustomSlugs.includes(s))
                                : Array.from(new Set([...p.custom, ...allCustomSlugs])),
                            }));
                          }}
                        />
                      );
                    })()}

                    <div className="space-y-3">
                      {/* MCP server-provided tools (direct list) */}
                      {mcpEntries.map(([source, tools]) => {
                        const serverTools = tools.filter((t) => !writeToolNames.has(t.name));
                        const names = serverTools.map((t) => t.name);
                        const allSel = names.length > 0 && names.every((x) => w.direct.includes(x));
                        return (
                          <div key={source} className="rounded-lg border border-xyne-border-subtle bg-xyne-surface-subtle/40 p-2.5">
                            <div className="flex items-center justify-between gap-2 mb-1.5">
                              <p className="text-[11px] font-medium text-xyne-fg-secondary">
                                {formatServerLabel(source)}
                                <span className="ml-1.5 text-xyne-fg-tertiary tabular-nums">
                                  {names.filter((n) => w.direct.includes(n)).length}/{names.length}
                                </span>
                              </p>
                              <button
                                onClick={() => toggleAll("direct", names)}
                                className="text-[11px] text-xyne-fg-tertiary hover:text-xyne-fg-primary transition"
                              >
                                {allSel ? "Deselect" : "Select all"}
                              </button>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {serverTools.map((t) => (
                                <button
                                  key={`${source}-${t.slug}`}
                                  onClick={() => toggle("direct", t.name)}
                                  className={`rounded-full border px-2.5 py-0.5 text-[12px] transition ${
                                    w.direct.includes(t.name)
                                      ? "border-xyne-brand bg-xyne-brand text-xyne-fg-inverse"
                                      : "border-xyne-border bg-xyne-surface text-xyne-fg-secondary hover:border-xyne-border-strong"
                                  }`}
                                >
                                  {t.name}
                                </button>
                              ))}
                            </div>
                          </div>
                        );
                      })}

                      {/* Custom MCP groups */}
                      {w.availableTools.customGroups.map((g) => {
                        const slugs = g.tools.map((t) => t.slug);
                        const allSel = slugs.every((x) => w.custom.includes(x));
                        const label = g.source.replace("custom:", "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
                        return (
                          <div key={g.source} className="rounded-lg border border-xyne-border-subtle bg-xyne-surface-subtle/40 p-2.5">
                            <div className="flex items-center justify-between gap-2 mb-1.5">
                              <p className="text-[11px] font-medium text-xyne-fg-secondary">
                                {label}
                                <span className="ml-1.5 text-xyne-fg-tertiary tabular-nums">
                                  {slugs.filter((s) => w.custom.includes(s)).length}/{slugs.length}
                                </span>
                              </p>
                              <button
                                onClick={() => toggleCustomGroup(slugs, allSel)}
                                className="text-[11px] text-xyne-fg-tertiary hover:text-xyne-fg-primary transition"
                              >
                                {allSel ? "Deselect" : "Select all"}
                              </button>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {g.tools.map((t) => (
                                <button
                                  key={t.slug}
                                  onClick={() => toggle("custom", t.slug)}
                                  className={`rounded-full border px-2.5 py-0.5 text-[12px] transition ${
                                    w.custom.includes(t.slug)
                                      ? "border-xyne-brand bg-xyne-brand text-xyne-fg-inverse"
                                      : "border-xyne-border bg-xyne-surface text-xyne-fg-secondary hover:border-xyne-border-strong"
                                  }`}
                                >
                                  {t.name}
                                </button>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            ) : <p className="text-[13px] text-xyne-fg-muted">Failed to load tools.</p>}
          </div>
        )}

        {/* ─── Step 3: Knowledge (was "Skills") ─────────────────────── */}
        {w.step === 3 && (
          <div className="space-y-4">
            <SectionCaption friendly="Knowledge" technical="skills" />
            {w.skillsLoading ? (
              <div className="flex items-center gap-2 text-[13px] text-xyne-fg-muted">
                <Loader2 size={14} className="animate-spin" /> Loading…
              </div>
            ) : w.availableSkills.length === 0 ? (
              <div className="rounded-lg border border-dashed border-xyne-border-subtle px-3 py-6 text-center text-[12px] text-xyne-fg-tertiary">
                No skills available. Create skills from the Skills page.
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
                              ? "border-xyne-brand bg-xyne-brand text-xyne-fg-inverse"
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
                              ? "border-xyne-brand bg-xyne-brand text-xyne-fg-inverse"
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
                {w.selectedSkillIds.length > 0 && (
                  <p className="text-[11px] text-xyne-fg-tertiary">
                    {w.selectedSkillIds.length} skill{w.selectedSkillIds.length === 1 ? "" : "s"} selected
                  </p>
                )}
              </>
            )}
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

            {/* Toolbox summary */}
            {(w.subagents.length > 0 || w.direct.length > 0 || w.custom.length > 0) && (
              <div>
                <SectionCaption friendly="Toolbox" technical="tools" />
                <div className="space-y-2">
                  {w.subagents.length > 0 && (
                    <div>
                      <p className="text-[11px] text-xyne-fg-tertiary mb-1">Specialists · {w.subagents.length}</p>
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
