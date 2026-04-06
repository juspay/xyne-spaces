import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { SERVER } from "./config.js";

interface McpToolInfo {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

interface McpServerTools {
  readonly serverType: string;
  readonly serverName: string;
  readonly tools: McpToolInfo[];
}

interface AuthResponse<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: string;
}

async function authFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${SERVER.authServiceUrl}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = (await res.json()) as AuthResponse<T>;
  if (!body.success || body.data === undefined) {
    throw new Error(body.error ?? `Auth service error: ${res.status}`);
  }
  return body.data;
}

export async function loadMcpToolsForUser(
  userId: string,
  toolPermissions?: Record<string, string>,
): Promise<{
  tools: ToolDefinition[];
  cleanup: () => Promise<void>;
  getPendingActions: () => Array<Record<string, unknown>>;
}> {
  const permissions = toolPermissions ?? {};
  const servers = await authFetch<McpServerTools[]>(
    `/claw/api/v1/users/${encodeURIComponent(userId)}/mcp/tools`,
  );

  if (servers.length === 0) {
    return { tools: [], cleanup: async () => {}, getPendingActions: () => [] };
  }

  const pendingActions: Array<Record<string, unknown>> = [];

  const tools: ToolDefinition[] = [];

  for (const server of servers) {
    for (const mcpTool of server.tools) {
      const toolKey = `${server.serverType}__${mcpTool.name}`;
      const permission = permissions[toolKey] ?? "allow";

      const definition: ToolDefinition = {
        name: `${server.serverName}__${mcpTool.name}`,
        label: `${server.serverName}/${mcpTool.name}`,
        description: mcpTool.description || `Tool ${mcpTool.name} from ${server.serverName}`,
        parameters: Type.Unsafe(mcpTool.inputSchema),
        async execute(_toolCallId, params) {
          const result = await authFetch<{ content: string; pendingAction?: Record<string, unknown> }>(
            `/claw/api/v1/users/${encodeURIComponent(userId)}/mcp/call`,
            {
              method: "POST",
              body: JSON.stringify({
                serverType: server.serverType,
                tool: mcpTool.name,
                params: params as Record<string, unknown>,
                permission,
              }),
            },
          );

          if (result.pendingAction) {
            pendingActions.push(result.pendingAction);
          }

          return {
            content: [{ type: "text" as const, text: result.content }],
            details: {},
          };
        },
      };
      tools.push(definition);
    }
  }

  console.log(`[mcp] Loaded ${tools.length} tools for user ${userId}`);

  return { tools, cleanup: async () => {}, getPendingActions: () => pendingActions };
}
