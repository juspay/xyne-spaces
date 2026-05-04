import { useState, useEffect, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Trash2, ChevronDown, ChevronRight, Link2, Save, X, Plus, Settings, Sparkles, Loader2 } from "lucide-react";
import { listAgents, getAgentDetail, updateAgent, listScheduledJobs, deleteScheduledJob, listScheduledJobRuns, getUserChainConfig, setUserChainConfig } from "../lib/api";
import type { Agent, AgentSkill, ScheduledJob, ScheduledJobRun } from "../lib/types";

interface Props {
  userId: string;
  isAdmin?: boolean;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function duration(start: string, end: string | null): string {
  if (!end) return "running...";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  return `${mins}m ${secs % 60}s`;
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active: "bg-green-950 text-green-400",
    completed: "bg-blue-950 text-blue-400",
    cancelled: "bg-zinc-800 text-zinc-400",
    started: "bg-yellow-950 text-yellow-400",
    failed: "bg-red-950 text-red-400",
    error: "bg-red-950 text-red-400",
  };
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs ${styles[status] ?? "bg-zinc-800 text-zinc-400"}`}>
      {status}
    </span>
  );
}

export function AgentDetailPage({ userId, isAdmin }: Props) {
  const { slug } = useParams<{ slug: string }>();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [runs, setRuns] = useState<ScheduledJobRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"configure" | "jobs" | "runs" | "chain">("jobs");
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [allAgents, setAllAgents] = useState<Agent[]>([]);

  const loadData = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    setError(null);
    try {
      const [agentDetail, agentList, jobList, runList] = await Promise.all([
        getAgentDetail(slug),
        listAgents(userId),
        listScheduledJobs({ agentSlug: slug }),
        listScheduledJobRuns(slug),
      ]);
      setAgent(agentDetail);
      setAllAgents(agentList);
      setJobs(jobList);
      setRuns(runList);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [slug, userId]);

  useEffect(() => { loadData(); }, [loadData]);

  // Default to configure tab for editable agents
  useEffect(() => {
    if (agent && (agent.ownerUserId === userId || (agent.scope === "global" && isAdmin))) {
      setActiveTab("configure");
    }
  }, [agent?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDelete = useCallback(async (jobId: string) => {
    setDeleting(jobId);
    try {
      await deleteScheduledJob(jobId);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete job");
    } finally {
      setDeleting(null);
    }
  }, [loadData]);

  if (loading) {
    return <p className="text-zinc-400">Loading...</p>;
  }

  if (!agent) {
    return (
      <div>
        <Link to="/" className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-400 transition hover:text-zinc-200">
          <ArrowLeft size={16} /> Back to Agents
        </Link>
        <p className="mt-4 text-zinc-400">Agent not found.</p>
      </div>
    );
  }

  const isOwner = agent.ownerUserId === userId;
  const canEdit = isOwner || (agent.scope === "global" && !!isAdmin);
  const activeJobs = jobs.filter((j) => j.status === "active");
  const inactiveJobs = jobs.filter((j) => j.status !== "active");

  return (
    <div>
      {/* Back link */}
      <Link to="/" className="mb-6 inline-flex items-center gap-1 text-sm text-zinc-400 transition hover:text-zinc-200">
        <ArrowLeft size={16} /> Back to Agents
      </Link>

      {/* Agent header */}
      <div className="mb-6 flex items-center gap-3">
        <div className="h-4 w-4 rounded-full" style={{ backgroundColor: agent.color }} />
        <div>
          <h1 className="text-xl font-semibold">{agent.name}</h1>
          <p className="text-sm text-zinc-400">{agent.slug} — {agent.description}</p>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-200">
          {error}
          <button onClick={() => setError(null)} className="ml-2 text-red-400 hover:text-red-200">✕</button>
        </div>
      )}

      {/* Tab bar */}
      <div className="mb-6 flex gap-1 border-b border-zinc-800">
        {canEdit && (
          <button
            onClick={() => setActiveTab("configure")}
            className={`px-4 py-2 text-sm font-medium transition ${
              activeTab === "configure"
                ? "border-b-2 border-zinc-100 text-zinc-100"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <span className="flex items-center gap-1.5"><Settings size={14} /> Configure</span>
          </button>
        )}
        <button
          onClick={() => setActiveTab("jobs")}
          className={`px-4 py-2 text-sm font-medium transition ${
            activeTab === "jobs"
              ? "border-b-2 border-zinc-100 text-zinc-100"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          Scheduled Jobs ({jobs.length})
        </button>
        <button
          onClick={() => setActiveTab("runs")}
          className={`px-4 py-2 text-sm font-medium transition ${
            activeTab === "runs"
              ? "border-b-2 border-zinc-100 text-zinc-100"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          Run History ({runs.length})
        </button>
        <button
          onClick={() => setActiveTab("chain")}
          className={`px-4 py-2 text-sm font-medium transition ${
            activeTab === "chain"
              ? "border-b-2 border-zinc-100 text-zinc-100"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <span className="flex items-center gap-1.5"><Link2 size={14} /> Chain</span>
        </button>
      </div>

      {/* Configure tab (personal agents only) */}
      {activeTab === "configure" && canEdit && agent && (
        <AgentConfigEditor agent={agent} userId={userId} onSave={loadData} />
      )}

      {/* Scheduled Jobs tab */}
      {activeTab === "jobs" && (
        <div className="space-y-3">
          {jobs.length === 0 ? (
            <p className="rounded-lg border border-zinc-800 bg-zinc-900 p-6 text-center text-sm text-zinc-500">
              No scheduled jobs for this agent.
            </p>
          ) : (
            <>
              {activeJobs.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-medium text-zinc-300">Active</h3>
                  {activeJobs.map((job) => (
                    <JobCard key={job.id} job={job} deleting={deleting === job.id} onDelete={handleDelete} />
                  ))}
                </div>
              )}
              {inactiveJobs.length > 0 && (
                <div className="mt-4 space-y-2">
                  <h3 className="text-sm font-medium text-zinc-500">Completed / Cancelled</h3>
                  {inactiveJobs.map((job) => (
                    <JobCard key={job.id} job={job} deleting={deleting === job.id} onDelete={handleDelete} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Run History tab */}
      {activeTab === "runs" && (
        <div className="space-y-2">
          {runs.length === 0 ? (
            <p className="rounded-lg border border-zinc-800 bg-zinc-900 p-6 text-center text-sm text-zinc-500">
              No runs yet.
            </p>
          ) : (
            runs.map((run) => (
              <RunCard
                key={run.id}
                run={run}
                expanded={expandedRunId === run.id}
                onToggle={() => setExpandedRunId(expandedRunId === run.id ? null : run.id)}
              />
            ))
          )}
        </div>
      )}

      {/* Chain Configuration tab */}
      {activeTab === "chain" && agent && (
        <ChainEditor
          agent={agent}
          userId={userId}
          allAgents={allAgents.filter((a) => a.slug !== agent.slug)}
          onSave={async (chainConfig) => {
            await setUserChainConfig(agent.slug, userId, chainConfig);
          }}
          loadConfig={async () => {
            return getUserChainConfig(agent.slug, userId);
          }}
        />
      )}

    </div>
  );
}

function JobCard({ job, deleting, onDelete }: { job: ScheduledJob; deleting: boolean; onDelete: (id: string) => void }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">{job.label || job.task.slice(0, 60)}</span>
            <StatusBadge status={job.status} />
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
            {job.type === "cron" && job.cronExpression && (
              <span title="Cron expression">cron: {job.cronExpression}</span>
            )}
            {job.type === "once" && job.nextRunAt && (
              <span>runs at: {new Date(job.nextRunAt).toLocaleString()}</span>
            )}
            <span>runs: {job.runCount}{job.maxRuns ? `/${job.maxRuns}` : ""}</span>
            {job.lastRunAt && <span>last run: {timeAgo(job.lastRunAt)}</span>}
            <span>created: {timeAgo(job.createdAt)}</span>
          </div>
          {job.label && (
            <p className="mt-1 truncate text-xs text-zinc-600">{job.task}</p>
          )}
        </div>
        {job.status === "active" && (
          <button
            onClick={() => onDelete(job.id)}
            disabled={deleting}
            className="ml-4 shrink-0 rounded p-1.5 text-red-400 transition hover:bg-red-950 hover:text-red-300 disabled:opacity-50"
            title="Cancel job"
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

function RunCard({ run, expanded, onToggle }: { run: ScheduledJobRun; expanded: boolean; onToggle: () => void }) {
  const jobLabel = run.scheduledJob?.label || run.scheduledJob?.task?.slice(0, 40) || run.scheduledJobId;
  const hasContent = !!(run.result || run.error);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900">
      <div
        className={`flex items-center gap-3 p-4 ${hasContent ? "cursor-pointer" : ""}`}
        onClick={hasContent ? onToggle : undefined}
      >
        {hasContent ? (
          expanded ? <ChevronDown size={16} className="shrink-0 text-zinc-500" /> : <ChevronRight size={16} className="shrink-0 text-zinc-500" />
        ) : (
          <div className="w-4" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{jobLabel}</span>
            <StatusBadge status={run.status} />
          </div>
          <div className="mt-0.5 flex gap-x-4 text-xs text-zinc-500">
            <span>{timeAgo(run.startedAt)}</span>
            <span>{duration(run.startedAt, run.completedAt)}</span>
          </div>
        </div>
      </div>
      {expanded && hasContent && (
        <div className="border-t border-zinc-800 p-4">
          {run.error && (
            <pre className="mb-2 whitespace-pre-wrap rounded bg-red-950/50 p-3 text-xs text-red-300">{run.error}</pre>
          )}
          {run.result && (
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded bg-zinc-950 p-3 text-xs text-zinc-300">{run.result}</pre>
          )}
        </div>
      )}
    </div>
  );
}

// ── Well-known tool names for deterministic chain conditions ──────────

const WELL_KNOWN_TOOLS = [
  { value: "Bitbucket__create_pull_request", label: "PR Created (Bitbucket)" },
  { value: "Bitbucket__merge_pull_request", label: "PR Merged (Bitbucket)" },
  { value: "Bitbucket__add_comment", label: "PR Comment Added (Bitbucket)" },
  { value: "Xyne_Spaces__spaces-create-ticket", label: "Ticket Created (Spaces)" },
  { value: "Xyne_Spaces__spaces-send-message", label: "Message Sent (Spaces)" },
  { value: "Xyne_Spaces__spaces-schedule-call", label: "Call Scheduled (Spaces)" },
  { value: "Xyne_Spaces__spaces-trigger-agent", label: "Agent Triggered (Spaces)" },
  { value: "Bitbucket__upload-pr-screenshot", label: "Screenshot Uploaded (Bitbucket)" },
  { value: "edit", label: "File Edited" },
  { value: "write", label: "File Written" },
  { value: "bash", label: "Shell Command Ran" },
];

interface ChainEditorProps {
  agent: Agent;
  userId: string;
  allAgents: Agent[];
  onSave: (chainConfig: Record<string, unknown> | null) => Promise<void>;
  loadConfig: () => Promise<Record<string, unknown> | null>;
}

function ChainEditor({ agent, userId, allAgents, onSave, loadConfig }: ChainEditorProps) {
  const [triggerAgent, setTriggerAgent] = useState<string>("");
  const [taskTemplate, setTaskTemplate] = useState<string>("");
  const [toolsMustInclude, setToolsMustInclude] = useState<string[]>([]);
  const [toolsMustExclude, setToolsMustExclude] = useState<string[]>([]);
  const [customTool, setCustomTool] = useState("");
  const [customExcludeTool, setCustomExcludeTool] = useState("");
  const [failureTriggerAgent, setFailureTriggerAgent] = useState<string>("");
  const [escalate, setEscalate] = useState<boolean>(false);
  const [maxRetries, setMaxRetries] = useState<number>(3);
  const [judgeContext, setJudgeContext] = useState<string>("");
  const [chainMode, setChainMode] = useState<"deterministic" | "non-deterministic">("deterministic");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loadingConfig, setLoadingConfig] = useState(true);

  // Load user-level chain config on mount
  useEffect(() => {
    loadConfig().then((data) => {
      if (data) {
        const onComplete = (data.onComplete ?? {}) as Record<string, unknown>;
        const onFailure = (data.onFailure ?? {}) as Record<string, unknown>;
        const conditions = (onComplete.conditions ?? {}) as Record<string, unknown>;
        setTriggerAgent((onComplete.triggerAgent as string) ?? "");
        setTaskTemplate((onComplete.task as string) ?? "");
        setToolsMustInclude((conditions.toolsMustInclude as string[]) ?? []);
        setToolsMustExclude((conditions.toolsMustExclude as string[]) ?? []);
        setFailureTriggerAgent((onFailure.triggerAgent as string) ?? "");
        setEscalate((onFailure.escalate as boolean) ?? false);
        setMaxRetries((data.maxDepth as number) ?? 3);
        setChainMode((data.mode as "deterministic" | "non-deterministic") ?? "deterministic");
        setJudgeContext((onComplete.judgeContext as string) ?? "");
      }
      setLoadingConfig(false);
    }).catch(() => setLoadingConfig(false));
  }, [loadConfig]);

  const hasChain = triggerAgent.length > 0;

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      if (!hasChain) {
        await onSave(null);
      } else {
        const chain: Record<string, unknown> = { mode: chainMode };

        const onComplete: Record<string, unknown> = {
          triggerAgent,
          task: taskTemplate,
        };
        if (chainMode === "deterministic") {
          const conditions: Record<string, unknown> = {};
          if (toolsMustInclude.length > 0) conditions.toolsMustInclude = toolsMustInclude;
          if (toolsMustExclude.length > 0) conditions.toolsMustExclude = toolsMustExclude;
          if (Object.keys(conditions).length > 0) onComplete.conditions = conditions;
        } else if (judgeContext.trim()) {
          onComplete.judgeContext = judgeContext.trim();
        }
        chain.onComplete = onComplete;

        if (failureTriggerAgent || escalate) {
          const onFailure: Record<string, unknown> = {};
          if (failureTriggerAgent) onFailure.triggerAgent = failureTriggerAgent;
          if (escalate) onFailure.escalate = true;
          chain.onFailure = onFailure;
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

  const addIncludeTool = (tool: string) => {
    if (tool && !toolsMustInclude.includes(tool)) {
      setToolsMustInclude([...toolsMustInclude, tool]);
    }
  };

  const addExcludeTool = (tool: string) => {
    if (tool && !toolsMustExclude.includes(tool)) {
      setToolsMustExclude([...toolsMustExclude, tool]);
    }
  };

  if (loadingConfig) return <div className="text-sm text-zinc-400">Loading chain config...</div>;

  return (
    <div className="space-y-6">
      <p className="text-xs text-zinc-500">This chain config is saved per-user. Other users have their own chain settings.</p>
      {/* On Complete */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
        <h3 className="mb-4 text-sm font-semibold text-zinc-200">On Complete — Trigger Next Agent</h3>

        <div className="space-y-4">
          {/* Target agent select */}
          <div>
            <label className="mb-1 block text-xs text-zinc-400">Trigger Agent</label>
            <select
              value={triggerAgent}
              onChange={(e) => setTriggerAgent(e.target.value)}
              className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 focus:border-zinc-500 focus:outline-none"
            >
              <option value="">— None (no chaining) —</option>
              {allAgents.map((a) => (
                <option key={a.slug} value={a.slug}>{a.name} ({a.slug})</option>
              ))}
            </select>
          </div>

          {/* Task template */}
          {hasChain && (
            <div>
              <label className="mb-1 block text-xs text-zinc-400">
                Task Template
                <span className="ml-2 text-zinc-600">
                  Variables: {"{{result}}"} {"{{agentSlug}}"} {"{{channelId}}"} {"{{conversationId}}"}
                </span>
              </label>
              <textarea
                value={taskTemplate}
                onChange={(e) => setTaskTemplate(e.target.value)}
                rows={3}
                placeholder="Review the PR created by {{agentSlug}}. Context: {{result}}"
                className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
              />
            </div>
          )}

          {/* Chain Mode Selector */}
          {hasChain && (
            <div>
              <label className="mb-2 block text-xs text-zinc-400">Chain Mode</label>
              <div className="flex gap-3">
                <label className={`flex-1 cursor-pointer rounded-lg border p-3 text-sm transition ${chainMode === "deterministic" ? "border-blue-500 bg-blue-950/30 text-blue-300" : "border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-600"}`}>
                  <input type="radio" name="chainMode" value="deterministic" checked={chainMode === "deterministic"} onChange={() => setChainMode("deterministic")} className="sr-only" />
                  <div className="font-medium">Deterministic</div>
                  <div className="mt-1 text-xs opacity-70">Chain fires based on which tools the agent called. Fast, no extra LLM call.</div>
                </label>
                <label className={`flex-1 cursor-pointer rounded-lg border p-3 text-sm transition ${chainMode === "non-deterministic" ? "border-purple-500 bg-purple-950/30 text-purple-300" : "border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-600"}`}>
                  <input type="radio" name="chainMode" value="non-deterministic" checked={chainMode === "non-deterministic"} onChange={() => { setChainMode("non-deterministic"); setToolsMustInclude([]); setToolsMustExclude([]); }} className="sr-only" />
                  <div className="font-medium">LLM Judge</div>
                  <div className="mt-1 text-xs opacity-70">An LLM reads the agent's output and decides if the chain should continue or stop.</div>
                </label>
              </div>
            </div>
          )}

          {/* Deterministic conditions — only shown in deterministic mode */}
          {hasChain && chainMode === "deterministic" && (
            <div>
              <label className="mb-2 block text-xs text-zinc-400">
                Conditions — Tools that MUST have been called
              </label>
              <div className="mb-2 flex flex-wrap gap-2">
                {toolsMustInclude.map((tool) => (
                  <span key={tool} className="inline-flex items-center gap-1 rounded-md bg-green-950 px-2 py-1 text-xs text-green-300">
                    {WELL_KNOWN_TOOLS.find((t) => t.value === tool)?.label ?? tool}
                    <button onClick={() => setToolsMustInclude(toolsMustInclude.filter((t) => t !== tool))} className="text-green-500 hover:text-green-200"><X size={12} /></button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <select
                  onChange={(e) => { addIncludeTool(e.target.value); e.target.value = ""; }}
                  defaultValue=""
                  className="flex-1 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-200 focus:border-zinc-500 focus:outline-none"
                >
                  <option value="">+ Add from common tools…</option>
                  {WELL_KNOWN_TOOLS.filter((t) => !toolsMustInclude.includes(t.value)).map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
                <input
                  type="text"
                  value={customTool}
                  onChange={(e) => setCustomTool(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && customTool) { addIncludeTool(customTool); setCustomTool(""); } }}
                  placeholder="Custom tool name…"
                  className="flex-1 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
                />
              </div>
            </div>
          )}

          {/* Exclude conditions — only shown in deterministic mode */}
          {hasChain && chainMode === "deterministic" && (
            <div>
              <label className="mb-2 block text-xs text-zinc-400">
                Exclude Conditions — Tools that must NOT have been called
              </label>
              <div className="mb-2 flex flex-wrap gap-2">
                {toolsMustExclude.map((tool) => (
                  <span key={tool} className="inline-flex items-center gap-1 rounded-md bg-red-950 px-2 py-1 text-xs text-red-300">
                    {WELL_KNOWN_TOOLS.find((t) => t.value === tool)?.label ?? tool}
                    <button onClick={() => setToolsMustExclude(toolsMustExclude.filter((t) => t !== tool))} className="text-red-500 hover:text-red-200"><X size={12} /></button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <select
                  onChange={(e) => { addExcludeTool(e.target.value); e.target.value = ""; }}
                  defaultValue=""
                  className="flex-1 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-200 focus:border-zinc-500 focus:outline-none"
                >
                  <option value="">+ Add from common tools…</option>
                  {WELL_KNOWN_TOOLS.filter((t) => !toolsMustExclude.includes(t.value)).map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
                <input
                  type="text"
                  value={customExcludeTool}
                  onChange={(e) => setCustomExcludeTool(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && customExcludeTool) { addExcludeTool(customExcludeTool); setCustomExcludeTool(""); } }}
                  placeholder="Custom tool name…"
                  className="flex-1 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
                />
              </div>
            </div>
          )}
          {/* LLM Judge context — only shown in non-deterministic mode */}
          {hasChain && chainMode === "non-deterministic" && (
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs text-zinc-400">
                  Judge Instructions <span className="text-zinc-600">(tell the LLM when to CONTINUE vs STOP)</span>
                </label>
                <textarea
                  value={judgeContext}
                  onChange={(e) => setJudgeContext(e.target.value)}
                  rows={3}
                  placeholder="e.g. CONTINUE if the agent found code issues or bugs that need fixing. STOP if the agent asked the user a question, or if the review is complete with no issues."
                  className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-sm text-zinc-200 placeholder-zinc-600 focus:border-purple-500 focus:outline-none"
                />
              </div>
              <div className="rounded-md border border-purple-800/50 bg-purple-950/20 p-3">
                <p className="text-xs text-purple-400">The LLM judge will read the agent's output plus your instructions above to decide CONTINUE or STOP after each step. Max depth ({maxRetries || 3}) is the hard safety limit.</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* On Failure */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
        <h3 className="mb-4 text-sm font-semibold text-zinc-200">On Failure</h3>
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={escalate}
              onChange={(e) => setEscalate(e.target.checked)}
              className="rounded border-zinc-600 bg-zinc-800"
            />
            Escalate — post failure notice in thread
          </label>

          <div>
            <label className="mb-1 block text-xs text-zinc-400">Trigger Agent on Failure (optional)</label>
            <select
              value={failureTriggerAgent}
              onChange={(e) => setFailureTriggerAgent(e.target.value)}
              className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 focus:border-zinc-500 focus:outline-none"
            >
              <option value="">— None —</option>
              {allAgents.map((a) => (
                <option key={a.slug} value={a.slug}>{a.name} ({a.slug})</option>
              ))}
            </select>
          </div>

        </div>
      </div>

      {/* Max Chain Depth */}
      {hasChain && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
          <label className="mb-1 block text-sm font-semibold text-zinc-200">Max Chain Depth (max 3)</label>
          <input
            type="number"
            min={1}
            max={3}
            value={maxRetries}
            onChange={(e) => setMaxRetries(Math.min(Number(e.target.value), 3))}
            className="w-24 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 focus:border-zinc-500 focus:outline-none"
          />
          <p className="mt-1 text-xs text-zinc-500">How many times the chain can loop back. Hard limit is 3.</p>
        </div>
      )}

      {/* Preview JSON */}
      {hasChain && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
          <h3 className="mb-2 text-sm font-semibold text-zinc-200">Config Preview</h3>
          <pre className="max-h-48 overflow-auto rounded bg-zinc-950 p-3 text-xs text-zinc-400">
            {JSON.stringify({
              mode: chainMode,
              onComplete: {
                triggerAgent,
                task: taskTemplate,
                ...(chainMode === "deterministic" && (toolsMustInclude.length > 0 || toolsMustExclude.length > 0)
                  ? {
                      conditions: {
                        ...(toolsMustInclude.length > 0 ? { toolsMustInclude } : {}),
                        ...(toolsMustExclude.length > 0 ? { toolsMustExclude } : {}),
                      },
                    }
                  : {}),
              },
              ...(failureTriggerAgent || escalate
                ? {
                    onFailure: {
                      ...(failureTriggerAgent ? { triggerAgent: failureTriggerAgent } : {}),
                      ...(escalate ? { escalate: true } : {}),
                    },
                  }
                : {}),
              ...(maxRetries > 0 ? { maxDepth: maxRetries } : {}),
            }, null, 2)}
          </pre>
        </div>
      )}

      {/* Save button */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 transition hover:bg-white disabled:opacity-50"
        >
          <Save size={16} />
          {saving ? "Saving…" : "Save Chain Config"}
        </button>
        {saved && <span className="text-sm text-green-400">✓ Saved</span>}
      </div>
    </div>
  );
}

// ── Agent Config Editor (System Prompt + Skills + Tools) ─────────────

function AgentConfigEditor({ agent, userId, onSave }: { agent: Agent; userId: string; onSave: () => void }) {
  const configTools = (agent.config?.tools as { subagents?: string[]; direct?: string[]; custom?: string[] } | undefined) ?? {};
  const configSubagentSkills = (agent.config?.subagentSkills as Record<string, string[]> | undefined) ?? {};
  const [prompt, setPrompt] = useState(agent.systemPrompt ?? "");
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>(
    agent.skills?.map((s) => s.skillId) ?? [],
  );
  const [subagents, setSubagents] = useState<string[]>(configTools.subagents ?? []);
  const [saSkills, setSaSkills] = useState<Record<string, string[]>>(configSubagentSkills);
  const [direct, setDirect] = useState<string[]>(configTools.direct ?? []);
  const [custom, setCustom] = useState<string[]>(configTools.custom ?? []);
  const [availableTools, setAvailableTools] = useState<import("../lib/api").AvailableTools | null>(null);
  const [availableSkills, setAvailableSkills] = useState<import("../lib/api").Skill[]>([]);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [promptInjections, setPromptInjections] = useState<Array<{ id: string; label: string; content: string; enabled: boolean }>>(
    (agent.config?.promptInjections as Array<{ id: string; label: string; content: string; enabled: boolean }> ?? []),
  );
  const [skillTriggers, setSkillTriggers] = useState<Array<{ toolName: string; skillSlug: string; when: "before" | "after"; prompt: string }>>(
    (agent.config?.skillTriggers as Array<{ toolName: string; skillSlug: string; when: string; prompt?: string }> ?? []).map((t) => ({ ...t, when: t.when as "before" | "after", prompt: t.prompt ?? "" })),
  );
  const [aiIntent, setAiIntent] = useState("");
  const [generating, setGenerating] = useState(false);

  // Free-form scalar config (env-style key/value), excludes structured keys managed above.
  const STRUCTURED_KEYS = new Set(["tools", "subagentSkills", "skillTriggers", "promptInjections"]);
  const initialCustomConfig: Record<string, string> = {};
  for (const [k, v] of Object.entries(agent.config ?? {})) {
    if (STRUCTURED_KEYS.has(k)) continue;
    if (v == null) continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      initialCustomConfig[k] = String(v);
    }
  }
  const [customConfig, setCustomConfig] = useState<Record<string, string>>(initialCustomConfig);
  const [newConfigKey, setNewConfigKey] = useState("");
  const [newConfigValue, setNewConfigValue] = useState("");
  const addCustomConfig = () => {
    const k = newConfigKey.trim();
    if (!k) return;
    setCustomConfig((prev) => ({ ...prev, [k]: newConfigValue }));
    setNewConfigKey("");
    setNewConfigValue("");
  };

  const generatePrompt = async () => {
    if (!aiIntent.trim()) return;
    setGenerating(true);
    try {
      const res = await fetch("/claw/api/v1/agents/generate-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ intent: aiIntent, agentName: agent.name, existingPrompt: prompt }),
      });
      if (res.ok) {
        const data = (await res.json()) as { success: boolean; data?: { prompt: string } };
        if (data.success && data.data?.prompt) setPrompt(data.data.prompt);
      }
    } catch (err) {
      console.error("[agent-config] generate prompt error:", err);
    } finally {
      setGenerating(false);
    }
  };

  // Fetch available tools and skills on mount
  useEffect(() => {
    setToolsLoading(true);
    Promise.all([
      import("../lib/api").then(({ getAvailableTools }) => getAvailableTools()),
      import("../lib/api").then(({ listSkills }) => listSkills(userId)),
    ]).then(([tools, skills]) => {
      setAvailableTools(tools);
      setAvailableSkills(skills);
    }).catch((err) => console.error("[agent-config] load error:", err))
      .finally(() => setToolsLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const toolsConfig = (subagents.length || direct.length || custom.length)
        ? { subagents, direct, custom }
        : undefined;
      const existingConfig = { ...(agent.config ?? {}) };
      if (toolsConfig) {
        existingConfig.tools = toolsConfig;
      } else {
        delete existingConfig.tools;
      }
      const activeTriggers = skillTriggers.filter((t) => t.toolName && t.skillSlug);
      if (activeTriggers.length > 0) {
        existingConfig.skillTriggers = activeTriggers;
      } else {
        delete existingConfig.skillTriggers;
      }
      const activeInjections = promptInjections.filter((p) => p.content.trim().length > 0);
      if (activeInjections.length > 0) {
        existingConfig.promptInjections = activeInjections;
      } else {
        delete existingConfig.promptInjections;
      }
      // Save subagent-level skills (only non-empty entries)
      const activeSaSkills = Object.fromEntries(Object.entries(saSkills).filter(([, ids]) => ids.length > 0));
      if (Object.keys(activeSaSkills).length > 0) {
        existingConfig.subagentSkills = activeSaSkills;
      } else {
        delete existingConfig.subagentSkills;
      }
      // Sync free-form scalar config: drop scalars no longer present, then write current ones.
      for (const k of Object.keys(existingConfig)) {
        if (STRUCTURED_KEYS.has(k)) continue;
        const v = existingConfig[k];
        if (v != null && (typeof v === "string" || typeof v === "number" || typeof v === "boolean")) {
          delete existingConfig[k];
        }
      }
      for (const [k, v] of Object.entries(customConfig)) {
        existingConfig[k] = v;
      }
      await updateAgent(agent.slug, { systemPrompt: prompt, skills: selectedSkillIds, config: existingConfig });
      setSaved(true);
      onSave();
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      console.error("[agent-config] save error:", err);
    } finally {
      setSaving(false);
    }
  };

  const toggleItem = (list: string[], setList: (v: string[]) => void, val: string) => {
    setList(list.includes(val) ? list.filter((x) => x !== val) : [...list, val]);
  };

  return (
    <div className="space-y-6">
      {/* System Prompt */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
        <h3 className="mb-3 text-sm font-semibold text-zinc-200">System Prompt</h3>

        {/* Generate with AI */}
        <div className="mb-4 rounded-lg border border-purple-800/50 bg-purple-950/20 p-4">
          <label className="mb-2 flex items-center gap-2 text-sm text-purple-300"><Sparkles size={16} /> Update with AI</label>
          <div className="flex gap-2">
            <input
              value={aiIntent}
              onChange={(e) => setAiIntent(e.target.value)}
              placeholder="Describe what to change in the prompt..."
              className="flex-1 rounded-lg border border-purple-800 bg-purple-950/30 px-3 py-2 text-sm text-purple-200 placeholder-purple-600 focus:border-purple-500 focus:outline-none"
              onKeyDown={(e) => { if (e.key === "Enter") generatePrompt(); }}
            />
            <button
              onClick={generatePrompt}
              disabled={generating || !aiIntent.trim()}
              className="flex items-center gap-1.5 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-purple-500 disabled:opacity-50"
            >
              {generating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Update
            </button>
          </div>
        </div>

        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={12}
          placeholder="You are a..."
          className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-sm text-zinc-200 placeholder-zinc-600 focus:border-purple-500 focus:outline-none"
        />
        <p className="mt-1 text-xs text-zinc-600">{prompt.length} characters</p>
      </div>

      {/* Tools */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
        <h3 className="mb-3 text-sm font-semibold text-zinc-200">Tools</h3>

        {toolsLoading ? (
          <p className="text-xs text-zinc-500">Loading...</p>
        ) : availableTools ? (
          <div className="space-y-5">
            {availableTools.subagents.length > 0 && (
              <div>
                <h4 className="mb-2 text-xs font-medium text-zinc-400">Subagents</h4>
                <div className="flex flex-wrap gap-2">
                  {availableTools.subagents.map((sa) => (
                    <div key={sa.name} className={subagents.includes(sa.name) ? "w-full" : ""}>
                      <button onClick={() => toggleItem(subagents, setSubagents, sa.name)}
                        className={`rounded-lg border px-3 py-1.5 text-sm transition ${subagents.includes(sa.name) ? "border-purple-500 bg-purple-950/30 text-purple-300" : "border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-600"}`}>
                        {sa.name}
                      </button>
                      {/* Per-subagent skill picker — all parent skills inherited by default */}
                      {subagents.includes(sa.name) && availableSkills.length > 0 && (() => {
                        // If no override exists for this subagent, show all skills (inherited)
                        const isOverridden = sa.name in saSkills;
                        const activeSkills = isOverridden ? saSkills[sa.name]! : availableSkills.map((s) => s.name);
                        return (
                          <div className="ml-4 mt-1.5">
                            {!isOverridden && <p className="mb-1 text-xs text-zinc-600">All skills inherited. Remove any to customize.</p>}
                            <div className="flex flex-wrap items-center gap-1.5">
                              {activeSkills.map((skillName) => (
                                <span key={skillName} className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs ${isOverridden ? "bg-purple-950 text-purple-300" : "bg-zinc-800 text-zinc-400"}`}>
                                  {skillName}
                                  <button onClick={() => {
                                    if (!isOverridden) {
                                      // First removal — create override with all skills minus this one
                                      setSaSkills((prev) => ({ ...prev, [sa.name]: availableSkills.map((s) => s.name).filter((n) => n !== skillName) }));
                                    } else {
                                      setSaSkills((prev) => ({ ...prev, [sa.name]: prev[sa.name]!.filter((n) => n !== skillName) }));
                                    }
                                  }} className="text-zinc-500 hover:text-zinc-200"><X size={10} /></button>
                                </span>
                              ))}
                              {isOverridden && (
                                <select
                                  onChange={(e) => {
                                    if (!e.target.value) return;
                                    setSaSkills((prev) => ({ ...prev, [sa.name]: [...new Set([...(prev[sa.name] ?? []), e.target.value])] }));
                                    e.target.value = "";
                                  }}
                                  defaultValue=""
                                  className="rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400 focus:border-purple-500 focus:outline-none"
                                >
                                  <option value="">+ Skill</option>
                                  {availableSkills.filter((s) => !activeSkills.includes(s.name)).map((s) => (
                                    <option key={s.id} value={s.name}>{s.name}</option>
                                  ))}
                                </select>
                              )}
                              {isOverridden && (
                                <button onClick={() => setSaSkills((prev) => { const next = { ...prev }; delete next[sa.name]; return next; })}
                                  className="text-xs text-zinc-500 hover:text-zinc-300">Reset to all</button>
                              )}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {availableTools.writeTools.length > 0 && (
              <div>
                <h4 className="mb-2 text-xs font-medium text-zinc-400">Direct Tools</h4>
                <div className="flex flex-wrap gap-2">
                  {availableTools.writeTools.map((t) => (
                    <button key={`${t.source}-${t.name}`} onClick={() => toggleItem(direct, setDirect, t.name)}
                      className={`rounded-lg border px-3 py-1.5 text-sm transition ${direct.includes(t.name) ? "border-green-500 bg-green-950/30 text-green-300" : "border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-600"}`}>
                      {t.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {availableTools.customGroups.length > 0 && (
              <div>
                <h4 className="mb-2 text-xs font-medium text-zinc-400">Custom Tools</h4>
                {availableTools.customGroups.map((g) => (
                  <div key={g.source} className="mb-3">
                    <p className="mb-1 text-xs text-zinc-500">{g.source.replace("custom:", "")}</p>
                    <div className="flex flex-wrap gap-2">
                      {g.tools.map((t) => (
                        <button key={t.slug} onClick={() => toggleItem(custom, setCustom, t.slug)}
                          className={`rounded-lg border px-3 py-1.5 text-sm transition ${custom.includes(t.slug) ? "border-blue-500 bg-blue-950/30 text-blue-300" : "border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-600"}`}>
                          {t.name}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-zinc-500">Failed to load available tools.</p>
        )}
      </div>

      {/* Skills */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
        <h3 className="mb-3 text-sm font-semibold text-zinc-200">Skills</h3>
        <p className="mb-3 text-xs text-zinc-500">Select skills to attach to this agent. Skills inject knowledge or instructions into the agent's context.</p>

        {availableSkills.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {availableSkills.map((skill) => (
              <button key={skill.id} onClick={() => toggleItem(selectedSkillIds, setSelectedSkillIds, skill.id)}
                className={`rounded-lg border px-3 py-1.5 text-sm transition ${selectedSkillIds.includes(skill.id) ? "border-amber-500 bg-amber-950/30 text-amber-300" : "border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-600"}`}
                title={skill.description || skill.slug}>
                {skill.label || skill.name}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-zinc-500">{toolsLoading ? "Loading skills..." : "No skills available."}</p>
        )}

        {selectedSkillIds.length > 0 && (
          <p className="mt-2 text-xs text-zinc-500">{selectedSkillIds.length} skill(s) selected</p>
        )}
      </div>

      {/* Skill Triggers */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
        <h3 className="mb-3 text-sm font-semibold text-zinc-200">Skill Triggers</h3>
        <p className="mb-3 text-xs text-zinc-500">Automatically inject a skill's content into the tool result when a specific tool is called.</p>

        {skillTriggers.map((trigger, idx) => {
          // Parse subagent:tool format
          const colonIdx = trigger.toolName.indexOf(":");
          const selectedSubagent = colonIdx > 0 ? trigger.toolName.slice(0, colonIdx) : trigger.toolName;
          const selectedInnerTool = colonIdx > 0 ? trigger.toolName.slice(colonIdx + 1) : "";
          // Find the subagent's serverType to look up its tools
          const subagentDef = availableTools?.subagents.find((s) => s.name === selectedSubagent);
          const innerTools = subagentDef ? (availableTools?.serverTools[subagentDef.serverType] ?? []) : [];

          return (
            <div key={idx} className="mb-3 rounded-lg border border-zinc-700 bg-zinc-800 p-3">
              <div className="mb-2 flex items-center gap-2">
                {/* Subagent selector */}
                <select value={selectedSubagent} onChange={(e) => {
                  const sa = e.target.value;
                  setSkillTriggers((prev) => prev.map((t, i) => i === idx ? { ...t, toolName: sa } : t));
                }}
                  className="flex-1 rounded-md border border-zinc-600 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-200 focus:border-purple-500 focus:outline-none">
                  <option value="">Select subagent...</option>
                  {availableTools?.subagents.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
                </select>

                {/* Inner tool selector (only if subagent selected and has tools) */}
                {selectedSubagent && innerTools.length > 0 && (
                  <select value={selectedInnerTool} onChange={(e) => {
                    const inner = e.target.value;
                    setSkillTriggers((prev) => prev.map((t, i) => i === idx ? { ...t, toolName: inner ? `${selectedSubagent}:${inner}` : selectedSubagent } : t));
                  }}
                    className="flex-1 rounded-md border border-zinc-600 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-200 focus:border-purple-500 focus:outline-none">
                    <option value="">Any tool (whole subagent)</option>
                    {innerTools.map((t) => <option key={t.slug} value={t.name}>{t.name}</option>)}
                  </select>
                )}

                <select value={trigger.when} onChange={(e) => setSkillTriggers((prev) => prev.map((t, i) => i === idx ? { ...t, when: e.target.value as "before" | "after" } : t))}
                  className="w-20 rounded-md border border-zinc-600 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-200 focus:border-purple-500 focus:outline-none">
                  <option value="after">After</option>
                  <option value="before">Before</option>
                </select>
                <button onClick={() => setSkillTriggers((prev) => prev.filter((_, i) => i !== idx))}
                  className="rounded p-1 text-zinc-600 hover:bg-red-950 hover:text-red-400">
                  <X size={14} />
                </button>
              </div>
              <div className="mb-2 flex items-center gap-2">
                <select value={trigger.skillSlug} onChange={(e) => setSkillTriggers((prev) => prev.map((t, i) => i === idx ? { ...t, skillSlug: e.target.value } : t))}
                  className="flex-1 rounded-md border border-zinc-600 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-200 focus:border-purple-500 focus:outline-none">
                  <option value="">Select skill to inject...</option>
                  {availableSkills.map((s) => <option key={s.id} value={s.slug}>{s.label || s.name}</option>)}
                </select>
              </div>
              <input value={trigger.prompt} onChange={(e) => setSkillTriggers((prev) => prev.map((t, i) => i === idx ? { ...t, prompt: e.target.value } : t))}
                placeholder="Instruction for the agent (optional)"
                className="w-full rounded-md border border-zinc-600 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-300 placeholder-zinc-600 focus:border-purple-500 focus:outline-none" />
            </div>
          );
        })}

        <button onClick={() => setSkillTriggers((prev) => [...prev, { toolName: "", skillSlug: "", when: "after", prompt: "" }])}
          className="flex items-center gap-1.5 rounded-lg bg-zinc-700 px-3 py-2 text-sm text-zinc-200 transition hover:bg-zinc-600">
          <Plus size={14} /> Add Trigger
        </button>
      </div>

      {/* Prompt Injections */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
        <h3 className="mb-3 text-sm font-semibold text-zinc-200">Prompt Injections</h3>
        <p className="mb-3 text-xs text-zinc-500">Text injected as a <code className="rounded bg-zinc-800 px-1">[System Reminder]</code> user message before every assistant response. Use for persistent rules (tone, format, guardrails).</p>

        {promptInjections.map((inj, idx) => (
          <div key={inj.id} className="mb-3 rounded-lg border border-zinc-700 bg-zinc-800 p-3">
            <div className="mb-2 flex items-center gap-2">
              <input
                value={inj.label}
                onChange={(e) => setPromptInjections((prev) => prev.map((p, i) => i === idx ? { ...p, label: e.target.value } : p))}
                placeholder="Label (e.g. 'Markdown rule')"
                className="flex-1 rounded-md border border-zinc-600 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 focus:border-purple-500 focus:outline-none"
              />
              <label className="flex items-center gap-1.5 text-xs text-zinc-400">
                <input
                  type="checkbox"
                  checked={inj.enabled}
                  onChange={(e) => setPromptInjections((prev) => prev.map((p, i) => i === idx ? { ...p, enabled: e.target.checked } : p))}
                  className="h-4 w-4 rounded border-zinc-600 bg-zinc-900 accent-purple-500"
                />
                Enabled
              </label>
              <button onClick={() => setPromptInjections((prev) => prev.filter((_, i) => i !== idx))}
                className="rounded p-1 text-zinc-600 hover:bg-red-950 hover:text-red-400">
                <X size={14} />
              </button>
            </div>
            <textarea
              value={inj.content}
              onChange={(e) => setPromptInjections((prev) => prev.map((p, i) => i === idx ? { ...p, content: e.target.value } : p))}
              placeholder="Instruction text injected on every turn..."
              rows={3}
              className="w-full rounded-md border border-zinc-600 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-300 placeholder-zinc-600 focus:border-purple-500 focus:outline-none"
            />
          </div>
        ))}

        <button onClick={() => setPromptInjections((prev) => [...prev, { id: crypto.randomUUID(), label: "", content: "", enabled: true }])}
          className="flex items-center gap-1.5 rounded-lg bg-zinc-700 px-3 py-2 text-sm text-zinc-200 transition hover:bg-zinc-600">
          <Plus size={14} /> Add Injection
        </button>
      </div>

      {/* Save */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 transition hover:bg-white disabled:opacity-50"
        >
          <Save size={16} />
          {saving ? "Saving..." : "Save Configuration"}
        </button>
        {saved && <span className="text-sm text-green-400">Saved</span>}
      </div>
    </div>
  );
}
