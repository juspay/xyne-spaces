import { useState, useEffect, useRef, useCallback } from "react";
import { X, Sparkles, ChevronRight, ChevronLeft, Loader2, Check, AlertCircle } from "lucide-react";
import { createAgent, checkAgentName, getAvailableTools, listSkills, type AvailableTools, type Skill } from "../lib/api";

interface Props {
  userId: string;
  onClose: () => void;
  onCreated: () => void;
}

const STEPS = ["Identity", "System Prompt", "Tools", "Skills", "Review"];
const COLORS = ["#6366f1", "#8b5cf6", "#a855f7", "#ec4899", "#f43f5e", "#ef4444", "#f97316", "#eab308", "#22c55e", "#10b981", "#14b8a6", "#06b6d4", "#3b82f6"];
const SUBAGENT_EMOJI: Record<string, string> = { spaces: "🔍", bitbucket: "🔀", grafana: "📊", deepwiki: "📚", context7: "📖", pgm: "📋", git: "🔧" };

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

interface State {
  step: number;
  name: string; description: string; color: string; slug: string; slugManual: boolean;
  systemPrompt: string; aiIntent: string; generating: boolean;
  availableTools: AvailableTools | null; toolsLoading: boolean;
  subagents: string[]; direct: string[]; custom: string[];
  availableSkills: Skill[]; skillsLoading: boolean; selectedSkillIds: string[];
  nameError: string | null; slugError: string | null; checking: boolean; nameValid: boolean;
  creating: boolean; error: string | null;
}

const INIT: State = {
  step: 0,
  name: "", description: "", color: COLORS[0]!, slug: "", slugManual: false,
  systemPrompt: "", aiIntent: "", generating: false,
  availableTools: null, toolsLoading: false,
  subagents: [], direct: [], custom: [],
  availableSkills: [], skillsLoading: false, selectedSkillIds: [],
  nameError: null, slugError: null, checking: false, nameValid: false,
  creating: false, error: null,
};

export function CreateAgentModal({ userId, onClose, onCreated }: Props) {
  const [w, setW] = useState<State>(INIT);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const u = useCallback((p: Partial<State>) => setW((prev) => ({ ...prev, ...p })), []);

  const effectiveSlug = w.slugManual ? w.slug : slugify(w.name);

  // Fetch tools on step 3
  useEffect(() => {
    if (w.step === 2 && !w.availableTools) {
      u({ toolsLoading: true });
      getAvailableTools().then((d) => u({ availableTools: d })).catch(() => {}).finally(() => u({ toolsLoading: false }));
    }
  }, [w.step, w.availableTools, u]);

  // Fetch skills on step 4 (skills step)
  useEffect(() => {
    if (w.step === 3 && w.availableSkills.length === 0) {
      u({ skillsLoading: true });
      listSkills(userId).then((d) => u({ availableSkills: d })).catch(() => {}).finally(() => u({ skillsLoading: false }));
    }
  }, [w.step, w.availableSkills.length, u, userId]);

  // Debounced name check
  useEffect(() => {
    u({ nameError: null, slugError: null, nameValid: false });
    if (!w.name.trim() || !effectiveSlug) return;
    if (timer.current) clearTimeout(timer.current);
    u({ checking: true });
    timer.current = setTimeout(async () => {
      try {
        const r = await checkAgentName(w.name.trim(), effectiveSlug);
        u({ nameError: r.nameAvailable ? null : "Agent name already taken", slugError: r.slugAvailable ? null : "Slug already taken", nameValid: r.nameAvailable && r.slugAvailable, checking: false });
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
    } catch (err) { console.error("[create-agent] generate prompt error:", err); } finally { u({ generating: false }); }
  };

  const handleCreate = async () => {
    u({ creating: true, error: null });
    try {
      await createAgent({ slug: effectiveSlug, name: w.name.trim(), description: w.description.trim(), systemPrompt: w.systemPrompt.trim(), color: w.color, ownerUserId: userId });
      const hasTools = w.subagents.length || w.direct.length || w.custom.length;
      const hasSkills = w.selectedSkillIds.length > 0;
      if (hasTools || hasSkills) {
        const { updateAgent } = await import("../lib/api");
        await updateAgent(effectiveSlug, {
          ...(hasTools ? { config: { tools: { subagents: w.subagents, direct: w.direct, custom: w.custom } } } : {}),
          ...(hasSkills ? { skills: w.selectedSkillIds } : {}),
        });
      }
      onCreated();
    } catch (err) { u({ error: err instanceof Error ? err.message : "Failed to create agent" }); }
    finally { u({ creating: false }); }
  };

  const canNext = w.step === 0 ? w.name.trim().length > 0 && effectiveSlug.length > 0 && w.nameValid && !w.checking
    : w.step === 1 ? w.systemPrompt.trim().length > 0 : true;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-zinc-100">Create Agent</h2>
            <p className="text-xs text-zinc-500">Step {w.step + 1} of {STEPS.length}: {STEPS[w.step]}</p>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300"><X size={20} /></button>
        </div>

        {/* Progress */}
        <div className="flex gap-1 px-6 pt-4">
          {STEPS.map((s, i) => <div key={s} className={`h-1 flex-1 rounded-full transition ${i <= w.step ? "bg-purple-500" : "bg-zinc-800"}`} />)}
        </div>

        {/* Content */}
        <div className="min-h-[320px] max-h-[60vh] overflow-y-auto px-6 py-5">

          {/* ── Step 1: Identity ── */}
          {w.step === 0 && (
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm text-zinc-400">Agent Name</label>
                <div className="relative">
                  <input value={w.name} onChange={(e) => u({ name: e.target.value, ...(!w.slugManual ? { slug: slugify(e.target.value) } : {}) })}
                    placeholder="e.g. PR Reviewer, Onboarding Guide" autoFocus
                    className={`w-full rounded-lg border bg-zinc-800 px-3 py-2 pr-8 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none ${w.nameError ? "border-red-500" : w.nameValid ? "border-green-500" : "border-zinc-700 focus:border-purple-500"}`} />
                  {w.name.trim() && <span className="absolute right-2.5 top-2.5">
                    {w.checking ? <Loader2 size={14} className="animate-spin text-zinc-500" /> : w.nameError ? <AlertCircle size={14} className="text-red-400" /> : w.nameValid ? <Check size={14} className="text-green-400" /> : null}
                  </span>}
                </div>
                {w.nameError && <p className="mt-1 text-xs text-red-400">{w.nameError}</p>}
              </div>
              <div>
                <label className="mb-1 flex items-center gap-2 text-sm text-zinc-400">
                  Slug <button onClick={() => u({ slugManual: !w.slugManual })} className="text-xs text-purple-400 hover:text-purple-300">{w.slugManual ? "auto" : "edit"}</button>
                </label>
                <input value={effectiveSlug} onChange={(e) => u({ slugManual: true, slug: e.target.value })} disabled={!w.slugManual}
                  className={`w-full rounded-lg border bg-zinc-800 px-3 py-2 text-sm text-zinc-400 focus:outline-none disabled:opacity-50 ${w.slugError ? "border-red-500" : "border-zinc-700 focus:border-purple-500"}`} />
                {w.slugError && <p className="mt-1 text-xs text-red-400">{w.slugError}</p>}
              </div>
              <div>
                <label className="mb-1 block text-sm text-zinc-400">Description</label>
                <input value={w.description} onChange={(e) => u({ description: e.target.value })} placeholder="What does this agent do?"
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-purple-500 focus:outline-none" />
              </div>
              <div>
                <label className="mb-1 block text-sm text-zinc-400">Color</label>
                <div className="flex flex-wrap gap-2">
                  {COLORS.map((c) => <button key={c} onClick={() => u({ color: c })}
                    className={`h-7 w-7 rounded-full transition ${w.color === c ? "ring-2 ring-white ring-offset-2 ring-offset-zinc-900" : "hover:scale-110"}`}
                    style={{ backgroundColor: c }} />)}
                </div>
              </div>
            </div>
          )}

          {/* ── Step 2: System Prompt ── */}
          {w.step === 1 && (
            <div className="space-y-4">
              <div className="rounded-lg border border-purple-800/50 bg-purple-950/20 p-4">
                <label className="mb-2 flex items-center gap-2 text-sm text-purple-300"><Sparkles size={16} /> Generate with AI</label>
                <div className="flex gap-2">
                  <input value={w.aiIntent} onChange={(e) => u({ aiIntent: e.target.value })} placeholder="Describe what this agent should do..."
                    className="flex-1 rounded-lg border border-purple-800 bg-purple-950/30 px-3 py-2 text-sm text-purple-200 placeholder-purple-600 focus:border-purple-500 focus:outline-none"
                    onKeyDown={(e) => { if (e.key === "Enter") generatePrompt(); }} />
                  <button onClick={generatePrompt} disabled={w.generating || !w.aiIntent.trim()}
                    className="flex items-center gap-1.5 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-purple-500 disabled:opacity-50">
                    {w.generating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Generate
                  </button>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm text-zinc-400">System Prompt</label>
                <textarea value={w.systemPrompt} onChange={(e) => u({ systemPrompt: e.target.value })} rows={10} placeholder="You are a..."
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-purple-500 focus:outline-none" />
              </div>
            </div>
          )}

          {/* ── Step 3: Tools ── */}
          {w.step === 2 && (
            <div className="space-y-5">
              {w.toolsLoading ? (
                <div className="flex items-center gap-2 text-sm text-zinc-400"><Loader2 size={14} className="animate-spin" /> Loading available tools...</div>
              ) : w.availableTools ? (
                <>
                  {Object.entries(w.availableTools.serverTools)
                    .filter(([source, tools]) => {
                      if (source.startsWith("custom:")) return false;
                      if (!Array.isArray(tools) || tools.length === 0) return false;
                      const writeToolNames = new Set(w.availableTools!.writeTools.map((t) => t.name));
                      return tools.some((t) => !writeToolNames.has(t.name));
                    })
                    .length > 0 && (
                    <div>
                      <h3 className="mb-3 text-sm font-medium text-zinc-300">MCP Server Tools</h3>
                      {Object.entries(w.availableTools.serverTools)
                        .filter(([source, tools]) => {
                          if (source.startsWith("custom:")) return false;
                          if (!Array.isArray(tools) || tools.length === 0) return false;
                          const writeToolNames = new Set(w.availableTools!.writeTools.map((t) => t.name));
                          return tools.some((t) => !writeToolNames.has(t.name));
                        })
                        .map(([source, tools]) => {
                          const writeToolNames = new Set(w.availableTools!.writeTools.map((t) => t.name));
                          const serverTools = tools.filter((t) => !writeToolNames.has(t.name));
                          const names = serverTools.map((t) => t.name);
                          const allSel = names.length > 0 && names.every((x) => w.direct.includes(x));
                          return (
                            <div key={source} className="mb-3">
                              <div className="mb-1 flex items-center justify-between">
                                <p className="text-xs font-medium text-zinc-400">{formatServerLabel(source)}</p>
                                <button onClick={() => toggleAll("direct", names)} className="text-xs text-cyan-400 hover:text-cyan-300">
                                  {allSel ? "Deselect all" : "Select all"}
                                </button>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {serverTools.map((t) => (
                                  <button key={`${source}-${t.slug}`} onClick={() => toggle("direct", t.name)}
                                    className={`rounded-lg border px-3 py-2 text-sm transition ${w.direct.includes(t.name) ? "border-cyan-500 bg-cyan-950/30 text-cyan-300" : "border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-600"}`}>
                                    {t.name}
                                  </button>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  )}

                  {w.availableTools.subagents.length > 0 && (
                    <div>
                      <div className="mb-3 flex items-center justify-between">
                        <h3 className="text-sm font-medium text-zinc-300">Subagents</h3>
                        <button onClick={() => toggleAll("subagents", w.availableTools!.subagents.map((x) => x.name))} className="text-xs text-purple-400 hover:text-purple-300">
                          {w.subagents.length === w.availableTools.subagents.length ? "Deselect all" : "Select all"}
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {w.availableTools.subagents.map((sa) => (
                          <button key={sa.name} onClick={() => toggle("subagents", sa.name)}
                            className={`flex items-start gap-3 rounded-lg border p-3 text-left transition ${w.subagents.includes(sa.name) ? "border-purple-500 bg-purple-950/30" : "border-zinc-700 bg-zinc-800 hover:border-zinc-600"}`}>
                            <span className="text-lg">{SUBAGENT_EMOJI[sa.name] ?? "🤖"}</span>
                            <div>
                              <div className={`text-sm font-medium ${w.subagents.includes(sa.name) ? "text-purple-300" : "text-zinc-300"}`}>{sa.name}</div>
                              <div className="text-xs text-zinc-500">{sa.description.slice(0, 80)}</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {w.availableTools.writeTools.length > 0 && (
                    <div>
                      <div className="mb-3 flex items-center justify-between">
                        <h3 className="text-sm font-medium text-zinc-300">Direct Tools (require approval)</h3>
                        <button onClick={() => toggleAll("direct", w.availableTools!.writeTools.map((x) => x.name))} className="text-xs text-green-400 hover:text-green-300">
                          {w.direct.length === w.availableTools.writeTools.length ? "Deselect all" : "Select all"}
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {w.availableTools.writeTools.map((t) => (
                          <button key={`${t.source}-${t.name}`} onClick={() => toggle("direct", t.name)}
                            className={`rounded-lg border px-3 py-2 text-sm transition ${w.direct.includes(t.name) ? "border-green-500 bg-green-950/30 text-green-300" : "border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-600"}`}>
                            {t.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {w.availableTools.customGroups.length > 0 && (
                    <div>
                      <h3 className="mb-3 text-sm font-medium text-zinc-300">Custom Tools</h3>
                      {w.availableTools.customGroups.map((g) => {
                        const slugs = g.tools.map((t) => t.slug);
                        const allSel = slugs.every((x) => w.custom.includes(x));
                        const label = g.source.replace("custom:", "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
                        return (
                          <div key={g.source} className="mb-3">
                            <div className="mb-1 flex items-center justify-between">
                              <p className="text-xs font-medium text-zinc-400">{label}</p>
                              <button onClick={() => toggleCustomGroup(slugs, allSel)} className="text-xs text-blue-400 hover:text-blue-300">
                                {allSel ? "Deselect all" : "Select all"}
                              </button>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {g.tools.map((t) => (
                                <button key={t.slug} onClick={() => toggle("custom", t.slug)}
                                  className={`rounded-lg border px-3 py-2 text-sm transition ${w.custom.includes(t.slug) ? "border-blue-500 bg-blue-950/30 text-blue-300" : "border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-600"}`}>
                                  {t.name}
                                </button>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              ) : <p className="text-sm text-zinc-500">Failed to load tools.</p>}
            </div>
          )}

          {/* ── Step 4: Skills ── */}
          {w.step === 3 && (
            <div className="space-y-4">
              <p className="text-sm text-zinc-400">Select skills to attach to your agent. Skills inject knowledge or instructions into the agent's context.</p>
              {w.skillsLoading ? (
                <div className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 size={14} className="animate-spin" /> Loading skills...</div>
              ) : w.availableSkills.length === 0 ? (
                <p className="text-sm text-zinc-500">No skills available. You can create skills from the Skills tab on the dashboard.</p>
              ) : (
                <>
                  {/* Global Skills */}
                  {w.availableSkills.filter((s) => s.scope === "global").length > 0 && (
                    <div>
                      <h3 className="mb-2 text-xs font-medium text-zinc-400">Global Skills</h3>
                      <div className="flex flex-wrap gap-2">
                        {w.availableSkills.filter((s) => s.scope === "global").map((skill) => (
                          <button key={skill.id} onClick={() => setW((p) => ({ ...p, selectedSkillIds: p.selectedSkillIds.includes(skill.id) ? p.selectedSkillIds.filter((x) => x !== skill.id) : [...p.selectedSkillIds, skill.id] }))}
                            className={`rounded-lg border px-3 py-2 text-sm transition ${w.selectedSkillIds.includes(skill.id) ? "border-amber-500 bg-amber-950/30 text-amber-300" : "border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-600"}`}
                            title={skill.description || skill.slug}>
                            {skill.label || skill.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* My Skills */}
                  {w.availableSkills.filter((s) => s.ownerUserId === userId).length > 0 && (
                    <div>
                      <h3 className="mb-2 text-xs font-medium text-zinc-400">My Skills</h3>
                      <div className="flex flex-wrap gap-2">
                        {w.availableSkills.filter((s) => s.ownerUserId === userId).map((skill) => (
                          <button key={skill.id} onClick={() => setW((p) => ({ ...p, selectedSkillIds: p.selectedSkillIds.includes(skill.id) ? p.selectedSkillIds.filter((x) => x !== skill.id) : [...p.selectedSkillIds, skill.id] }))}
                            className={`rounded-lg border px-3 py-2 text-sm transition ${w.selectedSkillIds.includes(skill.id) ? "border-amber-500 bg-amber-950/30 text-amber-300" : "border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-600"}`}
                            title={skill.description || skill.slug}>
                            {skill.label || skill.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {w.selectedSkillIds.length > 0 && <p className="text-xs text-zinc-500">{w.selectedSkillIds.length} skill(s) selected</p>}
                </>
              )}
            </div>
          )}

          {/* ── Step 5: Review ── */}
          {w.step === 4 && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <span className="inline-block h-5 w-5 rounded-full" style={{ backgroundColor: w.color }} />
                <div>
                  <h3 className="font-medium text-zinc-200">{w.name || "Untitled"}</h3>
                  <p className="text-xs text-zinc-500">{effectiveSlug} / personal</p>
                </div>
              </div>
              {w.description && <p className="text-sm text-zinc-400">{w.description}</p>}
              <div>
                <h4 className="mb-1 text-xs font-medium text-zinc-500">System Prompt</h4>
                <pre className="max-h-32 overflow-auto rounded bg-zinc-950 p-3 text-xs text-zinc-400">{w.systemPrompt.slice(0, 500)}{w.systemPrompt.length > 500 ? "..." : ""}</pre>
              </div>
              {w.subagents.length > 0 && <div><h4 className="mb-1 text-xs font-medium text-zinc-500">Subagents</h4><div className="flex flex-wrap gap-1">{w.subagents.map((x) => <span key={x} className="rounded bg-purple-950 px-2 py-0.5 text-xs text-purple-400">{x}</span>)}</div></div>}
              {w.direct.length > 0 && <div><h4 className="mb-1 text-xs font-medium text-zinc-500">Direct Tools</h4><div className="flex flex-wrap gap-1">{w.direct.map((x) => <span key={x} className="rounded bg-green-950 px-2 py-0.5 text-xs text-green-400">{x}</span>)}</div></div>}
              {w.custom.length > 0 && <div><h4 className="mb-1 text-xs font-medium text-zinc-500">Custom Tools</h4><div className="flex flex-wrap gap-1">{w.custom.map((x) => <span key={x} className="rounded bg-blue-950 px-2 py-0.5 text-xs text-blue-400">{x}</span>)}</div></div>}
              {w.selectedSkillIds.length > 0 && <div><h4 className="mb-1 text-xs font-medium text-zinc-500">Skills</h4><div className="flex flex-wrap gap-1">{w.selectedSkillIds.map((id) => { const s = w.availableSkills.find((x) => x.id === id); return <span key={id} className="rounded bg-amber-950 px-2 py-0.5 text-xs text-amber-400">{s?.label || s?.name || id}</span>; })}</div></div>}
              {w.error && <p className="rounded bg-red-950 p-2 text-sm text-red-400">{w.error}</p>}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-zinc-800 px-6 py-4">
          <button onClick={() => w.step > 0 ? u({ step: w.step - 1 }) : onClose()} className="flex items-center gap-1 text-sm text-zinc-400 transition hover:text-zinc-200">
            <ChevronLeft size={16} /> {w.step > 0 ? "Back" : "Cancel"}
          </button>
          {w.step < STEPS.length - 1 ? (
            <button onClick={() => u({ step: w.step + 1 })} disabled={!canNext}
              className="flex items-center gap-1 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-purple-500 disabled:opacity-50">
              Next <ChevronRight size={16} />
            </button>
          ) : (
            <button onClick={handleCreate} disabled={w.creating || !canNext}
              className="flex items-center gap-1 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-green-500 disabled:opacity-50">
              {w.creating ? <Loader2 size={14} className="animate-spin" /> : null} Create Agent
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
