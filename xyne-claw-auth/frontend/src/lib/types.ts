export interface User {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly googleId: string;
}

export interface McpServer {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly url: string;
  readonly description: string | null;
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

export interface HealthResult {
  readonly healthy: boolean;
  readonly message: string;
  readonly latencyMs: number;
}

export interface CredentialField {
  readonly name: string;
  readonly label: string;
  readonly type: "text" | "password";
  readonly placeholder: string;
  readonly optional?: boolean;
}

export interface Gateway {
  readonly id: string;
  readonly type: string;
  readonly name: string;
  readonly config: Record<string, unknown>;
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface GatewayIdentity {
  readonly id: string;
  readonly gatewayId: string;
  readonly externalUserId: string;
  readonly userId: string;
  readonly user: { readonly name: string; readonly email: string };
  readonly createdAt: string;
}

export interface AgentTool {
  readonly id: string;
  readonly toolId: string;
  readonly permission: string;
  readonly tool: { readonly slug: string; readonly name: string; readonly source: string };
}

export interface Agent {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly scope: string;
  readonly enabled: boolean;
  readonly color: string;
  readonly config: Record<string, unknown>;
  readonly spacesAppId: string | null;
  readonly spacesAppUserId: string | null;
  readonly spacesAppToken: string | null;
  readonly tools: AgentTool[];
  readonly createdAt: string;
  readonly updatedAt: string;
}
