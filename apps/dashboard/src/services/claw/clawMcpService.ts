import type {
  AgentMcpConnectionMeta,
  CredentialField,
  McpServer,
  UserConnection,
} from './clawMcpTypes';
import { clawApiRequest } from './clawRequest';
import { currentOAuthReturnTo } from '../../routes/AIScreen/library/shared/pickers/mcp/oauthReturnTo';

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

/**
 * Start an OAuth connect flow for a connector and return the consent URL.
 *
 * Every OAuth connector — google, microsoft and any `oauth: true` type —
 * exposes `/oauth/<type>/authorize` and answers with `{ authUrl }`; the caller
 * redirects the browser there. Mirrors claw's own connect path rather than
 * inventing a second one, so both UIs start the identical flow.
 */
export async function startMcpOAuth(userId: string, serverType: string): Promise<string> {
  const data = await clawApiRequest<{ authUrl: string }>(
    `/users/${encodeURIComponent(userId)}/oauth/${encodeURIComponent(serverType)}/authorize`,
    { method: 'POST', body: JSON.stringify({ returnTo: currentOAuthReturnTo() }), userId },
  );
  return data.authUrl;
}

/**
 * Create a connection. `credentials` is empty for connectors that need none and
 * carries the connector's own fields (url, token, …) for the ones that do.
 */
export function createMcpConnection(
  userId: string,
  mcpServerId: string,
  credentials: Record<string, string> = {},
): Promise<UserConnection> {
  return clawApiRequest<UserConnection>(`/users/${encodeURIComponent(userId)}/connections`, {
    method: 'POST',
    body: JSON.stringify({ mcpServerId, credentials }),
    userId,
  });
}

/**
 * The fields a connector needs, preferring its saved form and falling back to
 * deriving them from its JSON credential schema. Mirrors claw's resolution
 * order so the same connector asks for the same things in both UIs.
 */
export function mcpCredentialFields(server: McpServer): CredentialField[] {
  const saved = server.credentialForm?.fields ?? [];
  if (saved.length > 0) return saved;

  const schema = server.credentialSchema;
  if (!schema || typeof schema !== 'object') return [];
  const properties = (schema as { properties?: unknown }).properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return [];

  const rawRequired = (schema as { required?: unknown }).required;
  const required = new Set(Array.isArray(rawRequired) ? rawRequired.map(String) : []);

  const asText = (value: unknown, fallback: string): string =>
    typeof value === 'string' || typeof value === 'number' ? String(value) : fallback;

  return Object.entries(properties as Record<string, unknown>).map(([name, raw]) => {
    const property =
      raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    return {
      name,
      label: asText(property['title'] ?? property['label'], name),
      type: property['format'] === 'password' || property['secret'] === true ? 'password' : 'text',
      placeholder: asText(property['placeholder'], ''),
      optional: !required.has(name),
    } satisfies CredentialField;
  });
}

/** The Spaces connector authenticates from the session, so it self-connects. */
export function autoConnectSpaces(userId: string): Promise<unknown> {
  return clawApiRequest<unknown>(
    `/users/${encodeURIComponent(userId)}/connections/auto-connect-spaces`,
    { method: 'POST', body: JSON.stringify({}), userId },
  );
}

/** Remove one of the user's connections. */
export function deleteMcpConnection(userId: string, connectionId: string): Promise<unknown> {
  return clawApiRequest<unknown>(
    `/users/${encodeURIComponent(userId)}/connections/${encodeURIComponent(connectionId)}`,
    { method: 'DELETE', userId },
  );
}

/**
 * True when a connector can only be connected by typing credentials into a
 * form. Those live in claw's own MCP page; here the button points there rather
 * than creating a credential-less connection that would sit permanently
 * unhealthy.
 */
export function mcpRequiresCredentials(server: McpServer): boolean {
  if (server.oauth) return false;
  if (server.type === 'google' || server.type === 'microsoft' || server.type === 'xyne-spaces') {
    return false;
  }
  const hasFormFields = (server.credentialForm?.fields?.length ?? 0) > 0;
  const hasSchema = !!server.credentialSchema && Object.keys(server.credentialSchema).length > 0;
  return hasFormFields || hasSchema;
}

/** Connector provenance, as claw records it in `connectorMeta`. */
export interface McpConnectorMeta {
  scope?: string;
  publishStatus?: string;
  ownerUserId?: string;
}

export function mcpConnectorMeta(server: McpServer): McpConnectorMeta {
  const meta = server.connectorMeta;
  if (!meta || typeof meta !== 'object') return {};
  const read = (key: string): string | undefined => {
    const value = meta[key];
    return typeof value === 'string' ? value : undefined;
  };
  const scope = read('scope');
  const publishStatus = read('publishStatus');
  const ownerUserId = read('ownerUserId');
  return {
    ...(scope !== undefined ? { scope } : {}),
    ...(publishStatus !== undefined ? { publishStatus } : {}),
    ...(ownerUserId !== undefined ? { ownerUserId } : {}),
  };
}

/**
 * Who may edit a connector's definition. Mirrors the server rule exactly
 * (`routes/servers.ts`: `requesterIsAdmin || ownerUserId === requesterId`) —
 * anything looser just turns into a 403 the user cannot act on.
 */
export function canEditMcpDefinition(
  server: McpServer,
  userId: string | undefined,
  isAdmin: boolean,
): boolean {
  if (!userId) return false;
  if (isAdmin) return true;
  return mcpConnectorMeta(server).ownerUserId === userId;
}

/**
 * True when an edit will be queued for admin review rather than applied.
 * Every change to a `scope: global` connector goes through the review queue,
 * CLAW_ADMIN included — the server enforces this with no exceptions.
 */
export function mcpEditNeedsReview(server: McpServer): boolean {
  return mcpConnectorMeta(server).scope === 'global';
}

export interface McpDefinitionPatch {
  name: string;
  description?: string;
  url?: string;
}

/**
 * Submit a definition change. The connector is identified by `type`, matching
 * the server's own upsert-by-type behaviour. For a global connector this
 * creates a pending edit request instead of mutating the row.
 */
export function updateMcpDefinition(
  userId: string,
  server: McpServer,
  patch: McpDefinitionPatch,
): Promise<McpServer> {
  return clawApiRequest<McpServer>('/servers', {
    method: 'POST',
    body: JSON.stringify({
      type: server.type,
      transport: server.transport,
      name: patch.name,
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.url !== undefined ? { url: patch.url } : {}),
    }),
    userId,
  });
}
