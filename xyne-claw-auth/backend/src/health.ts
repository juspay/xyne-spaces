import { callTool, evictSession, getAdapters } from "./mcp/runner.js";

interface HealthResult {
  readonly healthy: boolean;
  readonly message: string;
  readonly latencyMs: number;
}

/**
 * Penny-drop health check: actually call a lightweight tool
 * to verify credentials work end-to-end, not just that the server starts.
 */
export async function checkHealth(
  userId: string,
  serverType: string,
  _serverName: string,
  credentials: Record<string, unknown>,
): Promise<HealthResult> {
  const start = Date.now();
  try {
    await evictSession(userId, serverType);

    const adapter = getAdapters()[serverType];
    if (!adapter) {
      return { healthy: false, message: `No adapter for: ${serverType}`, latencyMs: 0 };
    }

    const { name, params } = adapter.pennyDrop;
    await callTool(userId, serverType, credentials, name, params);
    const latencyMs = Date.now() - start;

    return { healthy: true, message: "Credentials verified", latencyMs };
  } catch (err) {
    return {
      healthy: false,
      message: err instanceof Error ? err.message : "Connection failed",
      latencyMs: Date.now() - start,
    };
  }
}
