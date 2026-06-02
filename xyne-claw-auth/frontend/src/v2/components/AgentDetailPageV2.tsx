import { useState, useEffect, useCallback } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft, Trash2, Link2, Brain,
  Save, X, Plus, Settings, Sparkles, Loader2, Upload, Globe,
} from "lucide-react";
import {
  listAgents, getAgentDetail, updateAgent, deleteAgent,
  listScheduledJobs, deleteScheduledJob, listScheduledJobRuns,
  getUserChainConfig, setUserChainConfig, submitAgentRequest,
  getAvailableTools, listSkills,
} from "../../lib/api";
import { toolColor } from "../utils";
import type { Agent, ScheduledJob, ScheduledJobRun } from "../../lib/types";
import { JobCard, RunCard, StatusBadge } from "./common/JobRunCards";
import { ChainEditor } from "./common/ChainEditor";
import { MemoryTab } from "./MemoryTab";

interface Props { userId: string; isAdmin?: boolean; }

// ── tab bar ───────────────────────────────────────────────────────────
type Tab = "configure" | "jobs" | "runs" | "chain" | "memory";
function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition ${active ? "border-zinc-900 text-zinc-900" : "border-transparent text-zinc-400 hover:text-zinc-700"}`}>
      {children}
    </button>
  );
}
function ActionBtn({ onClick, disabled, variant = "default", children }: { onClick: () => void; disabled?: boolean; variant?: "default" | "danger"; children: React.ReactNode }) {
  return (
    <button onClick={onClick} disabled={disabled} className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition disabled:opacity-50 ${variant === "danger" ? "border-red-200 bg-white text-red-500 hover:bg-red-50" : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"}`}>
      {children}
    </button>
  );
}

// ── add tools modal ─────────────────────────────────────────────────
type AvailableToolsType = Awaited<ReturnType<typeof getAvailableTools>>;
type SkillsType = Awaited<ReturnType<typeof listSkills>>;

type ToolCategory = "all" | "subagents" | "write" | "custom";
interface ToolRow { id: string; name: string; description?: string; group: string; category: Omit<ToolCategory, "all">; }

function AddToolsModal({ availableTools, subagents, direct, custom, onConfirm, onClose }: {
  availableTools: AvailableToolsType;
  subagents: string[]; direct: string[]; custom: string[];
  onConfirm: (subagents: string[], direct: string[], custom: string[]) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<ToolCategory>("all");
  const [search, setSearch] = useState("");
  const [selSub, setSelSub] = useState<string[]>(subagents);
  const [selDirect, setSelDirect] = useState<string[]>(direct);
  const [selCustom, setSelCustom] = useState<string[]>(custom);

  // build flat list
  const allRows: ToolRow[] = [
    ...availableTools.subagents.map((sa) => ({ id: sa.name, name: sa.name, description: sa.description, group: "Subagents", category: "subagents" as const })),
    ...availableTools.writeTools.map((t) => ({ id: t.name, name: t.name, group: t.source, category: "write" as const })),
    ...availableTools.customGroups.flatMap((g) => g.tools.map((t) => ({ id: t.slug, name: t.name, group: g.source.replace("custom:", ""), category: "custom" as const }))),
  ];

  const filtered = allRows.filter((r) => {
    if (tab !== "all" && r.category !== tab) return false;
    if (search && !r.name.toLowerCase().includes(search.toLowerCase()) && !(r.description ?? "").toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const groups = Array.from(new Set(filtered.map((r) => r.group)));

  const isSelected = (r: ToolRow) => {
    if (r.category === "subagents") return selSub.includes(r.id);
    if (r.category === "write") return selDirect.includes(r.id);
    return selCustom.includes(r.id);
  };
  const toggle = (r: ToolRow) => {
    if (r.category === "subagents") setSelSub((p) => p.includes(r.id) ? p.filter((x) => x !== r.id) : [...p, r.id]);
    else if (r.category === "write") setSelDirect((p) => p.includes(r.id) ? p.filter((x) => x !== r.id) : [...p, r.id]);
    else setSelCustom((p) => p.includes(r.id) ? p.filter((x) => x !== r.id) : [...p, r.id]);
  };

  const totalSelected = selSub.length + selDirect.length + selCustom.length;

  const TAB_LABELS: { id: ToolCategory; label: string }[] = [
    { id: "all", label: "All" }, { id: "subagents", label: "Subagents" },
    { id: "write", label: "Direct Tools" }, { id: "custom", label: "Custom Tools" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="relative flex h-150 w-150 flex-col rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4">
          <h2 className="text-base font-semibold text-zinc-900">Add Tools</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100"><X size={16} /></button>
        </div>

        {/* Search */}
        <div className="px-6 pt-4">
          <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
            <svg className="h-4 w-4 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" /></svg>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tools..." className="flex-1 bg-transparent text-sm text-zinc-700 placeholder-zinc-400 outline-none" autoFocus />
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-0 border-b border-zinc-200 px-6 pt-3">
          {TAB_LABELS.map(({ id, label }) => (
            <button key={id} onClick={() => setTab(id)}
              className={`px-3 py-2 text-sm font-medium border-b-2 transition ${tab === id ? "border-zinc-900 text-zinc-900" : "border-transparent text-zinc-400 hover:text-zinc-700"}`}>
              {label}
            </button>
          ))}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-6 py-3">
          {groups.length === 0 ? (
            <p className="py-8 text-center text-sm text-zinc-400">No tools match your search.</p>
          ) : groups.map((group) => (
            <div key={group} className="mb-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">{group}</p>
              <div className="space-y-1">
                {filtered.filter((r) => r.group === group).map((r) => (
                  <label key={r.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-zinc-50">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white" style={{ backgroundColor: toolColor(r.name) }}>
                      {r.name[0]?.toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-zinc-800">{r.name}</div>
                      {r.description && <div className="mt-0.5 line-clamp-2 text-xs text-zinc-400">{r.description}</div>}
                    </div>
                    <input type="checkbox" checked={isSelected(r)} onChange={() => toggle(r)}
                      className="h-4 w-4 rounded border-zinc-300 accent-zinc-900" />
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-zinc-200 px-6 py-4">
          <span className="text-sm text-zinc-500">{totalSelected} tool{totalSelected !== 1 ? "s" : ""} selected</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50">Cancel</button>
            <button onClick={() => onConfirm(selSub, selDirect, selCustom)} className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700">Confirm</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── skill trigger modal ─────────────────────────────────────────────
type SkillTriggerEntry = { toolName: string; skillSlug: string; when: "before" | "after"; prompt: string };

function SkillTriggerModal({
  initial, availableTools, availSkills, onConfirm, onClose,
}: {
  initial: SkillTriggerEntry | null;
  availableTools: AvailableToolsType | null;
  availSkills: SkillsType;
  onConfirm: (entry: SkillTriggerEntry) => void;
  onClose: () => void;
}) {
  const [selSa, setSelSa] = useState(() => {
    if (!initial?.toolName) return "";
    const ci = initial.toolName.indexOf(":");
    return ci > 0 ? initial.toolName.slice(0, ci) : initial.toolName;
  });
  const [selInner, setSelInner] = useState(() => {
    if (!initial?.toolName) return "";
    const ci = initial.toolName.indexOf(":");
    return ci > 0 ? initial.toolName.slice(ci + 1) : "";
  });
  const [when, setWhen] = useState<"before" | "after">(initial?.when ?? "after");
  const [skillSlug, setSkillSlug] = useState(initial?.skillSlug ?? "");
  const [instruction, setInstruction] = useState(initial?.prompt ?? "");

  const saDef = availableTools?.subagents.find((s) => s.name === selSa);
  const innerTools = saDef ? (availableTools?.serverTools[saDef.serverType] ?? []) : [];

  const selCls = "w-full rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-700 focus:border-zinc-400 focus:outline-none";

  const handleConfirm = () => {
    const toolName = selSa ? (selInner ? `${selSa}:${selInner}` : selSa) : "";
    onConfirm({ toolName, skillSlug, when, prompt: instruction });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5">
          <h2 className="text-base font-semibold text-zinc-900">Skill Trigger</h2>
          <button onClick={onClose} className="rounded p-1 text-zinc-400 hover:text-zinc-700"><X size={16} /></button>
        </div>
        <div className="h-px bg-zinc-100" />
        {/* Body */}
        <div className="space-y-5 px-6 py-5">
          {/* Subagent */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-zinc-700">Subagent</label>
            <select value={selSa} onChange={(e) => { setSelSa(e.target.value); setSelInner(""); }} className={selCls}>
              <option value="">Select subagent...</option>
              {availableTools?.subagents.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
            </select>
          </div>
          {/* When */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-zinc-700">When</label>
            <select value={when} onChange={(e) => setWhen(e.target.value as "before" | "after")} className={selCls}>
              <option value="after">After</option>
              <option value="before">Before</option>
            </select>
          </div>
          {/* Skill to inject */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-zinc-700">Skill to inject</label>
            <select value={skillSlug} onChange={(e) => setSkillSlug(e.target.value)} className={selCls}>
              <option value="">Select skill...</option>
              {availSkills.map((s) => <option key={s.id} value={s.slug}>{s.label || s.name}</option>)}
            </select>
          </div>
          {/* Instruction */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-zinc-700">Instruction <span className="text-zinc-400 font-normal">(optional)</span></label>
            <input value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="Instruction for the agent..." className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-700 placeholder-zinc-300 focus:border-zinc-400 focus:outline-none" />
          </div>
        </div>
        <div className="h-px bg-zinc-100" />
        {/* Footer */}
        <div className="flex justify-end gap-2 px-6 py-4">
          <button onClick={onClose} className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50">Cancel</button>
          <button onClick={handleConfirm} disabled={!selSa || !skillSlug} className="rounded-lg bg-zinc-700 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-900 disabled:opacity-50">Confirm</button>
        </div>
      </div>
    </div>
  );
}

// ── agent config editor ───────────────────────────────────────────────

function AgentConfigEditor({ agent, userId, onSave }: { agent: Agent; userId: string; onSave: () => void }) {
  const cfgTools = (agent.config?.tools as { subagents?: string[]; direct?: string[]; custom?: string[] } | undefined) ?? {};
  const cfgSaSkills = (agent.config?.subagentSkills as Record<string, string[]> | undefined) ?? {};
  const [prompt, setPrompt] = useState(agent.systemPrompt ?? "");
  const [skillIds, setSkillIds] = useState<string[]>(agent.skills?.map((s) => s.skillId) ?? []);
  const [subagents, setSubagents] = useState<string[]>(cfgTools.subagents ?? []);
  const [saSkills, setSaSkills] = useState<Record<string, string[]>>(cfgSaSkills);
  const [direct, setDirect] = useState<string[]>(cfgTools.direct ?? []);
  const [custom, setCustom] = useState<string[]>(cfgTools.custom ?? []);
  const [availableTools, setAt] = useState<AvailableToolsType | null>(null);
  const [availSkills, setAskills] = useState<SkillsType>([]);
  const [toolsLoading, setTL] = useState(false);
  const [toolsModalOpen, setToolsModalOpen] = useState(false);
  const [triggerModalOpen, setTriggerModalOpen] = useState(false);
  const [editingTriggerIdx, setEditingTriggerIdx] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [aiIntent, setAiIntent] = useState("");
  const [generating, setGenerating] = useState(false);
  const [promptInjections, setPi] = useState<Array<{ id: string; label: string; content: string; enabled: boolean }>>(
    (agent.config?.promptInjections as Array<{ id: string; label: string; content: string; enabled: boolean }>) ?? [],
  );
  const [skillTriggers, setSt] = useState<Array<{ toolName: string; skillSlug: string; when: "before" | "after"; prompt: string }>>(
    ((agent.config?.skillTriggers as Array<{ toolName: string; skillSlug: string; when: string; prompt?: string }>) ?? [])
      .map((t) => ({ ...t, when: t.when as "before" | "after", prompt: t.prompt ?? "" })),
  );

  const generatePrompt = async () => {
    if (!aiIntent.trim()) return;
    setGenerating(true);
    try {
      const res = await fetch("/claw/api/v1/agents/generate-prompt", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: aiIntent, agentName: agent.name, existingPrompt: prompt }),
      });
      if (res.ok) {
        const data = (await res.json()) as { success: boolean; data?: { prompt: string } };
        if (data.success && data.data?.prompt) setPrompt(data.data.prompt);
      }
    } finally { setGenerating(false); }
  };

  useEffect(() => {
    setTL(true);
    Promise.all([getAvailableTools(), listSkills(userId)])
      .then(([tools, skills]) => { setAt(tools); setAskills(skills); })
      .finally(() => setTL(false));
  }, [userId]);

  const toggle = (list: string[], setList: (v: string[]) => void, val: string) =>
    setList(list.includes(val) ? list.filter((x) => x !== val) : [...list, val]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const toolsCfg = (subagents.length || direct.length || custom.length) ? { subagents, direct, custom } : undefined;
      const cfg = { ...(agent.config ?? {}) };
      if (toolsCfg) cfg.tools = toolsCfg; else delete cfg.tools;
      const activeTriggers = skillTriggers.filter((t) => t.toolName && t.skillSlug);
      if (activeTriggers.length) cfg.skillTriggers = activeTriggers; else delete cfg.skillTriggers;
      const activeInj = promptInjections.filter((p) => p.content.trim());
      if (activeInj.length) cfg.promptInjections = activeInj; else delete cfg.promptInjections;
      const activeSaSk = Object.fromEntries(Object.entries(saSkills).filter(([, ids]) => ids.length > 0));
      if (Object.keys(activeSaSk).length) cfg.subagentSkills = activeSaSk; else delete cfg.subagentSkills;
      await updateAgent(agent.slug, { systemPrompt: prompt, skills: skillIds, config: cfg });
      setSaved(true); onSave(); setTimeout(() => setSaved(false), 3000);
    } finally { setSaving(false); }
  };

  const inputCls = "w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 placeholder-zinc-300 focus:border-zinc-400 focus:outline-none";

  return (
    <div className="space-y-4 pb-20">
      {/* System Prompt */}
      <div className="rounded-xl bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-zinc-800">System Prompt</h3>
            <p className="mt-0.5 text-xs text-zinc-400">The core instruction set that defines how this agent thinks, responds, and behaves. Everything the agent does is shaped by what you write here</p>
          </div>
          <button onClick={generatePrompt} disabled={generating || !aiIntent.trim()} className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50">
            {generating ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Update with AI
          </button>
        </div>
        <input value={aiIntent} onChange={(e) => setAiIntent(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") generatePrompt(); }} placeholder="Describe what to change…" className={`${inputCls} mb-3`} />
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={12} placeholder="You are a…" className={`${inputCls} font-mono`} />
        <p className="mt-1 text-xs text-zinc-400">{prompt.length} characters</p>
      </div>

      {/* Tools */}
      <div className="rounded-xl bg-white p-4">
        <div className="mb-1 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-zinc-800">Tools</h3>
            <p className="mt-0.5 text-xs text-zinc-400">Choose what capabilities this agent can act on — subagents it can delegate to, direct write tools it can execute, and custom integrations it can call.</p>
          </div>
          <button onClick={() => setToolsModalOpen(true)} disabled={toolsLoading || !availableTools}
            className="shrink-0 flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50">
            <Plus size={13} /> Add Tools
          </button>
        </div>
        {toolsLoading ? <p className="mt-3 text-xs text-zinc-400">Loading…</p> : (() => {
          type SelItem = { key: string; label: string; description?: string; category: "subagent" | "write" | "custom" };
          const selectedItems: SelItem[] = [
            ...subagents.map((s) => {
              const sa = availableTools?.subagents.find((a) => a.name === s);
              return { key: s, label: s, description: sa?.description, category: "subagent" as const };
            }),
            ...direct.map((d) => ({ key: d, label: d, category: "write" as const })),
            ...custom.map((c) => {
              const t = availableTools?.customGroups.flatMap((g) => g.tools).find((t) => t.slug === c);
              return { key: c, label: t?.name ?? c, category: "custom" as const };
            }),
          ];
          if (selectedItems.length === 0) {
            return <p className="mt-3 text-sm text-zinc-400">No tools selected. Click <strong>Add Tools</strong> to configure access.</p>;
          }
          return (
            <div className="mt-4">
              <div className="grid grid-cols-3 gap-3">
                {selectedItems.map((item) => (
                  <div key={item.key} className="flex items-center gap-3 rounded-xl bg-zinc-100 p-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                      style={{ backgroundColor: toolColor(item.label) }}>
                      {item.label[0]?.toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1 overflow-hidden">
                      <p className="truncate text-sm font-medium text-zinc-800">{item.label}</p>
                      {item.description && <p className="mt-0.5 line-clamp-2 text-xs text-zinc-400">{item.description}</p>}
                    </div>
                    <div className="shrink-0 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-800">
                      <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                    </div>
                  </div>
                ))}
              </div>
              {/* Per-subagent skill picker. Default is NONE; user adds the
                  specific skills they want to propagate into each subagent.
                  Empty list = subagent gets no skills (intentional). */}
              {subagents.map((saName) => {
                if (!availSkills.length) return null;
                const active = saSkills[saName] ?? [];
                return (
                  <div key={saName} className="mt-3 rounded-lg border border-zinc-100 bg-zinc-50 p-3">
                    <p className="mb-2 text-xs font-medium text-zinc-600">{saName} — skills</p>
                    {active.length === 0 && (
                      <p className="mb-1 text-xs text-zinc-400">No skills. Add to propagate into this subagent.</p>
                    )}
                    <div className="flex flex-wrap items-center gap-1.5">
                      {active.map((n) => (
                        <span key={n} className="inline-flex items-center gap-1 rounded-full bg-zinc-200 px-2.5 py-0.5 text-xs text-zinc-600">
                          {n}
                          <button onClick={() => setSaSkills((p) => ({ ...p, [saName]: (p[saName] ?? []).filter((x) => x !== n) }))}><X size={10} /></button>
                        </span>
                      ))}
                      <select
                        onChange={(e) => { if (!e.target.value) return; setSaSkills((p) => ({ ...p, [saName]: [...new Set([...(p[saName] ?? []), e.target.value])] })); e.target.value = ""; }}
                        defaultValue=""
                        className="rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-xs text-zinc-500 focus:outline-none"
                      >
                        <option value="">+ Skill</option>
                        {availSkills.filter((s) => !active.includes(s.name)).map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
                      </select>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>

      {/* Add Tools Modal */}
      {toolsModalOpen && availableTools && (
        <AddToolsModal
          availableTools={availableTools}
          subagents={subagents}
          direct={direct}
          custom={custom}
          onConfirm={(s, d, c) => { setSubagents(s); setDirect(d); setCustom(c); setToolsModalOpen(false); }}
          onClose={() => setToolsModalOpen(false)}
        />
      )}

      {/* Skills */}
      <div className="rounded-xl bg-white p-4">
        <h3 className="mb-1 text-sm font-semibold text-zinc-800">Skills</h3>
        <p className="mb-3 text-xs text-zinc-400">Skills inject knowledge into context.</p>
        {availSkills.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {availSkills.map((s) => (
              <button key={s.id} onClick={() => toggle(skillIds, setSkillIds, s.id)} title={s.description || s.slug} className={`rounded-lg border px-3 py-1.5 text-sm transition ${skillIds.includes(s.id) ? "border-amber-400 bg-amber-50 text-amber-700" : "border-zinc-200 text-zinc-600 hover:border-zinc-400"}`}>
                {s.label || s.name}
              </button>
            ))}
          </div>
        ) : <p className="text-xs text-zinc-400">{toolsLoading ? "Loading…" : "No skills available."}</p>}
        {skillIds.length > 0 && <p className="mt-2 text-xs text-zinc-400">{skillIds.length} skill(s) selected</p>}
      </div>

      {/* Skill Triggers */}
      <div className="rounded-xl bg-white p-4">
        <div className="mb-3 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-zinc-800">Skill Triggers</h3>
            <p className="mt-0.5 text-xs text-zinc-400">Inject a skill's content when a specific tool is called.</p>
          </div>
          <button onClick={() => { setEditingTriggerIdx(null); setTriggerModalOpen(true); }} className="shrink-0 flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50">
            <Plus size={13} /> Add Trigger
          </button>
        </div>
        {skillTriggers.length === 0 ? (
          <p className="text-sm text-zinc-400">No skill triggers configured.</p>
        ) : (
          <div className="space-y-2">
            {skillTriggers.map((tr, idx) => {
              const skill = availSkills.find((s) => s.slug === tr.skillSlug);
              const colonIdx = tr.toolName.indexOf(":");
              const saName = colonIdx > 0 ? tr.toolName.slice(0, colonIdx) : tr.toolName;
              return (
                <div key={idx} className="flex items-center justify-between gap-3 rounded-lg bg-zinc-50 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-zinc-800">{skill?.label || skill?.name || tr.skillSlug || "—"}</p>
                    <p className="text-xs text-zinc-400">{tr.when === "after" ? "After" : "Before"} · {saName || "—"}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => { setEditingTriggerIdx(idx); setTriggerModalOpen(true); }} className="rounded p-1 text-zinc-400 hover:text-zinc-700">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button onClick={() => setSt((p) => p.filter((_, i) => i !== idx))} className="rounded p-1 text-zinc-400 hover:text-red-500"><X size={14} /></button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {triggerModalOpen && (
        <SkillTriggerModal
          initial={editingTriggerIdx !== null ? skillTriggers[editingTriggerIdx] ?? null : null}
          availableTools={availableTools}
          availSkills={availSkills}
          onConfirm={(entry) => {
            if (editingTriggerIdx !== null) setSt((p) => p.map((t, i) => i === editingTriggerIdx ? entry : t));
            else setSt((p) => [...p, entry]);
            setTriggerModalOpen(false);
          }}
          onClose={() => setTriggerModalOpen(false)}
        />
      )}

      {/* Prompt Injections */}
      <div className="rounded-xl bg-white p-4">
        <h3 className="mb-1 text-sm font-semibold text-zinc-800">Prompt Injections</h3>
        <p className="mb-3 text-xs text-zinc-400">Text injected as a [System Reminder] before every response.</p>
        {promptInjections.map((inj, idx) => (
          <div key={inj.id} className="mb-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
            <div className="mb-2 flex items-center gap-2">
              <input value={inj.label} onChange={(e) => setPi((p) => p.map((x, i) => i === idx ? { ...x, label: e.target.value } : x))} placeholder="Label" className="flex-1 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-700 placeholder-zinc-300 focus:outline-none" />
              <label className="flex items-center gap-1.5 text-xs text-zinc-500">
                <input type="checkbox" checked={inj.enabled} onChange={(e) => setPi((p) => p.map((x, i) => i === idx ? { ...x, enabled: e.target.checked } : x))} className="rounded border-zinc-300" /> Enabled
              </label>
              <button onClick={() => setPi((p) => p.filter((_, i) => i !== idx))} className="rounded p-1 text-zinc-400 hover:text-red-500"><X size={14} /></button>
            </div>
            <textarea value={inj.content} onChange={(e) => setPi((p) => p.map((x, i) => i === idx ? { ...x, content: e.target.value } : x))} placeholder="Instruction text…" rows={3} className="w-full rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-700 placeholder-zinc-300 focus:outline-none" />
          </div>
        ))}
        <button onClick={() => setPi((p) => [...p, { id: crypto.randomUUID(), label: "", content: "", enabled: true }])} className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-50">
          <Plus size={14} /> Add Injection
        </button>
      </div>

      {/* Save */}
      <div className="fixed bottom-0 left-56 right-0 flex items-center justify-between border-t-2 border-zinc-50 bg-white px-6 py-6">
        <p className="text-sm text-zinc-500">Want to test your changes? <span className="font-semibold text-zinc-800">Try agent</span></p>
        <div className="flex items-center gap-3">
          {saved && <span className="text-sm text-green-600">✓ Saved</span>}
          <button onClick={handleSave} disabled={saving} className="flex items-center gap-2 rounded-lg bg-zinc-800 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50">
            {saving ? "Saving…" : "Save Configuration"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────
export function AgentDetailPageV2({ userId, isAdmin }: Props) {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [runs, setRuns] = useState<ScheduledJobRun[]>([]);
  const [allAgents, setAllAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("jobs");
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!slug) return;
    setLoading(true); setError(null);
    try {
      const [a, agents, jobList, runList] = await Promise.all([
        getAgentDetail(slug), listAgents(userId),
        listScheduledJobs({ agentSlug: slug }), listScheduledJobRuns(slug),
      ]);
      setAgent(a); setAllAgents(agents); setJobs(jobList); setRuns(runList);
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to load"); }
    finally { setLoading(false); }
  }, [slug, userId]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (!agent) return;
    const canEdit = agent.ownerUserId === userId || (agent.scope === "global" && !!isAdmin);
    if (canEdit) setActiveTab("configure");
  }, [agent?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDeleteJob = useCallback(async (id: string) => {
    setDeleting(id);
    try { await deleteScheduledJob(id); await loadData(); }
    catch (err) { setError(err instanceof Error ? err.message : "Failed to delete job"); }
    finally { setDeleting(null); }
  }, [loadData]);

  if (loading) return <div className="flex items-center justify-center py-16"><Loader2 size={22} className="animate-spin text-zinc-400" /></div>;

  if (!agent) return (
    <div>
      <Link to="/v2" className="mb-4 inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800"><ArrowLeft size={15} /> Back to Agents</Link>
      <p className="mt-4 text-zinc-400">Agent "{slug}" not found.</p>
      {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
    </div>
  );

  const isOwner = agent.ownerUserId === userId;
  const canEdit = isOwner || (agent.scope === "global" && !!isAdmin);
  const activeJobs = jobs.filter((j) => j.status === "active");
  const inactiveJobs = jobs.filter((j) => j.status !== "active");

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate("/v2")} className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700">
            <ArrowLeft size={18} />
          </button>
          <div className="flex h-10 w-10 items-center justify-center rounded-full text-base font-semibold text-white" style={{ backgroundColor: agent.color || "#6366f1" }}>
            {agent.name.trim()[0]?.toUpperCase()}
          </div>
          <div>
            <h1 className="text-lg font-semibold text-zinc-900">{agent.name}</h1>
            {agent.scope === "global" && <span className="text-xs text-zinc-400">Global agent</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isOwner && !agent.spacesAppId && (
            <ActionBtn onClick={() => submitAgentRequest(agent.slug, userId, "push_to_spaces").then(loadData)}>
              <Upload size={14} /> Push to Spaces
            </ActionBtn>
          )}
          {canEdit && agent.scope !== "global" && (
            <ActionBtn onClick={() => submitAgentRequest(agent.slug, userId, "push_to_global").then(loadData)}>
              <Globe size={14} /> Push to Global
            </ActionBtn>
          )}
          {isOwner && (
            <ActionBtn variant="danger" onClick={async () => {
              if (!confirm(`Delete "${agent.name}"? This cannot be undone.`)) return;
              try { await deleteAgent(agent.slug, userId); navigate("/v2"); }
              catch (e) { setError(e instanceof Error ? e.message : "Delete failed"); }
            }}>
              <Trash2 size={14} /> Delete
            </ActionBtn>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600"><X size={14} /></button>
        </div>
      )}

      {/* Tabs */}
      <div className="mb-6 flex border-b border-zinc-200">
        {canEdit && <TabBtn active={activeTab === "configure"} onClick={() => setActiveTab("configure")}><Settings size={13} /> Configure</TabBtn>}
        <TabBtn active={activeTab === "jobs"} onClick={() => setActiveTab("jobs")}>Scheduled Jobs ({jobs.length})</TabBtn>
        <TabBtn active={activeTab === "runs"} onClick={() => setActiveTab("runs")}>Run History ({runs.length})</TabBtn>
        <TabBtn active={activeTab === "chain"} onClick={() => setActiveTab("chain")}><Link2 size={13} /> Chain</TabBtn>
        {canEdit && <TabBtn active={activeTab === "memory"} onClick={() => setActiveTab("memory")}><Brain size={13} /> Memory</TabBtn>}
      </div>

      {activeTab === "configure" && canEdit && <AgentConfigEditor agent={agent} userId={userId} onSave={loadData} />}

      {activeTab === "jobs" && (
        <div className="space-y-3">
          {jobs.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-200 py-12 text-center text-sm text-zinc-400">No scheduled jobs for this agent.</div>
          ) : (
            <>
              {activeJobs.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Active</h3>
                  {activeJobs.map((j) => <JobCard key={j.id} job={j} deleting={deleting === j.id} onDelete={handleDeleteJob} />)}
                </div>
              )}
              {inactiveJobs.length > 0 && (
                <div className="mt-4 space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Completed / Cancelled</h3>
                  {inactiveJobs.map((j) => <JobCard key={j.id} job={j} deleting={deleting === j.id} onDelete={handleDeleteJob} />)}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {activeTab === "runs" && (
        <div className="space-y-2">
          {runs.length === 0
            ? <div className="rounded-xl border border-dashed border-zinc-200 py-12 text-center text-sm text-zinc-400">No runs yet.</div>
            : runs.map((r) => <RunCard key={r.id} run={r} expanded={expandedRun === r.id} onToggle={() => setExpandedRun(expandedRun === r.id ? null : r.id)} />)
          }
        </div>
      )}

      {activeTab === "chain" && (
        <ChainEditor
          agent={agent}
          userId={userId}
          allAgents={allAgents.filter((a) => a.slug !== agent.slug)}
          onSave={async (cfg) => { await setUserChainConfig(agent.slug, userId, cfg); }}
          loadConfig={async () => getUserChainConfig(agent.slug, userId)}
        />
      )}

      {activeTab === "memory" && canEdit && (
        <MemoryTab agentSlug={agent.slug} canDelete={canEdit} />
      )}
    </div>
  );
}
