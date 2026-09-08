import { useCallback, useEffect, useState } from "react";
import {
  listProviderCredentials,
  upsertProviderCredential,
  deleteProviderCredential,
  listSubagentRouting,
  upsertSubagentRouting,
  deleteSubagentRouting,
  listClaudeModelsForUser,
  listCodexModelsForUser,
  type ProviderCredential,
  type SubagentRouting,
  type ClaudeModelInfo,
} from "../../lib/api";

const SUBAGENTS = ["spaces", "bitbucket", "grafana", "deepwiki", "context7"] as const;

const PROVIDER_META: Record<string, { label: string; defaultModel: string; defaultBaseUrl: string }> = {
  claude:  { label: "Anthropic Claude", defaultModel: "claude-sonnet-4-5", defaultBaseUrl: "https://api.anthropic.com" },
  codex:   { label: "OpenAI (Codex)", defaultModel: "gpt-4.1", defaultBaseUrl: "https://api.openai.com/v1" },
};

// ── Shared input/select style ─────────────────────────────────────────
const inputCls =
  "w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-400 focus:outline-none";
const selectCls =
  "w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-400 focus:outline-none";

// ── StatusPill ────────────────────────────────────────────────────────
function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
        ok ? "bg-green-200 text-green-700" : "bg-zinc-200 text-zinc-500"
      }`}
    >
      {label}
    </span>
  );
}

// ── ProviderCredentialCard ────────────────────────────────────────────
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

  // Codex OAuth flow state

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

  useEffect(() => {
    if (!hasKey) return;
    if (provider !== "claude" && provider !== "codex") return;
    setModelsErr(null);
    const fetcher = provider === "claude" ? listClaudeModelsForUser : listCodexModelsForUser;
    fetcher(userId)
      .then((rows) =>
        setModels(rows.map((r) => ({
          id: r.id,
          displayName:
            (r as { name?: string; displayName?: string }).displayName ??
            (r as { name?: string }).name ??
            r.id,
        }))),
      )
      .catch((e) => {
        setModels(null);
        setModelsErr(e instanceof Error ? e.message : "Failed to load models");
      });
  }, [provider, hasKey, userId, existing?.authType]);

  return (
    <div className="rounded-2xl bg-zinc-100 p-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-zinc-900">{meta?.label ?? provider}</span>
            <span className="rounded-full bg-zinc-200 px-2.5 py-0.5 text-xs font-medium text-zinc-500">{provider}</span>
            <StatusPill ok={hasKey} label={hasKey ? "Configured" : "Not set"} />
          </div>
          {hasKey && existing?.model && (
            <p className="mt-1 text-xs text-zinc-500">Model: {existing.model}</p>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setEditing(!editing)}
            className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-600 transition hover:bg-zinc-200"
          >
            {editing ? "Cancel" : hasKey ? "Edit" : "Configure"}
          </button>
          {hasKey && (
            <button
              onClick={onDelete}
              disabled={saving}
              className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-red-500 transition hover:bg-red-50 disabled:opacity-40"
            >
              Delete
            </button>
          )}
        </div>
      </div>

      {editing && (
        <div className="mt-4 space-y-3 border-t border-zinc-200 pt-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-500">
              {"API Key"}{" "}
              {hasKey && <span className="text-zinc-400">(leave blank to keep current)</span>}
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={
                hasKey ? "••••••••" : "sk-…"
              }
              className={inputCls}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-500">Model</label>
            {models && models.length > 0 ? (
              <select value={model} onChange={(e) => setModel(e.target.value)} className={selectCls}>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>{m.displayName}</option>
                ))}
              </select>
            ) : (
              <input value={model} onChange={(e) => setModel(e.target.value)} className={inputCls} />
            )}
            {modelsErr && (
              <p className="mt-1 text-xs text-amber-500">Couldn't fetch model list — {modelsErr}. Free-text is fine.</p>
            )}
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-500">Base URL</label>
            <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className={inputCls} />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-500">Reasoning effort</label>
            <select
              value={reasoningEffort}
              onChange={(e) => setReasoningEffort(e.target.value as "low" | "medium" | "high")}
              className={inputCls}
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
              else if (!hasKey) return;
              await onSave(payload);
              setApiKey("");
              setEditing(false);
            }}
            disabled={saving || (!apiKey && !hasKey)}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── SettingsPageV2 ────────────────────────────────────────────────────
interface Props {
  userId: string;
}

export function SettingsPageV2({ userId }: Props) {
  const [creds, setCreds] = useState<ProviderCredential[]>([]);
  const [routing, setRouting] = useState<SubagentRouting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, r] = await Promise.all([
        listProviderCredentials(userId),
        listSubagentRouting(userId),
      ]);
      setCreds(c);
      setRouting(r);
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
  const availableProviders = ["default", ...creds.filter((c) => c.hasApiKey).map((c) => c.provider)];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-zinc-900">Settings</h2>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* Provider Credentials */}
      <section className="mt-8">
        <h3 className="mb-1 text-sm font-semibold text-zinc-900">Provider Credentials</h3>
        <p className="mb-4 text-xs text-zinc-500">
          Store API keys once per provider. They will be used for any agent or subagent configured to use that provider.
        </p>
        {loading ? (
          <div className="py-16 text-center text-sm text-zinc-400">Loading…</div>
        ) : (
          <div className="space-y-3">
            {(["claude", "codex"] as const).map((provider) => (
              <ProviderCredentialCard
                key={provider}
                userId={userId}
                provider={provider}
                existing={credByProvider.get(provider)}
                saving={saving === provider}
                onSave={async (payload) => {
                  setSaving(provider);
                  try { await upsertProviderCredential(userId, provider, payload); await load(); }
                  catch (err) { setError(err instanceof Error ? err.message : "Save failed"); }
                  finally { setSaving(null); }
                }}
                onDelete={async () => {
                  setSaving(provider);
                  try { await deleteProviderCredential(userId, provider); await load(); }
                  catch (err) { setError(err instanceof Error ? err.message : "Delete failed"); }
                  finally { setSaving(null); }
                }}
              />
            ))}
          </div>
        )}
      </section>

      {/* Subagent Routing */}
      <section>
        <h3 className="mb-1 text-sm font-semibold text-zinc-900">Subagent Provider Routing</h3>
        <p className="mb-4 text-xs text-zinc-500">
          Choose which provider each subagent should use. "Default" means use whatever the parent agent is using.
        </p>
        {loading ? (
          <div className="py-8 text-center text-sm text-zinc-400">Loading…</div>
        ) : (
          <div className="space-y-2">
            {SUBAGENTS.map((name) => {
              const current = routingBySubagent.get(name) ?? "default";
              return (
                <div
                  key={name}
                  className="flex items-center justify-between rounded-2xl bg-zinc-100 px-5 py-4"
                >
                  <div>
                    <p className="text-sm font-semibold capitalize text-zinc-900">{name}</p>
                    <p className="text-xs text-zinc-500">{name} subagent</p>
                  </div>
                  <select
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
                    className="rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 focus:border-zinc-400 focus:outline-none disabled:opacity-50"
                  >
                    {availableProviders.map((p) => (
                      <option key={p} value={p}>
                        {p === "default" ? "Default (parent agent)" : (PROVIDER_META[p]?.label ?? p)}
                      </option>
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
