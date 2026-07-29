import type { AgentMcpConnectionMeta, McpServer, UserConnection } from './clawMcpTypes';
import { clawApiRequest } from './clawRequest';

/** All registered MCP servers/connectors (the catalog). */
export function listMcpServers(): Promise<McpServer[]> {
  return clawApiRequest<McpServer[]>('/servers');
}

/** The current user's active MCP connections. */
export function listMcpConnections(userId: string): Promise<UserConnection[]> {
  return clawApiRequest<UserConnection[]>(`/users/${encodeURIComponent(userId)}/connections`);
}

export function listAgentMcpConnections(
  slug: string,
  requesterId: string,
): Promise<AgentMcpConnectionMeta[]> {
  return clawApiRequest(`/agents/${encodeURIComponent(slug)}/mcp/connections`, {
    userId: requesterId,
  });
}

export async function deleteAgentMcpConnection(
  slug: string,
  requesterId: string,
  mcpServerType: string,
  instanceSlug: string,
): Promise<void> {
  await clawApiRequest(
    `/agents/${encodeURIComponent(slug)}/mcp/connections/${encodeURIComponent(mcpServerType)}/${encodeURIComponent(instanceSlug)}`,
    { method: 'DELETE', userId: requesterId },
  );
}
