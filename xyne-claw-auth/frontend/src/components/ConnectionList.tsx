import { useState, useCallback, useEffect } from "react";
import type { UserConnection, HealthResult } from "../lib/types";
import { checkConnectionHealth, autoConnectSpaces, connectGoogle, hasGoogleConnection, connectMicrosoft, hasMicrosoftConnection, requestServerPublish } from "../lib/api";

interface Props {
  connections: UserConnection[];
  loading: boolean;
  userId: string;
  onDelete: (id: string) => void;
  onEdit: (connection: UserConnection) => void;
  onEditDefinition: (connection: UserConnection) => void;
  onUpdate: () => void;
}

export function ConnectionList({ connections, loading, userId, onDelete, onEdit, onEditDefinition, onUpdate }: Props) {
  const [healthStatus, setHealthStatus] = useState<Record<string, HealthResult | "loading">>({});
  const [connecting, setConnecting] = useState(false);
  const [connectingGoogle, setConnectingGoogle] = useState(false);
  const [connectingMicrosoft, setConnectingMicrosoft] = useState(false);
  const [googleSuccess, setGoogleSuccess] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [microsoftSuccess, setMicrosoftSuccess] = useState(false);
  const [microsoftError, setMicrosoftError] = useState<string | null>(null);

  const hasSpaces = connections.some((c) => c.mcpServer.type === "xyne-spaces");
  const hasGoogle = hasGoogleConnection(connections);
  const hasMicrosoft = hasMicrosoftConnection(connections);

  // Check URL params for Google / Microsoft OAuth callback result
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("google_connected") === "true") {
      setGoogleSuccess(true);
      onUpdate(); // Reload connections
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
      onUpdate();
      window.history.replaceState({}, "", window.location.pathname);
      setTimeout(() => setMicrosoftSuccess(false), 5000);
    }
    if (params.get("microsoft_error")) {
      setMicrosoftError(params.get("microsoft_error"));
      window.history.replaceState({}, "", window.location.pathname);
      setTimeout(() => setMicrosoftError(null), 8000);
    }
  }, [onUpdate]);

  const handleAutoConnect = useCallback(async () => {
    setConnecting(true);
    try {
      await autoConnectSpaces(userId);
      onUpdate();
    } catch {
      // silently fail
    } finally {
      setConnecting(false);
    }
  }, [userId, onUpdate]);

  const handleConnectGoogle = useCallback(async () => {
    setConnectingGoogle(true);
    setGoogleError(null);
    try {
      const authUrl = await connectGoogle(userId);
      // Redirect to Google consent screen
      window.location.href = authUrl;
    } catch (err) {
      setGoogleError(err instanceof Error ? err.message : "Failed to start Google connection");
      setConnectingGoogle(false);
    }
  }, [userId]);

  const handleConnectMicrosoft = useCallback(async () => {
    setConnectingMicrosoft(true);
    setMicrosoftError(null);
    try {
      const authUrl = await connectMicrosoft(userId);
      // Redirect to Microsoft consent screen
      window.location.href = authUrl;
    } catch (err) {
      setMicrosoftError(err instanceof Error ? err.message : "Failed to start Microsoft connection");
      setConnectingMicrosoft(false);
    }
  }, [userId]);

  const runHealthCheck = useCallback(async (connectionId: string) => {
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
  }, [userId]);

  if (loading) {
    return <p className="text-sm text-zinc-500">Loading connections…</p>;
  }

  if (connections.length === 0) {
    return (
      <div className="space-y-3">
        {googleSuccess && (
          <div className="rounded-lg border border-green-800/50 bg-green-950/30 px-4 py-3 text-sm text-green-300">
            Google account connected successfully!
          </div>
        )}
        {googleError && (
          <div className="rounded-lg border border-red-800/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">
            Google connection failed: {googleError}
          </div>
        )}
        {microsoftSuccess && (
          <div className="rounded-lg border border-green-800/50 bg-green-950/30 px-4 py-3 text-sm text-green-300">
            Microsoft account connected successfully!
          </div>
        )}
        {microsoftError && (
          <div className="rounded-lg border border-red-800/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">
            Microsoft connection failed: {microsoftError}
          </div>
        )}
        <div className="rounded-lg border border-blue-800/50 bg-blue-950/30 p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-blue-300">Xyne Spaces not connected</p>
            <p className="text-xs text-blue-400/70">Auto-connect using your current session</p>
          </div>
          <button
            onClick={handleAutoConnect}
            disabled={connecting}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
          >
            {connecting ? "Connecting..." : "Connect Spaces"}
          </button>
        </div>
        <div className="rounded-lg border border-emerald-800/50 bg-emerald-950/30 p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-emerald-300">Google not connected</p>
            <p className="text-xs text-emerald-400/70">Connect to enable Gmail, Calendar, Contacts, Tasks & Drive tools</p>
          </div>
          <button
            onClick={handleConnectGoogle}
            disabled={connectingGoogle}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
          >
            {connectingGoogle ? "Redirecting..." : "Connect Google"}
          </button>
        </div>
        <div className="rounded-lg border border-sky-800/50 bg-sky-950/30 p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-sky-300">Microsoft not connected</p>
            <p className="text-xs text-sky-400/70">Connect to enable Outlook, Calendar, To Do, OneDrive & Teams tools</p>
          </div>
          <button
            onClick={handleConnectMicrosoft}
            disabled={connectingMicrosoft}
            className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-500 disabled:opacity-50"
          >
            {connectingMicrosoft ? "Redirecting..." : "Connect Microsoft"}
          </button>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-8 text-center">
          <p className="text-zinc-400">No other MCP connections configured.</p>
          <p className="mt-1 text-sm text-zinc-500">Connect to an MCP server to enable additional tools for your agent.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {googleSuccess && (
        <div className="rounded-lg border border-green-800/50 bg-green-950/30 px-4 py-3 text-sm text-green-300">
          Google account connected successfully!
        </div>
      )}
      {googleError && (
        <div className="rounded-lg border border-red-800/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">
          Google connection failed: {googleError}
        </div>
      )}
      {microsoftSuccess && (
        <div className="rounded-lg border border-green-800/50 bg-green-950/30 px-4 py-3 text-sm text-green-300">
          Microsoft account connected successfully!
        </div>
      )}
      {microsoftError && (
        <div className="rounded-lg border border-red-800/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">
          Microsoft connection failed: {microsoftError}
        </div>
      )}
      {!hasSpaces && (
        <div className="rounded-lg border border-blue-800/50 bg-blue-950/30 p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-blue-300">Xyne Spaces not connected</p>
            <p className="text-xs text-blue-400/70">Auto-connect using your current session</p>
          </div>
          <button
            onClick={handleAutoConnect}
            disabled={connecting}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
          >
            {connecting ? "Connecting..." : "Connect Spaces"}
          </button>
        </div>
      )}
      {!hasGoogle && (
        <div className="rounded-lg border border-emerald-800/50 bg-emerald-950/30 p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-emerald-300">Google not connected</p>
            <p className="text-xs text-emerald-400/70">Connect to enable Gmail, Calendar, Contacts, Tasks & Drive tools</p>
          </div>
          <button
            onClick={handleConnectGoogle}
            disabled={connectingGoogle}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
          >
            {connectingGoogle ? "Redirecting..." : "Connect Google"}
          </button>
        </div>
      )}
      {!hasMicrosoft && (
        <div className="rounded-lg border border-sky-800/50 bg-sky-950/30 p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-sky-300">Microsoft not connected</p>
            <p className="text-xs text-sky-400/70">Connect to enable Outlook, Calendar, To Do, OneDrive & Teams tools</p>
          </div>
          <button
            onClick={handleConnectMicrosoft}
            disabled={connectingMicrosoft}
            className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-500 disabled:opacity-50"
          >
            {connectingMicrosoft ? "Redirecting..." : "Connect Microsoft"}
          </button>
        </div>
      )}
      {connections.map((conn) => {
        const health = healthStatus[conn.id];
        return (
          <div
            key={conn.id}
            className="rounded-lg border border-zinc-800 bg-zinc-900 p-4"
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
                    publishStatus?: "draft" | "pending" | "approved" | "rejected";
                    publishReviewNote?: string;
                  };
                  const isPersonal = meta.scope === "personal";
                  const isOwner = meta.ownerUserId === userId;
                  if (!isPersonal || !isOwner) return null;
                  const status = meta.publishStatus ?? "draft";
                  if (status === "approved") return null;
                  if (status === "pending") {
                    return (
                      <span
                        className="rounded-md border border-amber-700/60 px-3 py-1.5 text-sm text-amber-300"
                        title="An admin will review this connector and decide whether to make it global."
                      >
                        Pending review
                      </span>
                    );
                  }
                  const label = status === "rejected" ? "Re-request publishing" : "Request Publishing";
                  return (
                    <button
                      onClick={async () => {
                        try {
                          await requestServerPublish(conn.mcpServerId, userId);
                          onUpdate();
                        } catch (err) {
                          console.error("[connection-list] request-publish failed", err);
                        }
                      }}
                      className="rounded-md px-3 py-1.5 text-sm text-emerald-300 transition hover:bg-emerald-950 hover:text-emerald-200"
                      title={status === "rejected" && meta.publishReviewNote ? `Rejected: ${meta.publishReviewNote}` : "Submit this connector for admin approval to make it global."}
                    >
                      {label}
                    </button>
                  );
                })()}
                <button
                  onClick={() => runHealthCheck(conn.id)}
                  disabled={health === "loading"}
                  className="rounded-md px-3 py-1.5 text-sm text-zinc-300 transition hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-50"
                >
                  {health === "loading" ? "Checking…" : "Health Check"}
                </button>
                <button
                  onClick={() => onDelete(conn.id)}
                  className="rounded-md px-3 py-1.5 text-sm text-red-400 transition hover:bg-red-950 hover:text-red-300"
                >
                  Disconnect
                </button>
              </div>
            </div>

            {health && health !== "loading" && (
              <div
                className={`mt-3 flex items-center gap-2 rounded-md px-3 py-2 text-sm ${
                  health.healthy
                    ? "border border-green-800/50 bg-green-950/50 text-green-300"
                    : "border border-red-800/50 bg-red-950/50 text-red-300"
                }`}
              >
                <span
                  className={`inline-block h-2 w-2 rounded-full ${
                    health.healthy ? "bg-green-400" : "bg-red-400"
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
  );
}
