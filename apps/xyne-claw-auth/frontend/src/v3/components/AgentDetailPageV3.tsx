import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import type { Agent, AgentLight, AgentShare, ScheduledJob } from "../../lib/types";
import type {
  ClaudeModelInfo,
  AvailableTools,
  DashboardAgentRow,
  ChainWorkflow,
  Skill,
  ProviderCredential,
} from "../../lib/api";
import {
  ApiError,
  getAgentDetail,
  getUserAgentConfig,
  updateAgent,
  submitAgentRequest,
  listScheduledJobs,
  listClaudeModelsForUser,
  getAvailableTools,
  setUserAgentConfig,
  listSkills,
  getAgentDashboard,
  listChainWorkflows,
  deleteChainWorkflow,
  deleteAgent,
  promoteAgent,
  demoteAgent,
  cloneAgent,
  listDelegationGrants,
  createDelegationGrant,
  deleteDelegationGrant,
  listAgents,
  listAgentShares,
  listProviderCredentials,
  listSandboxRepos,
  listSbxGitRepos,
  listResearchAgentProducts,
  listResearchAgentRepositories,
  type SandboxRepoOption,
  type SbxGitRepoOption,
  type ResearchAgentOption,
  type AgentDelegationGrant,
  type DelegationIdentityMode,
} from "../../lib/api";
import { ADMIN_REQUEST_FORWARDED_MESSAGE } from "../../lib/admin-request-notice";
import type { AgentProvider } from "../hooks/useAgents";
import { getAgentPermissions } from "../lib/agentPermissions";
import {
  MAX_DELEGATIONS_PER_RUN_BOUNDS,
  clampMaxDelegationsPerRun,
} from "../lib/delegationBudget";
import { useSnackbar } from "./ui/Snackbar";
import { AgentDetailHeader } from "./agent-detail/AgentDetailHeader";
import { AgentDetailLeftColumn } from "./agent-detail/AgentDetailLeftColumn";
import { AgentDetailRightColumn, type TabId } from "./agent-detail/AgentDetailRightColumn";
import { AgentDetailSkeleton } from "./agent-detail/AgentDetailSkeleton";
import { AgentNotFound } from "./agent-detail/AgentNotFound";
import type { AgentToolSelection } from "./ToolPickerDialog";
import { SkillPickerDialog } from "./SkillPickerDialog";
import { ChainWorkflowModal } from "./ChainWorkflowModal";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { RenameHandleDialog } from "./agent-detail/RenameHandleDialog";
import { CloneAgentDialog } from "./agent-detail/CloneAgentDialog";

/* ── helpers ───────────────────────────────────────────────────────── */

function extractToolsFromConfig(config: Record<string, unknown> | undefined | null): AgentToolSelection {
  const t = ((config ?? {}) as { tools?: Partial<AgentToolSelection> }).tools ?? {};
  return {
    subagents: t.subagents ?? [],
    direct:    t.direct ?? [],
    custom:    t.custom ?? [],
    gateway:   t.gateway ?? [],
    callableAgents: t.callableAgents ?? [],
  };
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((v) => s.has(v));
}

/* ── props ─────────────────────────────────────────────────────────── */

interface Props {
  userId: string;
  isAdmin: boolean;
}

/**
 * Default plan-mode primer prose. Pre-fills the plan-mode prompt editor; a custom
 * value is persisted only when it DIFFERS from this (else the runtime falls back
 * to its built-in default). Keep in sync with claw's `defaultPlanModePrimer`
 * (xyne-claw/src/routes/run.ts) and the dashboard's DEFAULT_PLAN_MODE_PROMPT
 * (dashboard/src/services/claw/behaviourConfig.ts). Only the GUIDANCE (how to
 * plan) is editable — the propose→approve gate + propose-plan contract are
 * enforced by the tool palette, never by this text.
 */
const DEFAULT_PLAN_MODE_PROMPT = [
  "## Plan mode — propose first, do NOT execute",
  "You are in PLAN MODE. You have READ-ONLY tools (search / read) and ONE terminal tool: `propose-plan`. You CANNOT edit, run commands, send messages, or otherwise take action yet — those tools are intentionally unavailable until the user approves.",
  "Do this, in order:",
  "1. Investigate ONLY as much as you need to write a concrete, correct plan (search / read the relevant context). Keep it lightweight — you are scoping, not solving.",
  '2. Call `propose-plan` ONCE with: the full ordered todo list (`{ id, title }` each — stable ids and CRISP titles: imperative, max 6–8 words, NO "Step 1"/"Stage 2"/number prefixes; the UI numbers them), and a `document` — the full plan written out in GitHub-flavored MARKDOWN (context, approach, what each step does and why, risks, expected outcome). The todos are the checklist; the document is the detailed brief shown when the user expands the plan. Also pass a `trivial` judgment. This call ENDS your turn immediately.',
  "3. Do NOT do the work, do NOT write a final answer, do NOT call any tool after propose-plan. The user reviews your plan, picks the steps to keep, and approves — only then does execution begin (in a fresh turn where you’ll have your full tools back).",
  "Set `trivial: true` ONLY for a genuinely simple, low-risk ask where an approval prompt would just be noise; then it starts immediately. When unsure, use `trivial: false`.",
].join("\n");

/* ── main component ────────────────────────────────────────────────── */

export function AgentDetailPageV3({ userId, isAdmin }: Props) {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { show: showSnackbar } = useSnackbar();

  /* ── core data ─────────────────────────────────────────────────── */
  const [agent, setAgent] = useState<Agent | null>(null);
  const [config, setConfig] = useState<{ provider: AgentProvider; model?: string | null }>({ provider: "spaces" });
  const [shares, setShares] = useState<AgentShare[]>([]);
  const [scheduledJobs, setScheduledJobs] = useState<ScheduledJob[]>([]);
  const [availableModels, setAvailableModels] = useState<ClaudeModelInfo[]>([]);
  const [availableTools, setAvailableTools] = useState<AvailableTools | null>(null);
  const [availableSkills, setAvailableSkills] = useState<Skill[]>([]);
  // Skills the agent already has, hydrated by the agent payload itself. Kept
  // separately because listSkills() only ever returns global skills plus the
  // VIEWER's own — a personal skill belonging to someone else (which is exactly
  // what a cloned agent carries) is absent from that list, and the skill pills
  // render off the palette, so without this the attached skill shows as nothing.
  const [attachedSkills, setAttachedSkills] = useState<Skill[]>([]);
  /** Skill palette for the Knowledge card: everything the viewer may pick from,
   *  plus any already-attached skill the listing doesn't include. */
  const skillPalette = useMemo(() => {
    const byId = new Map(availableSkills.map((sk) => [sk.id, sk]));
    for (const sk of attachedSkills) if (!byId.has(sk.id)) byId.set(sk.id, sk);
    return [...byId.values()];
  }, [availableSkills, attachedSkills]);

  /** User's per-provider credentials. Used to gray-out unconfigured providers
      in the Provider dropdown — Spaces is always available, every other
      provider is enabled only when the user has set up credentials. */
  const [providerCredentials, setProviderCredentials] = useState<ProviderCredential[]>([]);
  const [agentStats, setAgentStats] = useState<DashboardAgentRow | null>(null);
  const [loading, setLoading] = useState(true);

  /* ── form state ────────────────────────────────────────────────── */
  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [prompt, setPrompt] = useState("");
  const [draftTools, setDraftTools] = useState<AgentToolSelection>({ subagents: [], direct: [], custom: [], gateway: [], callableAgents: [] });
  const [draftSkillIds, setDraftSkillIds] = useState<string[]>([]);
  const [draftKbResources, setDraftKbResources] = useState<import("./KnowledgeBasePicker").KbSelection[]>([]);
  const [draftKbScope, setDraftKbScope] = useState<"COLLECTIONS" | "USER">("COLLECTIONS");
  const [draftProvider, setDraftProvider] = useState<AgentProvider>("spaces");
  const [draftModel, setDraftModel] = useState<string | null>(null);
  const [draftPromptInjection, setDraftPromptInjection] = useState("");
  // Sandbox repo pin (REPO_CONFIGS key). When set, the runtime forces
  // sandbox-repo-setup onto this repo. "" = agent chooses.
  const [draftSandboxRepo, setDraftSandboxRepo] = useState("");
  const [sandboxRepoOptions, setSandboxRepoOptions] = useState<SandboxRepoOption[]>([]);
  // Reviewer-style read-only multi-repo sandbox (agent.config.forceReadOnlySandbox):
  // routes every run to the shared read-only sbx-git sandbox (grep across all repos,
  // no per-project clone, mutating sandbox tools stripped).
  const [draftForceReadOnlySandbox, setDraftForceReadOnlySandbox] = useState(false);
  // Operator-selected repo focus for read-only agents (agent.config.sbxGitRepos).
  const [draftSbxGitRepos, setDraftSbxGitRepos] = useState<string[]>([]);
  const [sbxGitRepoOptions, setSbxGitRepoOptions] = useState<SbxGitRepoOption[]>([]);
  const [draftResearchAgentProductId, setDraftResearchAgentProductId] = useState("");
  const [draftResearchAgentRepositoryId, setDraftResearchAgentRepositoryId] = useState("");
  const [researchAgentProductOptions, setResearchAgentProductOptions] = useState<ResearchAgentOption[]>([]);
  const [researchAgentRepositoryOptions, setResearchAgentRepositoryOptions] = useState<ResearchAgentOption[]>([]);
  // Per-agent opt-in: when true, xyne-claw injects the `suggest-goal` tool
  // and a /goal-awareness primer. The agent can then propose a one-click
  // "Run autonomously" button (the `pendingGoalSuggestion` payload). Default
  // false so existing agents are unchanged.
  const [draftSuggestGoal, setDraftSuggestGoal] = useState(false);
  // Query prefetch opt-in (agent.config.prefetchContext). When on, xyne-claw
  // resolves the entities named in the question (channels, projects, people)
  // BEFORE the first model turn and attaches the ids to the prompt, so the
  // agent does not spend turns looking them up.
  const [draftPrefetchContext, setDraftPrefetchContext] = useState(false);
  // Per-agent opt-OUT: post the live plan/TODO card (from the todo-write tool)
  // into the Spaces thread. Default true (post) so existing agents are
  // unchanged; turning it off sets agent.config.postTodos=false, which
  // suppresses the card at claw-auth's doRenderPlanCard choke point. The agent
  // still tracks TODOs internally for loop discipline — only the render is hidden.
  const [draftPostTodos, setDraftPostTodos] = useState(true);
  // Per-agent opt-OUT: plan tracking itself (the todo-write/todo-read tools AND
  // the primer that mandates them). Default true. Distinct from postTodos above,
  // which only hides the rendered card — this removes the tools entirely, so no
  // turn is spent on plan bookkeeping. Off is for agents that answer in a single
  // message and get no value from the checklist.
  const [draftPlanTracking, setDraftPlanTracking] = useState(true);
  // Per-agent opt-in: when true, claw-auth's webhook wraps every user message
  // as `/goal <text>` before parsing, so every interaction with this agent
  // runs as an autonomous /goal loop. User-typed `/stop` and `/goal status`
  // still work (they start with `/` and bypass the wrap). Default false.
  const [draftAutoGoal, setDraftAutoGoal] = useState(false);
  // Plan mode opt-in (agent.config.planMode). When on, non-twin thread mentions
  // propose a plan and wait for approval before multi-step work. Default false.
  const [draftPlanMode, setDraftPlanMode] = useState(false);
  // Editable plan-mode primer (agent.config.planModePrompt) — how the agent scopes
  // a plan. Pre-filled with the default; only a CUSTOM value is persisted. Never
  // changes the propose→approve gate (enforced by the tool palette).
  const [draftPlanModePrompt, setDraftPlanModePrompt] = useState(DEFAULT_PLAN_MODE_PROMPT);
  // Per-run delegation budget (agent.config.maxDelegationsPerRun). Bounds how
  // many child-agent delegations one top-level run may make. Only persisted
  // when non-default; the runtime re-clamps to [1,25]. Default 3.
  const [draftMaxDelegations, setDraftMaxDelegations] = useState<number>(MAX_DELEGATIONS_PER_RUN_BOUNDS.DEFAULT);
  // Opt-in response verification (agent.config.verifyResponses). When on, the
  // agent delivers its final answer via submit-response, which checks factual
  // claims against gathered tool evidence before posting. Default false.
  const [draftVerifyResponses, setDraftVerifyResponses] = useState(false);
  // Opt-in citation reflection (agent.config.citationReflection). When on, after
  // the agent answers, xyne-claw nudges it once to add inline [clf-…] citations
  // if it drew on citeable sources but cited none. Cheap (regex + ≤1 re-prompt,
  // no extra LLM judge call). Default false.
  const [draftCitationReflection, setDraftCitationReflection] = useState(false);
  // Opt-in generic auto-citations (agent.config.autoToolCitations). When on,
  // xyne-claw chunks EVERY tool result that doesn't already self-cite and injects
  // [clf-…] tokens (+ a generic citation per chunk) so the model can cite any
  // tool's output. Tools that emit their own citations are untouched. Default false.
  const [draftAutoToolCitations, setDraftAutoToolCitations] = useState(false);
  // Per-agent delivery criteria (agent.config.verifyResponseCriteria) — free
  // text stacked ON TOP of the default factual check when verifyResponses is on.
  // Inverted semantics: absence of evidence for a stated requirement is a
  // failure (e.g. "must post a Proof-of-Testing video before claiming done").
  const [draftVerifyResponseCriteria, setDraftVerifyResponseCriteria] = useState("");
  // Structured output (agent.config.outputFormat). When enabled, xyne-claw
  // injects a `submit-result` tool the agent must deliver its final answer
  // through. Two modes: "json" (schema-constrained payload; optional markdown
  // render template for the chat reply) and "markdown" (agent writes markdown
  // directly; optional structural outline). Default off.
  const [draftOutputFormatEnabled, setDraftOutputFormatEnabled] = useState(false);
  const [draftOutputType, setDraftOutputType] = useState<"json" | "markdown">("json");
  const [draftOutputSchema, setDraftOutputSchema] = useState("");
  const [draftOutputTemplate, setDraftOutputTemplate] = useState("");
  // Process guard (outputFormat.requireToolsBeforeSubmit): comma/newline-
  // separated tool-name substrings that MUST run before submit-result is
  // accepted. Stops a schema-constrained agent from short-circuiting a multi-
  // step pipeline with an empty/placeholder payload. Empty = no guard.
  const [draftOutputRequireTools, setDraftOutputRequireTools] = useState("");
  const [skillTriggers, setSkillTriggers] = useState<
    Array<{ toolName: string; skillSlug: string; when: "before" | "after"; prompt: string }>
  >([]);

  /* ── UI state ──────────────────────────────────────────────────── */
  const [togglingEnabled, setTogglingEnabled] = useState(false);
  const [pushing, setPushing] = useState<"push_to_spaces" | "push_to_global" | null>(null);
  const [cloning, setCloning] = useState(false);
  const [cloneDialogOpen, setCloneDialogOpen] = useState(false);
  // Default landing tab — "overview" is the calm status dashboard ("Running
  // well") that summarizes activity/memory/people/connections; selecting a
  // card drops into that panel. Provider settings now live in the left
  // column's "Model & provider" card, not the right rail.
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);

  /* ── chain workflow state ──────────────────────────────────────── */
  const [chainWorkflows, setChainWorkflows] = useState<ChainWorkflow[]>([]);
  const [chainLoading, setChainLoading] = useState(true);
  const [chainModalOpen, setChainModalOpen] = useState(false);
  const [editingChainWorkflow, setEditingChainWorkflow] = useState<ChainWorkflow | null>(null);
  const [allAgents, setAllAgents] = useState<AgentLight[]>([]);
  const [delegationGrants, setDelegationGrants] = useState<AgentDelegationGrant[]>([]);
  const [delegationLoading, setDelegationLoading] = useState(false);
  const [deleteWorkflowTarget, setDeleteWorkflowTarget] = useState<ChainWorkflow | null>(null);

  /* ── delete agent state ────────────────────────────────────────── */
  const [deleteAgentOpen, setDeleteAgentOpen] = useState(false);
  const [deletingAgent, setDeletingAgent] = useState(false);

  /* ── admin moderation state ──────────────────────────────────────
   * For admins viewing an agent they don't own. Mirrors the trio in
   * AgentSlideOver — Promote, Demote, Delete — each gated behind a
   * ConfirmDialog so a mis-click doesn't ship a workspace-wide change. */
  const [adminConfirm, setAdminConfirm] =
    useState<"promote" | "demote" | null>(null);
  const [adminBusy, setAdminBusy] = useState<"promote" | "demote" | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);

  /* ── data fetching ─────────────────────────────────────────────── */

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    Promise.all([
      getAgentDetail(slug),
      getUserAgentConfig(slug, userId).catch(() => ({ provider: "spaces", model: null } as { provider: string; model: string | null })),
      listScheduledJobs({ agentSlug: slug, userId }).catch(() => [] as ScheduledJob[]),
      listClaudeModelsForUser(userId).catch(() => [] as ClaudeModelInfo[]),
      listAgents(userId).catch(() => [] as AgentLight[]),
      listChainWorkflows().catch(() => [] as Array<ChainWorkflow | { workflow: ChainWorkflow }>),
      listAgentShares(slug, userId).catch(() => [] as AgentShare[]),
    ])
      .then(([agentData, agentConfig, jobs, models, agentsList, rawWorkflows, sharesData]) => {
        setAgent(agentData);
        setScheduledJobs(jobs);
        setAvailableModels(models);
        setAllAgents(agentsList);
        setShares(sharesData);
        const provider = agentConfig.provider as AgentProvider;
        const model = agentConfig.model ?? null;
        setConfig({ provider, model });
        setDraftName(agentData.name);
        setDraftDescription(agentData.description ?? "");
        setPrompt(agentData.systemPrompt ?? agentData.description ?? "");
        setDraftTools(extractToolsFromConfig(agentData.config));
        setDraftSkillIds((agentData.skills ?? []).map((s) => s.skillId));
        setAttachedSkills(
          (agentData.skills ?? []).map((s) => ({ id: s.skillId, ...s.skill }) as Skill),
        );
        setDraftKbResources((agentData.collections ?? []).map((c) => ({ collectionId: c.collectionId, fileId: c.fileId })));
        setDraftKbScope(agentData.kbScope === "USER" ? "USER" : "COLLECTIONS");
        setDraftProvider(provider);
        setDraftModel(model);
        const promptInj = (agentData.config as { promptInjection?: string }).promptInjection ?? "";
        setDraftPromptInjection(promptInj);
        setDraftSandboxRepo((agentData.config as { sandboxRepo?: string }).sandboxRepo ?? "");
        setDraftForceReadOnlySandbox((agentData.config as { forceReadOnlySandbox?: boolean }).forceReadOnlySandbox === true);
        setDraftSbxGitRepos(Array.isArray((agentData.config as { sbxGitRepos?: string[] }).sbxGitRepos) ? (agentData.config as { sbxGitRepos: string[] }).sbxGitRepos : []);
        setDraftResearchAgentProductId((agentData.config as { product_id?: string | null; RESEARCH_AGENT_PRODUCT_ID?: string | null }).product_id ?? (agentData.config as { RESEARCH_AGENT_PRODUCT_ID?: string | null }).RESEARCH_AGENT_PRODUCT_ID ?? "");
        setDraftResearchAgentRepositoryId((agentData.config as { repository_id?: string | null; RESEARCH_AGENT_REPOSITORY_ID?: string | null }).repository_id ?? (agentData.config as { RESEARCH_AGENT_REPOSITORY_ID?: string | null }).RESEARCH_AGENT_REPOSITORY_ID ?? "");
        setDraftSuggestGoal((agentData.config as { suggestGoal?: boolean }).suggestGoal === true);
        setDraftPrefetchContext((agentData.config as { prefetchContext?: boolean }).prefetchContext === true);
        setDraftPostTodos((agentData.config as { postTodos?: boolean }).postTodos !== false);
        setDraftPlanTracking((agentData.config as { planTracking?: boolean }).planTracking !== false);
        setDraftAutoGoal((agentData.config as { autoGoal?: boolean }).autoGoal === true);
        setDraftPlanMode((agentData.config as { planMode?: boolean }).planMode === true);
        {
          const pmp = (agentData.config as { planModePrompt?: string }).planModePrompt;
          setDraftPlanModePrompt(typeof pmp === "string" && pmp.trim() ? pmp : DEFAULT_PLAN_MODE_PROMPT);
        }
        setDraftMaxDelegations(clampMaxDelegationsPerRun((agentData.config as { maxDelegationsPerRun?: unknown }).maxDelegationsPerRun));
        setDraftVerifyResponses((agentData.config as { verifyResponses?: boolean }).verifyResponses === true);
        setDraftCitationReflection((agentData.config as { citationReflection?: boolean }).citationReflection === true);
        setDraftAutoToolCitations((agentData.config as { autoToolCitations?: boolean }).autoToolCitations === true);
        setDraftVerifyResponseCriteria((agentData.config as { verifyResponseCriteria?: string }).verifyResponseCriteria ?? "");
        const outputFormat = (agentData.config as { outputFormat?: { type?: string; schema?: Record<string, unknown>; template?: string; requireToolsBeforeSubmit?: string[] } }).outputFormat;
        const ofType = outputFormat?.type === "markdown" ? "markdown" : "json";
        setDraftOutputFormatEnabled(outputFormat?.type === "json" || outputFormat?.type === "markdown");
        setDraftOutputType(ofType);
        setDraftOutputSchema(outputFormat?.schema ? JSON.stringify(outputFormat.schema, null, 2) : "");
        setDraftOutputTemplate(outputFormat?.template ?? "");
        setDraftOutputRequireTools(Array.isArray(outputFormat?.requireToolsBeforeSubmit) ? outputFormat.requireToolsBeforeSubmit.join(", ") : "");
        const rawTriggers = ((agentData.config as { skillTriggers?: Array<{ toolName: string; skillSlug: string; when: string; prompt?: string }> })?.skillTriggers ?? []);
        setSkillTriggers(rawTriggers.map((t) => ({ ...t, when: t.when as "before" | "after", prompt: t.prompt ?? "" })));

        const normalizedWorkflows = (rawWorkflows ?? [])
          .map((w) => ("workflow" in w ? w.workflow : w))
          .filter((w) => w.definition.nodes.some((n) => n.agentSlug === agentData.slug));
        setChainWorkflows(normalizedWorkflows);
      })
      .catch(console.error)
      .finally(() => {
        setLoading(false);
        setChainLoading(false);
      });
  }, [slug, userId]);

  useEffect(() => {
    getAvailableTools().then(setAvailableTools).catch(() => {});
    // Pass userId: without it the API falls back to scope='global' only, so a
    // personal skill attached to this agent renders as nothing at all — and a
    // cloned agent looks like its skills were never copied.
    listSkills(userId).then(setAvailableSkills).catch(() => {});
    listProviderCredentials(userId).then(setProviderCredentials).catch(() => {});
    listSandboxRepos().then(setSandboxRepoOptions).catch(() => {});
    listSbxGitRepos().then(setSbxGitRepoOptions).catch(() => {});
    listResearchAgentProducts().then(setResearchAgentProductOptions).catch(() => {});
    listResearchAgentRepositories().then(setResearchAgentRepositoryOptions).catch(() => {});
  }, [userId]);

  useEffect(() => {
    if (!slug) return;
    getAgentDashboard(userId, 30, 1000)
      .then((data) => {
        const row = data.agentTable.find((r) => r.agentSlug === slug);
        if (row) setAgentStats(row);
      })
      .catch(() => {});
  }, [slug, userId]);

  /* ── computed ──────────────────────────────────────────────────── */

  const permissions = useMemo(() => {
    if (!agent) return null;
    return getAgentPermissions(agent, userId, shares, isAdmin);
  }, [agent, userId, shares, isAdmin]);

  useEffect(() => {
    if (!slug || permissions?.role !== "owner") {
      setDelegationGrants([]);
      setDelegationLoading(false);
      return;
    }
    let cancelled = false;
    setDelegationLoading(true);
    listDelegationGrants(slug)
      .then((grants) => {
        if (!cancelled) setDelegationGrants(grants);
      })
      .catch((err) => {
        if (!cancelled) {
          console.error("[agent-detail] load delegation grants error:", err);
          setDelegationGrants([]);
        }
      })
      .finally(() => {
        if (!cancelled) setDelegationLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug, permissions?.role]);

  const dirty = useMemo(() => {
    if (!agent) return false;
    const basePrompt = agent.systemPrompt ?? agent.description ?? "";
    const baseTools = extractToolsFromConfig(agent.config);
    const baseSkills = (agent.skills ?? []).map((s) => s.skillId);
    const baseKb = (agent.collections ?? []).map((c) => `${c.collectionId}::${c.fileId ?? ""}`).sort();
    const draftKb = draftKbResources.map((r) => `${r.collectionId}::${r.fileId ?? ""}`).sort();
    const kbChanged = baseKb.length !== draftKb.length || baseKb.some((k, i) => k !== draftKb[i]);
    const baseKbScope: "COLLECTIONS" | "USER" = agent.kbScope === "USER" ? "USER" : "COLLECTIONS";
    const kbScopeChanged = draftKbScope !== baseKbScope;
    const basePromptInjection = (agent.config as { promptInjection?: string }).promptInjection ?? "";
    const baseSandboxRepo = (agent.config as { sandboxRepo?: string }).sandboxRepo ?? "";
    const baseForceReadOnlySandbox = (agent.config as { forceReadOnlySandbox?: boolean }).forceReadOnlySandbox === true;
    const baseSbxGitRepos = Array.isArray((agent.config as { sbxGitRepos?: string[] }).sbxGitRepos) ? (agent.config as { sbxGitRepos: string[] }).sbxGitRepos : [];
    const baseResearchAgentProductId = (agent.config as { product_id?: string | null; RESEARCH_AGENT_PRODUCT_ID?: string | null }).product_id ?? (agent.config as { RESEARCH_AGENT_PRODUCT_ID?: string | null }).RESEARCH_AGENT_PRODUCT_ID ?? "";
    const baseResearchAgentRepositoryId = (agent.config as { repository_id?: string | null; RESEARCH_AGENT_REPOSITORY_ID?: string | null }).repository_id ?? (agent.config as { RESEARCH_AGENT_REPOSITORY_ID?: string | null }).RESEARCH_AGENT_REPOSITORY_ID ?? "";
    const baseSuggestGoal = (agent.config as { suggestGoal?: boolean }).suggestGoal === true;
    const basePrefetchContext = (agent.config as { prefetchContext?: boolean }).prefetchContext === true;
    const basePostTodos = (agent.config as { postTodos?: boolean }).postTodos !== false;
    const basePlanTracking = (agent.config as { planTracking?: boolean }).planTracking !== false;
    const baseAutoGoal = (agent.config as { autoGoal?: boolean }).autoGoal === true;
    const basePlanMode = (agent.config as { planMode?: boolean }).planMode === true;
    const basePlanModePromptRaw = (agent.config as { planModePrompt?: string }).planModePrompt;
    const basePlanModePrompt =
      typeof basePlanModePromptRaw === "string" && basePlanModePromptRaw.trim()
        ? basePlanModePromptRaw
        : DEFAULT_PLAN_MODE_PROMPT;
    const baseMaxDelegations = clampMaxDelegationsPerRun((agent.config as { maxDelegationsPerRun?: unknown }).maxDelegationsPerRun);
    const baseVerifyResponses = (agent.config as { verifyResponses?: boolean }).verifyResponses === true;
    const baseCitationReflection = (agent.config as { citationReflection?: boolean }).citationReflection === true;
    const baseAutoToolCitations = (agent.config as { autoToolCitations?: boolean }).autoToolCitations === true;
    const baseVerifyResponseCriteria = (agent.config as { verifyResponseCriteria?: string }).verifyResponseCriteria ?? "";
    const baseOutputFormat = (agent.config as { outputFormat?: { type?: string; schema?: Record<string, unknown>; template?: string; requireToolsBeforeSubmit?: string[] } }).outputFormat;
    const baseOutputFormatEnabled = baseOutputFormat?.type === "json" || baseOutputFormat?.type === "markdown";
    const baseOutputType = baseOutputFormat?.type === "markdown" ? "markdown" : "json";
    const baseOutputSchema = baseOutputFormat?.schema ? JSON.stringify(baseOutputFormat.schema, null, 2) : "";
    const baseOutputTemplate = baseOutputFormat?.template ?? "";
    const baseOutputRequireTools = Array.isArray(baseOutputFormat?.requireToolsBeforeSubmit) ? baseOutputFormat.requireToolsBeforeSubmit.join(", ") : "";
    const baseTriggersRaw = ((agent.config as { skillTriggers?: Array<{ toolName: string; skillSlug: string; when: string; prompt?: string }> })?.skillTriggers ?? []);
    const baseTriggers = baseTriggersRaw.map((t) => ({ toolName: t.toolName, skillSlug: t.skillSlug, when: t.when, prompt: t.prompt ?? "" }));
    const triggersChanged = JSON.stringify(baseTriggers) !== JSON.stringify(skillTriggers);
    return (
      draftName !== agent.name ||
      draftDescription !== (agent.description ?? "") ||
      prompt !== basePrompt ||
      !sameSet(draftTools.subagents, baseTools.subagents) ||
      !sameSet(draftTools.direct, baseTools.direct) ||
      !sameSet(draftTools.custom, baseTools.custom) ||
      !sameSet(draftTools.gateway, baseTools.gateway) ||
      !sameSet(draftTools.callableAgents, baseTools.callableAgents) ||
      !sameSet(draftSkillIds, baseSkills) ||
      kbChanged ||
      kbScopeChanged ||
      draftProvider !== config.provider ||
      (draftModel ?? null) !== (config.model ?? null) ||
      draftPromptInjection !== basePromptInjection ||
      draftSandboxRepo !== baseSandboxRepo ||
      draftForceReadOnlySandbox !== baseForceReadOnlySandbox ||
      JSON.stringify([...draftSbxGitRepos].sort()) !== JSON.stringify([...baseSbxGitRepos].sort()) ||
      draftResearchAgentProductId !== baseResearchAgentProductId ||
      draftResearchAgentRepositoryId !== baseResearchAgentRepositoryId ||
      draftSuggestGoal !== baseSuggestGoal ||
      draftPrefetchContext !== basePrefetchContext ||
      draftPostTodos !== basePostTodos ||
      draftPlanTracking !== basePlanTracking ||
      draftAutoGoal !== baseAutoGoal ||
      draftPlanMode !== basePlanMode ||
      // Only counts as a change when plan mode is on (a prompt with no plan mode
      // is never persisted).
      (draftPlanMode && draftPlanModePrompt !== basePlanModePrompt) ||
      draftMaxDelegations !== baseMaxDelegations ||
      draftVerifyResponses !== baseVerifyResponses ||
      draftCitationReflection !== baseCitationReflection ||
      draftAutoToolCitations !== baseAutoToolCitations ||
      draftVerifyResponseCriteria !== baseVerifyResponseCriteria ||
      draftOutputFormatEnabled !== baseOutputFormatEnabled ||
      draftOutputType !== baseOutputType ||
      draftOutputSchema !== baseOutputSchema ||
      draftOutputTemplate !== baseOutputTemplate ||
      draftOutputRequireTools !== baseOutputRequireTools ||
      triggersChanged
    );
  }, [agent, config, draftName, draftDescription, prompt, draftTools, draftSkillIds, draftKbResources, draftKbScope, draftProvider, draftModel, draftPromptInjection, draftSandboxRepo, draftForceReadOnlySandbox, draftSbxGitRepos, draftResearchAgentProductId, draftResearchAgentRepositoryId, draftSuggestGoal, draftPrefetchContext, draftPostTodos, draftPlanTracking, draftAutoGoal, draftPlanMode, draftPlanModePrompt, draftMaxDelegations, draftVerifyResponses, draftCitationReflection, draftAutoToolCitations, draftVerifyResponseCriteria, draftOutputFormatEnabled, draftOutputType, draftOutputSchema, draftOutputTemplate, draftOutputRequireTools, skillTriggers]);

  /* ── handlers ──────────────────────────────────────────────────── */

  const handleJobsChange = useCallback((updatedJobs: ScheduledJob[]) => {
    setScheduledJobs(updatedJobs);
  }, []);

  const handleToggleEnabled = useCallback(async (v: boolean) => {
    if (!agent || togglingEnabled) return;
    const prevEnabled = agent.enabled;
    setTogglingEnabled(true);
    // Optimistically update the agent object — the header reads
    // `agent.enabled` for both the status badge and the Switch, so
    // updating a parallel `enabled` state alone would leave the UI stale
    // (the original bug).
    setAgent({ ...agent, enabled: v });
    try {
      await updateAgent(agent.slug, { enabled: v });
      showSnackbar({ variant: "success", title: `${agent.name} ${v ? "enabled" : "disabled"}` });
    } catch (err) {
      setAgent({ ...agent, enabled: prevEnabled });
      const msg = err instanceof Error ? err.message : "";
      const is403 = msg.includes("403") || msg.toLowerCase().includes("forbidden");
      showSnackbar({
        variant: "error",
        title: is403 ? "You don't have permission to modify this agent" : "Failed to update agent",
        description: !is403 && err instanceof Error ? err.message : undefined,
      });
    } finally {
      setTogglingEnabled(false);
    }
  }, [agent, togglingEnabled, showSnackbar]);

  const handleSaveConfig = useCallback(async () => {
    if (!agent || savingConfig || !dirty) return;
    setSavingConfig(true);
    try {
      const nextConfig = { ...(agent.config ?? {}) } as Record<string, unknown>;
      if (draftTools.subagents.length || draftTools.direct.length || draftTools.custom.length || draftTools.gateway.length || draftTools.callableAgents.length) {
        nextConfig.tools = draftTools;
      } else {
        delete nextConfig.tools;
      }
      if (draftPromptInjection) {
        nextConfig.promptInjection = draftPromptInjection;
      } else {
        delete nextConfig.promptInjection;
      }
      if (draftSandboxRepo) {
        nextConfig.sandboxRepo = draftSandboxRepo;
      } else {
        delete nextConfig.sandboxRepo;
      }
      if (draftForceReadOnlySandbox) {
        nextConfig.forceReadOnlySandbox = true;
      } else {
        delete nextConfig.forceReadOnlySandbox;
      }
      if (draftSbxGitRepos.length > 0) {
        nextConfig.sbxGitRepos = draftSbxGitRepos;
      } else {
        delete nextConfig.sbxGitRepos;
      }
      nextConfig.product_id = draftResearchAgentProductId || null;
      nextConfig.repository_id = draftResearchAgentRepositoryId || null;
      delete nextConfig.RESEARCH_AGENT_PRODUCT_ID;
      delete nextConfig.RESEARCH_AGENT_REPOSITORY_ID;
      if (draftPrefetchContext) {
        nextConfig.prefetchContext = true;
      } else {
        delete nextConfig.prefetchContext;
      }
      if (draftSuggestGoal) {
        nextConfig.suggestGoal = true;
      } else {
        delete nextConfig.suggestGoal;
      }
      // Post TODOs to the Spaces thread (agent.config.postTodos). Opt-OUT: the
      // default is to post the live plan card, so we only persist the flag when
      // it's turned OFF (postTodos:false). Turning it back on removes the key,
      // restoring the default. Enforced at claw-auth's doRenderPlanCard.
      if (draftPostTodos) {
        delete nextConfig.postTodos;
      } else {
        nextConfig.postTodos = false;
      }
      // Plan tracking (agent.config.planTracking). Opt-OUT, same shape: only
      // persisted when turned OFF, so existing agents keep today's behaviour.
      // Gates planToolsDefaultOn in xyne-claw, which owns both the todo tools
      // and the "Plan tracking — REQUIRED" primer.
      if (draftPlanTracking) {
        delete nextConfig.planTracking;
      } else {
        nextConfig.planTracking = false;
      }
      if (draftVerifyResponses) {
        nextConfig.verifyResponses = true;
        // Per-agent criteria only meaningful when verification is on.
        if (draftVerifyResponseCriteria.trim()) {
          nextConfig.verifyResponseCriteria = draftVerifyResponseCriteria.trim();
        } else {
          delete nextConfig.verifyResponseCriteria;
        }
      } else {
        delete nextConfig.verifyResponses;
        delete nextConfig.verifyResponseCriteria;
      }
      if (draftCitationReflection) {
        nextConfig.citationReflection = true;
      } else {
        delete nextConfig.citationReflection;
      }
      if (draftAutoToolCitations) {
        nextConfig.autoToolCitations = true;
      } else {
        delete nextConfig.autoToolCitations;
      }
      if (draftAutoGoal) {
        nextConfig.autoGoal = true;
      } else {
        delete nextConfig.autoGoal;
      }
      if (draftPlanMode) {
        nextConfig.planMode = true;
        // Persist a CUSTOM plan-mode prompt only (empty or unchanged-from-default ⇒
        // drop the key so the runtime uses its built-in default).
        const pmp = draftPlanModePrompt.trim();
        if (pmp && pmp !== DEFAULT_PLAN_MODE_PROMPT.trim()) {
          nextConfig.planModePrompt = draftPlanModePrompt;
        } else {
          delete nextConfig.planModePrompt;
        }
      } else {
        delete nextConfig.planMode;
        delete nextConfig.planModePrompt;
      }
      // Per-run delegation budget. Persist only a non-default value; DEFAULT
      // drops the key so the runtime falls back to its own default (kept in
      // sync in xyne-claw/src/agent-delegation.ts).
      if (draftMaxDelegations !== MAX_DELEGATIONS_PER_RUN_BOUNDS.DEFAULT) {
        nextConfig.maxDelegationsPerRun = clampMaxDelegationsPerRun(draftMaxDelegations);
      } else {
        delete nextConfig.maxDelegationsPerRun;
      }
      // Structured output. Parse + lightly validate here so the user gets an
      // inline error instead of a backend 400 on save (the backend re-validates
      // in agent-config-validation.ts).
      if (draftOutputFormatEnabled) {
        const template = draftOutputTemplate.trim();
        // Split on comma OR newline; trim; drop blanks. Empty → no guard key.
        const requireTools = draftOutputRequireTools
          .split(/[\n,]/)
          .map((t) => t.trim())
          .filter((t) => t.length > 0);
        const gate = requireTools.length > 0 ? { requireToolsBeforeSubmit: requireTools } : {};
        if (draftOutputType === "markdown") {
          nextConfig.outputFormat = { type: "markdown", ...(template ? { template } : {}), ...gate };
        } else {
          if (!draftOutputSchema.trim()) {
            showSnackbar({ variant: "error", title: "Add a JSON Schema for structured output, or turn it off" });
            setSavingConfig(false);
            return;
          }
          let parsedSchema: unknown;
          try {
            parsedSchema = JSON.parse(draftOutputSchema);
          } catch (err) {
            showSnackbar({ variant: "error", title: "Output schema is not valid JSON", description: err instanceof Error ? err.message : undefined });
            setSavingConfig(false);
            return;
          }
          if (!parsedSchema || typeof parsedSchema !== "object" || Array.isArray(parsedSchema) || typeof (parsedSchema as Record<string, unknown>)["type"] !== "string") {
            showSnackbar({ variant: "error", title: 'Output schema must be a JSON Schema object with a top-level "type"' });
            setSavingConfig(false);
            return;
          }
          nextConfig.outputFormat = { type: "json", schema: parsedSchema as Record<string, unknown>, ...(template ? { template } : {}), ...gate };
        }
      } else {
        delete nextConfig.outputFormat;
      }
      const activeTriggers = skillTriggers.filter((t) => t.toolName && t.skillSlug);
      if (activeTriggers.length > 0) {
        nextConfig.skillTriggers = activeTriggers;
      } else {
        delete nextConfig.skillTriggers;
      }

      const tasks: Promise<unknown>[] = [
        updateAgent(agent.slug, {
          name: draftName.trim(),
          description: draftDescription.trim(),
          systemPrompt: prompt,
          config: nextConfig,
          skills: draftSkillIds,
          // In USER scope, knowledgeBase[] is ignored server-side AND the
          // server clears any stored grants. Sending the array anyway is a
          // no-op; we skip it to keep the payload honest.
          ...(draftKbScope === "COLLECTIONS" ? { knowledgeBase: draftKbResources } : {}),
          kbScope: draftKbScope,
        }),
      ];

      const providerOrModelChanged =
        draftProvider !== config.provider || (draftModel ?? null) !== (config.model ?? null);
      if (providerOrModelChanged) {
        tasks.push(
          setUserAgentConfig(agent.slug, userId, {
            provider: draftProvider,
            model: draftModel ?? undefined,
          }),
        );
      }

      const [updatedAgent] = await Promise.all(tasks);
      setAgent(updatedAgent as Agent);
      if (providerOrModelChanged) {
        setConfig({ provider: draftProvider, model: draftModel });
      }
      showSnackbar({ variant: "success", title: "Configuration saved" });
    } catch (err) {
      showSnackbar({
        variant: "error",
        title: "Failed to save configuration",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSavingConfig(false);
    }
  }, [agent, draftName, draftDescription, prompt, draftTools, draftSkillIds, draftKbResources, draftKbScope, draftProvider, draftModel, draftPromptInjection, draftSandboxRepo, draftForceReadOnlySandbox, draftSbxGitRepos, draftResearchAgentProductId, draftResearchAgentRepositoryId, draftSuggestGoal, draftPrefetchContext, draftPostTodos, draftPlanTracking, draftAutoGoal, draftPlanMode, draftPlanModePrompt, draftMaxDelegations, draftVerifyResponses, draftCitationReflection, draftAutoToolCitations, draftVerifyResponseCriteria, draftOutputFormatEnabled, draftOutputType, draftOutputSchema, draftOutputTemplate, draftOutputRequireTools, skillTriggers, config, savingConfig, dirty, userId, showSnackbar]);

  const persistToolsConfig = useCallback(async (nextTools: AgentToolSelection): Promise<Agent> => {
    if (!agent) throw new Error("Agent not loaded");
    const nextConfig = { ...(agent.config ?? {}) } as Record<string, unknown>;
    if (
      nextTools.subagents.length ||
      nextTools.direct.length ||
      nextTools.custom.length ||
      nextTools.gateway.length ||
      nextTools.callableAgents.length
    ) {
      nextConfig.tools = nextTools;
    } else {
      delete nextConfig.tools;
    }
    const updated = await updateAgent(agent.slug, { config: nextConfig });
    setAgent(updated);
    setDraftTools(extractToolsFromConfig(updated.config));
    return updated;
  }, [agent]);

  const addCallableAgentSlug = useCallback((slugToAdd: string): AgentToolSelection => {
    const set = new Set(draftTools.callableAgents);
    set.add(slugToAdd);
    return { ...draftTools, callableAgents: Array.from(set) };
  }, [draftTools]);

  const removeCallableAgentSlug = useCallback((slugToRemove: string): AgentToolSelection => {
    return { ...draftTools, callableAgents: draftTools.callableAgents.filter((s) => s !== slugToRemove) };
  }, [draftTools]);

  const upsertGrantState = useCallback((grant: AgentDelegationGrant) => {
    setDelegationGrants((prev) => {
      const withoutExisting = prev.filter((g) => g.id !== grant.id && g.calleeAgentId !== grant.calleeAgentId);
      return [grant, ...withoutExisting];
    });
  }, []);

  const handleAddDelegationGrant = useCallback(async (calleeSlug: string, identityMode: DelegationIdentityMode, requestReason?: string) => {
    if (!agent) return;
    try {
      const grant = await createDelegationGrant(agent.slug, { calleeSlug, identityMode, requestReason });
      upsertGrantState(grant);
      await persistToolsConfig(addCallableAgentSlug(calleeSlug));
      if (grant.status === "approved") {
        showSnackbar({ variant: "success", title: "Delegation enabled", description: `${grant.callee?.name ?? calleeSlug} can now be delegated to.` });
      } else {
        const ownerName = grant.callee?.ownerName;
        showSnackbar({
          variant: "success",
          title: "Approval requested",
          description: ownerName
            ? `${ownerName} (owner of ${grant.callee?.name ?? calleeSlug}) has been asked to approve this delegation.`
            : `The owner of ${grant.callee?.name ?? calleeSlug} has been asked to approve this delegation.`,
        });
      }
    } catch (err) {
      showSnackbar({
        variant: "error",
        title: "Failed to enable delegation",
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }, [agent, addCallableAgentSlug, persistToolsConfig, upsertGrantState, showSnackbar]);

  const handleDeleteDelegationGrant = useCallback(async (grant: AgentDelegationGrant) => {
    if (!agent) return;
    const calleeSlug = grant.callee?.slug;
    try {
      await deleteDelegationGrant(agent.slug, grant.id);
      setDelegationGrants((prev) => prev.filter((g) => g.id !== grant.id));
      if (calleeSlug) await persistToolsConfig(removeCallableAgentSlug(calleeSlug));
      showSnackbar({ variant: "success", title: "Delegation removed" });
    } catch (err) {
      showSnackbar({
        variant: "error",
        title: "Failed to remove delegation",
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }, [agent, persistToolsConfig, removeCallableAgentSlug, showSnackbar]);

  const handleAddDelegationConfigEntry = useCallback(async (calleeSlug: string) => {
    try {
      await persistToolsConfig(addCallableAgentSlug(calleeSlug));
      showSnackbar({ variant: "success", title: "Delegation config fixed" });
    } catch (err) {
      showSnackbar({
        variant: "error",
        title: "Failed to fix delegation config",
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }, [addCallableAgentSlug, persistToolsConfig, showSnackbar]);

  const handleCreateDelegationGrantForConfig = useCallback(async (calleeSlug: string) => {
    if (!agent) return;
    try {
      const grant = await createDelegationGrant(agent.slug, { calleeSlug, identityMode: "user" });
      upsertGrantState(grant);
      await persistToolsConfig(addCallableAgentSlug(calleeSlug));
      showSnackbar({ variant: "success", title: "Delegation grant fixed" });
    } catch (err) {
      showSnackbar({
        variant: "error",
        title: "Failed to fix delegation grant",
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }, [agent, addCallableAgentSlug, persistToolsConfig, upsertGrantState, showSnackbar]);

  const handleRemoveDelegationConfigEntry = useCallback(async (calleeSlug: string) => {
    try {
      await persistToolsConfig(removeCallableAgentSlug(calleeSlug));
      showSnackbar({ variant: "success", title: "Delegation config removed" });
    } catch (err) {
      showSnackbar({
        variant: "error",
        title: "Failed to remove delegation config",
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }, [persistToolsConfig, removeCallableAgentSlug, showSnackbar]);

  const handleDeleteWorkflow = useCallback(async () => {
    if (!deleteWorkflowTarget) return;
    try {
      await deleteChainWorkflow(deleteWorkflowTarget.id);
      setChainWorkflows((prev) => prev.filter((w) => w.id !== deleteWorkflowTarget.id));
      showSnackbar({ variant: "success", title: "Workflow deleted" });
    } catch (err) {
      showSnackbar({
        variant: "error",
        title: "Failed to delete workflow",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setDeleteWorkflowTarget(null);
    }
  }, [deleteWorkflowTarget, showSnackbar]);

  const refreshChainWorkflows = useCallback(async () => {
    if (!agent) return;
    setChainLoading(true);
    try {
      const raw = await listChainWorkflows();
      const normalized = (raw ?? [])
        .map((w) => ("workflow" in w ? w.workflow : w))
        .filter((w) => w.definition.nodes.some((n) => n.agentSlug === agent.slug));
      setChainWorkflows(normalized);
    } catch {
      // silently fail
    } finally {
      setChainLoading(false);
    }
  }, [agent]);

  const handleDeleteAgent = useCallback(async () => {
    if (!agent || deletingAgent) return;
    setDeletingAgent(true);
    try {
      await deleteAgent(agent.slug, userId);
      showSnackbar({ variant: "success", title: `${agent.name} deleted` });
      navigate("/v3/agents");
    } catch (err) {
      showSnackbar({
        variant: "error",
        title: "Failed to delete agent",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setDeletingAgent(false);
      setDeleteAgentOpen(false);
    }
  }, [agent, deletingAgent, userId, navigate, showSnackbar]);

  const handlePush = useCallback(async (type: "push_to_spaces" | "push_to_global") => {
    if (!agent || pushing) return;
    setPushing(type);
    const isSpaces = type === "push_to_spaces";
    try {
      await submitAgentRequest(agent.slug, userId, type);
      showSnackbar({
        variant: "success",
        title: isSpaces ? "Pushed to Spaces" : "Pushed to Global",
        description: ADMIN_REQUEST_FORWARDED_MESSAGE,
      });
    } catch (err) {
      showSnackbar({
        variant: "error",
        title: isSpaces ? "Push to Spaces failed" : "Push to Global failed",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setPushing(null);
    }
  }, [agent, pushing, userId, showSnackbar]);

  /**
   * Clone the current agent. Owners/contributors/admins get an instant copy
   * (server returns cloned=true) and we navigate to the new agent so they can
   * pick a model before first run — provider/model is per-user config and does
   * not travel with the clone. Everyone else raises an approval request routed
   * to the owner (cloned=false).
   */
  const doClone = useCallback(async (name: string) => {
    if (!agent || cloning) return;
    setCloning(true);
    try {
      const result = await cloneAgent(agent.slug, userId, name);
      if (result.cloned) {
        showSnackbar({
          variant: "success",
          title: `Cloned "${agent.name}"`,
          description: "Your copy is ready — pick a model to start using it.",
        });
        setCloneDialogOpen(false);
        navigate(`/v3/agents/${result.agent.slug}`);
      } else {
        showSnackbar({
          variant: "success",
          title: "Clone request sent",
          description: `${agent.name}'s owner will review your request.`,
        });
        setCloneDialogOpen(false);
      }
    } catch (err) {
      const isDuplicate = err instanceof ApiError && err.status === 409;
      showSnackbar({
        variant: isDuplicate ? "info" : "error",
        title: isDuplicate ? "Request already pending" : "Clone failed",
        description: err instanceof Error ? err.message : undefined,
      });
      if (isDuplicate) setCloneDialogOpen(false);
    } finally {
      setCloning(false);
    }
  }, [agent, cloning, userId, navigate, showSnackbar]);

  /**
   * Admin moderation — promote or demote an agent the viewer does NOT own.
   * Both routes immediately mutate scope (no admin-request queue), so the
   * caller must have isAdmin = true; the UI gates the button accordingly.
   * On success we optimistically flip `agent.scope` locally so the header
   * badge updates without a refetch.
   */
  const runAdminAction = useCallback(
    async (action: "promote" | "demote") => {
      if (!agent || adminBusy) return;
      setAdminBusy(action);
      try {
        if (action === "promote") {
          await promoteAgent(agent.slug, userId);
          setAgent({ ...agent, scope: "global" });
          showSnackbar({
            variant: "success",
            title: `${agent.name} promoted to global`,
          });
        } else {
          await demoteAgent(agent.slug, userId);
          setAgent({ ...agent, scope: "personal" });
          showSnackbar({
            variant: "success",
            title: `${agent.name} demoted to personal`,
          });
        }
      } catch (err) {
        showSnackbar({
          variant: "error",
          title: action === "promote" ? "Promote failed" : "Demote failed",
          description: err instanceof Error ? err.message : undefined,
        });
      } finally {
        setAdminBusy(null);
        setAdminConfirm(null);
      }
    },
    [agent, adminBusy, userId, showSnackbar],
  );

  const toggleSkill = useCallback((skillId: string) => {
    setDraftSkillIds((prev) =>
      prev.includes(skillId) ? prev.filter((id) => id !== skillId) : [...prev, skillId]
    );
  }, []);

  /* ── render guards ─────────────────────────────────────────────── */

  if (loading) {
    return <AgentDetailSkeleton />;
  }

  if (!agent) {
    return <AgentNotFound onBack={() => navigate("/v3/agents")} />;
  }

  if (!permissions?.canViewPage) {
    navigate("/v3/agents");
    return null;
  }

  /* ── render ────────────────────────────────────────────────────── */

  return (
    <>
      <div data-id="agent-detail-page" className="flex h-full flex-col overflow-hidden bg-xyne-surface">
        <AgentDetailHeader
          agent={agent}
          permissions={permissions}
          dirty={dirty}
          saving={savingConfig}
          onSave={handleSaveConfig}
          onToggleEnabled={handleToggleEnabled}
          onBack={() => navigate("/v3/agents")}
          onDelete={() => setDeleteAgentOpen(true)}
          onPublish={() => handlePush("push_to_global")}
          publishing={pushing === "push_to_global"}
          userId={userId}
          isAdmin={isAdmin}
          onAdminPromote={() => setAdminConfirm("promote")}
          onAdminDemote={() => setAdminConfirm("demote")}
          adminBusy={adminBusy}
          onClone={() => setCloneDialogOpen(true)}
          cloning={cloning}
          cloneNeedsApproval={!permissions?.canEdit}
        />

        <div className="flex flex-1 overflow-hidden">
          <AgentDetailLeftColumn
            agent={agent}
            userId={userId}
            permissions={permissions}
            draftName={draftName}
            onDraftNameChange={setDraftName}
            draftDescription={draftDescription}
            onDraftDescriptionChange={setDraftDescription}
            draftProvider={draftProvider}
            onDraftProviderChange={setDraftProvider}
            providerCredentials={providerCredentials}
            draftModel={draftModel}
            onDraftModelChange={setDraftModel}
            availableModels={availableModels}
            prompt={prompt}
            onPromptChange={setPrompt}
            draftTools={draftTools}
            onDraftToolsChange={setDraftTools}
            availableTools={availableTools}
            allAgents={allAgents}
            delegationGrants={delegationGrants}
            delegationLoading={delegationLoading}
            currentUserId={userId}
            onAddDelegationGrant={handleAddDelegationGrant}
            onDeleteDelegationGrant={handleDeleteDelegationGrant}
            onAddDelegationConfigEntry={handleAddDelegationConfigEntry}
            onCreateDelegationGrantForConfig={handleCreateDelegationGrantForConfig}
            onRemoveDelegationConfigEntry={handleRemoveDelegationConfigEntry}
            draftSkillIds={draftSkillIds}
            onToggleSkill={toggleSkill}
            availableSkills={skillPalette}
            draftKbResources={draftKbResources}
            onDraftKbResourcesChange={setDraftKbResources}
            draftKbScope={draftKbScope}
            onDraftKbScopeChange={setDraftKbScope}
            skillTriggers={skillTriggers}
            onSkillTriggersChange={setSkillTriggers}
            draftPromptInjection={draftPromptInjection}
            onDraftPromptInjectionChange={setDraftPromptInjection}
            draftSandboxRepo={draftSandboxRepo}
            onDraftSandboxRepoChange={setDraftSandboxRepo}
            sandboxRepoOptions={sandboxRepoOptions}
            draftForceReadOnlySandbox={draftForceReadOnlySandbox}
            onDraftForceReadOnlySandboxChange={setDraftForceReadOnlySandbox}
            draftSbxGitRepos={draftSbxGitRepos}
            onDraftSbxGitReposChange={setDraftSbxGitRepos}
            sbxGitRepoOptions={sbxGitRepoOptions}
            draftResearchAgentProductId={draftResearchAgentProductId}
            onDraftResearchAgentProductIdChange={setDraftResearchAgentProductId}
            researchAgentProductOptions={researchAgentProductOptions}
            draftResearchAgentRepositoryId={draftResearchAgentRepositoryId}
            onDraftResearchAgentRepositoryIdChange={setDraftResearchAgentRepositoryId}
            researchAgentRepositoryOptions={researchAgentRepositoryOptions}
            draftSuggestGoal={draftSuggestGoal}
            onDraftSuggestGoalChange={setDraftSuggestGoal}
            draftPrefetchContext={draftPrefetchContext}
            onDraftPrefetchContextChange={setDraftPrefetchContext}
            draftPostTodos={draftPostTodos}
            onDraftPostTodosChange={setDraftPostTodos}
            draftPlanTracking={draftPlanTracking}
            onDraftPlanTrackingChange={setDraftPlanTracking}
            draftVerifyResponses={draftVerifyResponses}
            onDraftVerifyResponsesChange={setDraftVerifyResponses}
            draftCitationReflection={draftCitationReflection}
            onDraftCitationReflectionChange={setDraftCitationReflection}
            draftAutoToolCitations={draftAutoToolCitations}
            onDraftAutoToolCitationsChange={setDraftAutoToolCitations}
            draftVerifyResponseCriteria={draftVerifyResponseCriteria}
            onDraftVerifyResponseCriteriaChange={setDraftVerifyResponseCriteria}
            draftAutoGoal={draftAutoGoal}
            onDraftAutoGoalChange={setDraftAutoGoal}
            draftPlanMode={draftPlanMode}
            onDraftPlanModeChange={setDraftPlanMode}
            draftPlanModePrompt={draftPlanModePrompt}
            onDraftPlanModePromptChange={setDraftPlanModePrompt}
            draftMaxDelegations={draftMaxDelegations}
            onDraftMaxDelegationsChange={setDraftMaxDelegations}
            draftOutputFormatEnabled={draftOutputFormatEnabled}
            onDraftOutputFormatEnabledChange={setDraftOutputFormatEnabled}
            draftOutputType={draftOutputType}
            onDraftOutputTypeChange={setDraftOutputType}
            draftOutputSchema={draftOutputSchema}
            onDraftOutputSchemaChange={setDraftOutputSchema}
            draftOutputTemplate={draftOutputTemplate}
            onDraftOutputTemplateChange={setDraftOutputTemplate}
            draftOutputRequireTools={draftOutputRequireTools}
            onDraftOutputRequireToolsChange={setDraftOutputRequireTools}
            onOpenSkillPicker={() => setSkillPickerOpen(true)}
            onRequestRenameHandle={() => setRenameOpen(true)}
          />

          <AgentDetailRightColumn
            agent={agent}
            userId={userId}
            permissions={permissions}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            onAgentUpdated={setAgent}
            scheduledJobs={scheduledJobs}
            onJobsChange={handleJobsChange}
            agentStats={agentStats}
            shareCount={shares.length}
            workflows={chainWorkflows}
            workflowsLoading={chainLoading}
            onCreateWorkflow={() => {
              setEditingChainWorkflow(null);
              setChainModalOpen(true);
            }}
            onEditWorkflow={(workflow) => {
              setEditingChainWorkflow(workflow);
              setChainModalOpen(true);
            }}
            onDeleteWorkflow={(workflow) => setDeleteWorkflowTarget(workflow)}
          />
        </div>
      </div>

      <SkillPickerDialog
        open={skillPickerOpen}
        onOpenChange={setSkillPickerOpen}
        userId={userId}
        selectedIds={draftSkillIds}
        onApply={(ids) => setDraftSkillIds(ids)}
      />

      <ChainWorkflowModal
        open={chainModalOpen}
        onOpenChange={setChainModalOpen}
        agents={allAgents}
        onSaved={refreshChainWorkflows}
        editingWorkflow={editingChainWorkflow}
      />

      <ConfirmDialog
        open={!!deleteWorkflowTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteWorkflowTarget(null);
        }}
        title="Delete workflow?"
        description={`"${deleteWorkflowTarget?.name ?? ""}" will be permanently removed. This cannot be undone.`}
        confirmLabel="Delete"
        danger
        onConfirm={handleDeleteWorkflow}
      />

      <ConfirmDialog
        open={deleteAgentOpen}
        onOpenChange={(open) => {
          setDeleteAgentOpen(open);
          if (!open) setDeletingAgent(false);
        }}
        title="Delete agent?"
        description={`"${agent.name}" will be permanently deleted. This cannot be undone.`}
        confirmLabel="Delete"
        danger
        onConfirm={handleDeleteAgent}
      />

      <ConfirmDialog
        open={adminConfirm !== null}
        onOpenChange={(open) => {
          if (!open && !adminBusy) setAdminConfirm(null);
        }}
        title={adminConfirm === "promote" ? "Promote agent?" : "Demote agent?"}
        description={
          adminConfirm === "promote"
            ? `Promote "${agent.name}" to global? It will become visible to everyone in the workspace.`
            : `Demote "${agent.name}" to personal? It will no longer be visible to other users.`
        }
        confirmLabel={adminConfirm === "promote" ? "Promote" : "Demote"}
        onConfirm={() => {
          if (adminConfirm) void runAdminAction(adminConfirm);
        }}
      />

      <RenameHandleDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        currentHandle={agent.slug}
        onRenamed={(newHandle) => {
          // Follow the rename: the page lives at /v3/agents/:slug, so
          // staying on the current URL would 404. `replace: true` so the
          // old slug doesn't sit in browser history.
          showSnackbar({ variant: "success", title: `Renamed to "${newHandle}"` });
          navigate(`/v3/agents/${newHandle}`, { replace: true });
        }}
      />

      <CloneAgentDialog
        open={cloneDialogOpen}
        onOpenChange={setCloneDialogOpen}
        sourceName={agent.name}
        needsApproval={!permissions?.canEdit}
        isOwnAgent={agent.ownerUserId === userId}
        sourceEnabled={agent.enabled}
        submitting={cloning}
        onConfirm={(name) => void doClone(name)}
      />
    </>
  );
}
