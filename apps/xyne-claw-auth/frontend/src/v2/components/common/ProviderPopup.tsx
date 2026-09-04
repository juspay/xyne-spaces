import { useState, useEffect, useCallback } from "react";
import {
  getUserAgentConfig,
  setUserAgentConfig,
  listProviderCredentials,
  type UserAgentConfig,
  type ProviderCredential,
} from "../../../lib/api";

interface Props {
  agentSlug: string;
  userId: string;
  onClose: () => void;
}

const PROVIDERS: Array<{ id: string; label: string; description: string; needsCreds: boolean }> = [
  { id: "spaces",  label: "Spaces (Default)",  description: "Shared LLM gateway",                                        needsCreds: false },
  { id: "copilot", label: "GitHub Copilot",     description: "Use your GitHub Copilot subscription",                      needsCreds: true  },
  { id: "claude",  label: "Anthropic Claude",   description: "Use your Anthropic API key",         needsCreds: true  },
  { id: "codex",   label: "OpenAI (Codex)",     description: "Use your OpenAI Platform API key",                          needsCreds: true  },
];

export function ProviderPopup({ agentSlug, userId, onClose }: Props) {
  const [config, setConfig] = useState<UserAgentConfig | null>(null);
  const [creds, setCreds]   = useState<ProviderCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState<string | null>(null);
  const [error, setError]     = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cfg, c] = await Promise.all([
        getUserAgentConfig(agentSlug, userId),
        listProviderCredentials(userId),
      ]);
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-lg border border-zinc-800 bg-zinc-900 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-zinc-100">Configure Provider</h3>
          <p className="mt-1 text-xs text-zinc-500">
            Pick which provider this agent should use. Credentials are managed in the Settings tab.
          </p>
        </div>

        {loading ? (
          <p className="text-sm text-zinc-500">Loading…</p>
        ) : (
          <div className="space-y-2">
            {PROVIDERS.map((p) => {
              const has    = !p.needsCreds || credByProvider.get(p.id)?.hasApiKey;
              const active = currentProvider === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => handleSelect(p.id)}
                  disabled={saving !== null || (!has && p.needsCreds)}
                  className={`flex w-full items-start justify-between rounded-lg border p-3 text-left transition ${
                    active
                      ? "border-zinc-100 bg-zinc-800"
                      : "border-zinc-800 bg-zinc-950 hover:bg-zinc-900"
                  } disabled:opacity-50`}
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${active ? "bg-blue-400" : "bg-zinc-600"}`} />
                      <span className="text-sm font-medium text-zinc-100">{p.label}</span>
                      {active && (
                        <span className="rounded bg-blue-950 px-1.5 py-0.5 text-xs text-blue-400">Current</span>
                      )}
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
          <button
            onClick={onClose}
            className="rounded-md px-4 py-2 text-sm text-zinc-400 transition hover:text-zinc-200"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
