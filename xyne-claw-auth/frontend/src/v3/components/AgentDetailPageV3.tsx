import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import type { Agent, AgentShare, ScheduledJob } from "../../lib/types";
import type {
  ClaudeModelInfo,
  AvailableTools,
  DashboardAgentRow,
  ChainWorkflow,
  Skill,
  ProviderCredential,
} from "../../lib/api";
import {
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
  listAgents,
  listAgentShares,
  listProviderCredentials,
} from "../../lib/api";
import { ADMIN_REQUEST_FORWARDED_MESSAGE } from "../../lib/admin-request-notice";
import type { AgentProvider } from "../hooks/useAgents";
import { getAgentPermissions } from "../lib/agentPermissions";
import { useSnackbar } from "./ui/Snackbar";
import { AgentDetailHeader } from "./agent-detail/AgentDetailHeader";
import { AgentDetailLeftColumn } from "./agent-detail/AgentDetailLeftColumn";
import { AgentDetailRightColumn, type TabId } from "./agent-detail/AgentDetailRightColumn";
import { AgentDetailSkeleton } from "./agent-detail/AgentDetailSkeleton";
import { AgentNotFound } from "./agent-detail/AgentNotFound";
import { ToolPickerDialog, type AgentToolSelection } from "./ToolPickerDialog";
import { SkillPickerDialog } from "./SkillPickerDialog";
import { ChainWorkflowModal } from "./ChainWorkflowModal";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { RenameHandleDialog } from "./agent-detail/RenameHandleDialog";

/* ── helpers ───────────────────────────────────────────────────────── */

function extractToolsFromConfig(config: Record<string, unknown> | undefined | null): AgentToolSelection {
  const t = ((config ?? {}) as { tools?: Partial<AgentToolSelection> }).tools ?? {};
  return {
    subagents: t.subagents ?? [],
    direct:    t.direct ?? [],
    custom:    t.custom ?? [],
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
  const [draftTools, setDraftTools] = useState<AgentToolSelection>({ subagents: [], direct: [], custom: [] });
  const [draftSkillIds, setDraftSkillIds] = useState<string[]>([]);
  const [draftProvider, setDraftProvider] = useState<AgentProvider>("spaces");
  const [draftModel, setDraftModel] = useState<string | null>(null);
  const [draftGitRepoUrl, setDraftGitRepoUrl] = useState("");
  const [draftPromptInjection, setDraftPromptInjection] = useState("");
  const [skillTriggers, setSkillTriggers] = useState<
    Array<{ toolName: string; skillSlug: string; when: "before" | "after"; prompt: string }>
  >([]);

  /* ── UI state ──────────────────────────────────────────────────── */
  const [togglingEnabled, setTogglingEnabled] = useState(false);
  const [pushing, setPushing] = useState<"push_to_spaces" | "push_to_global" | null>(null);
  // Default landing tab — "run-history" is the highest-signal idle view
  // (shows what the agent has actually done lately). The previous
  // "preview" default was a static summary that mirrored the form; the
  // panel was removed for now — see AgentPreviewPanel.tsx (orphaned).
  const [activeTab, setActiveTab] = useState<TabId>("run-history");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);

  /* ── chain workflow state ──────────────────────────────────────── */
  const [chainWorkflows, setChainWorkflows] = useState<ChainWorkflow[]>([]);
  const [chainLoading, setChainLoading] = useState(true);
  const [chainModalOpen, setChainModalOpen] = useState(false);
  const [editingChainWorkflow, setEditingChainWorkflow] = useState<ChainWorkflow | null>(null);
  const [allAgents, setAllAgents] = useState<Agent[]>([]);
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
      listAgents(userId).catch(() => [] as Agent[]),
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
        setDraftProvider(provider);
        setDraftModel(model);
        const gitUrl = (agentData.config as { gitRepoUrl?: string }).gitRepoUrl ?? "";
        setDraftGitRepoUrl(gitUrl);
        const promptInj = (agentData.config as { promptInjection?: string }).promptInjection ?? "";
        setDraftPromptInjection(promptInj);
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
    listSkills().then(setAvailableSkills).catch(() => {});
    listProviderCredentials(userId).then(setProviderCredentials).catch(() => {});
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

  const dirty = useMemo(() => {
    if (!agent) return false;
    const basePrompt = agent.systemPrompt ?? agent.description ?? "";
    const baseTools = extractToolsFromConfig(agent.config);
    const baseSkills = (agent.skills ?? []).map((s) => s.skillId);
    const baseGitUrl = (agent.config as { gitRepoUrl?: string }).gitRepoUrl ?? "";
    const basePromptInjection = (agent.config as { promptInjection?: string }).promptInjection ?? "";
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
      !sameSet(draftSkillIds, baseSkills) ||
      draftProvider !== config.provider ||
      (draftModel ?? null) !== (config.model ?? null) ||
      draftGitRepoUrl !== baseGitUrl ||
      draftPromptInjection !== basePromptInjection ||
      triggersChanged
    );
  }, [agent, config, draftName, draftDescription, prompt, draftTools, draftSkillIds, draftProvider, draftModel, draftGitRepoUrl, draftPromptInjection, skillTriggers]);

  /* ── handlers ──────────────────────────────────────────────────── */

  const handleTriggerToggle = useCallback((job: ScheduledJob, active: boolean) => {
    setScheduledJobs((prev) =>
      prev.map((j) => (j.id === job.id ? { ...j, status: active ? "active" : "paused" } : j))
    );
    showSnackbar({
      variant: "info",
      title: `Trigger ${active ? "enabled" : "paused"}`,
      description: "Persistence not wired yet",
    });
  }, [showSnackbar]);

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
      if (draftTools.subagents.length || draftTools.direct.length || draftTools.custom.length) {
        nextConfig.tools = draftTools;
      } else {
        delete nextConfig.tools;
      }
      if (draftGitRepoUrl) {
        nextConfig.gitRepoUrl = draftGitRepoUrl;
      } else {
        delete nextConfig.gitRepoUrl;
      }
      if (draftPromptInjection) {
        nextConfig.promptInjection = draftPromptInjection;
      } else {
        delete nextConfig.promptInjection;
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
  }, [agent, draftName, draftDescription, prompt, draftTools, draftSkillIds, draftProvider, draftModel, draftGitRepoUrl, draftPromptInjection, skillTriggers, config, savingConfig, dirty, userId, showSnackbar]);

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
        />

        <div className="flex flex-1 overflow-hidden">
          <AgentDetailLeftColumn
            agent={agent}
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
            draftSkillIds={draftSkillIds}
            onToggleSkill={toggleSkill}
            availableSkills={availableSkills}
            skillTriggers={skillTriggers}
            onSkillTriggersChange={setSkillTriggers}
            draftPromptInjection={draftPromptInjection}
            onDraftPromptInjectionChange={setDraftPromptInjection}
            onOpenToolPicker={() => setPickerOpen(true)}
            onOpenSkillPicker={() => setSkillPickerOpen(true)}
            onRequestRenameHandle={() => setRenameOpen(true)}
          />

          <AgentDetailRightColumn
            agent={agent}
            userId={userId}
            permissions={permissions}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            scheduledJobs={scheduledJobs}
            onToggleJob={handleTriggerToggle}
            agentStats={agentStats}
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

      <ToolPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        initial={draftTools}
        onSave={(next) => setDraftTools(next)}
      />

      <SkillPickerDialog
        open={skillPickerOpen}
        onOpenChange={setSkillPickerOpen}
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
    </>
  );
}
