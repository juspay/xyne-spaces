import { DASHBOARD_ORIGIN } from '@/src/config';

import { clawApiRequest } from './clawRequest';
import type { CredentialField, McpServer, UserConnection } from './clawMcpTypes';

/** All registered MCP servers/connectors (the catalog). */
export function listMcpServers(): Promise<McpServer[]> {
  return clawApiRequest<McpServer[]>('/servers');
}

/** The current user's active MCP connections. */
export function listMcpConnections(userId: string): Promise<UserConnection[]> {
  return clawApiRequest<UserConnection[]>(`/users/${encodeURIComponent(userId)}/connections`, {
    userId,
  });
}

/** Registry of credential fields keyed by server type. */
export function getCredentialFields(): Promise<Record<string, CredentialField[]>> {
  return clawApiRequest<Record<string, CredentialField[]>>('/servers/credential-fields');
}

/**
 * Start an OAuth connect flow. Pass an https allowlisted `returnTo`
 * (Spaces / dashboard origin) — custom schemes are rejected by claw-auth.
 */
export async function startMcpOAuth(
  userId: string,
  serverType: string,
  returnTo: string = `${DASHBOARD_ORIGIN}/`,
): Promise<string> {
  const data = await clawApiRequest<{ authUrl: string }>(
    `/users/${encodeURIComponent(userId)}/oauth/${encodeURIComponent(serverType)}/authorize`,
    {
      method: 'POST',
      body: { returnTo },
      userId,
    },
  );
  return data.authUrl;
}

export function createMcpConnection(
  userId: string,
  mcpServerId: string,
  credentials: Record<string, string> = {},
): Promise<UserConnection> {
  return clawApiRequest<UserConnection>(`/users/${encodeURIComponent(userId)}/connections`, {
    method: 'POST',
    body: { mcpServerId, credentials },
    userId,
  });
}

/** The Spaces connector authenticates from the session, so it self-connects. */
export function autoConnectSpaces(userId: string): Promise<unknown> {
  return clawApiRequest<unknown>(
    `/users/${encodeURIComponent(userId)}/connections/auto-connect-spaces`,
    { method: 'POST', body: {}, userId },
  );
}

/**
 * Fields from the connector's own DB columns / schema (fallback when the
 * registry is unavailable). Prefer `getCredentialFields` / ensureFieldsFor.
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

/**
 * True when Connect must open a credentials form first.
 * Do not decide from DB columns alone — pass registry-resolved fields.
 */
export function mcpRequiresCredentials(
  server: McpServer,
  resolvedFields?: readonly CredentialField[],
): boolean {
  if (server.oauth) return false;
  if (server.type === 'google' || server.type === 'microsoft' || server.type === 'xyne-spaces') {
    return false;
  }
  if (resolvedFields) return resolvedFields.length > 0;
  const hasFormFields = (server.credentialForm?.fields?.length ?? 0) > 0;
  const hasSchema = !!server.credentialSchema && Object.keys(server.credentialSchema).length > 0;
  return hasFormFields || hasSchema;
}
