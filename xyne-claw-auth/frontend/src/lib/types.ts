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
  readonly transport?: string;
  readonly enabled?: boolean;
  readonly credentialForm?: { fields?: CredentialField[] } | null;
  readonly credentialSchema?: Record<string, unknown> | null;
  readonly launchConfigTemplate?: { cmd?: string; args?: string[]; env?: Record<string, string> } | null;
  readonly httpConfigTemplate?: { url?: string; headers?: Record<string, string> } | null;
  readonly healthcheckSpec?: { name?: string; params?: Record<string, unknown> } | null;
  readonly writeToolPolicy?: { mode?: "allowlist" | "denylist" | "allAsk" | "allowAll"; tools?: string[] } | null;
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

export interface AgentSkill {
  readonly id: string;
  readonly skillId: string;
  readonly skill: { readonly slug: string; readonly name: string; readonly description: string; readonly content: string };
}

export interface Agent {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly systemPrompt?: string;
  readonly scope: string;
  readonly ownerUserId: string | null;
  readonly enabled: boolean;
  readonly color: string;
  readonly modelId?: string;
  readonly config: Record<string, unknown>;
  readonly spacesAppId: string | null;
  readonly spacesAppUserId: string | null;
  readonly spacesAppToken: string | null;
  readonly tools: AgentTool[];
  readonly skills?: AgentSkill[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ScheduledJob {
  readonly id: string;
  readonly userId: string;
  readonly agentSlug: string;
  readonly task: string;
  readonly context: string | null;
  readonly type: "once" | "cron";
  readonly delayMs: number | null;
  readonly cronExpression: string | null;
  readonly maxRuns: number | null;
  readonly runCount: number;
  readonly status: string;
  readonly nextRunAt: string | null;
  readonly lastRunAt: string | null;
  readonly label: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ScheduledJobRun {
  readonly id: string;
  readonly scheduledJobId: string;
  readonly sessionId: string | null;
  readonly status: string;
  readonly result: string | null;
  readonly error: string | null;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly createdAt: string;
  readonly scheduledJob?: {
    readonly label: string | null;
    readonly task: string;
    readonly cronExpression: string | null;
  };
}
