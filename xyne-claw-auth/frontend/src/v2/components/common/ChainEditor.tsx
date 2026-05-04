import { useState, useEffect } from "react";
import { Save, X } from "lucide-react";
import type { Agent } from "../../../lib/types";

export const WELL_KNOWN_TOOLS = [
  { value: "Bitbucket__create_pull_request", label: "PR Created (Bitbucket)" },
  { value: "Bitbucket__merge_pull_request", label: "PR Merged (Bitbucket)" },
  { value: "Bitbucket__add_comment", label: "PR Comment Added (Bitbucket)" },
  { value: "Xyne_Spaces__spaces-create-ticket", label: "Ticket Created (Spaces)" },
  { value: "Xyne_Spaces__spaces-send-message", label: "Message Sent (Spaces)" },
  { value: "Xyne_Spaces__spaces-schedule-call", label: "Call Scheduled (Spaces)" },
  { value: "Xyne_Spaces__spaces-trigger-agent", label: "Agent Triggered (Spaces)" },
  { value: "edit", label: "File Edited" },
  { value: "write", label: "File Written" },
  { value: "bash", label: "Shell Command Ran" },
];

interface ChainEditorProps {
  agent: Agent;
  userId: string;
  allAgents: Agent[];
  onSave: (cfg: Record<string, unknown> | null) => Promise<void>;
  loadConfig: () => Promise<Record<string, unknown> | null>;
}

export function ChainEditor({ allAgents, onSave, loadConfig }: ChainEditorProps) {
  const [triggerAgent, setTriggerAgent] = useState("");
  const [taskTemplate, setTaskTemplate] = useState("");
  const [toolsMustInclude, setToolsMustInclude] = useState<string[]>([]);
  const [toolsMustExclude, setToolsMustExclude] = useState<string[]>([]);
  const [customTool, setCustomTool] = useState("");
  const [customExcludeTool, setCustomExcludeTool] = useState("");
  const [failureTriggerAgent, setFailureTriggerAgent] = useState("");
  const [escalate, setEscalate] = useState(false);
  const [maxRetries, setMaxRetries] = useState(3);
  const [judgeContext, setJudgeContext] = useState("");
  const [chainMode, setChainMode] = useState<"deterministic" | "non-deterministic">("deterministic");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loadingCfg, setLoadingCfg] = useState(true);

  useEffect(() => {
    loadConfig().then((data) => {
      if (data) {
        const oc = (data.onComplete ?? {}) as Record<string, unknown>;
        const of_ = (data.onFailure ?? {}) as Record<string, unknown>;
        const conds = (oc.conditions ?? {}) as Record<string, unknown>;
        setTriggerAgent((oc.triggerAgent as string) ?? "");
        setTaskTemplate((oc.task as string) ?? "");
        setToolsMustInclude((conds.toolsMustInclude as string[]) ?? []);
        setToolsMustExclude((conds.toolsMustExclude as string[]) ?? []);
        setFailureTriggerAgent((of_.triggerAgent as string) ?? "");
        setEscalate((of_.escalate as boolean) ?? false);
        setMaxRetries((data.maxDepth as number) ?? 3);
        setChainMode((data.mode as "deterministic" | "non-deterministic") ?? "deterministic");
        setJudgeContext((oc.judgeContext as string) ?? "");
      }
      setLoadingCfg(false);
    }).catch(() => setLoadingCfg(false));
  }, [loadConfig]);

  const hasChain = triggerAgent.length > 0;
  const addInclude = (t: string) => { if (t && !toolsMustInclude.includes(t)) setToolsMustInclude([...toolsMustInclude, t]); };
  const addExclude = (t: string) => { if (t && !toolsMustExclude.includes(t)) setToolsMustExclude([...toolsMustExclude, t]); };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (!hasChain) {
        await onSave(null);
      } else {
        const oc: Record<string, unknown> = { triggerAgent, task: taskTemplate };
        if (chainMode === "deterministic") {
          const conds: Record<string, unknown> = {};
          if (toolsMustInclude.length) conds.toolsMustInclude = toolsMustInclude;
          if (toolsMustExclude.length) conds.toolsMustExclude = toolsMustExclude;
          if (Object.keys(conds).length) oc.conditions = conds;
        } else if (judgeContext.trim()) {
          oc.judgeContext = judgeContext.trim();
        }
        const chain: Record<string, unknown> = { mode: chainMode, onComplete: oc };
        if (failureTriggerAgent || escalate) {
          const of_: Record<string, unknown> = {};
          if (failureTriggerAgent) of_.triggerAgent = failureTriggerAgent;
          if (escalate) of_.escalate = true;
          chain.onFailure = of_;
        }
        if (maxRetries > 0) chain.maxDepth = maxRetries;
        await onSave(chain);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  };

  if (loadingCfg) return <p className="text-sm text-zinc-400">Loading chain config…</p>;

  const selCls = "w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 focus:border-zinc-400 focus:outline-none";
  const taCls = "w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 placeholder-zinc-300 focus:border-zinc-400 focus:outline-none";

  return (
    <div className="space-y-5">
      <p className="text-xs text-zinc-400">Chain config is saved per-user — other users have their own settings.</p>

      <div className="rounded-xl border border-zinc-200 bg-white p-5">
        <h3 className="mb-4 text-sm font-semibold text-zinc-800">On Complete — Trigger Next Agent</h3>
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs text-zinc-500">Trigger Agent</label>
            <select value={triggerAgent} onChange={(e) => setTriggerAgent(e.target.value)} className={selCls}>
              <option value="">— None (no chaining) —</option>
              {allAgents.map((a) => <option key={a.slug} value={a.slug}>{a.name} ({a.slug})</option>)}
            </select>
          </div>
          {hasChain && (
            <div>
              <label className="mb-1 block text-xs text-zinc-500">Task Template</label>
              <textarea value={taskTemplate} onChange={(e) => setTaskTemplate(e.target.value)} rows={3}
                placeholder="Review the PR. Context: {{result}}" className={taCls} />
            </div>
          )}
          {hasChain && (
            <div>
              <label className="mb-2 block text-xs text-zinc-500">Chain Mode</label>
              <div className="flex gap-3">
                {([
                  ["deterministic", "Deterministic", "Fires based on tools called."],
                  ["non-deterministic", "LLM Judge", "An LLM decides continue/stop."],
                ] as const).map(([val, lbl, desc]) => (
                  <label key={val} className={`flex-1 cursor-pointer rounded-lg border p-3 text-sm transition ${chainMode === val ? "border-zinc-900 bg-zinc-50" : "border-zinc-200 hover:border-zinc-300"}`}>
                    <input type="radio" name="chainMode" value={val} checked={chainMode === val}
                      onChange={() => { setChainMode(val); if (val === "non-deterministic") { setToolsMustInclude([]); setToolsMustExclude([]); } }}
                      className="sr-only" />
                    <div className="font-medium text-zinc-800">{lbl}</div>
                    <div className="mt-0.5 text-xs text-zinc-400">{desc}</div>
                  </label>
                ))}
              </div>
            </div>
          )}
          {hasChain && chainMode === "deterministic" && (
            <div>
              <label className="mb-2 block text-xs text-zinc-500">Tools that MUST have been called</label>
              <div className="mb-2 flex flex-wrap gap-2">
                {toolsMustInclude.map((t) => (
                  <span key={t} className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-xs text-green-700">
                    {WELL_KNOWN_TOOLS.find((w) => w.value === t)?.label ?? t}
                    <button onClick={() => setToolsMustInclude(toolsMustInclude.filter((x) => x !== t))}><X size={11} /></button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <select onChange={(e) => { addInclude(e.target.value); e.target.value = ""; }} defaultValue=""
                  className="flex-1 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs text-zinc-700 focus:outline-none">
                  <option value="">+ Add tool…</option>
                  {WELL_KNOWN_TOOLS.filter((t) => !toolsMustInclude.includes(t.value)).map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
                <input value={customTool} onChange={(e) => setCustomTool(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && customTool) { addInclude(customTool); setCustomTool(""); } }}
                  placeholder="Custom tool…"
                  className="flex-1 rounded-lg border border-zinc-200 px-2 py-1.5 text-xs placeholder-zinc-300 focus:outline-none" />
              </div>
            </div>
          )}
          {hasChain && chainMode === "deterministic" && (
            <div>
              <label className="mb-2 block text-xs text-zinc-500">Tools that must NOT have been called</label>
              <div className="mb-2 flex flex-wrap gap-2">
                {toolsMustExclude.map((t) => (
                  <span key={t} className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs text-red-600">
                    {WELL_KNOWN_TOOLS.find((w) => w.value === t)?.label ?? t}
                    <button onClick={() => setToolsMustExclude(toolsMustExclude.filter((x) => x !== t))}><X size={11} /></button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <select onChange={(e) => { addExclude(e.target.value); e.target.value = ""; }} defaultValue=""
                  className="flex-1 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs text-zinc-700 focus:outline-none">
                  <option value="">+ Add tool…</option>
                  {WELL_KNOWN_TOOLS.filter((t) => !toolsMustExclude.includes(t.value)).map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
                <input value={customExcludeTool} onChange={(e) => setCustomExcludeTool(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && customExcludeTool) { addExclude(customExcludeTool); setCustomExcludeTool(""); } }}
                  placeholder="Custom tool…"
                  className="flex-1 rounded-lg border border-zinc-200 px-2 py-1.5 text-xs placeholder-zinc-300 focus:outline-none" />
              </div>
            </div>
          )}
          {hasChain && chainMode === "non-deterministic" && (
            <div>
              <label className="mb-1 block text-xs text-zinc-500">Judge Instructions</label>
              <textarea value={judgeContext} onChange={(e) => setJudgeContext(e.target.value)} rows={3}
                placeholder="CONTINUE if issues found. STOP if complete." className={taCls} />
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-5">
        <h3 className="mb-4 text-sm font-semibold text-zinc-800">On Failure</h3>
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm text-zinc-700">
            <input type="checkbox" checked={escalate} onChange={(e) => setEscalate(e.target.checked)}
              className="rounded border-zinc-300" />
            Escalate — post failure notice in thread
          </label>
          <div>
            <label className="mb-1 block text-xs text-zinc-500">Trigger Agent on Failure</label>
            <select value={failureTriggerAgent} onChange={(e) => setFailureTriggerAgent(e.target.value)} className={selCls}>
              <option value="">— None —</option>
              {allAgents.map((a) => <option key={a.slug} value={a.slug}>{a.name} ({a.slug})</option>)}
            </select>
          </div>
        </div>
      </div>

      {hasChain && (
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <label className="mb-1 block text-sm font-semibold text-zinc-800">Max Chain Depth (max 3)</label>
          <input type="number" min={1} max={3} value={maxRetries}
            onChange={(e) => setMaxRetries(Math.min(+e.target.value, 3))}
            className="w-24 rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-700 focus:outline-none" />
        </div>
      )}

      <div className="flex items-center gap-3">
        <button onClick={handleSave} disabled={saving}
          className="flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50">
          <Save size={15} />{saving ? "Saving…" : "Save Chain Config"}
        </button>
        {saved && <span className="text-sm text-green-600">✓ Saved</span>}
      </div>
    </div>
  );
}
