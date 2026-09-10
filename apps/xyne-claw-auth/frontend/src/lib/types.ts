export interface User {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly googleId: string;
  /** Workspace the user is currently scoped to. Returned by GET /api/auth/validate
   *  (see xyne-spaces/apps/backend/src/routes/auth.ts). Used to build Spaces
   *  thread links that require the /:workspaceId route segment. */
  readonly workspaceId?: string;
}

export interface McpServer {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly url: string;
  readonly description: string | null;
  readonly transport?: string;
  readonly enabled?: boolean;
  /** True when this connector authenticates via per-user browser OAuth (set by
   *  the backend from the canonical OAuth set / connectorMeta.authMethod). Such
   *  connectors can't be pinned credential-less — they use the OAuth flow. */
  readonly oauth?: boolean;
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
  readonly tool: { readonly slug: string; readonly name: string; readonly source: string; readonly description?: string };
}

export interface AgentSkill {
  readonly id: string;
  readonly skillId: string;
  readonly skill: { readonly slug: string; readonly name: string; readonly description: string; readonly content: string };
}

/** Per-agent Knowledge Base grant — references a spaces Collection (and
 *  optionally a single file). fileId = null grants the whole collection.
 *  See AgentCollection in xyne-claw-auth's prisma schema. */
export interface AgentCollection {
  readonly id: string;
  readonly agentId: string;
  readonly collectionId: string;
  readonly fileId: string | null;
  readonly createdAt: string;
}

export interface AgentShare {
  readonly id: string;
  readonly userId: string;
  readonly role: string;
  readonly user: { readonly id: string; readonly name: string; readonly email: string };
}

export interface AgentLight {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly color: string;
  readonly scope: string;
  readonly delegationTier?: "standard" | "orchestrator";
  readonly ownerUserId: string | null;
  readonly createdBy?: string | null;
  readonly orgId?: string;
  readonly orgName?: string | null;
  readonly enabled: boolean;
  readonly isDefault?: boolean;
  readonly activePromptVersion?: number | null;
  readonly activePromptVersionId?: string | null;
  readonly modelId?: string;
  readonly spacesAppId?: string | null;
  readonly spacesAppUserId?: string | null;
  readonly spacesAppTokenConfigured?: boolean;
  readonly signingSecretConfigured?: boolean;
  /** Knowledge Base scoping mode. "COLLECTIONS" (default) = per-agent
   *  allowlist via `collections`. "USER" = inherits whatever the calling
   *  user can access in spaces. */
  readonly kbScope?: "COLLECTIONS" | "USER";
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly owner?: {
    readonly id: string;
    readonly name: string;
    readonly email: string;
    readonly googleId?: string | null;
  } | null;
  /** Absent from the default GET /agents light list. Present on full reads. */
  readonly tools?: AgentTool[];
  readonly skills?: AgentSkill[];
  readonly shares?: AgentShare[];
}

export interface Agent extends AgentLight {
  readonly systemPrompt?: string;
  readonly config: Record<string, unknown>;
  readonly spacesAppToken: string | null;
  readonly tools: AgentTool[];
  readonly skills?: AgentSkill[];
  readonly collections?: AgentCollection[];
  readonly shares?: AgentShare[];
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
  readonly replyMode: "thread" | "channel";
  /** Override target channel for `replyMode = "channel"`. Null = use the
   *  originating `channelId`. Settable from the Scheduled Jobs UI. */
  readonly targetChannelId: string | null;
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
