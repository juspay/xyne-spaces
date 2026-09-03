import { useState, useEffect, useCallback } from "react";
import type { UserConnection, McpServer, CredentialField } from "../../lib/types";
import {
  listConnections,
  createConnection,
  deleteConnection,
  checkConnectionHealth,
  listServers,
  createServer,
  getCredentialFields,
  autoConnectSpaces,
  connectGoogle,
  connectMicrosoft,
  hasGoogleConnection,
  hasMicrosoftConnection,
} from "../../lib/api";
import { AddConnectionDialog } from "../../components/AddConnectionDialog";
import { Activity, Edit2, Trash2 } from "lucide-react";

// ── Integration banners ───────────────────────────────────────────────
function IntegrationBanner({
  color,
  title,
  subtitle,
  actionLabel,
  loading,
  onClick,
}: {
  color: "blue" | "green" | "sky";
  title: string;
  subtitle: string;
  actionLabel: string;
  loading: boolean;
  onClick: () => void;
}) {
  const colorMap = {
    blue:  { bg: "bg-blue-50",    border: "border-blue-200",   text: "text-blue-700",   sub: "text-blue-500",   btn: "bg-blue-600 hover:bg-blue-500 text-white" },
    green: { bg: "bg-green-50",   border: "border-green-200",  text: "text-green-700",  sub: "text-green-500",  btn: "bg-emerald-600 hover:bg-emerald-500 text-white" },
    sky:   { bg: "bg-sky-50",     border: "border-sky-200",    text: "text-sky-700",    sub: "text-sky-500",    btn: "bg-sky-600 hover:bg-sky-500 text-white" },
  }[color];

  return (
    <div className={`flex items-center justify-between rounded-2xl border ${colorMap.border} ${colorMap.bg} px-5 py-4`}>
      <div>
        <p className={`text-sm font-semibold ${colorMap.text}`}>{title}</p>
        <p className={`text-xs mt-0.5 ${colorMap.sub}`}>{subtitle}</p>
      </div>
      <button
        onClick={onClick}
        disabled={loading}
        className={`rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-50 ${colorMap.btn}`}
      >
        {loading ? "Redirecting…" : actionLabel}
      </button>
    </div>
  );
}

// ── ConnectionCard ────────────────────────────────────────────────────
function ConnectionCard({
  conn,
  userId,
  onEdit,
  onDelete,
}: {
  conn: UserConnection;
  userId: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [health, setHealth] = useState<{ healthy: boolean; message: string; latencyMs: number } | "loading" | null>(null);

  const runHealthCheck = async () => {
    setHealth("loading");
    try {
      const result = await checkConnectionHealth(userId, conn.id);
      setHealth(result);
    } catch {
      setHealth({ healthy: false, message: "Health check failed", latencyMs: 0 });
    }
  };

  return (
    <div className="rounded-2xl bg-zinc-100 p-5">
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-zinc-900">{conn.mcpServer.name}</h3>
            <span className="rounded-full bg-zinc-200 px-2.5 py-0.5 text-xs font-medium text-zinc-600">
              {conn.mcpServer.type}
            </span>
          </div>
          {conn.mcpServer.description && (
            <p className="mt-1 text-sm text-zinc-500">{conn.mcpServer.description}</p>
          )}
          <p className="mt-1 text-xs text-zinc-400">
            Connected {new Date(conn.createdAt).toLocaleDateString()}
          </p>
        </div>

        <div className="ml-4 flex shrink-0 items-center gap-2">
          <button
            onClick={onEdit}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-600 transition hover:bg-zinc-200"
          >
            <Edit2 size={13} strokeWidth={1.8} />
            Edit
          </button>
          <button
            onClick={runHealthCheck}
            disabled={health === "loading"}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-600 transition hover:bg-zinc-200 disabled:opacity-50"
          >
            <Activity size={13} strokeWidth={1.8} />
            {health === "loading" ? "Checking…" : "Health Check"}
          </button>
          <button
            onClick={onDelete}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-red-500 transition hover:bg-red-50"
          >
            <Trash2 size={13} strokeWidth={1.8} />
            Disconnect
          </button>
        </div>
      </div>

      {health && health !== "loading" && (
        <div
          className={`mt-4 flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm ${
            health.healthy
              ? "border border-green-200 bg-green-50 text-green-700"
              : "border border-red-200 bg-red-50 text-red-600"
          }`}
        >
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              health.healthy ? "bg-green-500" : "bg-red-400"
            }`}
          />
          <span>{health.message}</span>
          {health.latencyMs > 0 && (
            <span className="ml-auto text-xs text-zinc-400">{health.latencyMs}ms</span>
          )}
        </div>
      )}
    </div>
  );
}

// ── MCPPageV2 ─────────────────────────────────────────────────────────
interface Props {
  userId: string;
}

export function MCPPageV2({ userId }: Props) {
  const [connections, setConnections] = useState<UserConnection[]>([]);
  const [servers, setServers] = useState<McpServer[]>([]);
  const [credentialFields, setCredentialFields] = useState<Record<string, CredentialField[]>>({});
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editServerId, setEditServerId] = useState<string | undefined>(undefined);

  // OAuth feedback state
  const [connectingSpaces, setConnectingSpaces] = useState(false);
  const [connectingGoogle, setConnectingGoogle] = useState(false);
  const [connectingMicrosoft, setConnectingMicrosoft] = useState(false);

  // Toast banners for OAuth callbacks
  const [googleSuccess, setGoogleSuccess] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [microsoftSuccess, setMicrosoftSuccess] = useState(false);
  const [microsoftError, setMicrosoftError] = useState<string | null>(null);

  const loadConnections = useCallback(async () => {
    setLoading(true);
    try {
      const [conns, serverList, fields] = await Promise.all([
        listConnections(userId),
        listServers(),
        getCredentialFields(),
      ]);
      setConnections(conns);
      setServers(serverList);
      setCredentialFields(fields);
    } catch (err) {
      console.error("[MCPPageV2] failed to load:", err);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { loadConnections(); }, [loadConnections]);

  // Handle OAuth callback URL params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("google_connected") === "true") {
      setGoogleSuccess(true);
      loadConnections();
      window.history.replaceState({}, "", window.location.pathname);
      setTimeout(() => setGoogleSuccess(false), 5000);
    }
    if (params.get("google_error")) {
      setGoogleError(params.get("google_error"));
      window.history.replaceState({}, "", window.location.pathname);
      setTimeout(() => setGoogleError(null), 8000);
    }
    if (params.get("microsoft_connected") === "true") {
      setMicrosoftSuccess(true);
      loadConnections();
      window.history.replaceState({}, "", window.location.pathname);
      setTimeout(() => setMicrosoftSuccess(false), 5000);
    }
    if (params.get("microsoft_error")) {
      setMicrosoftError(params.get("microsoft_error"));
      window.history.replaceState({}, "", window.location.pathname);
      setTimeout(() => setMicrosoftError(null), 8000);
    }
  }, [loadConnections]);

  const handleAddConnection = async (mcpServerId: string, credentials: Record<string, string>) => {
    try {
      const server = servers.find((s) => s.id === mcpServerId);
      if (server?.type === "google") {
        setShowAdd(false);
        setEditServerId(undefined);
        const authUrl = await connectGoogle(userId);
        window.location.href = authUrl;
        return;
      }
      if (server?.type === "microsoft") {
        setShowAdd(false);
        setEditServerId(undefined);
        const authUrl = await connectMicrosoft(userId);
        window.location.href = authUrl;
        return;
      }
      await createConnection(userId, { mcpServerId, credentials });
      setShowAdd(false);
      setEditServerId(undefined);
      loadConnections();
    } catch (err) {
      console.error("[MCPPageV2] create connection error:", err);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteConnection(userId, id);
      loadConnections();
    } catch (err) {
      console.error("[MCPPageV2] delete connection error:", err);
    }
  };

  const hasSpaces = connections.some((c) => c.mcpServer.type === "xyne-spaces");
  const hasGoogle = hasGoogleConnection(connections);
  const hasMicrosoft = hasMicrosoftConnection(connections);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-zinc-900">MCP Integrations</h2>
        <button
          onClick={() => setShowAdd(true)}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-700"
        >
          + Add Integration
        </button>
      </div>

      {/* OAuth success / error toasts */}
      {googleSuccess && (
        <div className="rounded-2xl border border-green-200 bg-green-50 px-5 py-3 text-sm text-green-700">
          Google account connected successfully!
        </div>
      )}
      {googleError && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-3 text-sm text-red-600">
          Google connection failed: {googleError}
        </div>
      )}
      {microsoftSuccess && (
        <div className="rounded-2xl border border-green-200 bg-green-50 px-5 py-3 text-sm text-green-700">
          Microsoft account connected successfully!
        </div>
      )}
      {microsoftError && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-3 text-sm text-red-600">
          Microsoft connection failed: {microsoftError}
        </div>
      )}

      {loading ? (
        <div className="py-16 text-center text-sm text-zinc-400">Loading integrations…</div>
      ) : (
        <section className="mt-8 space-y-3">
          {/* Xyne Spaces banner */}
          {!hasSpaces && (
            <IntegrationBanner
              color="blue"
              title="Xyne Spaces not connected"
              subtitle="Auto-connect using your current session"
              actionLabel="Connect Spaces"
              loading={connectingSpaces}
              onClick={async () => {
                setConnectingSpaces(true);
                try { await autoConnectSpaces(userId); loadConnections(); }
                catch { /* silently fail */ }
                finally { setConnectingSpaces(false); }
              }}
            />
          )}

          {/* Google banner */}
          {!hasGoogle && (
            <IntegrationBanner
              color="green"
              title="Google not connected"
              subtitle="Connect to enable Gmail, Calendar, Contacts, Tasks & Drive tools"
              actionLabel="Connect Google"
              loading={connectingGoogle}
              onClick={async () => {
                setConnectingGoogle(true);
                try {
                  const url = await connectGoogle(userId);
                  window.location.href = url;
                } catch {
                  setConnectingGoogle(false);
                }
              }}
            />
          )}

          {/* Microsoft banner */}
          {!hasMicrosoft && (
            <IntegrationBanner
              color="sky"
              title="Microsoft not connected"
              subtitle="Connect to enable Outlook, Calendar, To Do, OneDrive & Teams tools"
              actionLabel="Connect Microsoft"
              loading={connectingMicrosoft}
              onClick={async () => {
                setConnectingMicrosoft(true);
                try {
                  const url = await connectMicrosoft(userId);
                  window.location.href = url;
                } catch {
                  setConnectingMicrosoft(false);
                }
              }}
            />
          )}

          {/* Existing connections */}
          {connections.length === 0 && hasSpaces && hasGoogle && hasMicrosoft && (
            <div className="rounded-2xl border border-dashed border-zinc-300 p-16 text-center">
              <p className="text-sm text-zinc-400">No other MCP connections configured.</p>
              <p className="mt-1 text-xs text-zinc-400">
                Connect to an MCP server to enable additional tools for your agents.
              </p>
            </div>
          )}

          {connections.map((conn) => (
            <ConnectionCard
              key={conn.id}
              conn={conn}
              userId={userId}
              onEdit={() => {
                setEditServerId(conn.mcpServerId);
                setShowAdd(true);
              }}
              onDelete={() => handleDelete(conn.id)}
            />
          ))}
        </section>
      )}

      <AddConnectionDialog
        open={showAdd}
        onOpenChange={(open) => {
          setShowAdd(open);
          if (!open) setEditServerId(undefined);
        }}
        onSubmit={handleAddConnection}
        onCreateServer={async (payload) => {
          const result = await createServer(payload, userId);
          await loadConnections();
          if (result.kind === "editRequest") {
            // Shared connector — change queued for admin approval, nothing to
            // reconnect. Surface the message in the dialog's error banner.
            throw new Error(result.message);
          }
          return result.server;
        }}
        servers={servers}
        credentialFields={credentialFields}
        editServerId={editServerId}
      />
    </div>
  );
}
