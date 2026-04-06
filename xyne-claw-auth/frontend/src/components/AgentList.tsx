import { useState, useCallback } from "react";
import type { Agent } from "../lib/types";
import { updateAgent, createAgentApp, installAgentApp, configureAgentWebhook } from "../lib/api";

interface Props {
  agents: Agent[];
  loading: boolean;
  onUpdate: () => void;
}

export function AgentList({ agents, loading, onUpdate }: Props) {
  const [registering, setRegistering] = useState<string | null>(null);
  const [editingConfig, setEditingConfig] = useState<string | null>(null);
  const [configDraft, setConfigDraft] = useState<Record<string, string>>({});
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [saving, setSaving] = useState(false);

  const openConfigEditor = useCallback((agent: Agent) => {
    const config: Record<string, string> = {};
    for (const [k, v] of Object.entries(agent.config)) {
      config[k] = String(v ?? "");
    }
    setConfigDraft(config);
    setEditingConfig(agent.slug);
    setNewKey("");
    setNewValue("");
  }, []);

  const handleSaveConfig = useCallback(async (slug: string) => {
    setSaving(true);
    try {
      await updateAgent(slug, { config: configDraft });
      setEditingConfig(null);
      onUpdate();
    } catch {
      // silently fail
    } finally {
      setSaving(false);
    }
  }, [configDraft, onUpdate]);

  const handleToggle = useCallback(async (agent: Agent) => {
    try {
      await updateAgent(agent.slug, { enabled: !agent.enabled });
      onUpdate();
    } catch {
      // silently fail
    }
  }, [onUpdate]);

  const handleCreateApp = useCallback(async (agent: Agent) => {
    setRegistering(agent.slug);
    try {
      await createAgentApp(agent.slug);
      onUpdate();
    } catch {
      // silently fail
    } finally {
      setRegistering(null);
    }
  }, [onUpdate]);

  const handleInstallApp = useCallback(async (agent: Agent) => {
    setRegistering(agent.slug);
    try {
      await installAgentApp(agent.slug);
      onUpdate();
    } catch {
      // silently fail
    } finally {
      setRegistering(null);
    }
  }, [onUpdate]);

  const handleConfigureWebhook = useCallback(async (agent: Agent) => {
    setRegistering(agent.slug);
    try {
      await configureAgentWebhook(agent.slug);
      onUpdate();
    } catch {
      // silently fail
    } finally {
      setRegistering(null);
    }
  }, [onUpdate]);

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

  return (
    <div className="space-y-3">
      {agents.map((agent) => (
        <div key={agent.id} className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
          <div className="flex items-start justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span
                  className="inline-block h-3 w-3 rounded-full"
                  style={{ backgroundColor: agent.color }}
                />
                <h3 className="font-medium">{agent.name}</h3>
                <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-400">
                  {agent.slug}
                </span>
                <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-500">
                  {agent.scope}
                </span>
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
              {agent.tools.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {agent.tools.map((at) => (
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
            <div className="ml-4 flex shrink-0 items-center gap-3">
              <button
                onClick={() => editingConfig === agent.slug ? setEditingConfig(null) : openConfigEditor(agent)}
                className="rounded-md px-3 py-1.5 text-sm text-zinc-300 transition hover:bg-zinc-800 hover:text-zinc-100"
              >
                Config
              </button>
              {!agent.spacesAppId && (
                <button
                  onClick={() => handleCreateApp(agent)}
                  disabled={registering === agent.slug}
                  className="rounded-md px-3 py-1.5 text-sm text-blue-400 transition hover:bg-zinc-800 hover:text-blue-300 disabled:opacity-50"
                >
                  {registering === agent.slug ? "..." : "Create App"}
                </button>
              )}
              {agent.spacesAppId && !agent.spacesAppToken && (
                <button
                  onClick={() => handleInstallApp(agent)}
                  disabled={registering === agent.slug}
                  className="rounded-md px-3 py-1.5 text-sm text-yellow-400 transition hover:bg-zinc-800 hover:text-yellow-300 disabled:opacity-50"
                >
                  {registering === agent.slug ? "..." : "Install App"}
                </button>
              )}
              {agent.spacesAppId && (
                <button
                  onClick={() => handleConfigureWebhook(agent)}
                  disabled={registering === agent.slug}
                  className="rounded-md px-3 py-1.5 text-sm text-green-400 transition hover:bg-zinc-800 hover:text-green-300 disabled:opacity-50"
                >
                  {registering === agent.slug ? "..." : "Configure Webhook"}
                </button>
              )}
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

          {editingConfig === agent.slug && (
            <div className="mt-3 rounded-md border border-zinc-700 bg-zinc-800 p-3">
              <h4 className="mb-2 text-sm font-medium text-zinc-300">Agent Config</h4>

              {Object.keys(configDraft).length === 0 && (
                <p className="mb-2 text-xs text-zinc-500">No config keys set.</p>
              )}

              <div className="space-y-2">
                {Object.entries(configDraft).map(([key, value]) => (
                  <div key={key} className="flex items-center gap-2">
                    <span className="w-40 shrink-0 truncate text-xs font-mono text-zinc-400">{key}</span>
                    <input
                      type="text"
                      value={value}
                      onChange={(e) => setConfigDraft((prev) => ({ ...prev, [key]: e.target.value }))}
                      className="flex-1 rounded border border-zinc-600 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 outline-none focus:border-zinc-500"
                    />
                    <button
                      onClick={() => setConfigDraft((prev) => {
                        const next = { ...prev };
                        delete next[key];
                        return next;
                      })}
                      className="text-xs text-red-400 hover:text-red-300"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>

              <div className="mt-2 flex items-center gap-2">
                <input
                  type="text"
                  placeholder="KEY"
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  className="w-40 shrink-0 rounded border border-zinc-600 bg-zinc-900 px-2 py-1 text-xs font-mono text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-500"
                />
                <input
                  type="text"
                  placeholder="value"
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newKey.trim()) {
                      setConfigDraft((prev) => ({ ...prev, [newKey.trim()]: newValue }));
                      setNewKey("");
                      setNewValue("");
                    }
                  }}
                  className="flex-1 rounded border border-zinc-600 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-500"
                />
                <button
                  onClick={() => {
                    if (!newKey.trim()) return;
                    setConfigDraft((prev) => ({ ...prev, [newKey.trim()]: newValue }));
                    setNewKey("");
                    setNewValue("");
                  }}
                  disabled={!newKey.trim()}
                  className="rounded bg-zinc-700 px-2 py-1 text-xs text-zinc-300 transition hover:bg-zinc-600 disabled:opacity-40"
                >
                  Add
                </button>
              </div>

              <div className="mt-3 flex justify-end gap-2">
                <button
                  onClick={() => setEditingConfig(null)}
                  className="rounded px-3 py-1 text-xs text-zinc-400 hover:text-zinc-200"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleSaveConfig(agent.slug)}
                  disabled={saving}
                  className="rounded bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-900 transition hover:bg-zinc-300 disabled:opacity-50"
                >
                  {saving ? "Saving..." : "Save Config"}
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
