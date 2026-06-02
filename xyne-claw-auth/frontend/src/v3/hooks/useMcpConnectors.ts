import { useState, useEffect, useCallback, useRef } from "react";
import type { UserConnection, McpServer, HealthResult } from "../../lib/types";
import {
  listConnections,
  listServers,
  createConnection,
  deleteConnection,
  autoConnectSpaces,
  connectGoogle,
  connectMicrosoft,
  checkConnectionHealth,
} from "../../lib/api";

// Re-use a cached health result instead of re-pinging the server when the
// sidebar reopens. 60s is a compromise: long enough to dedupe rapid clicks /
// row→sidebar→row navigation, short enough that "Connected" badges still
// reflect reality if a credential breaks mid-session.
const HEALTH_TTL_MS = 60_000;

interface UseMcpConnectorsReturn {
  connections: UserConnection[];
  servers: McpServer[];
  loading: boolean;
  connectingId: string | null;
  healthMap: Record<string, HealthResult | "checking" | null>;
  healthCheckedAt: Record<string, number>;
  reload: () => void;
  connect: (server: McpServer) => Promise<void>;
  disconnect: (conn: UserConnection) => Promise<void>;
  checkHealth: (conn: UserConnection, opts?: { force?: boolean }) => Promise<void>;
}

export function useMcpConnectors(userId: string): UseMcpConnectorsReturn {
  const [connections, setConnections] = useState<UserConnection[]>([]);
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [healthMap, setHealthMap] = useState<Record<string, HealthResult | "checking" | null>>({});
  const [healthCheckedAt, setHealthCheckedAt] = useState<Record<string, number>>({});

  // Refs let checkHealth read the latest cache state without being recreated
  // on every render. Sidebars hold the function in a ref and re-invoke it on
  // open — without these, the freshness check could read stale state.
  const healthMapRef = useRef(healthMap);
  const healthCheckedAtRef = useRef(healthCheckedAt);
  useEffect(() => { healthMapRef.current = healthMap; }, [healthMap]);
  useEffect(() => { healthCheckedAtRef.current = healthCheckedAt; }, [healthCheckedAt]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [conns, serverList] = await Promise.all([
        listConnections(userId),
        listServers(userId),
      ]);
      setConnections(conns);
      setServers(serverList);
    } catch (err) {
      console.error("[useMcpConnectors] load error:", err);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function connect(server: McpServer) {
    setConnectingId(server.id);
    try {
      if (server.type === "xyne-spaces") {
        await autoConnectSpaces(userId);
        reload();
      } else if (server.type === "google") {
        window.location.href = await connectGoogle(userId);
      } else if (server.type === "microsoft") {
        window.location.href = await connectMicrosoft(userId);
      } else {
        await createConnection(userId, { mcpServerId: server.id, credentials: {} });
        reload();
      }
    } catch (err) {
      setConnectingId(null);
      throw err;
    }
  }

  async function disconnect(conn: UserConnection) {
    setConnectingId(conn.mcpServerId);
    try {
      await deleteConnection(userId, conn.id);
      reload();
    } finally {
      setConnectingId(null);
    }
  }

  async function checkHealth(conn: UserConnection, opts?: { force?: boolean }) {
    const existing = healthMapRef.current[conn.id];
    const checkedAt = healthCheckedAtRef.current[conn.id];

    if (existing === "checking") return;

    const haveResult = !!existing;
    const fresh =
      checkedAt !== undefined && Date.now() - checkedAt < HEALTH_TTL_MS;
    if (!opts?.force && haveResult && fresh) return;

    setHealthMap((prev) => ({ ...prev, [conn.id]: "checking" }));
    try {
      const result = await checkConnectionHealth(userId, conn.id);
      setHealthMap((prev) => ({ ...prev, [conn.id]: result }));
    } catch {
      setHealthMap((prev) => ({ ...prev, [conn.id]: { healthy: false, message: "Check failed", latencyMs: 0 } }));
    } finally {
      setHealthCheckedAt((prev) => ({ ...prev, [conn.id]: Date.now() }));
    }
  }

  // Once connections finish loading, kick off background health checks for
  // any we don't already have a cached/fresh result for. This populates the
  // row badges so users see real status without opening each sidebar.
  // checkHealth's TTL guard makes this safe to re-run on reload.
  const ranInitialCheckForRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (loading) return;
    for (const conn of connections) {
      if (ranInitialCheckForRef.current.has(conn.id)) continue;
      ranInitialCheckForRef.current.add(conn.id);
      void checkHealth(conn);
    }
    // checkHealth is stable enough — reads via refs — so excluding it here
    // is intentional. Re-running on `connections` change is what we want.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, connections]);

  return {
    connections,
    servers,
    loading,
    connectingId,
    healthMap,
    healthCheckedAt,
    reload,
    connect,
    disconnect,
    checkHealth,
  };
}
