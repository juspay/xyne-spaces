import { clawApiRequest } from '@/services/claw/clawRequest';
import { currentOAuthReturnTo } from './oauthReturnTo';
import type { CredentialField, McpServer, UserConnection } from '@/services/claw/clawMcpTypes';
import { openOAuthConsent } from './openOAuthConsent';
import { connectStrategyFor } from './mcpConnectStrategy';

export function getCredentialFields(): Promise<Record<string, CredentialField[]>> {
  return clawApiRequest<Record<string, CredentialField[]>>('/servers/credential-fields');
}

export function createMcpConnection(
  userId: string,
  payload: { mcpServerId: string; credentials: Record<string, string> },
): Promise<UserConnection> {
  return clawApiRequest<UserConnection>(`/users/${encodeURIComponent(userId)}/connections`, {
    method: 'POST',
    userId,
    body: JSON.stringify(payload),
  });
}

function startOAuth(userId: string, serverType: string): Promise<{ authUrl: string }> {
  return clawApiRequest<{ authUrl: string }>(
    `/users/${encodeURIComponent(userId)}/oauth/${encodeURIComponent(serverType)}/authorize`,
    { method: 'POST', userId, body: JSON.stringify({ returnTo: currentOAuthReturnTo() }) },
  );
}

export async function connectMcpServer(
  userId: string,
  server: McpServer,
  credentials: Record<string, string>,
): Promise<{ redirected: boolean }> {
  if (connectStrategyFor(server) === 'oauth') {
    const { authUrl } = await startOAuth(userId, server.type);
    openOAuthConsent(authUrl);
    return { redirected: true };
  }
  await createMcpConnection(userId, { mcpServerId: server.id, credentials });
  return { redirected: false };
}
