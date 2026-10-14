/** MCP types mirrored from dashboard `clawMcpTypes` / claw-auth wire contract. */

export type CredentialField = {
  readonly name: string;
  readonly label: string;
  readonly type: 'text' | 'password';
  readonly placeholder: string;
  readonly optional?: boolean;
};

export type McpServer = {
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
  readonly connectorMeta?: Record<string, unknown> | null;
  readonly writeToolPolicy?: {
    mode?: 'allowlist' | 'denylist' | 'allAsk' | 'allowAll';
    tools?: string[];
  } | null;
  readonly createdAt?: string;
  readonly updatedAt?: string;
};

export type UserConnection = {
  readonly id: string;
  readonly userId: string;
  readonly mcpServerId: string;
  readonly mcpServer?: McpServer;
  readonly createdAt: string;
  readonly updatedAt?: string;
};
