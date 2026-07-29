import { useState, useCallback, useEffect, useMemo } from "react";
import type { UserConnection, HealthResult } from "../lib/types";
import {
  checkConnectionHealth,
  autoConnectSpaces,
  connectGoogle,
  connectMicrosoft,
  connectCalendly,
  connectJotForm,
  connectDocuSign,
  connectEgnyte,
  connectMiro,
  connectWebflow,
  connectWix,
  connectAttio,
  connectMailerLite,
  connectHoneycomb,
  connectCustomerio,
  connectLinkedInRapidApi,
  requestServerPublish,
} from "../lib/api";
import { withAdminRequestAlert } from "../lib/admin-request-notice";

interface Props {
  connections: UserConnection[];
  loading: boolean;
  userId: string;
  onDelete: (id: string) => void;
  onEdit: (connection: UserConnection) => void;
  onEditDefinition: (connection: UserConnection) => void;
  onUpdate: () => void;
}

/**
 * One row in the OAuth provider catalog. Adding a new OAuth tile is now a
 * single entry here (plus a `connect*` helper in `lib/api.ts`).
 *
 * Tailwind classes are inlined as literal strings so the JIT can pick them up.
 */
interface OAuthProvider {
  type: string;
  name: string;
  description: string;
  border: string;
  bg: string;
  text: string;
  subtext: string;
  button: string;
  connect: (userId: string) => Promise<string>;
}

const OAUTH_PROVIDERS: readonly OAuthProvider[] = [
  {
    type: "google",
    name: "Google",
    description: "Connect to enable Gmail, Calendar, Contacts, Tasks & Drive tools",
    border: "border-emerald-800/50",
    bg: "bg-emerald-950/30",
    text: "text-emerald-300",
    subtext: "text-emerald-400/70",
    button: "bg-emerald-600 hover:bg-emerald-500",
    connect: connectGoogle,
  },
  {
    type: "microsoft",
    name: "Microsoft",
    description: "Connect to enable Outlook, Calendar, To Do, OneDrive & Teams tools",
    border: "border-sky-800/50",
    bg: "bg-sky-950/30",
    text: "text-sky-300",
    subtext: "text-sky-400/70",
    button: "bg-sky-600 hover:bg-sky-500",
    connect: connectMicrosoft,
  },
  {
    type: "calendly",
    name: "Calendly",
    description: "Connect to manage event types, availability & bookings",
    border: "border-orange-800/50",
    bg: "bg-orange-950/30",
    text: "text-orange-300",
    subtext: "text-orange-400/70",
    button: "bg-orange-600 hover:bg-orange-500",
    connect: connectCalendly,
  },
  {
    type: "jotform",
    name: "JotForm",
    description: "Connect to build forms, capture submissions & manage your workspace",
    border: "border-violet-800/50",
    bg: "bg-violet-950/30",
    text: "text-violet-300",
    subtext: "text-violet-400/70",
    button: "bg-violet-600 hover:bg-violet-500",
    connect: connectJotForm,
  },
  {
    type: "docusign",
    name: "DocuSign",
    description: "Connect to send, sign, and manage documents and contracts",
    border: "border-indigo-800/50",
    bg: "bg-indigo-950/30",
    text: "text-indigo-300",
    subtext: "text-indigo-400/70",
    button: "bg-indigo-600 hover:bg-indigo-500",
    connect: connectDocuSign,
  },
  {
    type: "egnyte",
    name: "Egnyte",
    description: "Connect to search, manage, and collaborate on your Egnyte files",
    border: "border-red-800/50",
    bg: "bg-red-950/30",
    text: "text-red-300",
    subtext: "text-red-400/70",
    button: "bg-red-600 hover:bg-red-500",
    connect: connectEgnyte,
  },
  {
    type: "miro",
    name: "Miro",
    description: "Connect to generate diagrams, read board context, and create documents on Miro boards",
    border: "border-yellow-800/50",
    bg: "bg-yellow-950/30",
    text: "text-yellow-300",
    subtext: "text-yellow-400/70",
    button: "bg-yellow-600 hover:bg-yellow-500",
    connect: connectMiro,
  },
  {
    type: "webflow",
    name: "Webflow",
    description: "Connect to manage Webflow sites, CMS collections, pages, assets, and publish content",
    border: "border-blue-800/50",
    bg: "bg-blue-950/30",
    text: "text-blue-300",
    subtext: "text-blue-400/70",
    button: "bg-blue-600 hover:bg-blue-500",
    connect: connectWebflow,
  },
  {
    type: "wix",
    name: "Wix",
    description: "Connect to manage Wix sites, products, orders, and content",
    border: "border-cyan-800/50",
    bg: "bg-cyan-950/30",
    text: "text-cyan-300",
    subtext: "text-cyan-400/70",
    button: "bg-cyan-600 hover:bg-cyan-500",
    connect: connectWix,
  },
  {
    type: "attio",
    name: "Attio",
    description: "Connect to manage CRM records, contacts, companies, deals, tasks, and notes",
    border: "border-purple-800/50",
    bg: "bg-purple-950/30",
    text: "text-purple-300",
    subtext: "text-purple-400/70",
    button: "bg-purple-600 hover:bg-purple-500",
    connect: connectAttio,
  },
  {
    type: "mailerlite",
    name: "MailerLite",
    description: "Connect to manage email campaigns, subscribers, groups, automations, and forms",
    border: "border-rose-800/50",
    bg: "bg-rose-950/30",
    text: "text-rose-300",
    subtext: "text-rose-400/70",
    button: "bg-rose-600 hover:bg-rose-500",
    connect: connectMailerLite,
  },
  {
    type: "honeycomb",
    name: "Honeycomb",
    description: "Connect to query traces, investigate anomalies, and monitor SLOs & Triggers",
    border: "border-yellow-800/50",
    bg: "bg-yellow-950/30",
    text: "text-yellow-300",
    subtext: "text-yellow-400/70",
    button: "bg-yellow-600 hover:bg-yellow-500",
    connect: connectHoneycomb,
  },
  {
    type: "customerio",
    name: "Customer.io",
    description: "Connect to generate segments, inspect customer profiles, search your workspace, and analyze campaigns",
    border: "border-teal-800/50",
    bg: "bg-teal-950/30",
    text: "text-teal-300",
    subtext: "text-teal-400/70",
    button: "bg-teal-600 hover:bg-teal-500",
    connect: connectCustomerio,
  }
] as const;

// ── API-key providers ─────────────────────────────────────────────────────

/**
 * Providers that authenticate with a static API key entered by the user,
 * rather than an OAuth redirect flow.
 */
interface ApiKeyProvider {
  type: string;
  name: string;
  description: string;
  keyLabel: string;
  keyPlaceholder: string;
  keyHelp: string;
  border: string;
  bg: string;
  text: string;
  subtext: string;
  button: string;
  connect: (userId: string, apiKey: string) => Promise<void>;
}

const API_KEY_PROVIDERS: readonly ApiKeyProvider[] = [
  {
    type: "rapidapi-linkedin",
    name: "LinkedIn (RapidAPI)",
    description: "Fetch profiles, companies, employees, posts and search people via Fresh LinkedIn Profile Data",
    keyLabel: "X-RapidAPI-Key",
    keyPlaceholder: "your-rapidapi-key",
    keyHelp: "Get your key at rapidapi.com → Fresh LinkedIn Profile Data",
    border: "border-blue-800/50",
    bg: "bg-blue-950/30",
    text: "text-blue-300",
    subtext: "text-blue-400/70",
    button: "bg-blue-600 hover:bg-blue-500",
    connect: connectLinkedInRapidApi,
  },
] as const;

interface ProviderUiState {
  connecting?: boolean;
  success?: boolean;
  error?: string | null;
}

interface ApiKeyUiState {
  open?: boolean;
  connecting?: boolean;
  success?: boolean;
  error?: string | null;
}

function ApiKeyConnectCard({
  provider,
  state,
  onConnect,
}: {
  provider: ApiKeyProvider;
  state: ApiKeyUiState | undefined;
  onConnect: (provider: ApiKeyProvider, apiKey: string) => void;
}) {
  const [inputValue, setInputValue] = useState("");
  const isOpen = !!state?.open;

  if (state?.success) {
    return (
      <div className="rounded-lg border border-green-800/50 bg-green-950/30 px-4 py-3 text-sm text-green-300">
        {provider.name} connected successfully!
      </div>
    );
  }

  return (
    <div className={`rounded-lg border ${provider.border} ${provider.bg} p-4`}>
      <div className="flex items-center justify-between">
        <div>
          <p className={`text-sm font-medium ${provider.text}`}>{provider.name} not connected</p>
          <p className={`text-xs ${provider.subtext}`}>{provider.description}</p>
        </div>
        <button
          onClick={() => onConnect(provider, /* sentinel */ "__toggle__")}
          disabled={!!state?.connecting}
          className={`rounded-md ${provider.button} px-4 py-2 text-sm font-medium text-white transition disabled:opacity-50 shrink-0 ml-4`}
        >
          {state?.connecting ? "Connecting…" : `Connect ${provider.name}`}
        </button>
      </div>

      {isOpen && (
        <div className="mt-3 space-y-2">
          <label className={`block text-xs font-medium ${provider.text}`}>
            {provider.keyLabel}
          </label>
          <input
            type="password"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={provider.keyPlaceholder}
            autoComplete="off"
            className="w-full rounded-md border border-zinc-600 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-400"
          />
          <p className={`text-xs ${provider.subtext}`}>{provider.keyHelp}</p>
          {state?.error && (
            <p className="text-xs text-red-400">{state.error}</p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={() => {
                setInputValue("");
                onConnect(provider, "__close__");
              }}
              className="rounded-md border border-zinc-600 px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                if (inputValue.trim()) onConnect(provider, inputValue.trim());
              }}
              disabled={!inputValue.trim() || !!state?.connecting}
              className={`rounded-md ${provider.button} px-3 py-1.5 text-xs font-medium text-white transition disabled:opacity-50`}
            >
              {state?.connecting ? "Connecting…" : "Connect"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function OAuthBanner({
  state,
  provider,
}: {
  state: ProviderUiState | undefined;
  provider: OAuthProvider;
}) {
  if (state?.success) {
    return (
      <div className="rounded-lg border border-green-800/50 bg-green-950/30 px-4 py-3 text-sm text-green-300">
        {provider.name} account connected successfully!
      </div>
    );
  }
  if (state?.error) {
    return (
      <div className="rounded-lg border border-red-800/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">
        {provider.name} connection failed: {state.error}
      </div>
    );
  }
  return null;
}

function OAuthConnectCard({
  provider,
  connecting,
  onConnect,
}: {
  provider: OAuthProvider;
  connecting: boolean;
  onConnect: (provider: OAuthProvider) => void;
}) {
  return (
    <div className={`rounded-lg border ${provider.border} ${provider.bg} p-4 flex items-center justify-between`}>
      <div>
        <p className={`text-sm font-medium ${provider.text}`}>{provider.name} not connected</p>
        <p className={`text-xs ${provider.subtext}`}>{provider.description}</p>
      </div>
      <button
        onClick={() => onConnect(provider)}
        disabled={connecting}
        className={`rounded-md ${provider.button} px-4 py-2 text-sm font-medium text-white transition disabled:opacity-50`}
      >
        {connecting ? "Redirecting..." : `Connect ${provider.name}`}
      </button>
    </div>
  );
}

export function ConnectionList({ connections, loading, userId, onDelete, onEdit, onEditDefinition, onUpdate }: Props) {
  const [healthStatus, setHealthStatus] = useState<Record<string, HealthResult | "loading">>({});
  const [connectingSpaces, setConnectingSpaces] = useState(false);
  const [providerState, setProviderState] = useState<Record<string, ProviderUiState>>({});
  const [apiKeyState, setApiKeyState] = useState<Record<string, ApiKeyUiState>>({});
  const [oauthExpanded, setOauthExpanded] = useState(false);
  const [connectionsExpanded, setConnectionsExpanded] = useState(false); 

  const hasSpaces = connections.some((c) => c.mcpServer.type === "xyne-spaces");

  const connectedTypes = useMemo(
    () => new Set(connections.map((c) => c.mcpServer.type)),
    [connections],
  );
  const unconnectedProviders = useMemo(
    () => OAUTH_PROVIDERS.filter((p) => !connectedTypes.has(p.type)),
    [connectedTypes],
  );

  const unconnectedApiKeyProviders = useMemo(
    () => API_KEY_PROVIDERS.filter((p) => !connectedTypes.has(p.type)),
    [connectedTypes],
  );

  const setProvider = useCallback((type: string, patch: ProviderUiState) => {
    setProviderState((prev) => ({ ...prev, [type]: { ...prev[type], ...patch } }));
  }, []);

  const setApiKey = useCallback((type: string, patch: ApiKeyUiState) => {
    setApiKeyState((prev) => ({ ...prev, [type]: { ...prev[type], ...patch } }));
  }, []);

  // Read the OAuth callback result out of the URL once on mount. Each provider
  // emits ?<type>_connected=true on success or ?<type>_error=<reason>.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    let touched = false;

    for (const provider of OAUTH_PROVIDERS) {
      if (params.get(`${provider.type}_connected`) === "true") {
        setProvider(provider.type, { success: true, error: null, connecting: false });
        setTimeout(() => setProvider(provider.type, { success: false }), 5000);
        touched = true;
      }
      const err = params.get(`${provider.type}_error`);
      if (err) {
        setProvider(provider.type, { error: err, success: false, connecting: false });
        setTimeout(() => setProvider(provider.type, { error: null }), 8000);
        touched = true;
      }
    }

    if (touched) {
      onUpdate();
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [onUpdate, setProvider]);

  const handleAutoConnect = useCallback(async () => {
    setConnectingSpaces(true);
    try {
      await autoConnectSpaces(userId);
      onUpdate();
    } catch {
      // silently fail
    } finally {
      setConnectingSpaces(false);
    }
  }, [userId, onUpdate]);

  const handleOAuthConnect = useCallback(
    async (provider: OAuthProvider) => {
      setProvider(provider.type, { connecting: true, error: null });
      try {
        const authUrl = await provider.connect(userId);
        window.location.href = authUrl;
      } catch (err) {
        setProvider(provider.type, {
          connecting: false,
          error: err instanceof Error ? err.message : `Failed to start ${provider.name} connection`,
        });
      }
    },
    [userId, setProvider],
  );

  const handleApiKeyConnect = useCallback(
    async (provider: ApiKeyProvider, apiKey: string) => {
      // Sentinel: toggle open/close without submitting.
      if (apiKey === "__toggle__") {
        setApiKey(provider.type, { open: !apiKeyState[provider.type]?.open, error: null });
        return;
      }
      if (apiKey === "__close__") {
        setApiKey(provider.type, { open: false, error: null });
        return;
      }

      setApiKey(provider.type, { connecting: true, error: null });
      try {
        await provider.connect(userId, apiKey);
        setApiKey(provider.type, { connecting: false, success: true, open: false });
        onUpdate();
        setTimeout(() => setApiKey(provider.type, { success: false }), 5000);
      } catch (err) {
        setApiKey(provider.type, {
          connecting: false,
          error: err instanceof Error ? err.message : `Failed to connect ${provider.name}`,
        });
      }
    },
    [userId, setApiKey, apiKeyState, onUpdate],
  );

  const runHealthCheck = useCallback(
    async (connectionId: string) => {
      setHealthStatus((prev) => ({ ...prev, [connectionId]: "loading" }));
      try {
        const result = await checkConnectionHealth(userId, connectionId);
        setHealthStatus((prev) => ({ ...prev, [connectionId]: result }));
      } catch {
        setHealthStatus((prev) => ({
          ...prev,
          [connectionId]: { healthy: false, message: "Health check failed", latencyMs: 0 },
        }));
      }
    },
    [userId],
  );

  if (loading) {
    return <p className="text-sm text-zinc-500">Loading connections…</p>;
  }

  // How many OAuth providers aren't connected yet (excluding Spaces which has its own card)
  const unconnectedCount = unconnectedProviders.length + unconnectedApiKeyProviders.length + (!hasSpaces ? 1 : 0);

  // Banners + collapsible "Connect more services" panel. Shared between empty + non-empty states.
  const tiles = (
    <>
      {/* Success / error banners — always visible */}
      {OAUTH_PROVIDERS.map((p) => (
        <OAuthBanner key={`banner-${p.type}`} provider={p} state={providerState[p.type]} />
      ))}

      {/* Collapsible OAuth panel */}
      {unconnectedCount > 0 && (
        <div className="rounded-lg border border-zinc-700/60 bg-zinc-900">
          <button
            onClick={() => setOauthExpanded((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm text-zinc-300 hover:text-zinc-100 transition"
          >
            <span className="font-medium">
              Connect more services
              <span className="ml-2 rounded-full bg-zinc-700 px-2 py-0.5 text-xs text-zinc-400">
                {unconnectedCount} available
              </span>
            </span>
            <svg
              className={`h-4 w-4 text-zinc-500 transition-transform duration-200 ${oauthExpanded ? "rotate-180" : ""}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {oauthExpanded && (
            <div className="border-t border-zinc-800 px-4 pb-4 pt-3 space-y-3">
              {!hasSpaces && (
                <div className="rounded-lg border border-blue-800/50 bg-blue-950/30 p-4 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-blue-300">Xyne Spaces not connected</p>
                    <p className="text-xs text-blue-400/70">Auto-connect using your current session</p>
                  </div>
                  <button
                    onClick={handleAutoConnect}
                    disabled={connectingSpaces}
                    className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
                  >
                    {connectingSpaces ? 'Connecting...' : 'Connect Spaces'}
                  </button>
                </div>
              )}
              {unconnectedProviders.map((p) => (
                <OAuthConnectCard
                  key={p.type}
                  provider={p}
                  connecting={!!providerState[p.type]?.connecting}
                  onConnect={handleOAuthConnect}
                />
              ))}
              {unconnectedApiKeyProviders.map((p) => (
                <ApiKeyConnectCard
                  key={p.type}
                  provider={p}
                  state={apiKeyState[p.type]}
                  onConnect={handleApiKeyConnect}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );

  if (connections.length === 0) {
    return (
      <div className="space-y-3">
        {tiles}
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-8 text-center">
          <p className="text-zinc-400">No MCP connections configured yet.</p>
          <p className="mt-1 text-sm text-zinc-500">Expand "Connect more services" above to get started.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {tiles}
      <div className="rounded-lg border border-zinc-700/60 bg-zinc-900">
        <button
          onClick={() => setConnectionsExpanded((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-zinc-300 hover:text-zinc-100 transition"
        >
          <span className="font-medium">
            Connected integrations
            <span className="ml-2 rounded-full bg-zinc-700 px-2 py-0.5 text-xs text-zinc-400">
              {connections.length}
            </span>
          </span>
          <svg
            className={`h-4 w-4 text-zinc-500 transition-transform duration-200 ${connectionsExpanded ? "rotate-180" : ""}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {connectionsExpanded && (
          <div className="border-t border-zinc-800 px-4 pb-4 pt-3 space-y-3">
            {connections.map((conn) => {
              const health = healthStatus[conn.id];
              return (
                <div
                  key={conn.id}
                  className="rounded-lg border border-zinc-800 bg-zinc-950 p-4"
                >
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium">{conn.mcpServer.name}</h3>
                        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-400">
                          {conn.mcpServer.type}
                        </span>
                      </div>
                      {conn.mcpServer.description && (
                        <p className="mt-0.5 text-sm text-zinc-500">{conn.mcpServer.description}</p>
                      )}
                      <p className="mt-1 text-xs text-zinc-500">
                        Connected {new Date(conn.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="ml-4 flex shrink-0 items-center gap-2">
                      <button
                        onClick={() => onEdit(conn)}
                        className="rounded-md px-3 py-1.5 text-sm text-zinc-300 transition hover:bg-zinc-800 hover:text-zinc-100"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => onEditDefinition(conn)}
                        className="rounded-md px-3 py-1.5 text-sm text-zinc-300 transition hover:bg-zinc-800 hover:text-zinc-100"
                      >
                        Edit Definition
                      </button>
                      {(() => {
                        const meta = (conn.mcpServer.connectorMeta ?? {}) as {
                          scope?: string;
                          ownerUserId?: string;
                          publishStatus?: 'draft' | 'pending' | 'approved' | 'rejected';
                          publishReviewNote?: string;
                        };
                        const isPersonal = meta.scope === 'personal';
                        const isOwner = meta.ownerUserId === userId;
                        if (!isPersonal || !isOwner) return null;
                        const status = meta.publishStatus ?? 'draft';
                        if (status === 'approved') return null;
                        if (status === 'pending') {
                          return (
                            <span
                              className="rounded-md border border-amber-700/60 px-3 py-1.5 text-sm text-amber-300"
                              title="An admin will review this connector and decide whether to make it global."
                            >
                              Pending review
                            </span>
                          );
                        }
                        const label = status === 'rejected' ? 'Re-request publishing' : 'Request Publishing';
                        return (
                          <button
                            onClick={async () => {
                              const ok = await withAdminRequestAlert(() => requestServerPublish(conn.mcpServerId, userId));
                              if (ok !== undefined) onUpdate();
                            }}
                            className="rounded-md px-3 py-1.5 text-sm text-emerald-300 transition hover:bg-emerald-950 hover:text-emerald-200"
                            title={status === 'rejected' && meta.publishReviewNote ? `Rejected: ${meta.publishReviewNote}` : 'Submit this connector for admin approval to make it global.'}
                          >
                            {label}
                          </button>
                        );
                      })()}
                      <button
                        onClick={() => runHealthCheck(conn.id)}
                        disabled={health === 'loading'}
                        className="rounded-md px-3 py-1.5 text-sm text-zinc-300 transition hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-50"
                      >
                        {health === 'loading' ? 'Checking…' : 'Health Check'}
                      </button>
                      <button
                        onClick={() => onDelete(conn.id)}
                        className="rounded-md px-3 py-1.5 text-sm text-red-400 transition hover:bg-red-950 hover:text-red-300"
                      >
                        Disconnect
                      </button>
                    </div>
                  </div>

                  {health && health !== 'loading' && (
                    <div
                      className={`mt-3 flex items-center gap-2 rounded-md px-3 py-2 text-sm ${
                        health.healthy
                          ? 'border border-green-800/50 bg-green-950/50 text-green-300'
                          : 'border border-red-800/50 bg-red-950/50 text-red-300'
                      }`}
                    >
                      <span
                        className={`inline-block h-2 w-2 rounded-full ${
                          health.healthy ? 'bg-green-400' : 'bg-red-400'
                        }`}
                      />
                      <span>{health.message}</span>
                      {health.latencyMs > 0 && (
                        <span className="ml-auto text-xs text-zinc-500">{health.latencyMs}ms</span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
