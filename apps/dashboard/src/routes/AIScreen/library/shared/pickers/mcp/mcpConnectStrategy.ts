import type { CredentialField, McpServer } from '@/services/claw/clawMcpTypes';

export type ConnectStrategy = 'auto' | 'oauth' | 'credentials';

/**
 * Connectors every run reaches with the user's own Spaces sign-in: the runner
 * fills in their session token, so there is nothing to connect. Their adapters
 * still declare a URL and token, but only as a manual fallback. Mirrors
 * SPACES_SESSION_CREDENTIAL_SERVER_TYPES in xyne-claw-auth.
 */
export const SPACES_SESSION_SERVER_TYPES: ReadonlySet<string> = new Set([
  'xyne-spaces',
  'xyne-dashboard',
  'xyne-workflows',
]);

export function connectStrategyFor(server: McpServer): ConnectStrategy {
  if (SPACES_SESSION_SERVER_TYPES.has(server.type)) return 'auto';
  if (server.type === 'google' || server.type === 'microsoft' || server.oauth) return 'oauth';
  return 'credentials';
}

/**
 * Whether the user has to connect anything before the connector works: an
 * OAuth sign-in, or credential fields to fill. Never for the Spaces-session
 * connectors, whatever fields their adapters declare.
 */
export function needsMcpKey(server: McpServer, fields: readonly CredentialField[]): boolean {
  const strategy = connectStrategyFor(server);
  return strategy === 'oauth' || (strategy === 'credentials' && fields.length > 0);
}
