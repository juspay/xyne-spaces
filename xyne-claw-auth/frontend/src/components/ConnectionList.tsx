import { useState, useCallback } from "react";
import type { UserConnection, HealthResult } from "../lib/types";
import { checkConnectionHealth, autoConnectSpaces } from "../lib/api";

interface Props {
  connections: UserConnection[];
  loading: boolean;
  userId: string;
  onDelete: (id: string) => void;
  onEdit: (connection: UserConnection) => void;
  onUpdate: () => void;
}

export function ConnectionList({ connections, loading, userId, onDelete, onEdit, onUpdate }: Props) {
  const [healthStatus, setHealthStatus] = useState<Record<string, HealthResult | "loading">>({});
  const [connecting, setConnecting] = useState(false);

  const hasSpaces = connections.some((c) => c.mcpServer.type === "xyne-spaces");

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
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-8 text-center">
        <p className="text-zinc-400">No MCP connections configured yet.</p>
        <p className="mt-1 text-sm text-zinc-500">Connect to an MCP server to enable tools for your agent.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
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
