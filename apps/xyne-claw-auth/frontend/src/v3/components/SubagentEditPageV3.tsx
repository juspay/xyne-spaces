/**
 * SubagentEditPageV3 — subagent configuration.
 *
 * Layout (single-column, tab-based — replaces the previous two-column split):
 *
 *   ┌──────────────────────── header (sticky) ───────────────────────┐
 *   │  ← Subagents | name + badges + meta-line | Save · Switch       │
 *   ├────────────────────────────────────────────────────────────────┤
 *   │           Persona · Knowledge · Tools · Contributors           │
 *   │           ────────                                             │
 *   │              ┌──────────────────────────┐                      │
 *   │              │  tab content (max-w-860) │                      │
 *   │              │                          │                      │
 *   │              └──────────────────────────┘                      │
 *   └────────────────────────────────────────────────────────────────┘
 *
 * Information architecture (vs. the old 7-inner-tab two-column UI):
 *
 *   - Persona tab       identity strip (name + description) + system prompt
 *                       + a "Used by" footer (absorbed from the right
 *                       column's Usage tab — kept here as glance-info so
 *                       users see consumption alongside who-this-is).
 *   - Knowledge tab     parameter contract (param name + param description
 *                       + progress labels) + skills (markdown playbooks).
 *                       Groups everything the subagent works with: what the
 *                       parent passes in and what reference material the
 *                       subagent draws from.
 *   - Tools tab         direct + custom tool inputs, gets the room it needs.
 *   - Contributors tab  was "Shares". Renamed for plain English.
 *
 * The old "Details" (source, created, updated) tab is gone — that info now
 * lives in the header as a small meta-line, since it's glance-info and never
 * interactive.
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useSubagentDetail } from "../hooks/useSubagentDetail";
import {
  listSkills,
  getAvailableTools,
  updateSubagent,
  enableSubagent,
  disableSubagent,
  addSubagentShare,
  removeSubagentShare,
} from "../../lib/api";
import type { AvailableTools, Skill, SubagentShareEntry } from "../../lib/api";
import { useSnackbar } from "./ui/Snackbar";
import { SubagentEditHeader } from "./subagents/SubagentEditHeader";
import { SubagentEditSkeleton } from "./subagents/SubagentEditSkeleton";
import { SubagentNotFound } from "./subagents/SubagentNotFound";
import { SubagentPersonaTab } from "./subagents/SubagentPersonaTab";
import { SubagentKnowledgeTab } from "./subagents/SubagentKnowledgeTab";
import { SubagentToolsTab } from "./subagents/SubagentToolsTab";
import { SubagentContributorsTab } from "./subagents/SubagentContributorsTab";
import { Tabs, type TabItem } from "./ui/Tabs";

/* ── helpers ───────────────────────────────────────────────────────── */

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((v) => s.has(v));
}

function normalizeToolsInput(input: string): string[] {
  return input
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/* ── tab IDs ───────────────────────────────────────────────────────── */

type SubagentTopTabId = "persona" | "knowledge" | "tools" | "contributors";

/* ── props ─────────────────────────────────────────────────────────── */

interface SubagentEditPageV3Props {
  userId: string;
  isAdmin: boolean;
}

/* ── component ─────────────────────────────────────────────────────── */

export function SubagentEditPageV3({
  userId,
  isAdmin,
}: SubagentEditPageV3Props) {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const { show: showSnackbar } = useSnackbar();

  /* ── data ──────────────────────────────────────────────────────── */
  const {
    subagent: loadedSubagent,
    shares: loadedShares,
    loading,
  } = useSubagentDetail(name, userId);

  /* ── local copies for optimistic updates ───────────────────────── */
  const [subagent, setSubagent] = useState(loadedSubagent);
  const [shares, setShares] = useState<SubagentShareEntry[]>(loadedShares);

  useEffect(() => {
    if (loadedSubagent) setSubagent(loadedSubagent);
  }, [loadedSubagent]);
  useEffect(() => {
    setShares(loadedShares);
  }, [loadedShares]);

  /* ── form state ────────────────────────────────────────────────── */
  const [draftDescription, setDraftDescription] = useState("");
  const [draftSystemPrompt, setDraftSystemPrompt] = useState("");
  const [draftParamName, setDraftParamName] = useState("");
  const [draftParamDescription, setDraftParamDescription] = useState("");
  const [draftProgressLabels, setDraftProgressLabels] = useState<string[]>([]);
  const [draftDirectTools, setDraftDirectTools] = useState("");
  const [draftCustomTools, setDraftCustomTools] = useState("");
  const [draftSkillIds, setDraftSkillIds] = useState<string[]>([]);

  /* ── available skills ──────────────────────────────────────────── */
  const [availableSkills, setAvailableSkills] = useState<Skill[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(true);

  /* ── available tools (write / MCP server / custom) ─────────────── */
  /* Fetched once for the chip-picker on the Tools tab. Same shape the
     create-agent wizard and V1 SubagentDetailPage use, so the picker
     groups are consistent across surfaces. */
  const [availableTools, setAvailableTools] = useState<AvailableTools | null>(null);
  const [toolsLoading, setToolsLoading] = useState(true);

  /* ── UI state ──────────────────────────────────────────────────── */
  const [activeTab, setActiveTab] = useState<SubagentTopTabId>("persona");
  const [saving, setSaving] = useState(false);
  const [togglingEnabled, setTogglingEnabled] = useState(false);
  const [addingShare, setAddingShare] = useState(false);

  /* ── init form from loaded subagent ────────────────────────────── */
  useEffect(() => {
    if (!subagent) return;
    setDraftDescription(subagent.description);
    setDraftSystemPrompt(subagent.systemPrompt);
    setDraftParamName(subagent.paramName || "question");
    setDraftParamDescription(subagent.paramDescription);
    setDraftProgressLabels(
      subagent.progressLabels?.length ? subagent.progressLabels : [""],
    );
    setDraftDirectTools((subagent.tools?.direct ?? []).join("\n"));
    setDraftCustomTools((subagent.tools?.custom ?? []).join("\n"));
    setDraftSkillIds((subagent.skills ?? []).map((s) => s.id));
  }, [subagent?.name]);

  /* ── fetch skills ──────────────────────────────────────────────── */
  useEffect(() => {
    setSkillsLoading(true);
    listSkills(userId)
      .then(setAvailableSkills)
      .catch(() => {})
      .finally(() => setSkillsLoading(false));
  }, [userId]);

  /* ── fetch available tools ─────────────────────────────────────── */
  useEffect(() => {
    setToolsLoading(true);
    getAvailableTools()
      .then(setAvailableTools)
      .catch(() => {})
      .finally(() => setToolsLoading(false));
  }, []);

  /* ── computed ──────────────────────────────────────────────────── */
  const isBuiltIn = subagent?.source === "builtin";
  const canEdit =
    !isBuiltIn &&
    ((subagent?.createdByUserId === userId) || isAdmin);

  const dirty = useMemo(() => {
    if (!subagent) return false;
    const origDirect = (subagent.tools?.direct ?? []).join("\n");
    const origCustom = (subagent.tools?.custom ?? []).join("\n");
    const origSkillIds = (subagent.skills ?? []).map((s) => s.id);

    return (
      draftDescription !== subagent.description ||
      draftSystemPrompt !== subagent.systemPrompt ||
      draftParamName !== (subagent.paramName || "question") ||
      draftParamDescription !== subagent.paramDescription ||
      draftProgressLabels.join("|") !==
        (subagent.progressLabels?.join("|") ?? "") ||
      draftDirectTools !== origDirect ||
      draftCustomTools !== origCustom ||
      !sameSet(draftSkillIds, origSkillIds)
    );
  }, [
    subagent,
    draftDescription,
    draftSystemPrompt,
    draftParamName,
    draftParamDescription,
    draftProgressLabels,
    draftDirectTools,
    draftCustomTools,
    draftSkillIds,
  ]);

  /* ── handlers ──────────────────────────────────────────────────── */
  const handleSave = useCallback(async () => {
    if (!subagent || saving || !dirty) return;
    setSaving(true);
    try {
      const direct = normalizeToolsInput(draftDirectTools);
      const custom = normalizeToolsInput(draftCustomTools);
      const updated = await updateSubagent(subagent.name, {
        name: subagent.name,
        description: draftDescription.trim(),
        systemPrompt: draftSystemPrompt.trim(),
        paramName: draftParamName.trim() || "question",
        paramDescription: draftParamDescription.trim(),
        progressLabels: draftProgressLabels
          .map((s) => s.trim())
          .filter((s) => s.length > 0),
        tools: {
          ...(direct.length > 0 ? { direct } : {}),
          ...(custom.length > 0 ? { custom } : {}),
        },
        skillIds:
          draftSkillIds.length > 0 ? draftSkillIds : undefined,
      });
      setSubagent(updated);
      showSnackbar({ variant: "success", title: "Subagent saved" });
    } catch (err) {
      showSnackbar({
        variant: "error",
        title: "Failed to save subagent",
        description:
          err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  }, [
    subagent,
    saving,
    dirty,
    draftDescription,
    draftSystemPrompt,
    draftParamName,
    draftParamDescription,
    draftProgressLabels,
    draftDirectTools,
    draftCustomTools,
    draftSkillIds,
    showSnackbar,
  ]);

  const handleToggleEnabled = useCallback(
    async (value: boolean) => {
      if (!subagent || subagent.enabled === value || togglingEnabled) return;
      setTogglingEnabled(true);
      try {
        // Route to the right endpoint based on intent — same fix as the list
        // page in SubagentsPageV3 (enable = POST /enable, disable = DELETE).
        if (value) {
          await enableSubagent(subagent.name);
        } else {
          await disableSubagent(subagent.name);
        }
        setSubagent((prev) =>
          prev ? { ...prev, enabled: value } : null,
        );
        showSnackbar({
          variant: "success",
          title: `${subagent.name} ${value ? "enabled" : "disabled"}`,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "";
        const is403 =
          msg.includes("403") ||
          msg.toLowerCase().includes("forbidden");
        showSnackbar({
          variant: "error",
          title: is403
            ? "You don't have permission"
            : "Failed to update subagent",
          description:
            !is403 && err instanceof Error ? err.message : undefined,
        });
      } finally {
        setTogglingEnabled(false);
      }
    },
    [subagent, togglingEnabled, showSnackbar],
  );

  const toggleSkill = useCallback((id: string) => {
    setDraftSkillIds((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : [...prev, id],
    );
  }, []);

  const handleAddShare = useCallback(
    async (userIdOrEmail: string) => {
      if (!subagent || addingShare) return;
      setAddingShare(true);
      try {
        const entry = await addSubagentShare(
          subagent.name,
          userIdOrEmail,
        );
        setShares((prev) => [...prev, entry]);
        showSnackbar({ variant: "success", title: "Contributor added" });
      } catch (err) {
        showSnackbar({
          variant: "error",
          title: "Failed to add contributor",
          description:
            err instanceof Error ? err.message : undefined,
        });
      } finally {
        setAddingShare(false);
      }
    },
    [subagent, addingShare, showSnackbar],
  );

  const handleRemoveShare = useCallback(
    async (shareUserId: string) => {
      if (!subagent) return;
      try {
        await removeSubagentShare(subagent.name, shareUserId);
        setShares((prev) =>
          prev.filter((s) => s.userId !== shareUserId),
        );
        showSnackbar({ variant: "success", title: "Contributor removed" });
      } catch (err) {
        showSnackbar({
          variant: "error",
          title: "Failed to remove contributor",
          description:
            err instanceof Error ? err.message : undefined,
        });
      }
    },
    [subagent, showSnackbar],
  );

  /* ── render guards ─────────────────────────────────────────────── */
  if (loading) {
    return <SubagentEditSkeleton />;
  }

  if (!subagent) {
    return (
      <SubagentNotFound onBack={() => navigate("/v3/subagents")} />
    );
  }

  /* ── tab config ────────────────────────────────────────────────── */
  /* Contributor count surfaces in the tab label as a small annotation
     so users see at a glance whether others can edit this subagent. */
  const tabItems: TabItem<SubagentTopTabId>[] = [
    { id: "persona", label: "Persona" },
    { id: "knowledge", label: "Knowledge" },
    { id: "tools", label: "Tools" },
    {
      id: "contributors",
      label:
        shares.length > 0 ? `Contributors (${shares.length})` : "Contributors",
    },
  ];

  /* ── render ────────────────────────────────────────────────────── */
  return (
    <div
      data-id="subagent-edit-page"
      className="flex h-full flex-col overflow-hidden bg-xyne-surface"
    >
      <SubagentEditHeader
        subagent={subagent}
        isBuiltIn={isBuiltIn}
        dirty={dirty}
        saving={saving}
        canEdit={canEdit}
        onSave={handleSave}
        onToggleEnabled={handleToggleEnabled}
        onBack={() => navigate("/v3/subagents")}
      />

      {/* Tab strip — centered above the content column. Sits below the
          header so the active tab indicator reads as part of the page nav. */}
      <div className="shrink-0 flex justify-center bg-xyne-surface">
        <Tabs items={tabItems} selected={activeTab} onSelect={setActiveTab} />
      </div>

      {/* Tab content — single scroll container, centered max-width column.
          Same width on all three tabs so switching feels seamless and the
          eye doesn't have to relocate the left margin. */}
      <div className="flex-1 overflow-y-auto bg-xyne-surface-sunken/30">
        <div className="mx-auto w-full max-w-[860px] px-6 py-8">
          {activeTab === "persona" && (
            <SubagentPersonaTab
              subagent={subagent}
              isBuiltIn={isBuiltIn}
              canEdit={canEdit}
              draftDescription={draftDescription}
              onDraftDescriptionChange={setDraftDescription}
              draftSystemPrompt={draftSystemPrompt}
              onDraftSystemPromptChange={setDraftSystemPrompt}
            />
          )}

          {activeTab === "knowledge" && (
            <SubagentKnowledgeTab
              subagent={subagent}
              isBuiltIn={isBuiltIn}
              canEdit={canEdit}
              draftParamName={draftParamName}
              onDraftParamNameChange={setDraftParamName}
              draftParamDescription={draftParamDescription}
              onDraftParamDescriptionChange={setDraftParamDescription}
              draftProgressLabels={draftProgressLabels}
              onDraftProgressLabelsChange={setDraftProgressLabels}
              draftSkillIds={draftSkillIds}
              onToggleSkill={toggleSkill}
              availableSkills={availableSkills}
              skillsLoading={skillsLoading}
            />
          )}

          {activeTab === "tools" && (
            <SubagentToolsTab
              subagent={subagent}
              isBuiltIn={isBuiltIn}
              canEdit={canEdit}
              availableTools={availableTools}
              toolsLoading={toolsLoading}
              draftDirectTools={draftDirectTools}
              onDraftDirectToolsChange={setDraftDirectTools}
              draftCustomTools={draftCustomTools}
              onDraftCustomToolsChange={setDraftCustomTools}
            />
          )}

          {activeTab === "contributors" && (
            <SubagentContributorsTab
              shares={shares}
              isBuiltIn={isBuiltIn}
              canEdit={canEdit}
              onAddShare={handleAddShare}
              onRemoveShare={handleRemoveShare}
              addingShare={addingShare}
            />
          )}
        </div>
      </div>
    </div>
  );
}
