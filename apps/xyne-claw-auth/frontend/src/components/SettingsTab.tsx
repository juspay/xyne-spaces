import { useCallback, useEffect, useState } from "react";
import {
  listProviderCredentials,
  upsertProviderCredential,
  deleteProviderCredential,
  listSubagentRouting,
  upsertSubagentRouting,
  deleteSubagentRouting,
  initiateCopilotGitHubLogin,
  pollCopilotGitHubLogin,
  listCopilotModelsForUser,
  listClaudeModelsForUser,
  listCodexModelsForUser,
  getAvailableTools,
  type ProviderCredential,
  type SubagentRouting,
  type GitHubDeviceCode,
  type ClaudeModelInfo,
} from "../lib/api";

// Fallback list — used only if /api/v1/tools/available 404s. The canonical
// list lives in xyne-claw-shared SUBAGENT_DEFINITIONS and is fetched at runtime.
const FALLBACK_SUBAGENTS = ["spaces", "bitbucket", "grafana", "deepwiki", "context7"];

const PROVIDER_META: Record<string, { label: string; defaultModel: string; defaultBaseUrl: string }> = {
  copilot: { label: "GitHub Copilot", defaultModel: "gpt-4o", defaultBaseUrl: "https://api.githubcopilot.com" },
  claude: { label: "Anthropic Claude", defaultModel: "claude-sonnet-4-5", defaultBaseUrl: "https://api.anthropic.com" },
  codex: { label: "OpenAI (Codex)", defaultModel: "gpt-4.1", defaultBaseUrl: "https://api.openai.com/v1" },
};

interface Props {
  userId: string;
}

export function SettingsTab({ userId }: Props) {
  const [creds, setCreds] = useState<ProviderCredential[]>([]);
  const [routing, setRouting] = useState<SubagentRouting[]>([]);
  const [subagents, setSubagents] = useState<string[]>(FALLBACK_SUBAGENTS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, r, available] = await Promise.all([
        listProviderCredentials(userId),
        listSubagentRouting(userId),
        getAvailableTools().catch(() => null),
      ]);
      setCreds(c);
      setRouting(r);
      if (available?.subagents && available.subagents.length > 0) {
        // Canonical list from xyne-claw-shared SUBAGENT_DEFINITIONS — keeps the
        // UI in sync as new subagents are added (hubspot, mixpanel, sandbox, ...).
        setSubagents(available.subagents.map((s) => s.name));
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  const credByProvider = new Map(creds.map((c) => [c.provider, c] as const));
  const routingBySubagent = new Map(routing.map((r) => [r.subagentName, r.provider] as const));

  const availableProvidersForSubagent = ["default", ...creds.filter((c) => c.hasApiKey).map((c) => c.provider)];

  return (
    <div className="space-y-8">
      {error && <div className="rounded border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">{error}</div>}

      {/* Provider Credentials */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-300">Provider Credentials</h2>
        <p className="mb-4 text-xs text-zinc-500">
          Store API keys once per provider. They will be used for any agent or subagent configured to use that provider.
        </p>
        {loading ? (
          <p className="text-sm text-zinc-500">Loading…</p>
        ) : (
          <div className="space-y-3">
            <CopilotCredentialCard
              userId={userId}
              existing={credByProvider.get("copilot")}
              saving={saving === "copilot"}
              onChange={load}
              onModelChange={async (model) => {
                setSaving("copilot");
                try { await upsertProviderCredential(userId, "copilot", { model }); await load(); }
                catch (err) { setError(err instanceof Error ? err.message : "Save failed"); }
                finally { setSaving(null); }
              }}
              onDelete={async () => {
                setSaving("copilot");
                try { await deleteProviderCredential(userId, "copilot"); await load(); }
                catch (err) { setError(err instanceof Error ? err.message : "Delete failed"); }
                finally { setSaving(null); }
              }}
            />
            <ProviderCredentialCard
              userId={userId}
              provider="claude"
              existing={credByProvider.get("claude")}
              saving={saving === "claude"}
              onSave={async (payload) => {
                setSaving("claude");
                try { await upsertProviderCredential(userId, "claude", payload); await load(); }
                catch (err) { setError(err instanceof Error ? err.message : "Save failed"); }
                finally { setSaving(null); }
              }}
              onDelete={async () => {
                setSaving("claude");
                try { await deleteProviderCredential(userId, "claude"); await load(); }
                catch (err) { setError(err instanceof Error ? err.message : "Delete failed"); }
                finally { setSaving(null); }
              }}
            />
            <ProviderCredentialCard
              userId={userId}
              provider="codex"
              existing={credByProvider.get("codex")}
              saving={saving === "codex"}
              onSave={async (payload) => {
                setSaving("codex");
                try { await upsertProviderCredential(userId, "codex", payload); await load(); }
                catch (err) { setError(err instanceof Error ? err.message : "Save failed"); }
                finally { setSaving(null); }
              }}
              onDelete={async () => {
                setSaving("codex");
                try { await deleteProviderCredential(userId, "codex"); await load(); }
                catch (err) { setError(err instanceof Error ? err.message : "Delete failed"); }
                finally { setSaving(null); }
              }}
            />
          </div>
        )}
      </section>

      {/* Subagent Routing */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-300">Subagent Provider Routing</h2>
        <p className="mb-4 text-xs text-zinc-500">
          Choose which provider each subagent should use. "Default" means use whatever the parent agent is using.
        </p>
        {loading ? (
          <p className="text-sm text-zinc-500">Loading…</p>
        ) : (
          <div className="space-y-2">
            {subagents.map((name) => {
              const current = routingBySubagent.get(name) ?? "default";
              return (
                <div key={name} className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900 p-3">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium capitalize text-zinc-200">{name}</span>
                    <span className="text-xs text-zinc-500">{name} subagent</span>
                  </div>
                  <select
                    className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-100 shadow-sm transition-colors hover:border-zinc-600 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20"
                    value={current}
                    disabled={saving === `sa:${name}`}
                    onChange={async (e) => {
                      const choice = e.target.value;
                      setSaving(`sa:${name}`);
                      try {
                        if (choice === "default") {
                          await deleteSubagentRouting(userId, name);
                        } else {
                          await upsertSubagentRouting(userId, name, choice);
                        }
                        await load();
                      } catch (err) {
                        setError(err instanceof Error ? err.message : "Save failed");
                      } finally {
                        setSaving(null);
                      }
                    }}
                  >
                    {availableProvidersForSubagent.map((p) => (
                      <option key={p} value={p}>{p === "default" ? "Default (parent agent)" : (PROVIDER_META[p]?.label ?? p)}</option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function ProviderCredentialCard({
  userId, provider, existing, saving, onSave, onDelete,
}: {
  userId: string;
  provider: string;
  existing?: ProviderCredential;
  saving: boolean;
  onSave: (payload: { apiKey?: string; model?: string; baseUrl?: string; reasoningEffort?: "low" | "medium" | "high" }) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const meta = PROVIDER_META[provider];
  const [apiKey, setApiKey] = useState("");

  const [model, setModel] = useState(existing?.model ?? meta?.defaultModel ?? "");
  const [baseUrl, setBaseUrl] = useState(existing?.baseUrl ?? meta?.defaultBaseUrl ?? "");
  const [reasoningEffort, setReasoningEffort] = useState<"low" | "medium" | "high">(
    existing?.reasoningEffort === "low" || existing?.reasoningEffort === "medium" || existing?.reasoningEffort === "high"
      ? existing.reasoningEffort
      : "medium",
  );
  const [editing, setEditing] = useState(false);
  const [models, setModels] = useState<ClaudeModelInfo[] | null>(null);
  const [modelsErr, setModelsErr] = useState<string | null>(null);

  useEffect(() => {
    setModel(existing?.model ?? meta?.defaultModel ?? "");
    setBaseUrl(existing?.baseUrl ?? meta?.defaultBaseUrl ?? "");
    if (existing?.reasoningEffort === "low" || existing?.reasoningEffort === "medium" || existing?.reasoningEffort === "high") {
      setReasoningEffort(existing.reasoningEffort);
    }
  }, [existing?.model, existing?.baseUrl, existing?.authType, existing?.reasoningEffort, meta?.defaultModel, meta?.defaultBaseUrl]);

  const hasKey = Boolean(existing?.hasApiKey);
  const isClaude = provider === "claude";
  const isCodex = provider === "codex";
  // Claude + Codex OAuth were removed (subscription tokens must not be
  // stored on a third-party server) — both providers are API-key-only.

  // Fetch live model catalog when API key is configured. Claude + Codex both expose a /v1/models endpoint.
  useEffect(() => {
    if (!hasKey) return;
    if (provider !== "claude" && provider !== "codex") return;
    setModelsErr(null);
    const fetcher = provider === "claude" ? listClaudeModelsForUser : listCodexModelsForUser;
    fetcher(userId)
      .then((rows) => setModels(rows.map((r) => ({ id: r.id, displayName: (r as { name?: string; displayName?: string }).displayName ?? (r as { name?: string }).name ?? r.id }))))
      .catch((e) => {
        setModels(null);
        setModelsErr(e instanceof Error ? e.message : "Failed to load models");
      });
  }, [provider, hasKey, userId, existing?.authType]);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium text-zinc-200">{meta?.label ?? provider}</span>
            <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-400">{provider}</span>
            {hasKey ? (
              <span className="rounded bg-green-950 px-1.5 py-0.5 text-xs text-green-400">Configured</span>
            ) : (
              <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-500">Not set</span>
            )}
          </div>
          {hasKey && existing?.model && <p className="mt-1 text-xs text-zinc-500">Model: {existing.model}</p>}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setEditing(!editing)}
            className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
          >
            {editing ? "Cancel" : hasKey ? "Edit" : "Configure"}
          </button>
          {hasKey && (
            <button
              onClick={onDelete}
              disabled={saving}
              className="rounded border border-red-900 px-2 py-1 text-xs text-red-400 hover:bg-red-950 disabled:opacity-50"
            >
              Delete
            </button>
          )}
        </div>
      </div>
      {editing && (
        <div className="mt-3 space-y-2 border-t border-zinc-800 pt-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">
              API Key {hasKey && <span className="text-zinc-600">(leave blank to keep current)</span>}
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={hasKey ? "••••••••" : ("sk-…")}
              className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 shadow-sm transition-colors hover:border-zinc-600 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">Model</label>
            {models && models.length > 0 ? (
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 shadow-sm transition-colors hover:border-zinc-600 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20"
              >
                {models.map((m) => <option key={m.id} value={m.id}>{m.displayName}</option>)}
              </select>
            ) : (
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 shadow-sm transition-colors hover:border-zinc-600 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20"
              />
            )}
            {modelsErr && <p className="mt-1 text-xs text-amber-400">Couldn't fetch model list — {modelsErr}. Free-text is fine.</p>}
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">Base URL</label>
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 shadow-sm transition-colors hover:border-zinc-600 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">Reasoning effort</label>
            <select
              value={reasoningEffort}
              onChange={(e) => setReasoningEffort(e.target.value as "low" | "medium" | "high")}
              className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 shadow-sm transition-colors hover:border-zinc-600 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20"
            >
              <option value="low">Low — fastest, minimal think time</option>
              <option value="medium">Medium — balanced (default)</option>
              <option value="high">High — deepest reasoning, slowest</option>
            </select>
            <p className="mt-1 text-[11px] text-zinc-500">
              Only applies to reasoning-capable models (e.g. gpt-5.x, codex). Lower = faster per-turn responses.
            </p>
          </div>
          <button
            onClick={async () => {
              const payload: { apiKey?: string; model?: string; baseUrl?: string; reasoningEffort?: "low" | "medium" | "high" } = { model, baseUrl, reasoningEffort };
              if (apiKey) payload.apiKey = apiKey;
              else if (!hasKey) { return; }
              await onSave(payload);
              setApiKey("");
              setEditing(false);
            }}
            disabled={saving || (!apiKey && !hasKey)}
            className="rounded-md bg-gradient-to-b from-zinc-50 to-zinc-200 px-4 py-1.5 text-sm font-medium text-zinc-900 shadow-sm transition hover:from-white hover:to-zinc-100 hover:shadow disabled:opacity-50 disabled:hover:shadow-sm"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      )}
    </div>
  );
}

function CopilotCredentialCard({
  userId, existing, saving, onChange, onModelChange, onDelete,
}: {
  userId: string;
  existing?: ProviderCredential;
  saving: boolean;
  onChange: () => Promise<void>;
  onModelChange: (model: string) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [device, setDevice] = useState<GitHubDeviceCode | null>(null);
  const [polling, setPolling] = useState(false);
  const [starting, setStarting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [models, setModels] = useState<Array<{ id: string; name: string }> | null>(null);
  const [modelsErr, setModelsErr] = useState<string | null>(null);

  const hasKey = Boolean(existing?.hasApiKey);

  // Fetch live Copilot models when connected
  useEffect(() => {
    if (!hasKey) return;
    setModelsErr(null);
    listCopilotModelsForUser(userId)
      .then(setModels)
      .catch((e) => setModelsErr(e instanceof Error ? e.message : "Failed to load models"));
  }, [hasKey, userId]);

  // Poll after device code is issued
  useEffect(() => {
    if (!polling || !device) return;
    let cancelled = false;
    const run = async () => {
      while (!cancelled) {
        await new Promise((r) => setTimeout(r, (device.interval + 1) * 1000));
        if (cancelled) break;
        try {
          const result = await pollCopilotGitHubLogin(userId);
          if (result.status === "approved") {
            setPolling(false);
            setDevice(null);
            await onChange();
            break;
          }
          if (result.status === "slow_down") await new Promise((r) => setTimeout(r, 5000));
        } catch (e) {
          setErr(e instanceof Error ? e.message : "Polling failed");
          setPolling(false);
          break;
        }
      }
    };
    run();
    return () => { cancelled = true; };
  }, [polling, device, userId, onChange]);

  const startLogin = async () => {
    setStarting(true);
    setErr(null);
    try {
      const d = await initiateCopilotGitHubLogin(userId);
      setDevice(d);
      setPolling(true);
      window.open(d.verificationUri, "_blank");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to start GitHub login");
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium text-zinc-200">GitHub Copilot</span>
            <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-400">copilot</span>
            {hasKey ? (
              <span className="rounded bg-green-950 px-1.5 py-0.5 text-xs text-green-400">Connected</span>
            ) : (
              <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-500">Not connected</span>
            )}
          </div>
          {hasKey && existing?.model && <p className="mt-1 text-xs text-zinc-500">Model: {existing.model}</p>}
        </div>
        <div className="flex gap-2">
          {!hasKey && !device && (
            <button
              onClick={startLogin}
              disabled={starting}
              className="rounded border border-zinc-700 px-3 py-1 text-xs text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
            >
              {starting ? "Starting…" : "Log in with GitHub"}
            </button>
          )}
          {hasKey && (
            <>
              <button
                onClick={startLogin}
                disabled={starting}
                className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
              >
                Reconnect
              </button>
              <button
                onClick={onDelete}
                disabled={saving}
                className="rounded border border-red-900 px-2 py-1 text-xs text-red-400 hover:bg-red-950 disabled:opacity-50"
              >
                Disconnect
              </button>
            </>
          )}
        </div>
      </div>
      {hasKey && (
        <div className="mt-3 space-y-2 border-t border-zinc-800 pt-3">
          <div className="flex items-center justify-between">
            <label className="block text-xs text-zinc-400">Model</label>
            {existing?.model && <span className="text-xs text-zinc-500">Current: <span className="text-zinc-300">{existing.model}</span></span>}
          </div>
          {models ? (
            models.length > 0 ? (
              <select
                value={existing?.model ?? ""}
                disabled={saving}
                onChange={(e) => onModelChange(e.target.value)}
                className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm text-zinc-200 disabled:opacity-50"
              >
                {!existing?.model && <option value="" disabled>Select a model…</option>}
                {/* Include currently saved model even if not in fetched list */}
                {existing?.model && !models.some((m) => m.id === existing.model) && (
                  <option value={existing.model}>{existing.model} (saved)</option>
                )}
                {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            ) : (
              <p className="text-xs text-amber-400">No models available for this account.</p>
            )
          ) : modelsErr ? (
            <p className="text-xs text-amber-400">Couldn't load models: {modelsErr}</p>
          ) : (
            <p className="text-xs text-zinc-500">Loading models…</p>
          )}
        </div>
      )}
      {device && (
        <div className="mt-3 space-y-2 border-t border-zinc-800 pt-3">
          <p className="text-xs text-zinc-400">Enter this code on GitHub to authorize:</p>
          <div className="flex items-center gap-2">
            <code className="rounded bg-zinc-950 px-3 py-1.5 font-mono text-lg tracking-widest text-zinc-100">{device.userCode}</code>
            <button
              onClick={() => navigator.clipboard.writeText(device.userCode)}
              className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
            >
              Copy
            </button>
          </div>
          <p className="text-xs text-zinc-500">
            Opens at <a href={device.verificationUri} target="_blank" rel="noreferrer" className="underline">{device.verificationUri}</a>
          </p>
          {polling && <p className="text-xs text-zinc-500">Waiting for you to authorize in GitHub…</p>}
        </div>
      )}
      {err && <p className="mt-2 text-xs text-red-400">{err}</p>}
    </div>
  );
}
