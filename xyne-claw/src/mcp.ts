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
  readonly writeTools: readonly string[];
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

/** A group of MCP tools from one server, with write tool info preserved */
export interface McpToolGroup {
  serverType: string;
  serverName: string;
  tools: ToolDefinition[];
  writeTools: string[];
}

export async function loadMcpToolsForUser(
  userId: string,
  toolPermissions?: Record<string, string>,
  agentSlug?: string,
): Promise<{
  groups: McpToolGroup[];
  cleanup: () => Promise<void>;
  getPendingActions: () => Array<Record<string, unknown>>;
}> {
  const permissions = toolPermissions ?? {};
  const servers = await authFetch<McpServerTools[]>(
    `/claw/api/v1/users/${encodeURIComponent(userId)}/mcp/tools`,
  );

  if (servers.length === 0) {
    return { groups: [], cleanup: async () => {}, getPendingActions: () => [] };
  }

  const pendingActions: Array<Record<string, unknown>> = [];
  const groups: McpToolGroup[] = [];

  for (const server of servers) {
    // query-routing tools are only available to the investigation-agent
    if (server.serverType === "query-routing" && agentSlug !== "investigation-agent") {
      continue;
    }

    const tools: ToolDefinition[] = [];

    for (const mcpTool of server.tools) {
      const toolKey = `${server.serverType}__${mcpTool.name}`;
      const permission = permissions[toolKey] ?? "allow";

      const safeName = `${server.serverName}__${mcpTool.name}`.replace(/[^a-zA-Z0-9_.\-]/g, "_");
      const definition: ToolDefinition = {
        name: safeName,
        label: `${server.serverName}/${mcpTool.name}`,
        description: mcpTool.description || `Tool ${mcpTool.name} from ${server.serverName}`,
        parameters: Type.Unsafe(mcpTool.inputSchema),
        async execute(_toolCallId, params) {
          const result = await authFetch<{
            content: string;
            citations?: import("xyne-claw-shared").Citation[];
            pendingAction?: Record<string, unknown>;
          }>(
            `/claw/api/v1/users/${encodeURIComponent(userId)}/mcp/call`,
            {
              method: "POST",
              body: JSON.stringify({
                serverType: server.serverType,
                tool: mcpTool.name,
                params: params as Record<string, unknown>,
                permission,
                agentSlug,
              }),
            },
          );

          if (result.pendingAction) {
            pendingActions.push(result.pendingAction);
          }

          // Stash structured citations keyed by toolCallId so agent.ts can
          // attach them to the recorded ToolInvocation in tool_execution_end.
          if (result.citations && result.citations.length > 0) {
            const { recordCitations } = await import("./citations.js");
            recordCitations(_toolCallId, result.citations);
          }

          return {
            content: [{ type: "text" as const, text: result.content }],
            details: {},
          };
        },
      };
      tools.push(definition);
    }

    groups.push({
      serverType: server.serverType,
      serverName: server.serverName,
      tools,
      writeTools: [...(server.writeTools ?? [])],
    });
  }

  const totalTools = groups.reduce((sum, g) => sum + g.tools.length, 0);
  console.log(`[mcp] Loaded ${totalTools} tools in ${groups.length} groups for user ${userId}`);

  return { groups, cleanup: async () => {}, getPendingActions: () => pendingActions };
}
