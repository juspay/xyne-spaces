import { useState, useEffect, useCallback } from "react";
import { Select } from "@base-ui-components/react/select";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "../../lib/utils";
import { PageHeader } from "./ui/PageHeader";
import { PageLayout } from "./ui/PageLayout";
import { Button } from "./ui/Button";
import { Badge } from "./ui/Badge";
import { SelectField } from "./ui/SelectField";
import { Dialog } from "./ui/Dialog";
import { TextField } from "./ui/TextField";
import { useAuth } from "../../hooks/useAuth";
import {
  listProviderCredentials,
  listSubagentRouting,
  getAvailableTools,
  upsertProviderCredential,
  deleteProviderCredential,
  upsertSubagentRouting,
  deleteSubagentRouting,
  initiateCopilotGitHubLogin,
  pollCopilotGitHubLogin,
  listCopilotModelsForUser,
  listClaudeModelsForUser,
  listCodexModelsForUser,
  listLitellmModelsForUser,
  startCodexOauth,
  exchangeCodexOauth,
  shareMyProviderCredential,
  listAgents,
  type ProviderCredential,
  type SubagentRouting,
  type GitHubDeviceCode,
  type ClaudeModelInfo,
} from "../../lib/api";
import {
  AirplaneTiltIcon,
  SparkleIcon,
  CodeIcon,
  CheckCircleIcon,
  SpinnerGapIcon,
  RobotIcon,
  ArrowRightIcon,
  GearSixIcon,
  CopyIcon,
  PlugIcon,
  CaretRightIcon,
  ShareNetworkIcon,
} from "@phosphor-icons/react";
import type { AgentLight } from "../../lib/types";

/* =================================================================== */
/*  CONFIG                                                              */
/* =================================================================== */

const PROVIDER_META: Record<
  string,
  { name: string; description: string; icon: typeof AirplaneTiltIcon }
> = {
  copilot: {
    name: "GitHub Copilot",
    description: "Code suggestions and autocomplete",
    icon: AirplaneTiltIcon,
  },
  claude: {
    name: "Anthropic Claude",
    description: "Reasoning and coding assistance",
    icon: SparkleIcon,
  },
  codex: {
    name: "OpenAI (Codex)",
    description: "Code generation and editing",
    icon: CodeIcon,
  },
  litellm: {
    name: "LiteLLM (own key)",
    description: "Use models allowed by your Grid/LiteLLM key",
    icon: SparkleIcon,
  },
};

const SUBAGENT_NAMES: Record<string, string> = {
  spaces: "Spaces Agent",
  bitbucket: "Bitbucket Agent",
  grafana: "Grafana Agent",
  deepwiki: "DeepWiki Agent",
  context7: "Context7 Agent",
};

/* =================================================================== */
/*  MAIN COMPONENT                                                      */
/* =================================================================== */

export function SettingsPageV3() {
  const auth = useAuth();

  const [creds, setCreds] = useState<ProviderCredential[]>([]);
  const [routing, setRouting] = useState<SubagentRouting[]>([]);
  const [subagents, setSubagents] = useState<string[]>([
    "spaces",
    "bitbucket",
    "grafana",
    "deepwiki",
    "context7",
  ]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async () => {
    if (auth.status !== "authenticated") return;
    setLoading(true);
    try {
      const [c, r, available] = await Promise.all([
        listProviderCredentials(auth.user.id),
        listSubagentRouting(auth.user.id),
        getAvailableTools().catch(() => null),
      ]);
      setCreds(c);
      setRouting(r);
      if (available?.subagents && available.subagents.length > 0) {
        setSubagents(available.subagents.map((s) => s.name));
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }, [auth.status, auth.status === "authenticated" ? auth.user.id : "", refreshKey]);

  useEffect(() => {
    load();
  }, [load]);

  const credMap = new Map(creds.map((c) => [c.provider, c]));
  const routingMap = new Map(routing.map((r) => [r.subagentName, r.provider]));

  const connectedProviders = Array.from(credMap.values()).filter((c) => c.hasApiKey);
  const defaultProvider = connectedProviders[0]?.provider ?? null;

  const availableProvidersForSelect = [
    { value: "default", label: "Uses Main Agent Model" },
    ...connectedProviders.map((c) => ({
      value: c.provider,
      label: PROVIDER_META[c.provider]?.name ?? c.provider,
    })),
  ];

  if (auth.status === "loading") {
    return (
      <PageLayout
        header={<PageHeader title="Settings" />}
        body={
          <div className="flex flex-1 items-center justify-center">
            <SpinnerGapIcon size={24} className="animate-spin text-xyne-fg-muted" />
          </div>
        }
      />
    );
  }

  return (
    <PageLayout
      header={<PageHeader title="Settings" description="Configure AI providers and agent model assignments" />}
      body={
        <div className="space-y-8 max-w-[860px] mx-auto w-full px-[20px]">
          {error && (
            <div className="rounded-lg border border-xyne-error-border bg-xyne-error-bg px-4 py-3 text-[13px] text-xyne-error-fg">
              {error}
            </div>
          )}

          <AIProvidersSection
            credentials={creds}
            defaultProvider={defaultProvider}
            loading={loading}
            userId={auth.status === "authenticated" ? auth.user.id : ""}
            onMutate={() => setRefreshKey((k) => k + 1)}
            onError={(msg) => setError(msg)}
          />

          <AgentAssignmentSection
            subagents={subagents}
            routingMap={routingMap}
            defaultProvider={defaultProvider}
            availableProviders={availableProvidersForSelect}
            providerMeta={PROVIDER_META}
            loading={loading}
            saving={saving}
            userId={auth.status === "authenticated" ? auth.user.id : ""}
            onMutate={() => setRefreshKey((k) => k + 1)}
            onError={(msg) => setError(msg)}
            onSaving={(key) => setSaving(key)}
          />

          <AdvancedSettingsSection />
        </div>
      }
    />
  );
}

/* =================================================================== */
/*  AI PROVIDERS SECTION                                                */
/* =================================================================== */

function AIProvidersSection({
  credentials,
  defaultProvider,
  loading,
  userId,
  onMutate,
  onError,
}: {
  credentials: ProviderCredential[];
  defaultProvider: string | null;
  loading: boolean;
  userId: string;
  onMutate: () => void;
  onError: (msg: string) => void;
}) {
  const [activeDialog, setActiveDialog] = useState<string | null>(null);
  const [shareDialog, setShareDialog] = useState<string | null>(null);
  const credMap = new Map(credentials.map((c) => [c.provider, c]));

  return (
    <section>
      <div className="mb-4">
        <div className="flex items-center gap-2">
          <SparkleIcon size={16} className="text-xyne-fg-secondary" />
          <h2 className="text-sm font-[550] text-xyne-fg-primary">AI Providers</h2>
        </div>
        <p className="mt-0.5 text-[13px] text-xyne-fg-muted">Connect AI services your agents can use.</p>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-xl border border-xyne-border bg-xyne-surface-subtle" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {Object.entries(PROVIDER_META).map(([id, meta]) => (
            <ProviderCard
              key={id}
              id={id}
              meta={meta}
              credential={credMap.get(id)}
              isDefault={id === defaultProvider}
              onOpenDialog={() => setActiveDialog(id)}
              onShare={() => setShareDialog(id)}
            />
          ))}
        </div>
      )}

      {activeDialog && (
        <ProviderConfigDialog
          provider={activeDialog}
          userId={userId}
          onClose={() => setActiveDialog(null)}
          onMutate={onMutate}
          onError={onError}
        />
      )}

      {shareDialog && (
        <ShareToAgentsDialog
          provider={shareDialog}
          userId={userId}
          onClose={() => setShareDialog(null)}
          onMutate={onMutate}
        />
      )}
    </section>
  );
}

/* =================================================================== */
/*  SHARE-TO-AGENTS DIALOG                                              */
/* =================================================================== */

/** Promote the user's personal credential into an org-level shared credential
 *  and bind selected agents. One login session serves every bound agent (and
 *  the user), so a single re-connect heals all of them — separate logins of
 *  the same account keep invalidating each other's OAuth sessions. */
function ShareToAgentsDialog({
  provider,
  userId,
  onClose,
  onMutate,
}: {
  provider: string;
  userId: string;
  onClose: () => void;
  onMutate: () => void;
}) {
  const meta = PROVIDER_META[provider];
  const displayName = meta?.name ?? provider;
  const [name, setName] = useState(`${displayName} (shared)`);
  const [agents, setAgents] = useState<AgentLight[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    void listAgents()
      .then((all) => setAgents(all.filter((a) => a.enabled)))
      .catch((e) => setErr(e instanceof Error ? e.message : "Failed to load agents"));
  }, []);

  const submit = async () => {
    if (selected.size === 0) return;
    setBusy(true);
    setErr(null);
    try {
      const { results } = await shareMyProviderCredential(userId, provider, {
        name: name.trim() || undefined,
        agentIds: [...selected],
      });
      const ok = results.filter((r) => r.ok).length;
      const failed = results.filter((r) => !r.ok);
      if (failed.length === 0) {
        setDone(`Shared with ${ok} agent(s).`);
        onMutate();
      } else {
        setErr(`Shared with ${ok}; failed for ${failed.length}: ${failed[0]?.error ?? "error"}`);
        if (ok > 0) onMutate();
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to share credential");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={`Share ${displayName} with agents`}
      description="Selected agents run on this same login. Re-connecting it once fixes every bound agent."
      maxWidth={520}
    >
      {done ? (
        <div className="flex flex-col gap-4">
          <p className="text-[13px] text-xyne-fg-secondary">{done}</p>
          <div className="flex justify-end">
            <Button onClick={onClose}>Close</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-[12px] text-xyne-fg-secondary">
            Shared credential name
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-md border border-xyne-border bg-xyne-surface px-2.5 py-1.5 text-[13px] text-xyne-fg-primary"
              placeholder={`${displayName} (shared)`}
            />
          </label>
          <div className="text-[12px] text-xyne-fg-secondary">Agents to bind</div>
          <div className="max-h-64 overflow-y-auto rounded-lg border border-xyne-border divide-y divide-xyne-border">
            {agents === null ? (
              <div className="px-3 py-4 text-center text-[12px] text-xyne-fg-tertiary">Loading agents…</div>
            ) : agents.length === 0 ? (
              <div className="px-3 py-4 text-center text-[12px] text-xyne-fg-tertiary">No agents available.</div>
            ) : (
              agents.map((a) => (
                <label key={a.id} className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-xyne-surface-sunken">
                  <input
                    type="checkbox"
                    checked={selected.has(a.id)}
                    onChange={(e) => {
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(a.id);
                        else next.delete(a.id);
                        return next;
                      });
                    }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] text-xyne-fg-primary truncate">{a.name}</span>
                    <span className="block text-[11px] text-xyne-fg-tertiary truncate">{a.slug}</span>
                  </span>
                </label>
              ))
            )}
          </div>
          <div className="text-[11px] text-xyne-fg-tertiary">
            You can bind agents you own (admins can bind any). Binding replaces the agent&apos;s own {displayName} credential.
          </div>
          {err && <div className="text-[12px] text-xyne-error-fg">{err}</div>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} disabled={busy || selected.size === 0}>
              {busy ? "Sharing…" : `Share with ${selected.size} agent(s)`}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function ProviderCard({
  id,
  meta,
  credential,
  isDefault,
  onOpenDialog,
  onShare,
}: {
  id: string;
  meta: (typeof PROVIDER_META)[string];
  credential?: ProviderCredential;
  isDefault: boolean;
  onOpenDialog: () => void;
  onShare: () => void;
}) {
  const isConnected = credential?.hasApiKey ?? false;
  const Icon = meta.icon;

  // Only the affirmative "Connected" state shows a badge — the negative
  // "Not connected" was redundant with the "Connect" CTA at the bottom of
  // the card and cluttered the title row.
  const statusConfig = isConnected
    ? { icon: CheckCircleIcon, label: "Connected", variant: "success" as const }
    : null;

  const actionLabel = isConnected ? "Configure" : "Connect";

  return (
    <div
      data-id={`provider-card-${id}`}
      className={`flex flex-col gap-3 rounded-xl border p-4 transition-all ${
        isConnected
          ? "border-xyne-success-border bg-xyne-success-bg/30"
          : "border-xyne-border bg-xyne-surface"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
              isConnected ? "bg-xyne-success/20 text-xyne-success" : "bg-xyne-surface-subtle text-xyne-fg-muted"
            }`}
          >
            <Icon size={20} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-xyne-fg-primary truncate">{meta.name}</h3>
              {isDefault && <Badge label="Default" variant="info" size="sm" as="span" />}
            </div>
            <p className="text-[12px] text-xyne-fg-muted truncate">{meta.description}</p>
          </div>
        </div>

        {statusConfig && (
          <Badge
            label={statusConfig.label}
            variant={statusConfig.variant}
            size="sm"
            as="span"
            dot={isConnected}
          />
        )}
      </div>

      {isConnected && credential?.model && (
        <p className="text-[12px] text-xyne-fg-muted">
          Model: <span className="font-medium text-xyne-fg-secondary">{credential.model}</span>
        </p>
      )}

      <div className="mt-auto flex justify-end gap-2">
        {isConnected && (
          <Button
            size="sm"
            variant="ghost"
            onClick={onShare}
            title="Share this login with selected agents — one session for all of them, one re-connect to fix all of them"
          >
            <ShareNetworkIcon size={14} weight="bold" />
            Share
          </Button>
        )}
        <Button size="sm" variant={isConnected ? "secondary" : "primary"} onClick={onOpenDialog}>
          {actionLabel}
        </Button>
      </div>
    </div>
  );
}

/* =================================================================== */
/*  PROVIDER CONFIG DIALOG                                              */
/* =================================================================== */

function ProviderConfigDialog({
  provider,
  userId,
  onClose,
  onMutate,
  onError,
}: {
  provider: string;
  userId: string;
  onClose: () => void;
  onMutate: () => void;
  onError: (msg: string) => void;
}) {
  const meta = PROVIDER_META[provider];

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={meta?.name ?? provider}
      description={meta?.description}
      maxWidth={520}
    >
      {provider === "copilot" ? (
        <CopilotConfigForm userId={userId} onMutate={onMutate} onError={onError} onClose={onClose} />
      ) : (
        <GenericProviderConfigForm
          provider={provider}
          userId={userId}
          onMutate={onMutate}
          onError={onError}
          onClose={onClose}
        />
      )}
    </Dialog>
  );
}

/* ── Copilot config (GitHub device-code flow) ──────────────────────── */

function CopilotConfigForm({
  userId,
  onMutate,
  onError,
  onClose,
}: {
  userId: string;
  onMutate: () => void;
  onError: (msg: string) => void;
  onClose: () => void;
}) {
  const [device, setDevice] = useState<GitHubDeviceCode | null>(null);
  const [polling, setPolling] = useState(false);
  const [starting, setStarting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [models, setModels] = useState<Array<{ id: string; name: string }> | null>(null);
  const [modelsErr, setModelsErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const [currentModel, setCurrentModel] = useState<string>("");

  // Load initial state
  useEffect(() => {
    listProviderCredentials(userId)
      .then((creds) => {
        const copilot = creds.find((c) => c.provider === "copilot");
        setHasKey(copilot?.hasApiKey ?? false);
        setCurrentModel(copilot?.model ?? "");
      })
      .catch(() => {});
  }, [userId]);

  // Fetch models when connected
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
            onMutate();
            onClose();
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
    return () => {
      cancelled = true;
    };
  }, [polling, device, userId, onMutate, onClose]);

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

  const handleModelChange = async (model: string) => {
    setSaving(true);
    try {
      await upsertProviderCredential(userId, "copilot", { model });
      onMutate();
      setCurrentModel(model);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async () => {
    setSaving(true);
    try {
      await deleteProviderCredential(userId, "copilot");
      onMutate();
      onClose();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Disconnect failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {!hasKey && !device && (
        <div className="flex flex-col gap-3">
          <p className="text-[13px] text-xyne-fg-muted">
            Connect your GitHub account to use Copilot-powered code suggestions across all agents.
          </p>
          <Button onClick={startLogin} disabled={starting} leadingIcon={<PlugIcon size={14} />}>
            {starting ? "Starting…" : "Log in with GitHub"}
          </Button>
        </div>
      )}

      {hasKey && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2 text-[13px] text-xyne-success-fg">
            <CheckCircleIcon size={16} />
            <span>Connected via GitHub</span>
          </div>

          {models && models.length > 0 && (
            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-xyne-fg-secondary">Model</label>
              <SelectField
                value={currentModel}
                onValueChange={(v) => v && handleModelChange(v)}
                options={models.map((m) => ({ value: m.id, label: m.name }))}
                disabled={saving}
              />
            </div>
          )}
          {modelsErr && <p className="text-[12px] text-xyne-warning-fg">{modelsErr}</p>}

          <div className="flex gap-2">
            <Button variant="secondary" onClick={startLogin} disabled={starting || saving}>
              Reconnect
            </Button>
            <Button variant="destructive" onClick={handleDisconnect} disabled={saving}>
              Disconnect
            </Button>
          </div>
        </div>
      )}

      {device && (
        <div className="flex flex-col gap-3 rounded-lg border border-xyne-border bg-xyne-surface-subtle p-4">
          <p className="text-[13px] text-xyne-fg-muted">Enter this code on GitHub to authorize:</p>
          <div className="flex items-center gap-2">
            <code className="rounded-md bg-xyne-surface px-3 py-2 font-mono text-lg tracking-widest text-xyne-fg-primary">
              {device.userCode}
            </code>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => navigator.clipboard.writeText(device.userCode)}
              leadingIcon={<CopyIcon size={14} />}
            />
          </div>
          <p className="text-[12px] text-xyne-fg-muted">
            Opens at{" "}
            <a href={device.verificationUri} target="_blank" rel="noreferrer" className="underline">
              {device.verificationUri}
            </a>
          </p>
          {polling && (
            <div className="flex items-center gap-2 text-[12px] text-xyne-fg-muted">
              <SpinnerGapIcon size={14} className="animate-spin" />
              Waiting for authorization…
            </div>
          )}
        </div>
      )}

      {err && <p className="text-[13px] text-xyne-error-fg">{err}</p>}
    </div>
  );
}

/* ── Generic provider config (Claude + Codex + LiteLLM) ─────────────── */

function GenericProviderConfigForm({
  provider,
  userId,
  onMutate,
  onError,
  onClose,
}: {
  provider: string;
  userId: string;
  onMutate: () => void;
  onError: (msg: string) => void;
  onClose: () => void;
}) {
  const isClaude = provider === "claude";
  const isCodex = provider === "codex";
  const isLitellm = provider === "litellm";
  const supportsOauth = isClaude || isCodex;

  const [existing, setExisting] = useState<ProviderCredential | undefined>();
  const [apiKey, setApiKey] = useState("");
  const [authType, setAuthType] = useState<"api_key" | "oauth_token">("api_key");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [reasoningEffort, setReasoningEffort] = useState<"low" | "medium" | "high">("medium");
  const [models, setModels] = useState<ClaudeModelInfo[] | null>(null);
  const [modelsErr, setModelsErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Codex OAuth flow state
  const [codexFlow, setCodexFlow] = useState<{ url: string; state: string } | null>(null);
  const [codexCode, setCodexCode] = useState("");
  const [codexBusy, setCodexBusy] = useState(false);

  // Load existing credential
  useEffect(() => {
    listProviderCredentials(userId)
      .then((creds) => {
        const cred = creds.find((c) => c.provider === provider);
        setExisting(cred);
        if (cred) {
          setModel(cred.model ?? (isClaude ? "claude-sonnet-4-5" : isLitellm ? "private-large" : "gpt-4.1"));
          setBaseUrl(cred.baseUrl ?? (isClaude ? "https://api.anthropic.com" : isLitellm ? "" : "https://api.openai.com/v1"));
          setAuthType(cred.authType === "oauth_token" ? "oauth_token" : "api_key");
          if (cred.reasoningEffort === "low" || cred.reasoningEffort === "medium" || cred.reasoningEffort === "high") {
            setReasoningEffort(cred.reasoningEffort);
          }
        } else {
          setModel(isClaude ? "claude-sonnet-4-5" : isLitellm ? "private-large" : "gpt-4.1");
          setBaseUrl(isClaude ? "https://api.anthropic.com" : isLitellm ? "" : "https://api.openai.com/v1");
        }
      })
      .catch(() => {});
  }, [provider, userId, isClaude, isLitellm]);

  // Fetch models when connected. LiteLLM additionally supports a just-typed key
  // so the user can pick from the Grid/LiteLLM allow-list before saving.
  useEffect(() => {
    const typedKey = apiKey.trim();
    const typedBase = baseUrl.trim();
    if (!isLitellm && !existing?.hasApiKey) return;
    if (isLitellm && !typedKey && !existing?.hasApiKey) return;

    let cancelled = false;
    setModelsErr(null);
    const t = setTimeout(() => {
      const promise = isLitellm
        ? listLitellmModelsForUser(userId, typedKey ? { apiKey: typedKey, ...(typedBase ? { baseUrl: typedBase } : {}) } : (typedBase ? { baseUrl: typedBase } : undefined))
        : (isClaude ? listClaudeModelsForUser : listCodexModelsForUser)(userId);

      promise
        .then((rows) => {
          if (cancelled) return;
          setModels(
            rows.map((r) => ({
              id: r.id,
              displayName: (r as { name?: string; displayName?: string }).displayName ?? (r as { name?: string }).name ?? r.id,
            })),
          );
        })
        .catch((e) => {
          if (cancelled) return;
          setModels(null);
          setModelsErr(e instanceof Error ? e.message : "Failed to load models");
        });
    }, isLitellm ? 400 : 0);

    return () => { cancelled = true; clearTimeout(t); };
  }, [provider, existing?.hasApiKey, userId, isClaude, isLitellm, apiKey, baseUrl]);

  const hasKey = existing?.hasApiKey ?? false;
  const isOauth = authType === "oauth_token";

  const handleSave = async () => {
    const payload: {
      apiKey?: string;
      model?: string;
      baseUrl?: string;
      authType?: "api_key" | "oauth_token";
      reasoningEffort?: "low" | "medium" | "high";
    } = { model, baseUrl, reasoningEffort };
    if (supportsOauth) payload.authType = authType;
    if (apiKey) payload.apiKey = apiKey;
    else if (!hasKey) {
      setErr("API key is required");
      return;
    }

    setSaving(true);
    setErr(null);
    try {
      await upsertProviderCredential(userId, provider, payload);
      onMutate();
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Save failed";
      setErr(msg);
      onError(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteProviderCredential(userId, provider);
      onMutate();
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Delete failed";
      setErr(msg);
      onError(msg);
    } finally {
      setDeleting(false);
    }
  };

  const startCodexOAuth = async () => {
    setCodexBusy(true);
    setErr(null);
    try {
      const flow = await startCodexOauth(userId);
      setCodexFlow({ url: flow.url, state: flow.state });
      window.open(flow.url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to start sign-in");
    } finally {
      setCodexBusy(false);
    }
  };

  const completeCodexOAuth = async () => {
    setCodexBusy(true);
    setErr(null);
    try {
      await exchangeCodexOauth(userId, { code: codexCode.trim(), state: codexFlow!.state });
      setCodexFlow(null);
      setCodexCode("");
      onMutate();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Sign-in failed");
    } finally {
      setCodexBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {hasKey && (
        <div className="flex items-center gap-2 text-[13px] text-xyne-success-fg">
          <CheckCircleIcon size={16} />
          <span>Connected</span>
        </div>
      )}

      {supportsOauth && (
        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-xyne-fg-secondary">Auth method</label>
          <div className="grid grid-cols-2 gap-2">
            <AuthMethodOption
              label="API Key"
              sublabel={isClaude ? "Usage-based, Console key" : "Usage-based, Platform key"}
              selected={authType === "api_key"}
              onSelect={() => setAuthType("api_key")}
            />
            <AuthMethodOption
              label={isClaude ? "OAuth Token" : "ChatGPT OAuth Token"}
              sublabel={isClaude ? "Pro/Max subscription" : "ChatGPT Plus/Pro subscription"}
              selected={authType === "oauth_token"}
              onSelect={() => setAuthType("oauth_token")}
            />
          </div>

          {isOauth && isClaude && (
            <p className="mt-2 rounded-lg border border-xyne-info-border bg-xyne-info-bg px-3 py-2 text-[12px] text-xyne-info-fg">
              Run <code className="rounded bg-xyne-surface px-1">claude setup-token</code> on any machine with
              Claude Code installed. Paste the resulting token below.
            </p>
          )}

          {isOauth && isCodex && (
            <div className="mt-2 flex flex-col gap-2 rounded-lg border border-xyne-info-border bg-xyne-info-bg px-3 py-2.5 text-[12px] text-xyne-info-fg">
              {!codexFlow ? (
                <Button size="sm" onClick={startCodexOAuth} disabled={codexBusy}>
                  {codexBusy ? "Opening…" : "Sign in with ChatGPT"}
                </Button>
              ) : (
                <>
                  <p>
                    Paste the code from the OpenAI page below.{" "}
                    <a href={codexFlow.url} target="_blank" rel="noopener noreferrer" className="underline">
                      Re-open tab
                    </a>
                  </p>
                  <TextField
                    value={codexCode}
                    onChange={(e) => setCodexCode(e.target.value)}
                    placeholder="Paste code or callback URL"
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={completeCodexOAuth} disabled={codexBusy || !codexCode.trim()}>
                      {codexBusy ? "Verifying…" : "Complete sign-in"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setCodexFlow(null);
                        setCodexCode("");
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {(!isOauth || isClaude) && (
        <TextField
          type="password"
          label={isOauth ? (isClaude ? "OAuth Token" : "ChatGPT OAuth Token") : "API Key"}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={hasKey ? "••••••••" : isLitellm ? "JUSPAY_GRID_API_KEY" : "sk-…"}
          hint={hasKey ? "Leave blank to keep current" : undefined}
        />
      )}

      <div>
        <label className="mb-1.5 block text-[12px] font-medium text-xyne-fg-secondary">Model</label>
        {models && models.length > 0 ? (
          <SelectField
            value={model}
            onValueChange={(v) => v && setModel(v)}
            options={models.map((m) => ({ value: m.id, label: m.displayName }))}
          />
        ) : (
          <TextField value={model} onChange={(e) => setModel(e.target.value)} />
        )}
        {modelsErr && <p className="mt-1 text-[11px] text-xyne-warning-fg">Couldn&apos;t fetch models — {modelsErr}</p>}
      </div>

      <TextField
        label="Base URL"
        value={baseUrl}
        onChange={(e) => setBaseUrl(e.target.value)}
        placeholder={isLitellm ? "blank = https://grid.ai.juspay.net" : undefined}
      />

      <div>
        <label className="mb-1.5 block text-[12px] font-medium text-xyne-fg-secondary">
          Reasoning Effort
        </label>
        <SelectField
          value={reasoningEffort}
          onValueChange={(v) => {
            if (v === "low" || v === "medium" || v === "high") setReasoningEffort(v);
          }}
          options={[
            { value: "low", label: "Low — fastest, minimal think time" },
            { value: "medium", label: "Medium — balanced (default)" },
            { value: "high", label: "High — deepest reasoning, slowest" },
          ]}
        />
        <p className="mt-1 text-[11px] text-xyne-fg-secondary">
          Only applies to reasoning-capable models (e.g. gpt-5.x, codex). Lower = faster per-turn responses.
        </p>
      </div>

      {err && <p className="text-[13px] text-xyne-error-fg">{err}</p>}

      <div className="flex items-center justify-end gap-2 pt-2">
        {hasKey && (
          <Button variant="ghost" onClick={handleDelete} disabled={deleting || saving}>
            {deleting ? "Removing…" : "Remove"}
          </Button>
        )}
        <Button onClick={handleSave} disabled={saving || (!apiKey && !hasKey)}>
          {saving ? "Saving…" : hasKey ? "Save changes" : "Connect"}
        </Button>
      </div>
    </div>
  );
}

function AuthMethodOption({
  label,
  sublabel,
  selected,
  onSelect,
}: {
  label: string;
  sublabel: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex flex-col gap-0.5 rounded-lg border px-3 py-2.5 text-left transition-all ${
        selected
          ? "border-xyne-fg-secondary bg-xyne-surface-subtle ring-1 ring-xyne-border-focus"
          : "border-xyne-border bg-xyne-surface hover:border-xyne-border-strong"
      }`}
    >
      <span className="text-[13px] font-medium text-xyne-fg-primary">{label}</span>
      <span className="text-[11px] text-xyne-fg-muted">{sublabel}</span>
    </button>
  );
}

/* =================================================================== */
/*  AGENT ASSIGNMENT SECTION                                            */
/* =================================================================== */

function AgentAssignmentSection({
  subagents,
  routingMap,
  defaultProvider,
  availableProviders,
  providerMeta,
  loading,
  saving,
  userId,
  onMutate,
  onError,
  onSaving,
}: {
  subagents: string[];
  routingMap: Map<string, string>;
  defaultProvider: string | null;
  availableProviders: Array<{ value: string; label: string }>;
  providerMeta: typeof PROVIDER_META;
  loading: boolean;
  saving: string | null;
  userId: string;
  onMutate: () => void;
  onError: (msg: string) => void;
  onSaving: (key: string | null) => void;
}) {
  return (
    <section>
      <div className="mb-4">
        <div className="flex items-center gap-2">
          <RobotIcon size={16} className="text-xyne-fg-secondary" />
          <h2 className="text-sm font-[550] text-xyne-fg-primary">Agent Model Assignment</h2>
        </div>
        <p className="mt-0.5 text-[13px] text-xyne-fg-muted">Choose which AI model powers specific agents.</p>
      </div>

      {loading ? (
        <div className="divide-y divide-xyne-border rounded-xl border border-xyne-border bg-xyne-surface">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center justify-between gap-4 px-4 py-3.5">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 animate-pulse rounded-md bg-xyne-surface-subtle" />
                <div className="space-y-1.5">
                  <div className="h-4 w-32 animate-pulse rounded bg-xyne-surface-subtle" />
                  <div className="h-3 w-48 animate-pulse rounded bg-xyne-surface-subtle" />
                </div>
              </div>
              <div className="h-8 w-40 animate-pulse rounded bg-xyne-surface-subtle" />
            </div>
          ))}
        </div>
      ) : (
        <div className="divide-y divide-xyne-border rounded-xl border border-xyne-border bg-xyne-surface">
          {subagents.map((name) => {
            const current = routingMap.get(name) ?? "default";
            return (
              <AgentAssignmentRow
                key={name}
                name={name}
                displayName={SUBAGENT_NAMES[name] ?? `${name.charAt(0).toUpperCase() + name.slice(1)} Agent`}
                currentProvider={current}
                defaultProviderName={defaultProvider ? providerMeta[defaultProvider]?.name ?? defaultProvider : null}
                availableProviders={availableProviders}
                providerMeta={providerMeta}
                disabled={saving === `sa:${name}`}
                onChange={async (provider) => {
                  onSaving(`sa:${name}`);
                  try {
                    if (provider === "default") {
                      await deleteSubagentRouting(userId, name);
                    } else {
                      await upsertSubagentRouting(userId, name, provider);
                    }
                    onMutate();
                  } catch (err) {
                    onError(err instanceof Error ? err.message : "Save failed");
                  } finally {
                    onSaving(null);
                  }
                }}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

function AgentAssignmentRow({
  name,
  displayName,
  currentProvider,
  defaultProviderName,
  availableProviders,
  providerMeta,
  disabled,
  onChange,
}: {
  name: string;
  displayName: string;
  currentProvider: string;
  defaultProviderName: string | null;
  availableProviders: Array<{ value: string; label: string }>;
  providerMeta: typeof PROVIDER_META;
  disabled: boolean;
  onChange: (provider: string) => void;
}) {
  const isInherited = currentProvider === "default";
  const selectedProvider = isInherited ? null : providerMeta[currentProvider];

  return (
    <div
      data-id={`agent-row-${name}`}
      className={`flex items-center justify-between gap-4 px-4 py-3.5 transition-colors ${
        isInherited ? "bg-transparent" : "bg-xyne-brand-ghost/30"
      }`}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-xyne-surface-subtle text-xyne-fg-muted">
          <RobotIcon size={16} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-xyne-fg-primary truncate">{displayName}</p>
          {isInherited && defaultProviderName && (
            <p className="flex items-center gap-1 text-[12px] text-xyne-fg-muted">
              <ArrowRightIcon size={12} />
              Inherited from Main Agent
              <span className="font-medium text-xyne-fg-secondary">({defaultProviderName})</span>
            </p>
          )}
          {!isInherited && selectedProvider && (
            <p className="flex items-center gap-1 text-[12px] text-xyne-brand">
              <CheckCircleIcon size={12} />
              Uses <span className="font-medium">{selectedProvider.name}</span>
            </p>
          )}
          {isInherited && !defaultProviderName && (
            <p className="text-[12px] text-xyne-fg-muted">No default provider connected</p>
          )}
        </div>
      </div>

      {/* Base UI Select — non-searchable, fully styleable dropdown.
          Earlier attempts:
            1. SelectField → searchable Combobox with "No results" state,
               unnecessary friction for a fixed 3–4 option list.
            2. Native <select> → opens with OS-themed option list which
               we can't style (Safari's pink highlight, Chrome's blue, etc).
          Base UI Select renders its own popup, so the option list inherits
          our design tokens and matches the rest of the V3 surface. */}
      <div className="w-52 shrink-0">
        <Select.Root
          value={currentProvider}
          onValueChange={(v) => { if (v) onChange(v); }}
          disabled={disabled}
        >
          <Select.Trigger
            className={cn(
              "flex h-9 w-full items-center justify-between gap-2",
              "rounded-[var(--comp-input-radius)] border border-xyne-border bg-xyne-surface",
              "px-3 text-[13px] text-xyne-fg-primary",
              "transition-[border-color] duration-[var(--comp-duration-normal)] ease-in",
              "hover:border-xyne-border-strong",
              "data-[popup-open]:border-xyne-border-focus",
              "focus-visible:outline-none focus-visible:border-xyne-border-focus",
              "disabled:cursor-not-allowed disabled:opacity-60",
            )}
          >
            <Select.Value className="truncate text-left" />
            <Select.Icon className="shrink-0 text-xyne-fg-muted data-[popup-open]:rotate-180 transition-transform duration-[var(--comp-duration-normal)]">
              <ChevronDown size={14} />
            </Select.Icon>
          </Select.Trigger>
          <Select.Portal>
            <Select.Positioner
              side="bottom"
              sideOffset={4}
              alignItemWithTrigger={false}
              className="z-[350] w-[var(--anchor-width)]"
            >
              <Select.Popup
                className={cn(
                  "w-full overflow-hidden",
                  "rounded-xl border border-xyne-border bg-xyne-surface",
                  "shadow-[var(--comp-shadow-lg)]",
                  "origin-[var(--transform-origin)]",
                  "transition-[transform,opacity] duration-[var(--comp-duration-normal)]",
                  "data-[ending-style]:opacity-0 data-[ending-style]:scale-95",
                  "data-[starting-style]:opacity-0 data-[starting-style]:scale-95",
                )}
              >
                <div className="max-h-56 overflow-y-auto py-1">
                  {availableProviders.map((opt) => (
                    <Select.Item
                      key={opt.value}
                      value={opt.value}
                      className={cn(
                        "flex cursor-pointer items-center gap-2 px-3 py-1.5",
                        "text-[13px] text-xyne-fg-primary outline-none",
                        "data-[highlighted]:bg-xyne-surface-subtle",
                        "data-[selected]:font-medium",
                        "transition-colors duration-75",
                      )}
                    >
                      <Select.ItemIndicator className="w-3.5 shrink-0">
                        <Check size={12} className="text-xyne-fg-primary" />
                      </Select.ItemIndicator>
                      <Select.ItemText className="flex-1 truncate">{opt.label}</Select.ItemText>
                    </Select.Item>
                  ))}
                </div>
              </Select.Popup>
            </Select.Positioner>
          </Select.Portal>
        </Select.Root>
      </div>
    </div>
  );
}

/* =================================================================== */
/*  ADVANCED SETTINGS SECTION                                           */
/* =================================================================== */

function AdvancedSettingsSection() {
  const [expanded, setExpanded] = useState(false);

  return (
    <section>
      <div className="mb-4">
        <div className="flex items-center gap-2">
          <GearSixIcon size={16} className="text-xyne-fg-secondary" />
          <h2 className="text-sm font-[550] text-xyne-fg-primary">Advanced Settings</h2>
        </div>
        <p className="mt-0.5 text-[13px] text-xyne-fg-muted">
          Execution limits, fallback providers, sandbox settings, and more.
        </p>
      </div>

      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center justify-between gap-3 rounded-xl border border-xyne-border bg-xyne-surface px-4 py-3 text-left transition-colors hover:bg-xyne-surface-subtle"
      >
        <div>
          <p className="text-sm font-medium text-xyne-fg-primary">Advanced options</p>
          <p className="text-[12px] text-xyne-fg-muted">
            Execution limits, approval rules, fallback providers, sandbox settings, token priority
          </p>
        </div>
        <CaretRightIcon
          size={16}
          className={`shrink-0 text-xyne-fg-muted transition-transform ${expanded ? "rotate-90" : ""}`}
        />
      </button>

      {expanded && (
        <div className="mt-3 rounded-xl border border-xyne-border bg-xyne-surface p-6">
          <p className="text-[13px] text-xyne-fg-muted">Advanced settings will be available in a future release.</p>
          <div className="mt-4 grid grid-cols-2 gap-3 opacity-50 lg:grid-cols-3">
            {["Execution Limits", "Approval Rules", "Fallback Providers", "Sandbox Settings", "Token Priority"].map(
              (label) => (
                <div
                  key={label}
                  className="flex items-center justify-center rounded-lg border border-dashed border-xyne-border bg-xyne-surface-subtle px-4 py-3 text-center"
                >
                  <p className="text-[11px] font-medium text-xyne-fg-muted">{label}</p>
                </div>
              ),
            )}
          </div>
        </div>
      )}
    </section>
  );
}
