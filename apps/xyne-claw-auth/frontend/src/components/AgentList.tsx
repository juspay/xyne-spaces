import { useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Trash2, Globe } from "lucide-react";
import type { AgentLight } from "../lib/types";
import {
  updateAgent,
  deleteAgent,
  submitAgentRequest,
  getUserAgentConfig,
  setUserAgentConfig,
  listProviderCredentials,
  type UserAgentConfig,
  type ProviderCredential,
} from "../lib/api";
import { withAdminRequestAlert } from "../lib/admin-request-notice";

interface Props {
  agents: AgentLight[];
  loading: boolean;
  isAdmin?: boolean;
  onUpdate: () => void;
  userId: string;
}

// ── Provider Config Popup ─────────────────────────────────────────────

function ProviderPopup({
  agentSlug,
  userId,
  onClose,
}: {
  agentSlug: string;
  userId: string;
  onClose: () => void;
}) {
  const [config, setConfig] = useState<UserAgentConfig | null>(null);
  const [creds, setCreds] = useState<ProviderCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cfg, c] = await Promise.all([getUserAgentConfig(agentSlug, userId), listProviderCredentials(userId)]);
      setConfig(cfg);
      setCreds(c);
      setError(null);
    } catch {
      setError("Failed to load config");
    } finally {
      setLoading(false);
    }
  }, [agentSlug, userId]);

  useEffect(() => { load(); }, [load]);

  const credByProvider = new Map(creds.map((c) => [c.provider, c] as const));
  const currentProvider = config?.provider ?? "spaces";

  const handleSelect = async (provider: string) => {
    if (provider === currentProvider) return;
    setSaving(provider);
    setError(null);
    try {
      await setUserAgentConfig(agentSlug, userId, { provider });
      setConfig((prev) => ({ ...(prev ?? { provider: "spaces", hasApiKey: false }), provider }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(null);
    }
  };

  const providers: Array<{ id: string; label: string; description: string; needsCreds: boolean }> = [
    { id: "spaces", label: "Spaces (Default)", description: "Shared LLM gateway", needsCreds: false },
    { id: "copilot", label: "GitHub Copilot", description: "Use your GitHub Copilot subscription", needsCreds: true },
    { id: "claude", label: "Anthropic Claude", description: "Use your Anthropic API key", needsCreds: true },
    { id: "codex", label: "OpenAI (Codex)", description: "Use your OpenAI Platform API key", needsCreds: true },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-lg border border-zinc-800 bg-zinc-900 p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h3 className="text-lg font-semibold text-zinc-100">Configure Provider</h3>
            <p className="mt-1 text-xs text-zinc-500">Pick which provider this agent should use. Credentials are managed in the Settings tab.</p>
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-zinc-500">Loading…</p>
        ) : (
          <div className="space-y-2">
            {providers.map((p) => {
              const has = !p.needsCreds || credByProvider.get(p.id)?.hasApiKey;
              const active = currentProvider === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => handleSelect(p.id)}
                  disabled={saving !== null || (!has && p.needsCreds)}
                  className={`flex w-full items-start justify-between rounded-lg border p-3 text-left transition ${active ? "border-zinc-100 bg-zinc-800" : "border-zinc-800 bg-zinc-950 hover:bg-zinc-900"} disabled:opacity-50`}
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${active ? "bg-blue-400" : "bg-zinc-600"}`} />
                      <span className="text-sm font-medium text-zinc-100">{p.label}</span>
                      {active && <span className="rounded bg-blue-950 px-1.5 py-0.5 text-xs text-blue-400">Current</span>}
                      {p.needsCreds && (
                        has
                          ? <span className="rounded bg-green-950 px-1.5 py-0.5 text-xs text-green-400">Configured</span>
                          : <span className="rounded bg-amber-950 px-1.5 py-0.5 text-xs text-amber-400">Not configured</span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-zinc-500">{p.description}</p>
                    {p.needsCreds && !has && (
                      <p className="mt-1 text-xs text-amber-400">Set this up in the Settings tab first.</p>
                    )}
                  </div>
                  {saving === p.id && <span className="text-xs text-zinc-400">Saving…</span>}
                </button>
              );
            })}
          </div>
        )}

        {error && <p className="mt-3 text-xs text-red-400">{error}</p>}

        <div className="mt-6 flex justify-end">
          <button onClick={onClose} className="rounded-md px-4 py-2 text-sm text-zinc-400 transition hover:text-zinc-200">Close</button>
        </div>
      </div>
    </div>
  );
}

// ── Agent List ────────────────────────────────────────────────────────

export function AgentList({ agents, loading, onUpdate, userId, isAdmin }: Props) {
  const navigate = useNavigate();
  const [providerSlug, setProviderSlug] = useState<string | null>(null);

  const handleToggle = useCallback(async (agent: AgentLight) => {
    try {
      await updateAgent(agent.slug, { enabled: !agent.enabled });
      onUpdate();
    } catch (err) {
      console.error("[agents] toggle error:", err);
    }
  }, [onUpdate]);

  const [deleting, setDeleting] = useState<string | null>(null);

  const handleDelete = useCallback(async (agent: AgentLight) => {
    if (!confirm(`Delete "${agent.name}"? This cannot be undone.`)) return;
    setDeleting(agent.slug);
    try {
      await deleteAgent(agent.slug, userId);
      onUpdate();
    } catch (err) {
      console.error("[agents] delete error:", err);
    } finally {
      setDeleting(null);
    }
  }, [onUpdate, userId]);

  if (loading) {
    return <p className="text-sm text-zinc-500">Loading agents...</p>;
  }

  if (agents.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-8 text-center">
        <p className="text-zinc-400">No agents available.</p>
      </div>
    );
  }

  const globalAgents = agents.filter((a) => a.scope === "global");
  const myAgents = agents.filter((a) => a.ownerUserId === userId);
  const sharedAgents = agents.filter((a) => a.scope !== "global" && a.ownerUserId !== userId && a.ownerUserId !== null);

  const shareRoleBadge = (agent: AgentLight) => {
    const share = agent.shares?.find((s) => s.userId === userId);
    if (!share) return null;
    const styles: Record<string, string> = {
      CONTRIBUTOR: "bg-blue-950 text-blue-400",
      EDITOR: "bg-purple-950 text-purple-400",
      VIEWER: "bg-zinc-800 text-zinc-400",
    };
    return (
      <span className={`rounded px-1.5 py-0.5 text-xs ${styles[share.role] ?? "bg-zinc-800 text-zinc-400"}`}>
        {share.role}
      </span>
    );
  };

  const renderAgent = (agent: AgentLight, canDelete: boolean) => {
    const tools = agent.tools ?? [];
    return (
        <div
          key={agent.id}
          className="cursor-pointer rounded-lg border border-zinc-800 bg-zinc-900 p-4 transition-colors hover:border-zinc-600"
          onClick={() => navigate(`/agents/${agent.slug}`)}
        >
          {/* Action buttons for own agents */}
          {canDelete && (
            <div className="float-right ml-2 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              {agent.scope !== "global" && (
                <button
                  onClick={async () => {
                    const ok = await withAdminRequestAlert(() => submitAgentRequest(agent.slug, userId, "push_to_global"));
                    if (ok !== undefined) onUpdate();
                  }}
                  className="rounded-md p-1.5 text-zinc-600 transition hover:bg-green-950 hover:text-green-400"
                  title="Request: Push to Global"
                >
                  <Globe size={14} />
                </button>
              )}
              <button
                onClick={() => handleDelete(agent)}
                disabled={deleting === agent.slug}
                className="rounded-md p-1.5 text-zinc-600 transition hover:bg-red-950 hover:text-red-400 disabled:opacity-50"
                title="Delete agent"
              >
                <Trash2 size={14} />
              </button>
            </div>
          )}
          <div className="flex items-start justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span
                  className="inline-block h-3 w-3 rounded-full"
                  style={{ backgroundColor: agent.color }}
                />
                <h3 className="font-medium">
                  {agent.name}
                </h3>
                <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-400">
                  {agent.slug}
                </span>
                <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-500">
                  {agent.scope}
                </span>
                {agent.owner && (
                  <span className="text-xs text-zinc-500">
                    by {agent.owner.name || agent.owner.email}
                  </span>
                )}
                {shareRoleBadge(agent)}
                {agent.spacesAppId ? (
                  <span className="rounded bg-green-950 px-1.5 py-0.5 text-xs text-green-400">
                    Spaces App
                  </span>
                ) : (
                  <span className="rounded bg-yellow-950 px-1.5 py-0.5 text-xs text-yellow-400">
                    Not registered
                  </span>
                )}
              </div>
              {agent.description && (
                <p className="mt-1 text-sm text-zinc-400">{agent.description}</p>
              )}
              {/* Custom tool pills */}
              {tools.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {tools.map((at) => (
                    <span
                      key={at.id}
                      className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-500"
                    >
                      {at.tool.slug}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="ml-4 flex shrink-0 items-center gap-3" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => setProviderSlug(agent.slug)}
                className="rounded-md px-3 py-1.5 text-sm text-purple-400 transition hover:bg-zinc-800 hover:text-purple-300"
              >
                Provider
              </button>
              <button
                onClick={() => handleToggle(agent)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                  agent.enabled ? "bg-green-600" : "bg-zinc-700"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
                    agent.enabled ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
              <span className={`text-xs ${agent.enabled ? "text-green-400" : "text-zinc-500"}`}>
                {agent.enabled ? "On" : "Off"}
              </span>
            </div>
          </div>

        </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* My Agents */}
      {myAgents.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-medium text-zinc-400">My Agents</h3>
          <div className="space-y-3">
            {myAgents.map((agent) => renderAgent(agent, true))}
          </div>
        </div>
      )}

      {/* Shared with me */}
      {sharedAgents.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-medium text-zinc-400">Shared with me</h3>
          <div className="space-y-3">
            {sharedAgents.map((agent) => renderAgent(agent, false))}
          </div>
        </div>
      )}

      {/* Global Agents */}
      {globalAgents.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-medium text-zinc-400">Global Agents</h3>
          <div className="space-y-3">
            {globalAgents.map((agent) => renderAgent(agent, false))}
          </div>
        </div>
      )}

      {providerSlug && (
        <ProviderPopup
          agentSlug={providerSlug}
          userId={userId}
          onClose={() => setProviderSlug(null)}
        />
      )}

    </div>
  );
}
