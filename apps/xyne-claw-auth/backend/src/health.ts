import { callTool, evictSession, listToolsForUser } from "./mcp/runner.js";
import { resolveConnectorDefinition } from "./mcp/connector-definitions.js";

interface HealthResult {
  readonly healthy: boolean;
  readonly message: string;
  readonly latencyMs: number;
}

function toFriendlyHealthMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : "Connection failed";
  const lower = raw.toLowerCase();
  if (
    lower.includes("streamablehttpclienttransport.send") ||
    lower.includes("invalid url") ||
    lower.includes("unable to process your request as the url")
  ) {
    return "Health check failed: target endpoint is not a valid MCP endpoint (it appears to be a regular HTTP/REST URL). Configure an MCP server URL/package instead.";
  }
  return raw;
}

function isMissingHealthToolError(err: unknown): boolean {
  const raw = err instanceof Error ? err.message.toLowerCase() : "";
  return (
    raw.includes("unknown tool")
    || raw.includes("tool not found")
    || raw.includes("method not found")
    || (raw.includes("tool") && raw.includes("not found"))
    || raw.includes("not found")
  );
}

/**
 * Health check: call a lightweight tool to verify credentials work end-to-end.
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

    const definition = await resolveConnectorDefinition(serverType);
    if (!definition) {
      return { healthy: false, message: `No adapter for: ${serverType}`, latencyMs: 0 };
    }

    const { name, params } = definition.healthCheck;
    if (name === "__list_tools__") {
      const tools = await listToolsForUser(userId, serverType, _serverName, credentials);
      const latencyMs = Date.now() - start;
      if (!tools || tools.tools.length === 0) {
        return { healthy: false, message: "Connected, but no tools were exposed by MCP server", latencyMs };
      }
      return { healthy: true, message: `Connected (${tools.tools.length} tools available)`, latencyMs };
    }
    try {
      await callTool(userId, serverType, credentials, name, params);
    } catch (err) {
      if (!isMissingHealthToolError(err)) throw err;
      // Fallback for connectors where configured health tool doesn't exist:
      // if tools can be listed, connection/auth is considered healthy.
      const tools = await listToolsForUser(userId, serverType, _serverName, credentials);
      if (!tools || tools.tools.length === 0) throw err;
    }
    const latencyMs = Date.now() - start;

    return { healthy: true, message: "Credentials verified", latencyMs };
  } catch (err) {
    return {
      healthy: false,
      message: toFriendlyHealthMessage(err),
      latencyMs: Date.now() - start,
    };
  }
}
