import { useState, useEffect, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Trash2, ChevronDown, ChevronRight, Link2, Save, X, Plus, Settings, Sparkles, Loader2, Share2, UserPlus, Brain, Plug, Cpu } from "lucide-react";
import { listAgents, getAgentDetail, updateAgent, listScheduledJobs, deleteScheduledJob, updateScheduledJob, listScheduledJobRuns, getUserChainConfig, setUserChainConfig, listAgentShares, addAgentShare, removeAgentShare, listSandboxRepos, type SandboxRepoOption } from "../lib/api";
import { PromptVersionHistory } from "./PromptVersionHistory";
import { ChainWorkflowEditor } from "./ChainWorkflowEditor";
import { CollapsibleSection } from "./CollapsibleSection";
import { MemoryTab } from "../v2/components/MemoryTab";
import { AgentMcpTab } from "./AgentMcpTab";
import { KnowledgeBasePicker } from "../v3/components/KnowledgeBasePicker";
import type { Agent, AgentLight, AgentSkill, ScheduledJob, ScheduledJobRun } from "../lib/types";

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
  const [activeTab, setActiveTab] = useState<"configure" | "jobs" | "runs" | "chain" | "share" | "memory" | "mcp" | "provider">("configure");
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [allAgents, setAllAgents] = useState<AgentLight[]>([]);
  const [myShare, setMyShare] = useState<{ role: string } | null>(null);

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
      // Fetch my share record if I'm not the owner
      if (agentDetail && agentDetail.ownerUserId !== userId) {
        try {
          const shares = await listAgentShares(slug, userId);
          const mine = shares.find((s) => s.userId === userId);
          setMyShare(mine ? { role: mine.role } : null);
        } catch {
          setMyShare(null);
        }
      } else {
        setMyShare(null);
      }
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

  // Returns a structured result instead of throwing. Existing callers
  // (replyMode dropdown, channel picker) keep their existing behavior —
  // failures surface via the page-level error banner. The cron-edit flow
  // inspects the result so the editor can stay open with an inline error
  // on validation failures (typos, min-interval breaches).
  const handleUpdateJob = useCallback(
    async (
      jobId: string,
      patch: { replyMode?: "thread" | "channel"; targetChannelId?: string | null; cronExpression?: string; nextRunAt?: string },
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      try {
        const updated = await updateScheduledJob(jobId, patch);
        setJobs((prev) => prev.map((j) => (j.id === jobId ? updated : j)));
        return { ok: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to update job";
        // Skip the page-level banner when this is a cron-edit failure —
        // the JobCard owns inline error rendering for that flow and we
        // don't want the message duplicated. Other flows (replyMode,
        // targetChannelId) have no local UI, so we still surface to
        // the page banner there.
        // Cron and once-time reschedule both render error inline next to
        // their input in the card. Skip the page banner for those.
        const isInlineHandledPatch =
          (patch.cronExpression !== undefined || patch.nextRunAt !== undefined) &&
          patch.replyMode === undefined &&
          patch.targetChannelId === undefined;
        if (!isInlineHandledPatch) setError(msg);
        return { ok: false, error: msg };
      }
    },
    [],
  );

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
  const isContributor = myShare?.role === "CONTRIBUTOR" || myShare?.role === "EDITOR";
  const canEdit = isOwner || (!!isAdmin) || isContributor;
  const canShare = isOwner || (!!isAdmin);
  // Anyone can VIEW the configure tab of a global agent in read-only mode —
  // prompt + tool selection are public so callers can understand what the
  // agent does before invoking it. Personal agents stay invisible to
  // non-owners.
  const canViewConfigure = canEdit || agent.scope === "global";
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
        {canViewConfigure && (
          <button
            onClick={() => setActiveTab("configure")}
            className={`px-4 py-2 text-sm font-medium transition ${
              activeTab === "configure"
                ? "border-b-2 border-zinc-100 text-zinc-100"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <span className="flex items-center gap-1.5"><Settings size={14} /> {canEdit ? "Configure" : "View Config"}</span>
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
        {canShare && (
          <button
            onClick={() => setActiveTab("share")}
            className={`px-4 py-2 text-sm font-medium transition ${
              activeTab === "share"
                ? "border-b-2 border-zinc-100 text-zinc-100"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <span className="flex items-center gap-1.5"><Share2 size={14} /> Contributors</span>
          </button>
        )}
        {canEdit && (
          <button
            onClick={() => setActiveTab("memory")}
            className={`px-4 py-2 text-sm font-medium transition ${
              activeTab === "memory"
                ? "border-b-2 border-zinc-100 text-zinc-100"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <span className="flex items-center gap-1.5"><Brain size={14} /> Memory</span>
          </button>
        )}
        {canEdit && (
          <button
            onClick={() => setActiveTab("mcp")}
            className={`px-4 py-2 text-sm font-medium transition ${
              activeTab === "mcp"
                ? "border-b-2 border-zinc-100 text-zinc-100"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <span className="flex items-center gap-1.5"><Plug size={14} /> MCPs</span>
          </button>
        )}
        {(isOwner || !!isAdmin) && (
          <button
            onClick={() => setActiveTab("provider")}
            className={`px-4 py-2 text-sm font-medium transition ${
              activeTab === "provider"
                ? "border-b-2 border-zinc-100 text-zinc-100"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <span className="flex items-center gap-1.5"><Cpu size={14} /> Provider</span>
          </button>
        )}
      </div>

      {/* Configure tab — full edit for owner/admin/contributor; read-only
          view for everyone else if the agent is global. */}
      {activeTab === "configure" && canViewConfigure && agent && (
        <AgentConfigEditor agent={agent} userId={userId} onSave={loadData} readOnly={!canEdit} />
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
                    <JobCard key={job.id} job={job} deleting={deleting === job.id} onDelete={handleDelete} onUpdate={handleUpdateJob} />
                  ))}
                </div>
              )}
              {inactiveJobs.length > 0 && (
                <div className="mt-4 space-y-2">
                  <h3 className="text-sm font-medium text-zinc-500">Completed / Cancelled</h3>
                  {inactiveJobs.map((job) => (
                    <JobCard key={job.id} job={job} deleting={deleting === job.id} onDelete={handleDelete} onUpdate={handleUpdateJob} />
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
        <div className="space-y-8">
          <ChainWorkflowEditor
            agent={agent}
            allAgents={allAgents.filter((a) => a.slug !== agent.slug)}
          />

          <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
            <h3 className="mb-2 text-sm font-semibold text-zinc-300">Legacy per-user chain config</h3>
            <p className="mb-4 text-xs text-zinc-500">Kept temporarily for compatibility; channel-level workflow above is the new path.</p>
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
          </div>
        </div>
      )}

      {/* Contributors tab */}
      {activeTab === "share" && canShare && agent && (
        <ContributorsPanel
          agent={agent}
          userId={userId}
          onUpdate={loadData}
        />
      )}

      {/* Memory tab — gated on canEdit, same as Configure. */}
      {activeTab === "memory" && canEdit && agent && (
        <MemoryTab agentSlug={agent.slug} canDelete={canEdit} />
      )}

      {/* MCPs tab — pin per-agent MCP credentials. Gated on canEdit. */}
      {activeTab === "mcp" && canEdit && agent && (
        <AgentMcpTab agentSlug={agent.slug} userId={userId} canEdit={canEdit} />
      )}

      {/* Provider tab — agent-level default LLM + shared API credentials.
          Gated on owner/admin: contributors and viewers don't see the tab
          button at all (defense in depth: backend also enforces). */}
      {activeTab === "provider" && (isOwner || !!isAdmin) && agent && (
        <ProviderTab agent={agent} onSave={loadData} />
      )}

    </div>
  );
}

/**
 * Provider tab — owner/admin-only surface to configure the agent-level
 * default LLM provider and the shared API credentials behind it.
 *
 * Resolution precedence at session dispatch (in claw-auth/webhook.ts):
 *   1. user's personal provider (Settings → Providers)
 *   2. agent.config.provider + this tab's credentials  ← here
 *   3. "spaces" / LiteLLM platform default
 *
 * Permission model: tab button only renders for owner/admin, but backend
 * enforces the same gate independently — a contributor manipulating the
 * frontend would still get 403 from the POST/DELETE endpoints.
 *
 * Decrypted key is never echoed back by any read endpoint. The "Save
 * credential" flow writes encrypted-at-rest; subsequent loads show only
 * { provider, model, baseUrl, authType, configured: true } metadata.
 */
function ProviderTab({ agent, onSave }: { agent: Agent; onSave: () => void }) {
  // Provider preference order is now the single source of truth — first entry
  // serves as the parent (formerly "default provider"), subsequent entries
  // form the quota-fallback chain. Backwards compat: if no list is set we
  // seed from the legacy `config.provider` field so existing agents look
  // sensible without a manual re-save.
  const seedOrder: string[] = (() => {
    if (Array.isArray(agent.config?.providerOrder)) {
      return (agent.config?.providerOrder as unknown[]).filter((p): p is string => typeof p === "string");
    }
    const legacy = agent.config?.provider as string | undefined;
    return legacy ? [legacy] : [];
  })();
  const [providerOrder, setProviderOrder] = useState<string[]>(seedOrder);
  const [orderSaving, setOrderSaving] = useState(false);
  const [orderSaved, setOrderSaved] = useState(false);

  const [creds, setCreds] = useState<import("../lib/api").AgentProviderCredentialStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    provider: "codex" as "copilot" | "claude" | "codex" | "openrouter",
    apiKey: "",
    model: "",
    baseUrl: "",
    authType: "api_key" as "api_key" | "oauth_token",
    reasoningEffort: "medium" as "low" | "medium" | "high",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);


  // Codex model list — fetched after a codex credential exists on the agent.
  // API-key-only now (ChatGPT OAuth removed): standard /v1/models.
  const [codexModels, setCodexModels] = useState<Array<{ id: string; name: string }> | null>(null);
  const [codexModelsErr, setCodexModelsErr] = useState<string | null>(null);
  const hasCodexCred = creds.some((c) => c.provider === "codex" && c.configured);
  useEffect(() => {
    if (!hasCodexCred) {
      setCodexModels(null);
      setCodexModelsErr(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const { listAgentCodexModels } = await import("../lib/api");
        const rows = await listAgentCodexModels(agent.slug);
        if (!cancelled) {
          setCodexModels(rows);
          setCodexModelsErr(null);
        }
      } catch (err) {
        if (!cancelled) {
          setCodexModels(null);
          setCodexModelsErr(err instanceof Error ? err.message : "Failed to load Codex models");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [agent.slug, hasCodexCred]);

  const reload = async () => {
    setLoading(true);
    try {
      const { listAgentProviderCredentials } = await import("../lib/api");
      const rows = await listAgentProviderCredentials(agent.slug);
      setCreds(rows);
    } catch (err) {
      console.warn("[provider-tab] failed to load credentials", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.slug]);

  const saveOrder = async () => {
    setOrderSaving(true);
    setOrderSaved(false);
    try {
      const cfg = { ...(agent.config ?? {}) };
      if (providerOrder.length > 0) cfg.providerOrder = providerOrder;
      else delete cfg.providerOrder;
      // Retire the legacy single-pick field — preference order is now
      // canonical. Avoids drift where the two disagree.
      delete cfg.provider;
      await updateAgent(agent.slug, { config: cfg });
      setOrderSaved(true);
      onSave();
      setTimeout(() => setOrderSaved(false), 3000);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setOrderSaving(false);
    }
  };

  const moveOrderItem = (idx: number, dir: -1 | 1) => {
    setProviderOrder((curr) => {
      const target = idx + dir;
      if (target < 0 || target >= curr.length) return curr;
      const next = [...curr];
      const tmp = next[idx]!;
      next[idx] = next[target]!;
      next[target] = tmp;
      return next;
    });
  };
  const removeOrderItem = (idx: number) =>
    setProviderOrder((curr) => curr.filter((_, i) => i !== idx));
  const addOrderItem = (p: string) =>
    setProviderOrder((curr) => (curr.includes(p) ? curr : [...curr, p]));

  const submitForm = async () => {
    // apiKey is only required the FIRST time. If a credential already exists
    // for the chosen provider (e.g. just-completed Codex OAuth), this same
    // Save updates only model/baseUrl/authType without re-encrypting.
    const existingForProvider = creds.find((c) => c.provider === form.provider && c.configured);
    if (!form.apiKey.trim() && !existingForProvider) {
      setError("apiKey is required");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const { setAgentProviderCredential } = await import("../lib/api");
      await setAgentProviderCredential(agent.slug, {
        provider: form.provider,
        ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
        ...(form.model.trim() ? { model: form.model.trim() } : {}),
        ...(form.baseUrl.trim() ? { baseUrl: form.baseUrl.trim() } : {}),
        ...(form.authType ? { authType: form.authType } : {}),
        reasoningEffort: form.reasoningEffort,
      });
      setAdding(false);
      setForm({ provider: "codex", apiKey: "", model: "", baseUrl: "", authType: "api_key", reasoningEffort: "medium" });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (provider: string) => {
    if (!confirm(`Remove ${provider} credentials from this agent? Users who run the agent without their own ${provider} key will fall back to the platform default.`)) return;
    try {
      const { deleteAgentProviderCredential } = await import("../lib/api");
      await deleteAgentProviderCredential(agent.slug, provider);
      await reload();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="space-y-4">
      {/* Provider preference order — single source of truth */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
        <h3 className="mb-1 text-sm font-semibold text-zinc-200">Provider preference order</h3>
        <p className="mb-3 text-xs text-zinc-500">
          The first provider in this list runs the agent. If it hits a rate limit or quota error, the next provider takes over, and so on — ending at the platform default (Kimi). Personal user keys still win — this order only applies to users who haven't configured a personal provider in Settings → Providers. Leave empty to fall straight through to Kimi.
        </p>
        {providerOrder.length === 0 ? (
          <p className="mb-2 rounded border border-dashed border-zinc-700 px-3 py-2 text-xs text-zinc-500">No order configured. Add a provider below to start.</p>
        ) : (
          <ol className="mb-2 space-y-1.5">
            {providerOrder.map((p, idx) => (
              <li key={p} className="flex items-center gap-2 rounded border border-zinc-700 bg-zinc-800 px-2.5 py-1.5">
                <span className="w-5 text-center text-xs font-mono text-zinc-500">{idx + 1}.</span>
                <span className="flex-1 text-sm text-zinc-200">{p}</span>
                <button
                  type="button"
                  disabled={idx === 0}
                  onClick={() => moveOrderItem(idx, -1)}
                  className="rounded px-1.5 py-0.5 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200 disabled:opacity-30"
                  title="Move up"
                >↑</button>
                <button
                  type="button"
                  disabled={idx === providerOrder.length - 1}
                  onClick={() => moveOrderItem(idx, 1)}
                  className="rounded px-1.5 py-0.5 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200 disabled:opacity-30"
                  title="Move down"
                >↓</button>
                <button
                  type="button"
                  onClick={() => removeOrderItem(idx)}
                  className="rounded px-1.5 py-0.5 text-xs text-zinc-400 hover:bg-red-950/40 hover:text-red-400"
                  title="Remove"
                >×</button>
              </li>
            ))}
          </ol>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {(["codex", "claude", "copilot", "openrouter", "spaces"] as const)
            .filter((p) => !providerOrder.includes(p))
            .map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => addOrderItem(p)}
                className="rounded-full border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-xs text-zinc-300 hover:border-zinc-600 hover:bg-zinc-700"
              >
                + {p}
              </button>
            ))}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={() => void saveOrder()}
            disabled={orderSaving}
            className="rounded-lg bg-purple-600 px-3 py-2 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-50"
          >
            {orderSaving ? "Saving…" : "Save order"}
          </button>
          {orderSaved && <span className="text-xs text-emerald-400">Saved ✓</span>}
        </div>
      </div>

      {/* Configured credentials */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-zinc-200">Configured credentials</h3>
            <p className="mt-0.5 text-xs text-zinc-500">Encrypted at rest. Decrypted keys are never returned by any API after upload.</p>
          </div>
          {!adding && (
            <button
              onClick={() => { setError(null); setAdding(true); }}
              className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-sm font-medium text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800"
            >
              <Plus size={14} /> Add credential
            </button>
          )}
        </div>

        {loading ? (
          <p className="text-xs text-zinc-500">Loading…</p>
        ) : creds.length === 0 && !adding ? (
          <p className="text-xs text-zinc-500">No agent-level credentials configured. Users running this agent will fall through to their personal provider or the platform default.</p>
        ) : (
          <ul className="space-y-2">
            {creds.map((c) => (
              <li key={c.provider} className="flex items-start justify-between gap-3 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-zinc-200">{c.provider}</span>
                    {c.authType && <span className="rounded bg-zinc-700 px-1.5 py-0.5 text-[10px] uppercase text-zinc-300">{c.authType}</span>}
                    {!c.configured && <span className="rounded bg-amber-950/40 px-1.5 py-0.5 text-[10px] uppercase text-amber-400">no key</span>}
                  </div>
                  <div className="mt-0.5 text-xs text-zinc-400">
                    model: <code className="font-mono">{c.model ?? "default"}</code>
                    {c.baseUrl && <> · baseUrl: <code className="font-mono text-[11px]">{c.baseUrl}</code></>}
                  </div>
                  <div className="mt-0.5 text-[11px] text-zinc-500">
                    Updated {new Date(c.updatedAt).toLocaleString()}{c.createdByUserId ? ` · by ${c.createdByUserId}` : ""}
                  </div>
                </div>
                <button
                  onClick={() => void remove(c.provider)}
                  title={`Remove ${c.provider} credentials`}
                  className="shrink-0 rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:border-red-700 hover:bg-red-950/30 hover:text-red-400"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        {adding && (
          <div className="mt-4 rounded-lg border border-zinc-700 bg-zinc-800 p-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-400">Provider</label>
                <select
                  value={form.provider}
                  onChange={(e) => setForm((p) => ({ ...p, provider: e.target.value as typeof p.provider }))}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-purple-500 focus:outline-none"
                >
                  <option value="codex">Codex</option>
                  <option value="claude">Claude (Anthropic)</option>
                  <option value="copilot">Copilot</option>
                  <option value="openrouter">OpenRouter</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-400">Auth type</label>
                <select
                  value={form.authType}
                  onChange={(e) => setForm((p) => ({ ...p, authType: e.target.value as typeof p.authType }))}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-purple-500 focus:outline-none"
                >
                  <option value="api_key">api_key</option>
                  {form.provider === "copilot" && <option value="oauth_token">oauth_token</option>}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium text-zinc-400">
                  Reasoning effort
                </label>
                <select
                  value={form.reasoningEffort}
                  onChange={(e) => setForm((p) => ({ ...p, reasoningEffort: e.target.value as typeof p.reasoningEffort }))}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-purple-500 focus:outline-none"
                >
                  <option value="low">Low — fastest, minimal think time</option>
                  <option value="medium">Medium — balanced (default)</option>
                  <option value="high">High — deepest reasoning, slowest</option>
                </select>
                <p className="mt-1 text-[11px] text-zinc-500">
                  Only applies to reasoning-capable models (e.g. gpt-5.x, codex). Lower = faster per-turn responses.
                </p>
              </div>

                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs font-medium text-zinc-400">API key (encrypted on save — never shown again)</label>
                  <input
                    type="password"
                    value={form.apiKey}
                    onChange={(e) => setForm((p) => ({ ...p, apiKey: e.target.value }))}
                    placeholder="sk-…  or  {access_token: ...}"
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm text-zinc-200 placeholder-zinc-600 focus:border-purple-500 focus:outline-none"
                  />
                </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-400">Model{form.provider === "codex" && codexModels && codexModels.length > 0 ? "" : " (optional)"}</label>
                {form.provider === "codex" && codexModels && codexModels.length > 0 ? (
                  <select
                    value={form.model}
                    onChange={(e) => setForm((p) => ({ ...p, model: e.target.value }))}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-purple-500 focus:outline-none"
                  >
                    <option value="">Use default</option>
                    {codexModels.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={form.model}
                    onChange={(e) => setForm((p) => ({ ...p, model: e.target.value }))}
                    placeholder="gpt-5.5 / claude-sonnet-4-5 / …"
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-purple-500 focus:outline-none"
                  />
                )}
                {form.provider === "codex" && codexModelsErr && (
                  <p className="mt-1 text-[11px] text-amber-400">Couldn't load Codex models ({codexModelsErr}). Free-text is fine.</p>
                )}
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-400">Base URL (optional)</label>
                <input
                  value={form.baseUrl}
                  onChange={(e) => setForm((p) => ({ ...p, baseUrl: e.target.value }))}
                  placeholder="https://openrouter.ai/api/v1"
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-purple-500 focus:outline-none"
                />
              </div>
            </div>
            {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={() => void submitForm()}
                disabled={busy}
                className="rounded-lg bg-purple-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-50"
              >
                {busy ? "Saving…" : "Save credential"}
              </button>
              <button
                onClick={() => { setAdding(false); setError(null); }}
                className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-400 hover:border-zinc-600 hover:bg-zinc-900"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface UserOption { id: string; name: string; email: string }

function ContributorsPanel({ agent, userId, onUpdate }: { agent: Agent; userId: string; onUpdate: () => void }) {
  const [shares, setShares] = useState<Array<{ id: string; userId: string; role: string; user: { id: string; name: string; email: string } }>>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserOption[]>([]);
  const [selected, setSelected] = useState<UserOption | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [newRole, setNewRole] = useState<"CONTRIBUTOR" | "EDITOR" | "VIEWER">("CONTRIBUTOR");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listAgentShares(agent.slug, userId);
      setShares(data);
    } catch {
      setError("Failed to load shares");
    } finally {
      setLoading(false);
    }
  }, [agent.slug, userId]);

  useEffect(() => { load(); }, [load]);

  // Live search against the local users table. Debounced via a small delay so
  // typing doesn't fire a request per keystroke. Hits `GET /users?q=`.
  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        const url = `/claw/api/v1/users${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ""}`;
        const res = await fetch(url, {
          headers: { "x-user-id": userId },
          credentials: "include",
        });
        if (!res.ok) return;
        const data = await res.json() as { success: boolean; data?: UserOption[] };
        if (!cancelled) setResults(data.data ?? []);
      } catch {
        if (!cancelled) setResults([]);
      }
    }, 150);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [query, userId]);

  // Hide the selected user from the dropdown list and anyone who's already a contributor.
  const existingShareIds = new Set(shares.map((s) => s.userId));
  const visibleResults = results.filter((u) => !existingShareIds.has(u.id));

  const handleAdd = async () => {
    if (!selected) return;
    setAdding(true);
    setError(null);
    try {
      await addAgentShare(agent.slug, userId, selected.id, newRole);
      setQuery("");
      setSelected(null);
      setResults([]);
      await load();
      onUpdate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add contributor");
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (targetUserId: string) => {
    setRemoving(targetUserId);
    setError(null);
    try {
      await removeAgentShare(agent.slug, userId, targetUserId);
      await load();
      onUpdate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove contributor");
    } finally {
      setRemoving(null);
    }
  };

  const roleBadge = (role: string) => {
    const styles: Record<string, string> = {
      CONTRIBUTOR: "bg-blue-950 text-blue-400",
      EDITOR: "bg-purple-950 text-purple-400",
      VIEWER: "bg-zinc-800 text-zinc-400",
    };
    return (
      <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${styles[role] ?? "bg-zinc-800 text-zinc-400"}`}>
        {role}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* Add contributor */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-200">
          <UserPlus size={14} /> Add Contributor
        </h3>
        <p className="mb-4 text-xs text-zinc-500">
          Contributors can edit this agent's configuration. Viewers can only see it in their list.
        </p>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={selected ? `${selected.name || selected.email} <${selected.email}>` : query}
              onChange={(e) => { setSelected(null); setQuery(e.target.value); setDropdownOpen(true); }}
              onFocus={() => setDropdownOpen(true)}
              onBlur={() => setTimeout(() => setDropdownOpen(false), 150)}
              placeholder="Search by name or email…"
              spellCheck={false}
              autoComplete="off"
              className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
            />
            {dropdownOpen && !selected && visibleResults.length > 0 && (
              <div className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border border-zinc-700 bg-zinc-900 shadow-lg">
                {visibleResults.map((u) => (
                  <button
                    key={u.id}
                    onMouseDown={(e) => { e.preventDefault(); setSelected(u); setDropdownOpen(false); }}
                    className="block w-full px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-800"
                  >
                    <div>{u.name || u.email}</div>
                    {u.name && <div className="text-xs text-zinc-500">{u.email}</div>}
                  </button>
                ))}
              </div>
            )}
            {dropdownOpen && !selected && visibleResults.length === 0 && query.trim().length > 0 && (
              <div className="absolute z-10 mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-500 shadow-lg">
                No matching claw users.
              </div>
            )}
          </div>
          <select
            value={newRole}
            onChange={(e) => setNewRole(e.target.value as "CONTRIBUTOR" | "EDITOR" | "VIEWER")}
            className="rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 focus:border-zinc-500 focus:outline-none"
          >
            <option value="CONTRIBUTOR">Contributor (can edit)</option>
            <option value="VIEWER">Viewer (read-only)</option>
          </select>
          <button
            onClick={handleAdd}
            disabled={adding || !selected}
            className="inline-flex items-center gap-1.5 rounded-md bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 transition hover:bg-white disabled:opacity-50"
          >
            {adding ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
            Add
          </button>
        </div>
        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      </div>

      {/* Existing shares */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
        <h3 className="mb-3 text-sm font-semibold text-zinc-200">Current Access</h3>
        {loading ? (
          <p className="text-sm text-zinc-500">Loading...</p>
        ) : shares.length === 0 ? (
          <p className="text-sm text-zinc-500">No one has been granted access yet.</p>
        ) : (
          <div className="space-y-2">
            {shares.map((share) => (
              <div key={share.id} className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3">
                <div className="flex items-center gap-3">
                  <div>
                    <p className="text-sm text-zinc-200">{share.user.name || share.user.email}</p>
                    {share.user.name && <p className="text-xs text-zinc-500">{share.user.email}</p>}
                  </div>
                  {roleBadge(share.role)}
                </div>
                <button
                  onClick={() => handleRemove(share.userId)}
                  disabled={removing === share.userId}
                  className="rounded p-1.5 text-zinc-600 transition hover:bg-red-950 hover:text-red-400 disabled:opacity-50"
                  title="Remove access"
                >
                  {removing === share.userId ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

type JobUpdateResult = { ok: true } | { ok: false; error: string };

/**
 * Convert an ISO timestamp to the "YYYY-MM-DDTHH:mm" format that
 * <input type="datetime-local"> renders/accepts. The format is implicitly
 * local-tz (no offset stored), which matches what the user is typing into
 * the picker.
 */
function isoToDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function JobCard({ job, deleting, onDelete, onUpdate }: { job: ScheduledJob; deleting: boolean; onDelete: (id: string) => void; onUpdate?: (id: string, patch: { replyMode?: "thread" | "channel"; targetChannelId?: string | null; cronExpression?: string; nextRunAt?: string }) => Promise<JobUpdateResult> }) {
  const [savingReplyMode, setSavingReplyMode] = useState(false);
  const [channelSearch, setChannelSearch] = useState("");
  const [channelResults, setChannelResults] = useState<import("../lib/api").SpacesChannel[]>([]);
  const [channelDropdownOpen, setChannelDropdownOpen] = useState(false);
  const [savingChannel, setSavingChannel] = useState(false);
  const [editingCron, setEditingCron] = useState(false);
  const [cronDraft, setCronDraft] = useState(job.cronExpression ?? "");
  const [savingCron, setSavingCron] = useState(false);
  const [cronErr, setCronErr] = useState<string | null>(null);
  const [editingRunAt, setEditingRunAt] = useState(false);
  // <input type="datetime-local"> uses the format "YYYY-MM-DDTHH:mm" in
  // the local timezone — we render the existing nextRunAt that way.
  const [runAtDraft, setRunAtDraft] = useState(() => isoToDatetimeLocal(job.nextRunAt));
  const [savingRunAt, setSavingRunAt] = useState(false);
  const [runAtErr, setRunAtErr] = useState<string | null>(null);
  const replyMode = job.replyMode ?? "thread";

  const handleReplyModeChange = async (next: "thread" | "channel") => {
    if (!onUpdate || next === replyMode) return;
    setSavingReplyMode(true);
    try {
      await onUpdate(job.id, { replyMode: next });
    } finally {
      setSavingReplyMode(false);
    }
  };

  // Live channel search — fires only when the user opens the picker for
  // "Post in channel" mode. Uses `/api/v1/spaces/channels` which scopes to
  // channels the requesting user can see (live-first via SPACES_DB_URL).
  useEffect(() => {
    if (!channelDropdownOpen) return;
    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        const { listSpacesChannels } = await import("../lib/api");
        const rows = await listSpacesChannels(channelSearch || undefined, 20, job.agentSlug);
        if (!cancelled) setChannelResults(rows);
      } catch {
        if (!cancelled) setChannelResults([]);
      }
    }, 200);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [channelDropdownOpen, channelSearch]);

  const handleChannelPick = async (channelId: string | null) => {
    if (!onUpdate) return;
    setSavingChannel(true);
    try {
      await onUpdate(job.id, { targetChannelId: channelId });
      setChannelDropdownOpen(false);
      setChannelSearch("");
    } finally {
      setSavingChannel(false);
    }
  };

  const targetChannelLabel = job.targetChannelId
    ? channelResults.find((c) => c.id === job.targetChannelId)?.name ?? job.targetChannelId.slice(0, 8)
    : "originating channel";

  const handleCronSave = async () => {
    if (!onUpdate) return;
    const next = cronDraft.trim();
    if (!next) {
      setCronErr("Cron expression is required");
      return;
    }
    if (next === job.cronExpression) {
      setEditingCron(false);
      setCronErr(null);
      return;
    }
    setSavingCron(true);
    setCronErr(null);
    try {
      const result = await onUpdate(job.id, { cronExpression: next });
      if (result.ok) {
        setEditingCron(false);
      } else {
        // Inline error — editor stays open so the user can correct their
        // input without losing what they typed.
        setCronErr(result.error);
      }
    } finally {
      setSavingCron(false);
    }
  };

  const canRescheduleCron = onUpdate && job.type === "cron" && job.status === "active";
  const canRescheduleOnce = onUpdate && job.type === "once" && job.status === "active";

  const handleRunAtSave = async () => {
    if (!onUpdate) return;
    const local = runAtDraft.trim();
    if (!local) {
      setRunAtErr("Pick a date and time");
      return;
    }
    // datetime-local produces a local-tz string with no offset (e.g.
    // "2026-05-26T19:30"). `new Date(localString)` parses it as local-tz,
    // and toISOString() converts to UTC for the wire format the backend
    // expects.
    const parsed = new Date(local);
    if (isNaN(parsed.getTime())) {
      setRunAtErr("Invalid date");
      return;
    }
    if (parsed.getTime() - Date.now() < 5_000) {
      setRunAtErr("Must be at least a few seconds in the future");
      return;
    }
    setSavingRunAt(true);
    setRunAtErr(null);
    try {
      const result = await onUpdate(job.id, { nextRunAt: parsed.toISOString() });
      if (result.ok) {
        setEditingRunAt(false);
      } else {
        setRunAtErr(result.error);
      }
    } finally {
      setSavingRunAt(false);
    }
  };

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">{job.label || job.task.slice(0, 60)}</span>
            <StatusBadge status={job.status} />
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
            {job.type === "cron" && job.cronExpression && !editingCron && (
              <span title="Cron expression" className="inline-flex items-center gap-1">
                cron: <span className="font-mono text-zinc-400">{job.cronExpression}</span>
                {canRescheduleCron && (
                  <button
                    onClick={() => {
                      setCronDraft(job.cronExpression ?? "");
                      setCronErr(null);
                      setEditingCron(true);
                    }}
                    className="ml-1 rounded px-1 py-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                    title="Reschedule — interpreted in Asia/Kolkata"
                  >
                    edit
                  </button>
                )}
              </span>
            )}
            {job.type === "cron" && editingCron && (
              <span className="flex w-full items-center gap-2">
                <span>cron:</span>
                <input
                  autoFocus
                  type="text"
                  value={cronDraft}
                  onChange={(e) => { setCronDraft(e.target.value); setCronErr(null); }}
                  disabled={savingCron}
                  placeholder="e.g. 0 9 * * 1-5"
                  className="w-44 rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 font-mono text-xs text-zinc-200 focus:border-zinc-500 focus:outline-none disabled:opacity-50"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); void handleCronSave(); }
                    if (e.key === "Escape") { setEditingCron(false); setCronErr(null); }
                  }}
                />
                <button
                  onClick={handleCronSave}
                  disabled={savingCron || !cronDraft.trim()}
                  className="rounded bg-emerald-700 px-2 py-0.5 text-xs text-white hover:bg-emerald-600 disabled:opacity-50"
                >
                  {savingCron ? "Saving…" : "Save"}
                </button>
                <button
                  onClick={() => { setEditingCron(false); setCronErr(null); }}
                  disabled={savingCron}
                  className="rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300 hover:bg-zinc-800"
                >
                  Cancel
                </button>
                <span className="text-[10px] text-zinc-500">IST</span>
                {cronErr && <span className="text-xs text-red-400">{cronErr}</span>}
              </span>
            )}
            {job.type === "once" && job.nextRunAt && !editingRunAt && (
              <span className="inline-flex items-center gap-1">
                runs at: {new Date(job.nextRunAt).toLocaleString()}
                {canRescheduleOnce && (
                  <button
                    onClick={() => {
                      setRunAtDraft(isoToDatetimeLocal(job.nextRunAt));
                      setRunAtErr(null);
                      setEditingRunAt(true);
                    }}
                    className="ml-1 rounded px-1 py-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                    title="Reschedule"
                  >
                    edit
                  </button>
                )}
              </span>
            )}
            {job.type === "once" && editingRunAt && (
              <span className="flex w-full items-center gap-2">
                <span>runs at:</span>
                <input
                  autoFocus
                  type="datetime-local"
                  value={runAtDraft}
                  onChange={(e) => { setRunAtDraft(e.target.value); setRunAtErr(null); }}
                  disabled={savingRunAt}
                  className="rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-xs text-zinc-200 focus:border-zinc-500 focus:outline-none disabled:opacity-50"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); void handleRunAtSave(); }
                    if (e.key === "Escape") { setEditingRunAt(false); setRunAtErr(null); }
                  }}
                />
                <button
                  onClick={handleRunAtSave}
                  disabled={savingRunAt || !runAtDraft.trim()}
                  className="rounded bg-emerald-700 px-2 py-0.5 text-xs text-white hover:bg-emerald-600 disabled:opacity-50"
                >
                  {savingRunAt ? "Saving…" : "Save"}
                </button>
                <button
                  onClick={() => { setEditingRunAt(false); setRunAtErr(null); }}
                  disabled={savingRunAt}
                  className="rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300 hover:bg-zinc-800"
                >
                  Cancel
                </button>
                {runAtErr && <span className="text-xs text-red-400">{runAtErr}</span>}
              </span>
            )}
            <span>runs: {job.runCount}{job.maxRuns ? `/${job.maxRuns}` : ""}</span>
            {job.lastRunAt && <span>last run: {timeAgo(job.lastRunAt)}</span>}
            <span>created: {timeAgo(job.createdAt)}</span>
          </div>
          {job.label && (
            <p className="mt-1 truncate text-xs text-zinc-600">{job.task}</p>
          )}
          {/* Output target — where the agent's result is posted when the job fires.
              "thread" = reply in the original conversation thread (default).
              "channel" = top-level post in the channel, no thread context. */}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-zinc-500">output:</span>
            {onUpdate ? (
              <select
                value={replyMode}
                onChange={(e) => handleReplyModeChange(e.target.value as "thread" | "channel")}
                disabled={savingReplyMode || job.status !== "active"}
                className="rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-xs text-zinc-200 focus:border-zinc-500 focus:outline-none disabled:opacity-50"
              >
                <option value="thread">Reply in thread</option>
                <option value="channel">Post in channel</option>
              </select>
            ) : (
              <span className="text-zinc-400">{replyMode === "channel" ? "Post in channel" : "Reply in thread"}</span>
            )}
            {savingReplyMode && <Loader2 size={12} className="animate-spin text-zinc-500" />}

            {/* Channel override picker — only visible when "Post in channel"
                is selected. Click the chip to open a typeahead. Clicking "use
                originating channel" clears the override. */}
            {replyMode === "channel" && onUpdate && job.status === "active" && (
              <div className="relative inline-block">
                <button
                  onClick={() => setChannelDropdownOpen((v) => !v)}
                  disabled={savingChannel}
                  className="rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-xs text-zinc-200 hover:border-zinc-500 disabled:opacity-50"
                  title="Pick a channel for this job's output"
                >
                  channel: <span className="font-mono text-zinc-300">{targetChannelLabel}</span>
                </button>
                {savingChannel && <Loader2 size={12} className="ml-1 inline animate-spin text-zinc-500" />}
                {channelDropdownOpen && (
                  <div className="absolute left-0 z-10 mt-1 w-72 rounded-md border border-zinc-700 bg-zinc-900 shadow-lg">
                    <div className="border-b border-zinc-800 p-2">
                      <input
                        autoFocus
                        type="text"
                        value={channelSearch}
                        onChange={(e) => setChannelSearch(e.target.value)}
                        placeholder="Search channels…"
                        className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 focus:border-zinc-500 focus:outline-none"
                      />
                    </div>
                    <div className="max-h-60 overflow-auto">
                      {/* Allow clearing override → revert to originating channel. */}
                      <button
                        onMouseDown={(e) => { e.preventDefault(); handleChannelPick(null); }}
                        className="block w-full px-3 py-2 text-left text-xs italic text-zinc-400 hover:bg-zinc-800"
                      >
                        Use originating channel (default)
                      </button>
                      {channelResults.length === 0 ? (
                        <p className="px-3 py-2 text-xs text-zinc-500">No matches.</p>
                      ) : (
                        channelResults.map((c) => (
                          <button
                            key={c.id}
                            onMouseDown={(e) => { e.preventDefault(); handleChannelPick(c.id); }}
                            className="block w-full px-3 py-2 text-left text-xs text-zinc-200 hover:bg-zinc-800"
                          >
                            <div className="font-medium">#{c.name}</div>
                            <div className="text-[10px] text-zinc-500">{c.scopeType}{c.projectName ? ` · ${c.projectName}` : ""}</div>
                          </button>
                        ))
                      )}
                    </div>
                    <div className="border-t border-zinc-800 p-1">
                      <button
                        onClick={() => setChannelDropdownOpen(false)}
                        className="block w-full rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-800"
                      >
                        Close
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
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
  allAgents: AgentLight[];
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

/**
 * Collapsible card used to chunk the agent edit form into sections that can
 * be folded away. The form has 6+ sections and rendering everything expanded
 * by default makes the page a mile long. Each section folds independently;
 * `defaultOpen` controls the initial state. Pass a `badge` (count, status,
 * etc.) to surface at-a-glance info in the collapsed header.
 *
 * `bordered={true}` (default) renders the card chrome (border + background).
 * Pass `false` for nested use inside another section (no double border).
 */
function AgentConfigEditor({ agent, userId, onSave, readOnly = false }: { agent: Agent; userId: string; onSave: () => void; readOnly?: boolean }) {
  const configTools = (agent.config?.tools as { subagents?: string[]; direct?: string[]; custom?: string[] } | undefined) ?? {};
  const configSubagentSkills = (agent.config?.subagentSkills as Record<string, string[]> | undefined) ?? {};
  const [prompt, setPrompt] = useState(agent.systemPrompt ?? "");
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>(
    agent.skills?.map((s) => s.skillId) ?? [],
  );
  // Knowledge Base grants — initialized from the agent's existing AgentCollection
  // rows. Storing fileId as null in the form mirrors the DB and the request
  // payload's `knowledgeBase` field.
  const [selectedKbResources, setSelectedKbResources] = useState<import("../v3/components/KnowledgeBasePicker").KbSelection[]>(
    agent.collections?.map((c) => ({ collectionId: c.collectionId, fileId: c.fileId })) ?? [],
  );
  // KB scoping mode — "COLLECTIONS" uses the picker selection above;
  // "USER" inherits the running user's spaces access and hides the picker.
  const [selectedKbScope, setSelectedKbScope] = useState<"COLLECTIONS" | "USER">(
    agent.kbScope === "USER" ? "USER" : "COLLECTIONS",
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
  // Which sandbox repo setup (REPO_CONFIGS key) this agent is pinned to. When
  // set, the runtime forces sandbox-repo-setup onto this repo so the LLM can't
  // pick the wrong one (xyne-spaces vs hyperswitch). "" = not pinned.
  const [sandboxRepo, setSandboxRepo] = useState<string>((agent.config?.sandboxRepo as string | undefined) ?? "");
  const [sandboxRepoOptions, setSandboxRepoOptions] = useState<SandboxRepoOption[]>([]);
  useEffect(() => { listSandboxRepos().then(setSandboxRepoOptions).catch(() => {}); }, []);
  // Citation reflection — opt-in post-response nudge (see xyne-claw agent.ts).
  // Stored as a real boolean in config.citationReflection (accepts legacy "true").
  const [citationReflection, setCitationReflection] = useState<boolean>(
    agent.config?.citationReflection === true || agent.config?.citationReflection === "true",
  );
  // Auto-citations — opt-in: chunk + inline-tokenize EVERY tool result so the
  // model can cite any tool's output (see xyne-claw auto-citations.ts). Stored
  // as a real boolean in config.autoToolCitations (accepts legacy "true").
  const [autoToolCitations, setAutoToolCitations] = useState<boolean>(
    agent.config?.autoToolCitations === true || agent.config?.autoToolCitations === "true",
  );
  const [aiIntent, setAiIntent] = useState("");
  const [generating, setGenerating] = useState(false);

  // Free-form scalar config (env-style key/value), excludes structured keys managed above.
  const STRUCTURED_KEYS = new Set(["tools", "subagentSkills", "skillTriggers", "promptInjections", "sandboxRepo", "citationReflection", "autoToolCitations"]);
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
      // Every failure path used to silently no-op so the button just spun
      // and stopped with no feedback. Now: any non-2xx or empty response
      // raises a visible alert with the actual reason. Three modes:
      //   1. HTTP non-OK → server error (LLM timeout, 5xx from claw-auth, etc.)
      //   2. data.success=false → backend returned a structured error
      //   3. data.data.prompt empty → LLM returned blank content
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Server returned ${res.status}: ${text.slice(0, 200) || "no body"}`);
      }
      const data = (await res.json()) as { success: boolean; error?: string; data?: { prompt: string } };
      if (!data.success) {
        throw new Error(data.error || "Server reported failure but gave no reason");
      }
      const newPrompt = data.data?.prompt?.trim();
      if (!newPrompt) {
        throw new Error("LLM returned an empty prompt — try a more specific instruction");
      }
      setPrompt(newPrompt);
    } catch (err) {
      console.error("[agent-config] generate prompt error:", err);
      alert(`Failed to ${prompt.trim() ? "update" : "generate"} prompt:\n\n${err instanceof Error ? err.message : String(err)}`);
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
      if (sandboxRepo) existingConfig.sandboxRepo = sandboxRepo;
      else delete existingConfig.sandboxRepo;
      if (citationReflection) existingConfig.citationReflection = true;
      else delete existingConfig.citationReflection;
      if (autoToolCitations) existingConfig.autoToolCitations = true;
      else delete existingConfig.autoToolCitations;
      await updateAgent(agent.slug, {
        systemPrompt: prompt,
        skills: selectedSkillIds,
        // In USER scope the server ignores knowledgeBase[] and clears any
        // stored grants; skip the field so the payload reflects intent.
        ...(selectedKbScope === "COLLECTIONS" ? { knowledgeBase: selectedKbResources } : {}),
        kbScope: selectedKbScope,
        config: existingConfig,
      });
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

  // Slug-aware toggle for MCP server tools. Two servers can expose a tool with
  // the same `name`, so we key selection on the unique `slug` (keying on `name`
  // made same-named pills toggle together). We also strip any legacy bare-name
  // entry so re-saving migrates the stored id name → slug.
  const toggleDirectSlug = (t: { slug: string; name: string }) => {
    const cleaned = direct.filter((d) => d !== t.name);
    setDirect(cleaned.includes(t.slug) ? cleaned.filter((d) => d !== t.slug) : [...cleaned, t.slug]);
  };
  const isDirectSel = (t: { slug: string; name: string }) => direct.includes(t.slug) || direct.includes(t.name);

  return (
    // When readOnly is true, the outer fieldset disables every <input>,
    // <textarea>, <button>, and <select> inside the form automatically.
    // We hide the Save section separately below.
    <fieldset disabled={readOnly} className="contents">
    <div className="space-y-6">
      {readOnly && (
        <div className="rounded-lg border border-amber-800/50 bg-amber-950/20 p-3 text-sm text-amber-200">
          Read-only view. You don't have edit access to this global agent — only the owner, contributors, or a CLAW admin can modify it.
        </div>
      )}
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
        <PromptVersionHistory
          agentSlug={agent.slug}
          activeVersion={agent.activePromptVersion}
          readOnly={readOnly}
          onActivated={(restored) => { setPrompt(restored); onSave(); }}
        />
      </div>

      {/* Tools */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
        <h3 className="mb-3 text-sm font-semibold text-zinc-200">Tools</h3>

        {toolsLoading ? (
          <p className="text-xs text-zinc-500">Loading...</p>
        ) : availableTools ? (
          (() => {
            // Pre-compute per-section selection counts for the accordion badges
            // and the server-tools grouping (used in two places: the count
            // badge and the render). Hoisting it out of inline IIFE so it's
            // available to BOTH the header (for `badge`) and the body.
            const writeToolNames = new Set(availableTools.writeTools.map((t) => t.name));
            // Group write tools by their owning MCP server (e.g. github,
            // bitbucket, asana). Same grouping shape as serverGroups below
            // so the UI is consistent across the two sections.
            const writeGroupsMap = new Map<string, Array<{ name: string }>>();
            for (const t of availableTools.writeTools) {
              const arr = writeGroupsMap.get(t.source) ?? [];
              if (!arr.some((x) => x.name === t.name)) arr.push({ name: t.name });
              writeGroupsMap.set(t.source, arr);
            }
            const writeGroups = Array.from(writeGroupsMap.entries())
              .map(([source, tools]) => ({ source, tools }))
              .sort((a, b) => a.source.localeCompare(b.source));
            const serverGroups = Object.entries(availableTools.serverTools ?? {})
              .filter(([source]) => !source.startsWith("custom:"))
              .map(([source, tools]) => ({
                source,
                tools: (tools as Array<{ slug: string; name: string }>)
                  .filter((t) => !writeToolNames.has(t.name)),
              }))
              .filter((g) => g.tools.length > 0);
            const serverToolNames = new Set(
              // slug + name so the badge count is correct whether a tool was
              // stored by its new unique slug or a legacy bare name.
              serverGroups.flatMap((g) => g.tools.flatMap((t) => [t.slug, t.name])),
            );
            const selectedWriteCount = direct.filter((n) => writeToolNames.has(n)).length;
            const selectedServerCount = direct.filter((n) => serverToolNames.has(n)).length;
            return (
          <div className="space-y-2">
            {availableTools.subagents.length > 0 && (
              <CollapsibleSection
                bordered={false}
                title="Subagents"
                badge={`${subagents.length} / ${availableTools.subagents.length} selected`}
              >
                <div className="flex flex-wrap gap-2">
                  {availableTools.subagents.map((sa) => (
                    <div key={sa.name} className={subagents.includes(sa.name) ? "w-full" : ""}>
                      <button onClick={() => toggleItem(subagents, setSubagents, sa.name)}
                        className={`rounded-lg border px-3 py-1.5 text-sm transition ${subagents.includes(sa.name) ? "border-purple-500 bg-purple-950/30 text-purple-300" : "border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-600"}`}>
                        {sa.name}
                      </button>
                      {/* Per-subagent skill picker. Default is NONE — user
                          adds the specific skills they want to propagate into
                          each subagent. */}
                      {subagents.includes(sa.name) && availableSkills.length > 0 && (() => {
                        const activeSkills = saSkills[sa.name] ?? [];
                        return (
                          <div className="ml-4 mt-1.5">
                            {activeSkills.length === 0 && (
                              <p className="mb-1 text-xs text-zinc-600">No skills. Add to propagate into this subagent.</p>
                            )}
                            <div className="flex flex-wrap items-center gap-1.5">
                              {activeSkills.map((skillName) => (
                                <span key={skillName} className="inline-flex items-center gap-1 rounded bg-purple-950 px-2 py-0.5 text-xs text-purple-300">
                                  {skillName}
                                  <button
                                    onClick={() => setSaSkills((prev) => ({ ...prev, [sa.name]: (prev[sa.name] ?? []).filter((n) => n !== skillName) }))}
                                    className="text-zinc-500 hover:text-zinc-200"
                                  ><X size={10} /></button>
                                </span>
                              ))}
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
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  ))}
                </div>
              </CollapsibleSection>
            )}
            {writeGroups.length > 0 && (
              <CollapsibleSection
                bordered={false}
                title="Write Tools"
                badge={`${selectedWriteCount} / ${availableTools.writeTools.length} selected`}
              >
                {writeGroups.map((g) => (
                  <div key={g.source} className="mb-3 last:mb-0">
                    <p className="mb-1 text-xs text-zinc-500">{g.source}</p>
                    <div className="flex flex-wrap gap-2">
                      {g.tools.map((t) => (
                        <button key={`${g.source}-${t.name}`} onClick={() => toggleItem(direct, setDirect, t.name)}
                          className={`rounded-lg border px-3 py-1.5 text-sm transition ${direct.includes(t.name) ? "border-green-500 bg-green-950/30 text-green-300" : "border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-600"}`}>
                          {t.name}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </CollapsibleSection>
            )}
            {/* Non-write MCP server tools (e.g. claw-builtin:webfetch, github
                read-only tools). The "Direct Tools" section above only renders
                writeTools, which silently drops every read-only MCP tool from
                the picker. Read groups computed in the outer IIFE. */}
            {serverGroups.length > 0 && (
              <CollapsibleSection
                bordered={false}
                title="MCP Server Tools"
                badge={`${selectedServerCount} / ${serverToolNames.size} selected`}
              >
                {serverGroups.map((g) => (
                  <div key={g.source} className="mb-3 last:mb-0">
                    <p className="mb-1 text-xs text-zinc-500">{g.source}</p>
                    <div className="flex flex-wrap gap-2">
                      {g.tools.map((t) => (
                        <button key={t.slug} onClick={() => toggleDirectSlug(t)}
                          className={`rounded-lg border px-3 py-1.5 text-sm transition ${isDirectSel(t) ? "border-green-500 bg-green-950/30 text-green-300" : "border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-600"}`}>
                          {t.name}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </CollapsibleSection>
            )}
            {availableTools.customGroups.length > 0 && (
              <CollapsibleSection
                bordered={false}
                title="System Tools"
                badge={`${custom.length} / ${availableTools.customGroups.reduce((sum, g) => sum + g.tools.length, 0)} selected`}
              >
                {availableTools.customGroups.map((g) => (
                  <div key={g.source} className="mb-3 last:mb-0">
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
              </CollapsibleSection>
            )}
          </div>
            );
          })()
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

      {/* Knowledge Base — two scoping modes:
            COLLECTIONS — picker selects an explicit allowlist (same for everyone).
            USER        — agent inherits the calling user's spaces access at runtime. */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
        <h3 className="mb-3 text-sm font-semibold text-zinc-200">Knowledge Base</h3>
        <p className="mb-3 text-xs text-zinc-500">
          Attach spaces collections or specific files, or have the agent match whoever's running it.
        </p>

        <fieldset className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2" disabled={readOnly}>
          {([
            { value: "COLLECTIONS" as const, label: "Selected collections & files", hint: "Explicit allowlist — same for every user." },
            { value: "USER" as const, label: "Match my access", hint: "Inherits the running user's spaces access." },
          ]).map((opt) => {
            const selected = selectedKbScope === opt.value;
            return (
              <label
                key={opt.value}
                className={`flex cursor-pointer flex-col gap-1 rounded-md border px-3 py-2 text-xs ${
                  selected ? "border-blue-500 bg-blue-500/10" : "border-zinc-700 hover:border-zinc-600"
                } ${readOnly ? "cursor-not-allowed opacity-60" : ""}`}
              >
                <span className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="kb-scope-v2"
                    value={opt.value}
                    checked={selected}
                    onChange={() => !readOnly && setSelectedKbScope(opt.value)}
                  />
                  <span className="font-medium text-zinc-200">{opt.label}</span>
                </span>
                <span className="pl-5 text-zinc-500">{opt.hint}</span>
              </label>
            );
          })}
        </fieldset>

        {selectedKbScope === "USER" ? (
          <div className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-400">
            This agent is scoped at the user level — KB reach is whatever the running user can see in spaces. The per-collection picker is disabled.
          </div>
        ) : (
          <>
            <KnowledgeBasePicker
              value={selectedKbResources}
              onChange={setSelectedKbResources}
            />
            {selectedKbResources.length > 0 && (
              <p className="mt-2 text-xs text-zinc-500">{selectedKbResources.length} KB grant(s) selected</p>
            )}
          </>
        )}
      </div>

      {/* Sandbox repository — pins which REPO_CONFIGS setup the sandbox uses */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
        <h3 className="mb-3 text-sm font-semibold text-zinc-200">Sandbox repository</h3>
        <p className="mb-3 text-xs text-zinc-500">
          Optional. Pin this agent to a specific sandbox setup. When set, the runtime forces
          <code className="font-mono text-zinc-400"> sandbox-repo-setup</code> onto this repo — the agent
          can no longer pick the wrong one. Leave as "None" to let the agent choose.
        </p>
        <select
          value={sandboxRepo}
          onChange={(e) => setSandboxRepo(e.target.value)}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 focus:border-purple-500 focus:outline-none"
        >
          <option value="">None (agent chooses)</option>
          {sandboxRepoOptions.map((r) => (
            <option key={r.key} value={r.key}>{r.name} ({r.key})</option>
          ))}
        </select>
      </div>

      {/* Citations — post-response citation enforcement */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
        <h3 className="mb-3 text-sm font-semibold text-zinc-200">Citations</h3>
        <p className="mb-3 text-xs text-zinc-500">
          Enforce inline citations. After the agent answers, if it drew on citeable sources
          (search / KB / subagents that return <code className="font-mono text-zinc-400">[clf-…]</code> tokens)
          but cited none, the runtime nudges it once to rewrite the answer with verbatim inline citations.
        </p>
        <label className="flex items-center gap-2 text-sm text-zinc-200">
          <input
            type="checkbox"
            checked={citationReflection}
            onChange={(e) => setCitationReflection(e.target.checked)}
            disabled={readOnly}
            className="h-4 w-4 rounded border-zinc-600 bg-zinc-900 accent-purple-500"
          />
          Enforce citations (post-response reflection)
        </label>
        <label className="mt-3 flex items-start gap-2 text-sm text-zinc-200">
          <input
            type="checkbox"
            checked={autoToolCitations}
            onChange={(e) => setAutoToolCitations(e.target.checked)}
            disabled={readOnly}
            className="mt-0.5 h-4 w-4 rounded border-zinc-600 bg-zinc-900 accent-purple-500"
          />
          <span>
            Auto-cite all tools
            <span className="mt-0.5 block text-xs text-zinc-500">
              Chunk every tool result — every MCP, sandbox, and built-in tool — and
              inject <code className="font-mono text-zinc-400">[clf-…]</code> tokens so the
              model can cite any output. Tools that already emit their own citations are
              left untouched.
            </span>
          </span>
        </label>
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

      {/* Save — hidden entirely in read-only mode. */}
      {!readOnly && (
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
      )}
    </div>
    </fieldset>
  );
}
