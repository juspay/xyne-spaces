// MCP types mirrored from xyne-claw-auth/frontend/src/lib/types.ts so the
// dashboard renders the same data returned by the claw-auth backend's
// GET /api/v1/servers and GET /api/v1/users/:userId/connections endpoints.

export interface CredentialField {
  readonly name: string;
  readonly label: string;
  readonly type: 'text' | 'password';
  readonly placeholder: string;
  readonly optional?: boolean;
}

export interface McpServer {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly url: string;
  readonly description: string | null;
  readonly transport?: string;
  readonly enabled?: boolean;
  /** True when this connector authenticates via per-user browser OAuth. */
  readonly oauth?: boolean;
  readonly credentialForm?: { fields?: CredentialField[] } | null;
  readonly credentialSchema?: Record<string, unknown> | null;
  readonly launchConfigTemplate?: {
    cmd?: string;
    args?: string[];
    env?: Record<string, string>;
  } | null;
  readonly httpConfigTemplate?: { url?: string; headers?: Record<string, string> } | null;
  readonly healthcheckSpec?: { name?: string; params?: Record<string, unknown> } | null;
  readonly writeToolPolicy?: {
    mode?: 'allowlist' | 'denylist' | 'allAsk' | 'allowAll';
    tools?: string[];
  } | null;
  /** Untyped bag; the UI reads `scope`, `publishStatus`, `ownerUserId`, etc. */
  readonly connectorMeta?: Record<string, unknown> | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface UserConnection {
  readonly id: string;
  readonly userId: string;
  readonly mcpServerId: string;
  readonly mcpServer: McpServer;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AgentMcpConnectionMeta {
  readonly id: string;
  readonly mcpServerId: string;
  readonly mcpServerType: string;
  readonly mcpServerName: string;
  readonly slug: string;
  readonly displayName: string;
  readonly createdByUserId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface HealthResult {
  readonly healthy: boolean;
  readonly message: string;
  readonly latencyMs: number;
}
