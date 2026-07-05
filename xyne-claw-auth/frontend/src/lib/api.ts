import type { User, McpServer, UserConnection, HealthResult, CredentialField, Gateway, GatewayIdentity, Agent, ScheduledJob, ScheduledJobRun } from "./types";

import { frontendConfig } from "./config";

const BACKEND_URL = frontendConfig.spacesAuthBaseUrl;
const AUTH_API_URL = frontendConfig.clawApiBaseUrl;

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new ApiError(res.status, body.error ?? `Request failed: ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export async function getMe(): Promise<User> {
  const data = await request<{ success: boolean; user: User }>(
    `${BACKEND_URL}/api/auth/validate`,
  );
  return data.user;
}

export async function upsertUser(user: User): Promise<void> {
  const spacesToken = getGoogleToken();
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/users`,
    {
      method: "POST",
      body: JSON.stringify({
        id: user.id,
        email: user.email,
        name: user.name,
        ...(spacesToken ? { spacesToken } : {}),
      }),
    },
  );
}

export function getLoginUrl(): string {
  if (import.meta.env.DEV) {
    const redirectTo = `${window.location.origin}/claw/`;
    // Same pattern as the Spaces dashboard at localhost:5173 — navigate directly
    // to the Spaces backend on localhost:3001. Cookie lands on origin :3001;
    // subsequent fetches must also hit :3001 directly (set VITE_XYNE_BACKEND_URL=
    // http://localhost:3001) so the browser includes the cookie. CORS+credentials
    // does the rest, and Spaces backend's CORS_ORIGIN must include
    // http://localhost:5174.
    return `http://localhost:3001/api/auth/login?redirect_to=${encodeURIComponent(redirectTo)}`;
  }
  return `${BACKEND_URL}/api/auth/login`;
}

export async function getCredentialFields(): Promise<Record<string, CredentialField[]>> {
  const data = await request<{ success: boolean; data: Record<string, CredentialField[]> }>(
    `${AUTH_API_URL}/api/v1/servers/credential-fields`,
  );
  return data.data;
}

export async function listServers(userId?: string): Promise<McpServer[]> {
  const data = await request<{ success: boolean; data: McpServer[] }>(
    `${AUTH_API_URL}/api/v1/servers`,
    { headers: userId ? { "x-user-id": userId } : undefined },
  );
  return data.data;
}

export async function createServer(
  payload: {
    name: string;
    type: string;
    url: string;
    description?: string;
    transport?: "stdio" | "http";
    credentialForm?: { fields: CredentialField[] };
    launchConfigTemplate?: { cmd: string; args: string[]; env: Record<string, string> };
    httpConfigTemplate?: { url: string; headers: Record<string, string> };
    healthcheckSpec?: { name: string; params: Record<string, unknown> };
    writeToolPolicy?: { mode?: "allowlist" | "denylist" | "allAsk" | "allowAll"; tools?: string[] };
    connectorMeta?: Record<string, unknown>;
  },
  userId: string,
): Promise<McpServer> {
  const data = await request<{ success: boolean; data: McpServer }>(
    `${AUTH_API_URL}/api/v1/servers`,
    { method: "POST", headers: { "x-user-id": userId }, body: JSON.stringify(payload) },
  );
  return data.data;
}

export async function requestServerPublish(serverId: string, userId: string): Promise<void> {
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/servers/${serverId}/request-publish`,
    { method: "POST", headers: { "x-user-id": userId } },
  );
}

export async function listMcpPublishRequests(userId: string): Promise<McpServer[]> {
  const data = await request<{ success: boolean; data: McpServer[] }>(
    `${AUTH_API_URL}/api/v1/servers/publish-requests`,
    { headers: { "x-user-id": userId } },
  );
  return data.data;
}

export async function approveServerPublish(serverId: string, userId: string): Promise<void> {
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/servers/publish-requests/${serverId}/approve`,
    { method: "POST", headers: { "x-user-id": userId } },
  );
}

export async function rejectServerPublish(serverId: string, userId: string, note?: string): Promise<void> {
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/servers/publish-requests/${serverId}/reject`,
    {
      method: "POST",
      headers: { "x-user-id": userId, "Content-Type": "application/json" },
      body: JSON.stringify(note ? { note } : {}),
    },
  );
}

/**
 * Edit-request queue (separate from publish-request).
 *
 * Direct edits to scope=global connectors are forbidden — the form-save
 * flow creates an `McpConnectorEditRequest` row in `pending` state instead.
 * A CLAW_ADMIN reviews via this endpoint set and either approves (proposed
 * fields are copied onto the live McpServer row) or rejects (request closed,
 * live row untouched).
 *
 * Until the UI exposed these endpoints, the only way to clear the queue was
 * via direct SQL or a hand-rolled curl — see `routes/servers.ts:524-700`.
 */
export interface McpEditRequest {
  id: string;
  mcpServerId: string;
  mcpServer: { id: string; type: string; name: string };
  proposedByUserId: string;
  proposedAt: string;
  proposedFields: Record<string, unknown>;
  status: "pending" | "approved" | "rejected" | "superseded" | "cancelled";
}

export async function listMcpEditRequests(userId: string): Promise<McpEditRequest[]> {
  const data = await request<{ success: boolean; data: McpEditRequest[] }>(
    `${AUTH_API_URL}/api/v1/servers/edit-requests`,
    { headers: { "x-user-id": userId } },
  );
  return data.data;
}

export async function approveServerEdit(requestId: string, userId: string): Promise<void> {
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/servers/edit-requests/${requestId}/approve`,
    { method: "POST", headers: { "x-user-id": userId } },
  );
}

export async function rejectServerEdit(requestId: string, userId: string, note?: string): Promise<void> {
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/servers/edit-requests/${requestId}/reject`,
    {
      method: "POST",
      headers: { "x-user-id": userId, "Content-Type": "application/json" },
      body: JSON.stringify(note ? { note } : {}),
    },
  );
}

export async function deleteServer(id: string): Promise<void> {
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/servers/${id}`,
    { method: "DELETE" },
  );
}

export async function listConnections(userId: string): Promise<UserConnection[]> {
  const data = await request<{ success: boolean; data: UserConnection[] }>(
    `${AUTH_API_URL}/api/v1/users/${userId}/connections`,
  );
  return data.data;
}

export async function createConnection(
  userId: string,
  payload: { mcpServerId: string; credentials: Record<string, string> },
): Promise<UserConnection> {
  const data = await request<{ success: boolean; data: UserConnection }>(
    `${AUTH_API_URL}/api/v1/users/${userId}/connections`,
    { method: "POST", body: JSON.stringify(payload) },
  );
  return data.data;
}

export async function deleteConnection(userId: string, id: string): Promise<void> {
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/users/${userId}/connections/${id}`,
    { method: "DELETE" },
  );
}

// ── System Health ───────────────────────────────────────────────────

export interface SystemHealth {
  status: "ok" | "degraded" | "critical";
  message: string;
}

export async function getSystemHealth(): Promise<SystemHealth> {
  if (import.meta.env.DEV) {
    // Dev simulation: read ?health=ok|degraded|critical from URL
    const urlParams = new URLSearchParams(window.location.search);
    const simulated = urlParams.get("health");
    if (simulated === "degraded") {
      return { status: "degraded", message: "Degraded" };
    }
    if (simulated === "critical") {
      return { status: "critical", message: "Critical" };
    }
    return { status: "ok", message: "All systems operational" };
  }

  const data = await request<{ success: boolean; data: SystemHealth }>(
    `${AUTH_API_URL}/api/v1/health`,
  );
  return data.data;
}

// ── Connections ─────────────────────────────────────────────────────

export async function checkConnectionHealth(
  userId: string,
  connectionId: string,
): Promise<HealthResult> {
  const data = await request<{ success: boolean; data: HealthResult }>(
    `${AUTH_API_URL}/api/v1/users/${userId}/connections/${connectionId}/health`,
  );
  return data.data;
}

// ── Gateways ──────────────────────────────────────────────────────────

export async function listGateways(): Promise<Gateway[]> {
  const data = await request<{ success: boolean; data: Gateway[] }>(
    `${AUTH_API_URL}/api/v1/gateways`,
  );
  return data.data;
}

export async function createGateway(
  payload: { type: string; name: string; config?: Record<string, unknown> },
): Promise<Gateway> {
  const data = await request<{ success: boolean; data: Gateway }>(
    `${AUTH_API_URL}/api/v1/gateways`,
    { method: "POST", body: JSON.stringify(payload) },
  );
  return data.data;
}

export async function deleteGateway(id: string): Promise<void> {
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/gateways/${id}`,
    { method: "DELETE" },
  );
}

export async function listIdentities(gatewayId: string): Promise<GatewayIdentity[]> {
  const data = await request<{ success: boolean; data: GatewayIdentity[] }>(
    `${AUTH_API_URL}/api/v1/gateways/${gatewayId}/identities`,
  );
  return data.data;
}

export async function linkIdentity(
  gatewayId: string,
  payload: { externalUserId: string; userId: string },
): Promise<GatewayIdentity> {
  const data = await request<{ success: boolean; data: GatewayIdentity }>(
    `${AUTH_API_URL}/api/v1/gateways/${gatewayId}/identities`,
    { method: "POST", body: JSON.stringify(payload) },
  );
  return data.data;
}

export async function unlinkIdentity(gatewayId: string, identityId: string): Promise<void> {
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/gateways/${gatewayId}/identities/${identityId}`,
    { method: "DELETE" },
  );
}

// ── Agents ────────────────────────────────────────────────────────────

export async function listAgents(userId?: string, allAgents?: boolean): Promise<Agent[]> {
  // allAgents=true asks the backend for the FULL roster (admins only — server
  // enforces). Use it only where you genuinely need every user's agents (e.g.
  // the metrics agent filter); the default list stays filtered to
  // global ∪ owned ∪ shared.
  const params = new URLSearchParams();
  if (userId) params.set("userId", userId);
  if (allAgents) params.set("scope", "all");
  const qs = params.toString() ? `?${params.toString()}` : "";
  const data = await request<{ success: boolean; data: Agent[] }>(
    `${AUTH_API_URL}/api/v1/agents${qs}`,
  );
  return data.data;
}

export interface SandboxRepoOption {
  key: string;
  name: string;
  description?: string;
}

/** Available sandbox repo setups (for the agent "Sandbox repository" picker). */
export async function listSandboxRepos(): Promise<SandboxRepoOption[]> {
  const data = await request<{ success: boolean; data: SandboxRepoOption[] }>(
    `${AUTH_API_URL}/api/v1/sandbox/repos`,
  );
  return data.data;
}

export interface SbxGitRepoOption {
  key: string;
  path: string;
}

/** Individual repos in the shared read-only sbx-git sandbox (for the read-only
 *  agent "Repo context" multi-select). */
export async function listSbxGitRepos(): Promise<SbxGitRepoOption[]> {
  const data = await request<{ success: boolean; data: SbxGitRepoOption[] }>(
    `${AUTH_API_URL}/api/v1/sandbox/sbx-git-repos`,
  );
  return data.data;
}

export interface ResearchAgentOption {
  id: string;
  name: string;
}

export async function listResearchAgentProducts(): Promise<ResearchAgentOption[]> {
  const data = await request<{ success: boolean; data: ResearchAgentOption[] }>(
    `${AUTH_API_URL}/api/v1/research-agent/products`,
  );
  return data.data;
}

export async function listResearchAgentRepositories(): Promise<ResearchAgentOption[]> {
  const data = await request<{ success: boolean; data: ResearchAgentOption[] }>(
    `${AUTH_API_URL}/api/v1/research-agent/repositories`,
  );
  return data.data;
}

export interface IntegrationToolEntry {
  slug: string;
  name: string;
  description: string;
  riskLevel: "read" | "write" | "destructive";
}

export interface Integration {
  slug: string;
  label: string;
  kind: "mcp" | "builtin" | "custom" | "gateway";
  connected: boolean;
  /** Only populated for kind==="gateway". Lists every backendId registered under this serviceName. */
  backendIds?: string[];
  readTools: IntegrationToolEntry[];
  writeTools: IntegrationToolEntry[];
  /** How many agents select tools from this integration (popularity). */
  usageCount: number;
}

export interface AvailableTools {
  subagents: Array<{ name: string; description: string; serverType: string; progressLabel: string }>;
  mcpServers: Array<{ id: string; name: string; type: string }>;
  writeTools: Array<{ name: string; source: string }>;
  customGroups: Array<{ source: string; tools: Array<{ slug: string; name: string }> }>;
  serverTools: Record<string, Array<{ slug: string; name: string }>>;
  integrations: Integration[];
}

export async function getAvailableTools(): Promise<AvailableTools> {
  const data = await request<{ success: boolean; data: AvailableTools }>(
    `${AUTH_API_URL}/api/v1/tools/available`,
  );
  return data.data;
}

// AI-suggested tool selection from an agent's intent (system prompt or short
// description). Returns a proposal — the UI is expected to render this as a
// diff and let the user accept/reject before it touches agent.config.
export interface ToolSuggestion {
  subagents: string[];
  integrations: Array<{
    slug: string;
    readTools: string[];
    writeTools: string[];
  }>;
  reasoning: Record<string, string>;
}

export async function suggestTools(
  payload: { systemPrompt?: string; description?: string },
): Promise<ToolSuggestion> {
  const data = await request<{ success: boolean; data: ToolSuggestion }>(
    `${AUTH_API_URL}/api/v1/agents/suggest-tools`,
    { method: "POST", body: JSON.stringify(payload) },
  );
  return data.data;
}

// Generate a structured-output contract (JSON Schema + markdown template)
// from a plain-text description. Proxies to xyne-claw's generator; returns
// the pair plus any server-side sanity warnings for the user to review.
export interface GeneratedOutputFormat {
  schema: string;
  template: string;
  notes: string;
  warnings: string[];
}

export async function generateOutputFormat(payload: {
  description: string;
  format: "json" | "markdown";
  existingSchema?: string;
  existingTemplate?: string;
  agentName?: string;
}): Promise<GeneratedOutputFormat> {
  const data = await request<{ success: boolean; data: GeneratedOutputFormat }>(
    `${AUTH_API_URL}/api/v1/agents/generate-output-format`,
    { method: "POST", body: JSON.stringify(payload) },
  );
  return data.data;
}

export async function checkAgentName(name: string, slug: string): Promise<{ slugAvailable: boolean; nameAvailable: boolean }> {
  const data = await request<{ success: boolean; data: { slugAvailable: boolean; nameAvailable: boolean } }>(
    `${AUTH_API_URL}/api/v1/agents/check-name?name=${encodeURIComponent(name)}&slug=${encodeURIComponent(slug)}`,
  );
  return data.data;
}

export async function createAgent(
  payload: { slug: string; name: string; description?: string; systemPrompt: string; color?: string; ownerUserId?: string; skills?: string[]; knowledgeBase?: Array<{ collectionId: string; fileId?: string | null }>; kbScope?: "COLLECTIONS" | "USER" },
): Promise<Agent> {
  const data = await request<{ success: boolean; data: Agent }>(
    `${AUTH_API_URL}/api/v1/agents`,
    { method: "POST", body: JSON.stringify(payload) },
  );
  return data.data;
}

export async function deleteAgent(slug: string, userId: string): Promise<void> {
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/agents/${slug}`,
    { method: "DELETE", headers: { "x-user-id": userId } },
  );
}

export async function getAgentDetail(slug: string): Promise<Agent> {
  const data = await request<{ success: boolean; data: Agent }>(
    `${AUTH_API_URL}/api/v1/agents/${slug}`,
  );
  return data.data;
}

export async function updateAgent(
  slug: string,
  payload: { slug?: string; enabled?: boolean; name?: string; description?: string; systemPrompt?: string; promptNote?: string; color?: string; modelId?: string; config?: Record<string, unknown>; skills?: string[]; knowledgeBase?: Array<{ collectionId: string; fileId?: string | null }>; kbScope?: "COLLECTIONS" | "USER" },
): Promise<Agent> {
  const data = await request<{ success: boolean; data: Agent }>(
    `${AUTH_API_URL}/api/v1/agents/${slug}`,
    { method: "PUT", body: JSON.stringify(payload) },
  );
  return data.data;
}

// ── Prompt versioning ────────────────────────────────────────────────
// Every system-prompt edit creates an immutable version; the agent's
// `systemPrompt` is the denormalized active copy. These power the history /
// rollback UI.
export interface PromptVersion {
  id: string;
  agentId: string;
  version: number;
  systemPrompt: string;
  note: string | null;
  createdByUserId: string | null;
  createdAt: string;
}

export async function getPromptVersions(
  slug: string,
): Promise<{ activeVersion: number | null; versions: PromptVersion[] }> {
  const data = await request<{ success: boolean; data: { activeVersion: number | null; versions: PromptVersion[] } }>(
    `${AUTH_API_URL}/api/v1/agents/${encodeURIComponent(slug)}/prompt-versions`,
  );
  return data.data;
}

/** Roll back to / re-activate a specific prompt version. Returns the updated agent. */
export async function activatePromptVersion(slug: string, version: number): Promise<Agent> {
  const data = await request<{ success: boolean; data: Agent }>(
    `${AUTH_API_URL}/api/v1/agents/${encodeURIComponent(slug)}/prompt-versions/${version}/activate`,
    { method: "POST" },
  );
  return data.data;
}

// ── Agent-level provider credentials (shared keys) ───────────────────
// Used when a user runs the agent without their own personal provider:
// claw-auth falls back to these shared keys (e.g. team's Codex sub on Doctor).
// Owner/admin only for writes; contributor+ can see configured status.
// The decrypted apiKey is NEVER returned by the read endpoint.

export interface AgentProviderCredentialStatus {
  provider: string;
  model: string | null;
  baseUrl: string | null;
  authType: string | null;
  reasoningEffort: "low" | "medium" | "high" | null;
  configured: boolean;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function listAgentProviderCredentials(
  slug: string,
): Promise<AgentProviderCredentialStatus[]> {
  const data = await request<{ success: boolean; data: { providers: AgentProviderCredentialStatus[] } }>(
    `${AUTH_API_URL}/api/v1/agents/${encodeURIComponent(slug)}/provider-credentials`,
  );
  return data.data.providers;
}

export async function setAgentProviderCredential(
  slug: string,
  payload: {
    provider: string;
    // Optional when the credential already exists (e.g. updating the model
    // from the dropdown after OAuth). Required on the first save.
    apiKey?: string;
    model?: string;
    baseUrl?: string;
    authType?: "api_key" | "oauth_token";
    reasoningEffort?: "low" | "medium" | "high" | null;
  },
): Promise<void> {
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/agents/${encodeURIComponent(slug)}/provider-credentials`,
    { method: "POST", body: JSON.stringify(payload) },
  );
}

export async function deleteAgentProviderCredential(
  slug: string,
  provider: string,
): Promise<void> {
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/agents/${encodeURIComponent(slug)}/provider-credentials/${encodeURIComponent(provider)}`,
    { method: "DELETE" },
  );
}

// Agent-scoped Codex ChatGPT OAuth (PKCE). Mirrors the user-scoped flow
// (startCodexOauth / exchangeCodexOauth) but writes the OAuth bundle into
// `agentProviderCredentials` instead of `userProviderCredentials`. Gated by
// owner/admin via the backend's `requireAgentOwnerOrAdmin` middleware.
export async function startAgentCodexOauth(
  slug: string,
): Promise<{ url: string; state: string; expiresIn: number }> {
  const data = await request<{ success: boolean; data: { url: string; state: string; expiresIn: number } }>(
    `${AUTH_API_URL}/api/v1/agents/${encodeURIComponent(slug)}/provider-credentials/codex/oauth/start`,
    { method: "POST", body: JSON.stringify({}) },
  );
  return data.data;
}

export async function exchangeAgentCodexOauth(
  slug: string,
  payload: { code: string; state: string },
): Promise<void> {
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/agents/${encodeURIComponent(slug)}/provider-credentials/codex/oauth/exchange`,
    { method: "POST", body: JSON.stringify(payload) },
  );
}

// Agent-scoped Anthropic (Claude) OAuth — captures the {access_token,
// refresh_token, expires_at} bundle so the token can be auto-refreshed.
export async function startAgentClaudeOauth(
  slug: string,
): Promise<{ url: string; state: string; expiresIn: number }> {
  const data = await request<{ success: boolean; data: { url: string; state: string; expiresIn: number } }>(
    `${AUTH_API_URL}/api/v1/agents/${encodeURIComponent(slug)}/provider-credentials/claude/oauth/start`,
    { method: "POST", body: JSON.stringify({}) },
  );
  return data.data;
}

export async function exchangeAgentClaudeOauth(
  slug: string,
  payload: { code: string; state: string },
): Promise<void> {
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/agents/${encodeURIComponent(slug)}/provider-credentials/claude/oauth/exchange`,
    { method: "POST", body: JSON.stringify(payload) },
  );
}

export async function listAgentCodexModels(
  slug: string,
): Promise<Array<{ id: string; name: string }>> {
  const data = await request<{ success: boolean; data: Array<{ id: string; name: string }> }>(
    `${AUTH_API_URL}/api/v1/agents/${encodeURIComponent(slug)}/provider-credentials/codex/models`,
  );
  return data.data;
}

// ── User Agent Config (provider override) ────────────────────────────

export interface UserAgentConfig {
  provider: string;
  model?: string | null;
  baseUrl?: string | null;
  hasApiKey?: boolean;
}

export interface ClaudeModelInfo {
  id: string;
  displayName: string;
}

export async function getUserAgentConfig(slug: string, userId: string): Promise<UserAgentConfig> {
  const data = await request<{ success: boolean; data: UserAgentConfig }>(
    `${AUTH_API_URL}/api/v1/agents/${slug}/user-config/${userId}`,
  );
  return data.data;
}

export async function setUserAgentConfig(
  slug: string,
  userId: string,
  config: { provider: string; apiKey?: string; model?: string; baseUrl?: string },
): Promise<UserAgentConfig> {
  const data = await request<{ success: boolean; data: UserAgentConfig }>(
    `${AUTH_API_URL}/api/v1/agents/${slug}/user-config/${userId}`,
    { method: "PUT", body: JSON.stringify(config) },
  );
  return data.data;
}

// ── User Chain Config (per-user agent chaining) ────────────────────

export async function getUserChainConfig(slug: string, userId: string): Promise<Record<string, unknown> | null> {
  const data = await request<{ success: boolean; data: Record<string, unknown> | null }>(
    `${AUTH_API_URL}/api/v1/agents/${slug}/chain-config/${userId}`,
  );
  return data.data;
}

export async function setUserChainConfig(
  slug: string,
  userId: string,
  chainConfig: Record<string, unknown> | null,
): Promise<Record<string, unknown> | null> {
  const data = await request<{ success: boolean; data: Record<string, unknown> | null }>(
    `${AUTH_API_URL}/api/v1/agents/${slug}/chain-config/${userId}`,
    { method: "PUT", body: JSON.stringify({ chainConfig }) },
  );
  return data.data;
}

export interface ChainWorkflowNode {
  id: string;
  agentSlug: string;
  taskTemplate?: string;
}

export interface ChainWorkflowEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  mode?: "always" | "tools" | "judge";
  toolsMustInclude?: string[];
  toolsMustExclude?: string[];
  judgeContext?: string;
  taskTemplate?: string;
}

export interface ChainWorkflowDefinition {
  version: number;
  maxDepth?: number;
  nodes: ChainWorkflowNode[];
  edges: ChainWorkflowEdge[];
}

export interface ChainWorkflowTriggerChannel {
  channelId: string;
  spacesAutomationId: string | null;
  /** Webhook-backed triggers (GitHub/Bitbucket): URL to paste into the repo. */
  webhookUrl?: string | null;
}

export interface ChainWorkflowTrigger {
  id: string;
  type: string;
  channels: ChainWorkflowTriggerChannel[];
  configValues?: Record<string, string>;
}

export interface ChainWorkflow {
  id: string;
  name: string;
  definition: ChainWorkflowDefinition;
  isPublished: boolean;
  /** True once promoted to global (available to all users) by an admin. */
  global?: boolean;
  createdByUserId: string;
  /**
   * Non-null when the owner consented to run triggered executions with their
   * own credentials. Value is the consenting user's id (= the creator).
   */
  credentialUserId?: string | null;
  triggers: ChainWorkflowTrigger[];
  createdAt: string;
  updatedAt: string;
  bindings?: Array<{
    id: string;
    channelId: string;
    entryAgentSlug: string;
    workflowId: string;
    enabled: boolean;
    /** "*" = any user. A real id = scoped to that user. */
    userId?: string;
  }>;
}

export interface ChainWorkflowBinding {
  id: string;
  /** A real channel id, or the sentinel "*" meaning all channels. */
  channelId: string;
  entryAgentSlug: string;
  workflowId: string;
  enabled: boolean;
  /** "*" = any user. A real id = scoped to that user. */
  userId?: string;
  workflow: ChainWorkflow;
}

export async function listChainWorkflows(channelId?: string): Promise<Array<ChainWorkflow | ChainWorkflowBinding>> {
  const qs = channelId ? `?channelId=${encodeURIComponent(channelId)}` : "";
  const data = await request<{ success: boolean; data: Array<ChainWorkflow | ChainWorkflowBinding> }>(
    `${AUTH_API_URL}/api/v1/chain-workflows${qs}`,
  );
  return data.data;
}

export async function createChainWorkflow(payload: {
  name: string;
  definition: ChainWorkflowDefinition;
  isPublished?: boolean;
  triggers?: Array<{ type: string; channelIds: string[]; configValues?: Record<string, string> }>;
  /** Owner consent: run triggered executions with the creator's own creds. */
  useCreatorCredentials?: boolean;
}): Promise<ChainWorkflow> {
  const data = await request<{ success: boolean; data: ChainWorkflow }>(
    `${AUTH_API_URL}/api/v1/chain-workflows`,
    { method: "POST", body: JSON.stringify(payload) },
  );
  return data.data;
}

export async function updateChainWorkflow(id: string, payload: {
  name?: string;
  definition?: ChainWorkflowDefinition;
  isPublished?: boolean;
  triggers?: Array<{ id?: string; type: string; channelIds: string[]; configValues?: Record<string, string> }> | null;
  /** Owner consent toggle (owner-only on the backend). */
  useCreatorCredentials?: boolean;
}): Promise<ChainWorkflow> {
  const data = await request<{ success: boolean; data: ChainWorkflow }>(
    `${AUTH_API_URL}/api/v1/chain-workflows/${id}`,
    { method: "PUT", body: JSON.stringify(payload) },
  );
  return data.data;
}

export interface SpacesChannel {
  id: string;
  name: string;
  scopeType: string;
  visibility: string;
  participantCount: number;
  lastActivityAt: string | null;
  projectName: string | null;
}

export async function listSpacesChannels(q?: string, limit = 50, agentSlug?: string, memberOnly?: boolean): Promise<SpacesChannel[]> {
  const params = new URLSearchParams();
  if (q && q.trim()) params.set("q", q.trim());
  params.set("limit", String(limit));
  if (agentSlug) params.set("agentSlug", agentSlug);
  if (memberOnly) params.set("memberOnly", "true");
  const data = await request<{ success: boolean; data: SpacesChannel[] }>(
    `${AUTH_API_URL}/api/v1/spaces/channels?${params.toString()}`,
  );
  return data.data;
}

export interface SpacesProject {
  id: string;
  name: string;
  description: string | null;
  updatedAt: string | null;
}

export async function listSpacesProjects(q?: string, limit = 50): Promise<SpacesProject[]> {
  const params = new URLSearchParams();
  if (q && q.trim()) params.set("q", q.trim());
  params.set("limit", String(limit));
  const data = await request<{ success: boolean; data: SpacesProject[] }>(
    `${AUTH_API_URL}/api/v1/spaces/projects?${params.toString()}`,
  );
  return data.data;
}

export interface SpacesBoard {
  id: string;
  name: string;
  description: string | null;
  projectId: string | null;
  projectName: string | null;
  updatedAt: string | null;
}

export async function listSpacesBoards(q?: string, limit = 50, projectId?: string): Promise<SpacesBoard[]> {
  const params = new URLSearchParams();
  if (q && q.trim()) params.set("q", q.trim());
  params.set("limit", String(limit));
  if (projectId) params.set("projectId", projectId);
  const data = await request<{ success: boolean; data: SpacesBoard[] }>(
    `${AUTH_API_URL}/api/v1/spaces/boards?${params.toString()}`,
  );
  return data.data;
}

export interface SpacesTriggerSummary {
  type: string;
  name: string;
  description?: string;
}

export interface SpacesTriggerPropertySchema {
  type?: string;
  description?: string;
  enum?: string[];
  default?: unknown;
  // present when type === "array"
  items?: { type?: string; enum?: string[] };
  // present when type === "object" (nested trigger OUTPUT fields, e.g. message.content)
  properties?: Record<string, SpacesTriggerPropertySchema>;
  // zodToJsonSchema may emit a nested object as a $ref into definitions
  $ref?: string;
}

interface SpacesTriggerSchemaDefinition {
  type?: string;
  properties?: Record<string, SpacesTriggerPropertySchema>;
  required?: string[];
  additionalProperties?: boolean;
}

type SpacesJsonSchema = {
  $ref?: string;
  definitions?: Record<string, SpacesTriggerSchemaDefinition>;
  properties?: Record<string, SpacesTriggerPropertySchema>;
  required?: string[];
};

export interface SpacesTriggerSchema {
  type: string;
  name: string;
  description?: string;
  // zodToJsonSchema with { name: 'config' } wraps properties under
  // { $ref: '#/definitions/config', definitions: { config: { properties, required } } }
  configSchema: SpacesJsonSchema;
  // Same wrapping for the trigger's OUTPUT payload — the fields available as
  // {{trigger.*}} variable refs in step configs.
  outputSchema?: SpacesJsonSchema;
}

export async function listSpacesTriggers(): Promise<SpacesTriggerSummary[]> {
  const res = await request<{ success: boolean; data: SpacesTriggerSummary[] }>(
    `${AUTH_API_URL}/api/v1/spaces/automations-schema/triggers`,
  );
  return res.data;
}

export async function getSpacesTriggerSchema(type: string): Promise<SpacesTriggerSchema> {
  const res = await request<{ success: boolean; data: SpacesTriggerSchema }>(
    `${AUTH_API_URL}/api/v1/spaces/automations-schema/triggers/${encodeURIComponent(type)}`,
  );
  return res.data;
}

export async function deleteChainWorkflow(id: string): Promise<void> {
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/chain-workflows/${id}`,
    { method: "DELETE" },
  );
}

// ── "Push to global" request flow ──────────────────────────────────────────

export interface WorkflowGlobalRequest {
  id: string;
  workflowId: string;
  workflow: ChainWorkflow;
  requestedByUserId: string;
  requestedByUser?: { id: string; name: string | null; email: string } | null;
  status: "pending" | "approved" | "rejected" | "cancelled";
  reviewedByUserId?: string | null;
  reviewNote?: string | null;
  createdAt: string;
}

/** Owner asks an admin to promote a workflow to global (available to all users). */
export async function requestWorkflowGlobal(
  workflowId: string,
  userId: string,
): Promise<{ alreadyGlobal?: boolean } | WorkflowGlobalRequest> {
  const data = await request<{ success: boolean; data: { alreadyGlobal?: boolean } | WorkflowGlobalRequest }>(
    `${AUTH_API_URL}/api/v1/chain-workflows/${workflowId}/request-global`,
    { method: "POST", headers: { "x-user-id": userId }, body: JSON.stringify({}) },
  );
  return data.data;
}

/** Admin: list pending global-promotion requests. */
export async function listWorkflowGlobalRequests(userId: string): Promise<WorkflowGlobalRequest[]> {
  const data = await request<{ success: boolean; data: WorkflowGlobalRequest[] }>(
    `${AUTH_API_URL}/api/v1/chain-workflows/global-requests`,
    { headers: { "x-user-id": userId } },
  );
  return data.data;
}

/** Admin: approve a request — sets the workflow global and wires all users. */
export async function approveWorkflowGlobalRequest(id: string, userId: string): Promise<void> {
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/chain-workflows/global-requests/${id}/approve`,
    { method: "POST", headers: { "x-user-id": userId } },
  );
}

/** Admin: reject a request. */
export async function rejectWorkflowGlobalRequest(id: string, userId: string, note?: string): Promise<void> {
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/chain-workflows/global-requests/${id}/reject`,
    {
      method: "POST",
      headers: { "x-user-id": userId, "Content-Type": "application/json" },
      body: JSON.stringify(note ? { note } : {}),
    },
  );
}

export async function upsertChannelChainBinding(payload: {
  /** Single channel (legacy). Provide this or `channelIds`. */
  channelId?: string;
  /** Multiple channels. Use ["*"] (or include "*") to bind across ALL channels. */
  channelIds?: string[];
  entryAgentSlug: string;
  workflowId: string;
  enabled?: boolean;
  /** Omit to bind for yourself (default). "*" = any user; else a real user id. */
  userId?: string;
}): Promise<ChainWorkflowBinding | ChainWorkflowBinding[]> {
  const data = await request<{ success: boolean; data: ChainWorkflowBinding | ChainWorkflowBinding[] }>(
    `${AUTH_API_URL}/api/v1/chain-workflows/bindings/upsert`,
    { method: "PUT", body: JSON.stringify(payload) },
  );
  return data.data;
}

export async function setChannelChainBindingEnabled(id: string, enabled: boolean): Promise<ChainWorkflowBinding> {
  const data = await request<{ success: boolean; data: ChainWorkflowBinding }>(
    `${AUTH_API_URL}/api/v1/chain-workflows/bindings/${id}`,
    { method: "PATCH", body: JSON.stringify({ enabled }) },
  );
  return data.data;
}

export async function deleteChannelChainBinding(id: string): Promise<void> {
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/chain-workflows/bindings/${id}`,
    { method: "DELETE" },
  );
}

export async function resolveChannelChainBinding(channelId: string, entryAgentSlug: string): Promise<ChainWorkflowBinding | null> {
  const data = await request<{ success: boolean; data: ChainWorkflowBinding | null }>(
    `${AUTH_API_URL}/api/v1/chain-workflows/bindings/resolve?channelId=${encodeURIComponent(channelId)}&entryAgentSlug=${encodeURIComponent(entryAgentSlug)}`,
  );
  return data.data;
}

export interface GitHubDeviceCode {
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export async function initiateGitHubLogin(slug: string, userId: string): Promise<GitHubDeviceCode> {
  const data = await request<{ success: boolean; data: GitHubDeviceCode }>(
    `${AUTH_API_URL}/api/v1/agents/${slug}/user-config/${userId}/github-login`,
    { method: "POST" },
  );
  return data.data;
}

export async function pollGitHubLogin(slug: string, userId: string): Promise<{ status: string }> {
  const data = await request<{ success: boolean; data?: { status: string }; error?: string }>(
    `${AUTH_API_URL}/api/v1/agents/${slug}/user-config/${userId}/github-poll`,
    { method: "POST" },
  );
  if (!data.success) {
    throw new Error(data.error ?? "Authorization failed");
  }
  return data.data!;
}

export async function listClaudeModels(
  slug: string,
  userId: string,
  payload?: { apiKey?: string; baseUrl?: string; authType?: string },
): Promise<ClaudeModelInfo[]> {
  const data = await request<{ success: boolean; data: ClaudeModelInfo[] }>(
    `${AUTH_API_URL}/api/v1/agents/${slug}/user-config/${userId}/claude-models`,
    { method: "POST", body: JSON.stringify(payload ?? {}) },
  );
  return data.data;
}

function readCookie(name: string): string | undefined {
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

// Get the active Spaces user JWT from cookies.
// Spaces authV2 stores the JWT in `xyne_ws_<workspaceId>_token`, selected by
// the `xyne_last_workspace` cookie. `google_access_token` is a legacy fallback
// but during the pending-auth window it holds a JSON blob — skip it unless
// it looks like a JWT.
function getGoogleToken(): string | undefined {
  const lastWorkspace = readCookie("xyne_last_workspace");
  if (lastWorkspace) {
    const wsToken = readCookie(`xyne_ws_${lastWorkspace}_token`);
    if (wsToken) return wsToken;
  }
  const legacy = readCookie("google_access_token");
  if (legacy && legacy.split(".").length === 3) return legacy;
  return undefined;
}

export async function registerAgentApp(slug: string): Promise<void> {
  const userToken = getGoogleToken();
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/agents/${slug}/register-app`,
    {
      method: "POST",
      body: JSON.stringify({ userToken }),
    },
  );
}

export async function autoConnectSpaces(userId: string): Promise<void> {
  // Token is sent automatically via httpOnly cookie through the proxy
  // Also try reading from JS cookie as fallback (non-httpOnly setups)
  const token = getGoogleToken();
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/users/${userId}/connections/auto-connect-spaces`,
    { method: "POST", body: JSON.stringify(token ? { spacesToken: token } : {}) },
  );
}

// ── Google OAuth ──────────────────────────────────────────────────────

/** Start the Google OAuth flow — returns the consent URL to redirect the user to. */
export async function connectGoogle(userId: string): Promise<string> {
  const data = await request<{ success: boolean; data: { authUrl: string } }>(
    `${AUTH_API_URL}/api/v1/users/${userId}/oauth/google/authorize`,
    { method: "POST", body: JSON.stringify({}) },
  );
  return data.data.authUrl;
}

/**
 * Generic OAuth connect for any connector the backend flags `oauth: true`
 * (attio, honeycomb, … and any DB connector with connectorMeta.authMethod=
 * "oauth"). All OAuth routes share the path `/oauth/<type>/authorize` and
 * return `{ authUrl }`; the caller redirects the browser there. google/microsoft
 * keep their dedicated helpers (extra callback handling), so they aren't routed
 * through here.
 */
export async function connectOAuth(userId: string, serverType: string): Promise<string> {
  const data = await request<{ success: boolean; data: { authUrl: string } }>(
    `${AUTH_API_URL}/api/v1/users/${userId}/oauth/${encodeURIComponent(serverType)}/authorize`,
    { method: "POST", body: JSON.stringify({}) },
  );
  return data.data.authUrl;
}

/** Check if a user has a Google connection. */
export function hasGoogleConnection(connections: UserConnection[]): boolean {
  return connections.some((c) => c.mcpServer.type === "google");
}

// ── Microsoft OAuth ──────────────────────────────────────────────────

/** Start the Microsoft OAuth flow — returns the consent URL to redirect the user to. */
export async function connectMicrosoft(userId: string): Promise<string> {
  const data = await request<{ success: boolean; data: { authUrl: string } }>(
    `${AUTH_API_URL}/api/v1/users/${userId}/oauth/microsoft/authorize`,
    { method: "POST", body: JSON.stringify({}) },
  );
  return data.data.authUrl;
}

/** Check if a user has a Microsoft connection. */
export function hasMicrosoftConnection(connections: UserConnection[]): boolean {
  return connections.some((c) => c.mcpServer.type === "microsoft");
}

// ── Calendly OAuth ─────────────────────────────────────────────────────

/** Start the Calendly OAuth flow (DCR + PKCE) — returns the consent URL. */
export async function connectCalendly(userId: string): Promise<string> {
  const data = await request<{ success: boolean; data: { authUrl: string } }>(
    `${AUTH_API_URL}/api/v1/users/${userId}/oauth/calendly/authorize`,
    { method: "POST", body: JSON.stringify({}) },
  );
  return data.data.authUrl;
}

// ── JotForm OAuth ──────────────────────────────────────────────────────

/** Start the JotForm OAuth flow (DCR + PKCE) — returns the consent URL. */
export async function connectJotForm(userId: string): Promise<string> {
  const data = await request<{ success: boolean; data: { authUrl: string } }>(
    `${AUTH_API_URL}/api/v1/users/${userId}/oauth/jotform/authorize`,
    { method: "POST", body: JSON.stringify({}) },
  );
  return data.data.authUrl;
}

// ── DocuSign OAuth ──────────────────────────────────────────────

/** Start the DocuSign OAuth flow — returns the consent URL. */
export async function connectDocuSign(userId: string): Promise<string> {
  const data = await request<{ success: boolean; data: { authUrl: string } }>(
    `${AUTH_API_URL}/api/v1/users/${userId}/oauth/docusign/authorize`,
    { method: "POST", body: JSON.stringify({}) },
  );
  return data.data.authUrl;
}

// ── Egnyte OAuth ───────────────────────────────────────────────────────────────

/** Start the Egnyte OAuth flow — domain is read from EGNYTE_DOMAIN on the server. */
export async function connectEgnyte(userId: string): Promise<string> {
  const data = await request<{ success: boolean; data: { authUrl: string } }>(
    `${AUTH_API_URL}/api/v1/users/${userId}/oauth/egnyte/authorize`,
    { method: "POST", body: JSON.stringify({}) },
  );
  return data.data.authUrl;
}

// ── Miro OAuth ────────────────────────────────────────────────────────────────

/** Start the Miro OAuth flow (DCR + PKCE, confidential client) — returns the consent URL. */
export async function connectMiro(userId: string): Promise<string> {
  const data = await request<{ success: boolean; data: { authUrl: string } }>(
    `${AUTH_API_URL}/api/v1/users/${userId}/oauth/miro/authorize`,
    { method: "POST", body: JSON.stringify({}) },
  );
  return data.data.authUrl;
}

// ── Webflow OAuth ──────────────────────────────────────────────────────────

/** Start the Webflow OAuth flow (DCR + PKCE, public client) — returns the consent URL. */
export async function connectWebflow(userId: string): Promise<string> {
  const data = await request<{ success: boolean; data: { authUrl: string } }>(
    `${AUTH_API_URL}/api/v1/users/${userId}/oauth/webflow/authorize`,
    { method: "POST", body: JSON.stringify({}) },
  );
  return data.data.authUrl;
}

// ── Wix OAuth ────────────────────────────────────────────────────────────────

/** Start the Wix OAuth flow (DCR + PKCE, public client) — returns the consent URL. */
export async function connectWix(userId: string): Promise<string> {
  const data = await request<{ success: boolean; data: { authUrl: string } }>(
    `${AUTH_API_URL}/api/v1/users/${userId}/oauth/wix/authorize`,
    { method: "POST", body: JSON.stringify({}) },
  );
  return data.data.authUrl;
}

// ── Attio OAuth ──────────────────────────────────────────────────────────────

/** Start the Attio OAuth flow (DCR + PKCE, public client) — returns the consent URL. */
export async function connectAttio(userId: string): Promise<string> {
  const data = await request<{ success: boolean; data: { authUrl: string } }>(
    `${AUTH_API_URL}/api/v1/users/${userId}/oauth/attio/authorize`,
    { method: "POST", body: JSON.stringify({}) },
  );
  return data.data.authUrl;
}

export async function connectMailerLite(userId: string): Promise<string> {
  const data = await request<{ success: boolean; data: { authUrl: string } }>(
    `${AUTH_API_URL}/api/v1/users/${userId}/oauth/mailerlite/authorize`,
    { method: "POST", body: JSON.stringify({}) },
  );
  return data.data.authUrl;
}

// ── Honeycomb OAuth ────────────────────────────────────────────────────────────

/** Start the Honeycomb OAuth flow (DCR + PKCE) — returns the consent URL. */
export async function connectHoneycomb(userId: string): Promise<string> {
  const data = await request<{ success: boolean; data: { authUrl: string } }>(
    `${AUTH_API_URL}/api/v1/users/${userId}/oauth/honeycomb/authorize`,
    { method: "POST", body: JSON.stringify({}) },
  );
  return data.data.authUrl;
}

// ── Customer.io OAuth ─────────────────────────────────────────────────────────
/** Start the Customer.io OAuth flow (DCR + PKCE) — returns the consent URL. */
export async function connectCustomerio(userId: string): Promise<string> {
  const data = await request<{ success: boolean; data: { authUrl: string } }>(
    `${AUTH_API_URL}/api/v1/users/${userId}/oauth/customerio/authorize`,
    { method: "POST", body: JSON.stringify({}) },
  );
  return data.data.authUrl;
}

// ── LinkedIn via RapidAPI (API key) ───────────────────────────────────────

/**
 * Sends the user's X-RapidAPI-Key to the backend for validation and storage.
 * Returns the success message (no redirect needed — this is not an OAuth flow).
 */
export async function connectLinkedInRapidApi(
  userId: string,
  apiKey: string,
): Promise<void> {
  await request<{ success: boolean; data: { message: string } }>(
    `${AUTH_API_URL}/api/v1/users/${userId}/oauth/rapidapi-linkedin/connect`,
    { method: "POST", body: JSON.stringify({ apiKey }) },
  );
}


export async function createAgentApp(slug: string): Promise<void> {
  const userToken = getGoogleToken();
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/agents/${slug}/create-app`,
    { method: "POST", body: JSON.stringify({ userToken }) },
  );
}

export async function installAgentApp(slug: string): Promise<void> {
  const userToken = getGoogleToken();
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/agents/${slug}/install-app`,
    { method: "POST", body: JSON.stringify({ userToken }) },
  );
}

export async function configureAgentWebhook(slug: string): Promise<void> {
  const userToken = getGoogleToken();
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/agents/${slug}/configure-webhook`,
    { method: "POST", body: JSON.stringify({ userToken }) },
  );
}

export async function grantAgentPermissions(slug: string): Promise<void> {
  const userToken = getGoogleToken();
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/agents/${slug}/grant-permissions`,
    { method: "POST", body: JSON.stringify({ userToken }) },
  );
}

export async function uploadAgentPicture(slug: string, file: File): Promise<{ pictureUrl?: string }> {
  const form = new FormData();
  form.append("picture", file, file.name);
  const res = await fetch(`${AUTH_API_URL}/api/v1/agents/${slug}/upload-picture`, {
    method: "POST",
    credentials: "include",
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `Upload failed: HTTP ${res.status}`);
  }
  const body = (await res.json()) as { success: boolean; data?: { pictureUrl?: string } };
  return body.data ?? {};
}

// ── Scheduled Jobs ──────────────────────────────────────────────────

export async function listScheduledJobs(params: {
  agentSlug?: string;
  userId?: string;
  status?: string;
}): Promise<ScheduledJob[]> {
  const qs = new URLSearchParams();
  if (params.agentSlug) qs.set("agentSlug", params.agentSlug);
  if (params.userId) qs.set("userId", params.userId);
  if (params.status) qs.set("status", params.status);
  const data = await request<{ success: boolean; data: ScheduledJob[] }>(
    `${AUTH_API_URL}/api/v1/scheduled-jobs?${qs.toString()}`,
  );
  return data.data;
}

export async function deleteScheduledJob(id: string): Promise<void> {
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/scheduled-jobs/${id}`,
    { method: "DELETE" },
  );
}

export async function updateScheduledJob(
  id: string,
  patch: {
    replyMode?: "thread" | "channel";
    label?: string | null;
    targetChannelId?: string | null;
    cronExpression?: string;
    nextRunAt?: string;
  },
): Promise<ScheduledJob> {
  const data = await request<{ success: boolean; data: ScheduledJob }>(
    `${AUTH_API_URL}/api/v1/scheduled-jobs/${id}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    },
  );
  return data.data;
}

export async function listScheduledJobRuns(agentSlug: string): Promise<ScheduledJobRun[]> {
  const data = await request<{ success: boolean; data: ScheduledJobRun[] }>(
    `${AUTH_API_URL}/api/v1/scheduled-jobs/runs?agentSlug=${encodeURIComponent(agentSlug)}`,
  );
  return data.data;
}

// ── Admin API ────────────────────────────────────────────────────────

export interface AdminRole {
  id: string;
  userId: string;
  role: string;
  grantedBy: string | null;
  createdAt: string;
  user: { id: string; name: string; email: string };
}

export interface AuditLogEntry {
  id: string;
  actorUserId: string | null;
  eventType: string;
  targetId: string;
  description: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export async function checkIsAdmin(userId: string): Promise<boolean> {
  const data = await request<{ success: boolean; data: { isAdmin: boolean } }>(
    `${AUTH_API_URL}/api/v1/admin/roles/check/${userId}`,
    { headers: { "x-user-id": userId } },
  );
  return data.data.isAdmin;
}

export async function listAdminRoles(userId: string): Promise<AdminRole[]> {
  const data = await request<{ success: boolean; data: AdminRole[] }>(
    `${AUTH_API_URL}/api/v1/admin/roles`,
    { headers: { "x-user-id": userId } },
  );
  return data.data;
}

export async function grantAdmin(userId: string, targetUserId: string): Promise<void> {
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/admin/roles`,
    { method: "POST", headers: { "x-user-id": userId }, body: JSON.stringify({ userId: targetUserId }) },
  );
}

export async function revokeAdmin(userId: string, targetUserId: string): Promise<void> {
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/admin/roles/${targetUserId}`,
    { method: "DELETE", headers: { "x-user-id": userId } },
  );
}

export async function listAuditLogs(userId: string, limit = 50): Promise<AuditLogEntry[]> {
  const data = await request<{ success: boolean; data: AuditLogEntry[] }>(
    `${AUTH_API_URL}/api/v1/admin/audit-logs?limit=${limit}`,
    { headers: { "x-user-id": userId } },
  );
  return data.data;
}

/**
 * Paginated variant of audit-log listing. Returns rows + total so the
 * admin UI can render Prev/Next controls instead of capping at 50.
 */
export async function listAuditLogsPaged(
  userId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<{ rows: AuditLogEntry[]; total: number }> {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  const data = await request<{ success: boolean; data: AuditLogEntry[]; total: number }>(
    `${AUTH_API_URL}/api/v1/admin/audit-logs?limit=${limit}&offset=${offset}`,
    { headers: { "x-user-id": userId } },
  );
  return { rows: data.data, total: data.total };
}

export interface AgentUsageStat {
  agentSlug: string;
  runs: number;
  tokensIn: number;
  tokensOut: number;
  tokensCacheRead: number;
  tokensCacheWrite: number;
}

export async function listAgentUsageStats(userId: string, days: number | "all" = 30): Promise<AgentUsageStat[]> {
  const data = await request<{ success: boolean; data: AgentUsageStat[] }>(
    `${AUTH_API_URL}/api/v1/admin/usage/stats?days=${days}`,
    { headers: { "x-user-id": userId } },
  );
  return data.data;
}

export interface AdminScheduledJob extends ScheduledJob {
  user: { id: string; name: string; email: string } | null;
}

export async function listAdminScheduledJobs(
  userId: string,
  params: { status?: string; agentSlug?: string; userId?: string; limit?: number; offset?: number } = {},
): Promise<{ rows: AdminScheduledJob[]; total: number }> {
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.agentSlug) qs.set("agentSlug", params.agentSlug);
  if (params.userId) qs.set("userId", params.userId);
  if (params.limit != null) qs.set("limit", String(params.limit));
  if (params.offset != null) qs.set("offset", String(params.offset));
  const data = await request<{ success: boolean; data: { rows: AdminScheduledJob[]; total: number } }>(
    `${AUTH_API_URL}/api/v1/admin/scheduled-jobs?${qs.toString()}`,
    { headers: { "x-user-id": userId } },
  );
  return data.data;
}

// ── Global MCP Credentials (admin) ──────────────────────────────────

export interface AdminMcpServerSummary {
  id: string;
  type: string;
  name: string;
  description: string | null;
  enabled: boolean;
  allowGlobalFallback: boolean;
  hasGlobalCredentials: boolean;
  globalCredentialsUpdatedAt: string | null;
  globalCredentialsSetByUserId: string | null;
}

export interface AdminMcpGlobalCredsDetail {
  type: string;
  hasCredentials: boolean;
  credentialKeys?: string[];
  updatedAt?: string;
  setByUserId?: string;
}

export async function listAdminMcpServers(userId: string): Promise<AdminMcpServerSummary[]> {
  const data = await request<{ success: boolean; data: AdminMcpServerSummary[] }>(
    `${AUTH_API_URL}/api/v1/admin/mcp-servers`,
    { headers: { "x-user-id": userId } },
  );
  return data.data;
}

export async function getAdminMcpGlobalCreds(userId: string, type: string): Promise<AdminMcpGlobalCredsDetail> {
  const data = await request<{ success: boolean; data: AdminMcpGlobalCredsDetail }>(
    `${AUTH_API_URL}/api/v1/admin/mcp-servers/${encodeURIComponent(type)}/global-credentials`,
    { headers: { "x-user-id": userId } },
  );
  return data.data;
}

export async function setAdminMcpGlobalCreds(
  userId: string,
  type: string,
  credentials: Record<string, unknown>,
): Promise<void> {
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/admin/mcp-servers/${encodeURIComponent(type)}/global-credentials`,
    { method: "PUT", headers: { "x-user-id": userId }, body: JSON.stringify({ credentials }) },
  );
}

export async function deleteAdminMcpGlobalCreds(userId: string, type: string): Promise<void> {
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/admin/mcp-servers/${encodeURIComponent(type)}/global-credentials`,
    { method: "DELETE", headers: { "x-user-id": userId } },
  );
}

export async function setAdminMcpFallbackFlag(
  userId: string,
  type: string,
  allow: boolean,
): Promise<void> {
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/admin/mcp-servers/${encodeURIComponent(type)}/global-fallback`,
    { method: "PUT", headers: { "x-user-id": userId }, body: JSON.stringify({ allow }) },
  );
}

// ── Agent Requests ──────────────────────────────────────────────────

export interface AgentRequestItem {
  id: string;
  targetType: string;
  agentId?: string;
  agentSlug?: string;
  skillId?: string;
  skillSlug?: string;
  requestType: string;
  requesterId: string;
  status: string;
  createdAt: string;
  agentName?: string;
  skillName?: string;
  requesterName?: string;
  requesterEmail?: string;
  agentOwnerName?: string;
  agentOwnerEmail?: string;
}

export async function submitAgentRequest(slug: string, userId: string, requestType: "push_to_spaces" | "push_to_global"): Promise<void> {
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/agents/${slug}/request`,
    { method: "POST", headers: { "x-user-id": userId }, body: JSON.stringify({ requestType }) },
  );
}

// ── Agent cloning ─────────────────────────────────────────────────────────────

export interface CloneRequestItem {
  id: string;
  agentId?: string;
  agentSlug?: string;
  agentName?: string;
  requestType: string;
  requesterId: string;
  requesterName?: string;
  requesterEmail?: string;
  status: string;
  resultAgentId?: string | null;
  createdAt: string;
}

/**
 * Result of POST /agents/:slug/clone.
 *  - cloned=true  → the caller was privileged; `agent` is the new clone.
 *  - cloned=false → an approval request was raised; `request` is pending.
 */
export type CloneAgentResult =
  | { cloned: true; agent: Agent }
  | { cloned: false; request: CloneRequestItem };

export async function cloneAgent(slug: string, userId: string, name?: string): Promise<CloneAgentResult> {
  const data = await request<{ success: boolean; data: Agent | CloneRequestItem; cloned: boolean }>(
    `${AUTH_API_URL}/api/v1/agents/${slug}/clone`,
    { method: "POST", headers: { "x-user-id": userId }, body: JSON.stringify(name ? { name } : {}) },
  );
  return data.cloned
    ? { cloned: true, agent: data.data as Agent }
    : { cloned: false, request: data.data as CloneRequestItem };
}

/** Clone requests awaiting MY approval (agents I own). */
export async function listIncomingCloneRequests(userId: string): Promise<CloneRequestItem[]> {
  const data = await request<{ success: boolean; data: CloneRequestItem[] }>(
    `${AUTH_API_URL}/api/v1/agents/clone-requests/incoming`,
    { headers: { "x-user-id": userId } },
  );
  return data.data;
}

/** Clone requests I raised (their status). */
export async function listOutgoingCloneRequests(userId: string): Promise<CloneRequestItem[]> {
  const data = await request<{ success: boolean; data: CloneRequestItem[] }>(
    `${AUTH_API_URL}/api/v1/agents/clone-requests/outgoing`,
    { headers: { "x-user-id": userId } },
  );
  return data.data;
}

export async function approveCloneRequest(requestId: string, userId: string): Promise<Agent | null> {
  const data = await request<{ success: boolean; data: Agent | null }>(
    `${AUTH_API_URL}/api/v1/agents/clone-requests/${requestId}/approve`,
    { method: "POST", headers: { "x-user-id": userId } },
  );
  return data.data;
}

export async function rejectCloneRequest(requestId: string, userId: string, note?: string): Promise<void> {
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/agents/clone-requests/${requestId}/reject`,
    { method: "POST", headers: { "x-user-id": userId, "Content-Type": "application/json" }, body: JSON.stringify(note ? { note } : {}) },
  );
}

export async function listPendingRequests(userId: string): Promise<AgentRequestItem[]> {
  const data = await request<{ success: boolean; data: AgentRequestItem[] }>(
    `${AUTH_API_URL}/api/v1/agents/requests/pending`,
    { headers: { "x-user-id": userId } },
  );
  return data.data;
}

// ── Control Center Approvals ─────────────────────────────────────────

export interface Approval {
  id: string;
  agentSlug: string;
  agentName: string;
  sessionId: string;
  action: string;
  targetSystem: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  minutesAgo: number;
}

export interface ControlCenterMetrics {
  activeSessions: number;
  runningAgents: number;
  pendingApprovals: number;
  toolCallsToday: number;
}

export interface ControlCenterAgent {
  id: string;
  sessionId: string;
  name: string;
  initials: string;
  avatarBg: string;
  avatarText: string;
  agentSlug: string;
  task: string;
  status: "running" | "waiting" | "blocked" | "completed" | "failed";
  integration: string;
  startedAt: string;
  minutesAgo: number;
  error?: string;
  progress?: number;
  deepLink?: string;
}

export interface ControlCenterFailure {
  sessionId: string;
  agentSlug: string;
  agentName: string;
  task: string;
  error: { message: string; recoveryActions: string[] };
  failedAt: string;
  deepLink?: string;
}

export async function listPendingApprovals(): Promise<Approval[]> {
  const data = await request<{ success: boolean; data: Approval[] }>(
    `${AUTH_API_URL}/api/v1/control-center/approvals`,
  );
  return data.data ?? [];
}

export async function listControlCenterApprovals(): Promise<Approval[]> {
  return listPendingApprovals();
}

export async function getControlCenterMetrics(): Promise<ControlCenterMetrics> {
  const data = await request<{ success: boolean; data: ControlCenterMetrics }>(
    `${AUTH_API_URL}/api/v1/control-center/metrics`,
  );
  return data.data;
}

export async function getControlCenterAgents(limit = 50): Promise<ControlCenterAgent[]> {
  const data = await request<{ success: boolean; data: ControlCenterAgent[] }>(
    `${AUTH_API_URL}/api/v1/control-center/agents?limit=${limit}`,
  );
  return data.data;
}

export async function getControlCenterFailures(limit = 10): Promise<ControlCenterFailure[]> {
  const data = await request<{ success: boolean; data: ControlCenterFailure[] }>(
    `${AUTH_API_URL}/api/v1/control-center/failures?limit=${limit}`,
  );
  return data.data ?? [];
}

export async function approveControlCenterAction(id: string): Promise<void> {
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/control-center/approvals/${id}/approve`,
    { method: "POST" },
  );
}

export async function rejectControlCenterAction(id: string): Promise<void> {
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/control-center/approvals/${id}/reject`,
    { method: "POST" },
  );
}

export async function retryControlCenterRun(sessionId: string): Promise<{ agentSlug: string; task: string }> {
  const data = await request<{ success: boolean; data: { agentSlug: string; task: string } }>(
    `${AUTH_API_URL}/api/v1/control-center/runs/${encodeURIComponent(sessionId)}/retry`,
    { method: "POST" },
  );
  return data.data;
}

export async function resolveControlCenterRun(sessionId: string): Promise<void> {
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/control-center/runs/${encodeURIComponent(sessionId)}/resolve`,
    { method: "POST" },
  );
}

export async function approveRequest(requestId: string, userId: string): Promise<void> {
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/agents/requests/${requestId}/approve`,
    { method: "POST", headers: { "x-user-id": userId } },
  );
}

export async function rejectRequest(requestId: string, userId: string, note?: string): Promise<void> {
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/agents/requests/${requestId}/reject`,
    { method: "POST", headers: { "x-user-id": userId }, body: JSON.stringify({ note }) },
  );
}

export async function promoteAgent(slug: string, userId: string): Promise<void> {
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/agents/${slug}/promote`,
    { method: "POST", headers: { "x-user-id": userId } },
  );
}

export async function demoteAgent(slug: string, userId: string): Promise<void> {
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/agents/${slug}/demote`,
    { method: "POST", headers: { "x-user-id": userId } },
  );
}

export async function listAgentShares(slug: string, userId: string): Promise<Array<{ id: string; userId: string; role: string; user: { id: string; name: string; email: string } }>> {
  const data = await request<{ success: boolean; data: Array<{ id: string; userId: string; role: string; user: { id: string; name: string; email: string } }> }>(
    `${AUTH_API_URL}/api/v1/agents/${slug}/shares`,
    { headers: { "x-user-id": userId } },
  );
  return data.data;
}

// Search the user directory (claw-auth User table) by name OR email for the
// contributor picker. Backed by GET /users?q= (case-insensitive, top 20).
// NOTE: only returns users who already exist in claw-auth (have used the
// product) — it is NOT the full Spaces org directory.
export async function searchUsers(
  q: string,
  requesterId: string,
): Promise<Array<{ id: string; name: string; email: string }>> {
  const data = await request<{ success: boolean; data: Array<{ id: string; name: string; email: string }> }>(
    `${AUTH_API_URL}/api/v1/users?q=${encodeURIComponent(q)}`,
    { headers: { "x-user-id": requesterId } },
  );
  return data.data ?? [];
}

export async function addAgentShare(slug: string, requesterId: string, targetUserId: string, role: "VIEWER" | "EDITOR" | "CONTRIBUTOR"): Promise<void> {
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/agents/${slug}/shares`,
    {
      method: "POST",
      headers: { "x-user-id": requesterId, "Content-Type": "application/json" },
      body: JSON.stringify({ userId: targetUserId, role }),
    },
  );
}

export async function removeAgentShare(slug: string, requesterId: string, targetUserId: string): Promise<void> {
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/agents/${slug}/shares/${targetUserId}`,
    { method: "DELETE", headers: { "x-user-id": requesterId } },
  );
}

// ── Agent-scoped MCP connections ────────────────────────────────────
//
// Lists / upserts / deletes credentials pinned to a specific agent. The
// runtime credential resolver picks these before user-level connections.
// Server never returns decrypted creds — only metadata about whether a
// connection exists.

export interface AgentMcpConnectionMeta {
  id: string;
  mcpServerId: string;
  mcpServerType: string;
  mcpServerName: string;
  /** Per-agent, per-server stable identifier. 'default' for legacy single
   *  instances. Used in the tool prefix (`<serverType>-<slug>__<tool>`)
   *  and in the DELETE URL. */
  slug: string;
  /** UI label. Falls back to mcpServerName when never set. */
  displayName: string;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function listAgentMcpConnections(slug: string, requesterId: string): Promise<AgentMcpConnectionMeta[]> {
  const data = await request<{ success: boolean; data: AgentMcpConnectionMeta[] }>(
    `${AUTH_API_URL}/api/v1/agents/${slug}/mcp/connections`,
    { headers: { "x-user-id": requesterId } },
  );
  return data.data;
}

export async function upsertAgentMcpConnection(
  slug: string,
  requesterId: string,
  mcpServerType: string,
  credentials: Record<string, unknown>,
  instance?: { slug?: string; displayName?: string },
): Promise<AgentMcpConnectionMeta> {
  const data = await request<{ success: boolean; data: AgentMcpConnectionMeta }>(
    `${AUTH_API_URL}/api/v1/agents/${slug}/mcp/connections`,
    {
      method: "POST",
      headers: { "x-user-id": requesterId, "Content-Type": "application/json" },
      body: JSON.stringify({
        mcpServerType,
        credentials,
        ...(instance?.slug ? { slug: instance.slug } : {}),
        ...(instance?.displayName ? { displayName: instance.displayName } : {}),
      }),
    },
  );
  return data.data;
}

export async function deleteAgentMcpConnection(
  slug: string,
  requesterId: string,
  mcpServerType: string,
  instanceSlug = "default",
): Promise<void> {
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/agents/${slug}/mcp/connections/${encodeURIComponent(mcpServerType)}/${encodeURIComponent(instanceSlug)}`,
    { method: "DELETE", headers: { "x-user-id": requesterId } },
  );
}

/**
 * Fork a subagent for one of this agent's MCP instances. Copies the source
 * subagent's definition (prompt, tools, skills) into a new SubagentDefinition
 * with `mcpInstanceMap` pinned, and (optionally) appends the new subagent to
 * this agent's `config.tools.subagents` so it's enabled in the same call.
 *
 * Source MUST be a custom subagent (builtin forks not supported yet).
 */
export interface ForkSubagentResult {
  subagent: {
    id: string;
    name: string;
    description: string;
    systemPrompt: string;
    paramName: string;
    paramDescription: string;
    tools: unknown;
    mcpInstanceMap: Record<string, string>;
    createdByUserId: string | null;
    createdAt: string;
    updatedAt: string;
    skills: Array<{ id: string; slug: string; name: string }>;
  };
  agent: {
    slug: string;
    /** The agent's full updated `config.tools.subagents` array AFTER the fork
     *  (whether we appended or not). Lets the caller refresh local state
     *  without a separate GET. */
    subagents: string[];
  };
}

export async function forkSubagentForInstance(
  agentSlug: string,
  requesterId: string,
  payload: {
    sourceName: string;
    newName: string;
    mcpInstanceMap: Record<string, string>;
    enableOnAgent?: boolean;
  },
): Promise<ForkSubagentResult> {
  const data = await request<{ success: boolean; data: ForkSubagentResult }>(
    `${AUTH_API_URL}/api/v1/agents/${agentSlug}/fork-subagent`,
    {
      method: "POST",
      headers: { "x-user-id": requesterId, "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceName: payload.sourceName,
        newName: payload.newName,
        mcpInstanceMap: payload.mcpInstanceMap,
        enableOnAgent: payload.enableOnAgent ?? true,
      }),
    },
  );
  return data.data;
}

// ── Agent Chat API ──────────────────────────────────────────────────

export interface ChatAttachmentMeta {
  id: string;
  mimeType: string;
  originalFilename: string;
  size?: number;
  width?: number | null;
  height?: number | null;
}

export interface ChatMsg {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  status: string;
  createdAt: string;
  reasoning?: string | null;
  /** Tree parent for branching conversations. Null/undefined = root child. */
  parentId?: string | null;
  attachments?: ChatAttachmentMeta[];
  contextItems?: AttachedContextRef[];
}

export type ContextType = "channel" | "ticket" | "canvas" | "call";
export type ContextSearchType = ContextType | "all";

export interface ContextItem {
  id: string;
  type: ContextType;
  title: string;
  subtitle?: string;
  meta?: Record<string, unknown>;
}

export interface AttachedContextRef {
  type: ContextType;
  id: string;
  title: string;
  threadId?: string;
}

export async function uploadChatAttachments(
  slug: string,
  userId: string,
  files: File[],
): Promise<ChatAttachmentMeta[]> {
  const form = new FormData();
  for (const f of files) form.append("files", f, f.name);
  const res = await fetch(`${AUTH_API_URL}/api/v1/agent-chat/${slug}/chat/attachments/upload`, {
    method: "POST",
    credentials: "include",
    headers: { "x-user-id": userId },
    body: form,
  });
  if (!res.ok) throw new Error(`Upload failed: HTTP ${res.status}`);
  const json = (await res.json()) as { success: boolean; data: ChatAttachmentMeta[]; error?: string };
  if (!json.success) throw new Error(json.error ?? "Upload failed");
  return json.data;
}

export function chatAttachmentDownloadUrl(attachmentId: string): string {
  return `${AUTH_API_URL}/api/v1/agent-chat/attachments/${attachmentId}/download`;
}

export interface SlidePptConfig {
  title?: string;
  layout?: string;
  slides: Array<Record<string, unknown>>;
}

export async function fetchChatAttachmentSlideJson(
  attachmentId: string,
  userId: string,
): Promise<SlidePptConfig | null> {
  const res = await fetch(
    `${AUTH_API_URL}/api/v1/agent-chat/attachments/${attachmentId}/slide-json`,
    { credentials: "include", headers: { "x-user-id": userId } },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`slide-json HTTP ${res.status}`);
  const body = (await res.json()) as { success: boolean; data?: SlidePptConfig; error?: string };
  if (!body.success || !body.data) return null;
  return body.data;
}

export async function searchContext(
  slug: string,
  userId: string,
  opts?: { type?: ContextSearchType; q?: string; limit?: number },
): Promise<ContextItem[]> {
  const type = opts?.type ?? "all";
  const q = opts?.q ?? "";
  const limit = typeof opts?.limit === "number" ? Math.max(1, Math.min(50, Math.floor(opts.limit))) : 20;
  const params = new URLSearchParams({
    type,
    q,
    limit: String(limit),
  });
  const res = await fetch(`${AUTH_API_URL}/api/v1/agent-chat/${slug}/context/search?${params.toString()}`, {
    credentials: "include",
    headers: { "x-user-id": userId },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Context search failed: HTTP ${res.status}`);
  }
  const body = (await res.json()) as { items?: ContextItem[] };
  return body.items ?? [];
}

/** Raw attachment streamed mid-session (before GCS persistence).
 *  `data` is base64. The frontend renders it as a blob; the final `done`
 *  event ships the persisted GCS-backed ChatAttachmentMeta (with a real id)
 *  that replaces this placeholder. */
export interface StreamedAttachment {
  fileName: string;
  mimeType: string;
  data: string;
  metadata?: Record<string, unknown>;
}

export interface DebugEventRecord {
  seq: number;
  at: string;
  kind: string;
  turn?: number;
  llmCall?: number;
  toolCallId?: string;
  parentToolCallId?: string;
  subagentName?: string;
  data: Record<string, unknown>;
}

export interface StreamCallbacks {
  onProgress?: (toolLabel: string) => void;
  onInvocation?: (inv: ToolInvocation) => void;
  onReasoningDelta?: (delta: string) => void;
  onTextDelta?: (delta: string) => void;
  onAttachment?: (att: StreamedAttachment) => void;
  onDebugEvent?: (event: DebugEventRecord) => void;
  onDebugArtifactsReady?: (meta: { sessionId?: string; conversationId?: string }) => void;
  onRunMeta?: (meta: { sessionId: string }) => void;
  /** Fires on the SSE `meta` event with the real conversationId — sent
   *  immediately after the backend creates the conversation row, well before
   *  the agent finishes thinking. Lets the frontend surface the in-flight
   *  conversation in the sidebar without waiting for the stream to complete. */
  onConversationId?: (conversationId: string) => void;
}

export interface PendingAction {
  serverType: string;
  tool: string;
  params: Record<string, unknown>;
  userId: string;
  signature: string;
}

export interface ChatReply {
  /** Persisted assistant message id (server-assigned). The frontend uses this
   *  to swap its optimistic local id once the run finishes. */
  id?: string;
  /** Persisted user message id for this turn. Same swap reason as `id`. */
  userMessageId?: string;
  role: string;
  content: string;
  status: string;
  /** Tree parent the assistant attached under — relayed so the client can
   *  stitch the optimistic placeholder into the persisted tree. */
  parentId?: string | null;
  pendingActions?: PendingAction[];
  attachments?: ChatAttachmentMeta[];
}

export async function sendChatMessage(
  slug: string,
  message: string,
  userId: string,
  conversationId: string | undefined,
  callbacks?: StreamCallbacks | ((toolLabel: string) => void),
  attachmentIds?: string[],
  attachedContext?: AttachedContextRef[],
  // Branching args (positional and forgiving for backward compat):
  //   - isRegenerate / parentUserMessageId
  //   - parentAssistantMessageIdOrSignal: either the assistant parent id OR
  //     a plain AbortSignal (legacy callers).
  //   - signalOrIsEditUserMessage: either an AbortSignal OR `true` to flag
  //     the call as an edit-user branch.
  //   - editedUserMessageId: id of the user message being edited.
  //   - signal: explicit terminal AbortSignal slot.
  isRegenerate?: boolean,
  parentUserMessageId?: string,
  parentAssistantMessageIdOrSignal?: string | AbortSignal,
  signalOrIsEditUserMessage?: AbortSignal | boolean,
  editedUserMessageId?: string,
  signal?: AbortSignal,
  requestOptions?: {
    disableTools?: boolean;
    additionalInstructions?: string;
  },
): Promise<{ conversationId: string; reply: ChatReply }> {
  // Backward-compat: allow passing a single onProgress function (old signature).
  const cb: StreamCallbacks = typeof callbacks === "function"
    ? { onProgress: callbacks }
    : (callbacks ?? {});

  const parentAssistantMessageId =
    typeof parentAssistantMessageIdOrSignal === "string" ? parentAssistantMessageIdOrSignal : undefined;
  // Resolve the request's AbortSignal across overload slots. Legacy callers
  // pass it in the parentAssistantMessageIdOrSignal slot; mid-vintage callers
  // pass it in signalOrIsEditUserMessage; new callers use the terminal `signal`.
  const requestSignal =
    parentAssistantMessageIdOrSignal instanceof AbortSignal
      ? parentAssistantMessageIdOrSignal
      : signalOrIsEditUserMessage instanceof AbortSignal
        ? signalOrIsEditUserMessage
        : signal;
  const isEditUserMessage = signalOrIsEditUserMessage === true;

  const res = await fetch(`${AUTH_API_URL}/api/v1/agent-chat/${slug}/chat`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", "x-user-id": userId },
    body: JSON.stringify({
      message,
      conversationId,
      userId,
      ...(attachmentIds?.length ? { attachmentIds } : {}),
      ...(attachedContext?.length ? { attachedContext } : {}),
      ...(isRegenerate ? { isRegenerate: true } : {}),
      ...(isEditUserMessage ? { isEditUserMessage: true } : {}),
      ...(parentUserMessageId ? { parentUserMessageId } : {}),
      ...(parentAssistantMessageId ? { parentAssistantMessageId } : {}),
      ...(editedUserMessageId ? { editedUserMessageId } : {}),
      ...(requestOptions?.disableTools ? { disableTools: true } : {}),
      ...(requestOptions?.additionalInstructions?.trim()
        ? { additionalInstructions: requestOptions.additionalInstructions.trim() }
        : {}),
    }),
    ...(requestSignal ? { signal: requestSignal } : {}),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";
  let convId = conversationId ?? "";
  let reply: ChatReply | null = null;
  let currentEvent = "";
  let dataLines: string[] = [];

  function processEvent() {
    if (!currentEvent || dataLines.length === 0) { currentEvent = ""; dataLines = []; return; }
    const dataStr = dataLines.join("\n");
    dataLines = [];
    try {
      const data = JSON.parse(dataStr);
      if (currentEvent === "meta" && data.conversationId) {
        convId = data.conversationId;
        if (cb.onConversationId) cb.onConversationId(String(data.conversationId));
      } else if (currentEvent === "run" && data.sessionId && cb.onRunMeta) {
        cb.onRunMeta({ sessionId: String(data.sessionId) });
      } else if (currentEvent === "progress" && data.toolLabel && cb.onProgress) {
        cb.onProgress(data.toolLabel);
      } else if (currentEvent === "tool" && data.toolInvocation && cb.onInvocation) {
        cb.onInvocation(data.toolInvocation as ToolInvocation);
      } else if (currentEvent === "reasoning" && typeof data.delta === "string" && cb.onReasoningDelta) {
        cb.onReasoningDelta(data.delta);
      } else if (currentEvent === "text" && typeof data.delta === "string" && cb.onTextDelta) {
        cb.onTextDelta(data.delta);
      } else if (currentEvent === "attachment" && data.attachment && cb.onAttachment) {
        cb.onAttachment(data.attachment as StreamedAttachment);
      } else if (currentEvent === "debug" && data.debugEvent && cb.onDebugEvent) {
        cb.onDebugEvent(data.debugEvent as DebugEventRecord);
      } else if (currentEvent === "debug_artifacts_ready" && cb.onDebugArtifactsReady) {
        cb.onDebugArtifactsReady({
          ...(data.sessionId ? { sessionId: String(data.sessionId) } : {}),
          ...(data.conversationId ? { conversationId: String(data.conversationId) } : {}),
        });
      } else if (currentEvent === "done") {
        reply = data;
      }
    } catch {}
    currentEvent = "";
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line === "") {
        // Blank line = end of SSE event
        processEvent();
      } else if (line.startsWith("event: ")) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith("data: ")) {
        dataLines.push(line.slice(6));
      } else if (dataLines.length > 0) {
        // Continuation of data (multi-line JSON)
        dataLines.push(line);
      }
    }
  }
  // Process any remaining event
  processEvent();

  if (!reply) throw new Error("No reply received");

  return { conversationId: convId, reply };
}

export async function cancelChatRun(
  slug: string,
  userId: string,
  sessionId: string,
): Promise<{ conversationId: string | null; status: string }> {
  const res = await fetch(`${AUTH_API_URL}/api/v1/agent-chat/${slug}/chat/cancel`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", "x-user-id": userId },
    body: JSON.stringify({ sessionId }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    data?: { conversationId?: string | null; status?: string };
    error?: string;
  };
  if (!res.ok || !json.success) {
    throw new Error(json.error ?? `Cancel failed: HTTP ${res.status}`);
  }
  return {
    conversationId: json.data?.conversationId ?? null,
    status: json.data?.status ?? "cancelled",
  };
}

/**
 * Fetch the input needed to regenerate the latest assistant response on a
 * conversation: the user message it was responding to and that message's id.
 * The caller posts a follow-up to /chat with isRegenerate=true to spawn a
 * sibling assistant under the same user parent.
 */
export async function regenerateChatMessage(
  slug: string,
  userId: string,
  conversationId: string,
): Promise<{ replayMessage: string; parentUserMessageId: string }> {
  const res = await fetch(
    `${AUTH_API_URL}/api/v1/agent-chat/${slug}/chat/${conversationId}/regenerate`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "x-user-id": userId },
    },
  );
  const json = (await res.json()) as {
    success?: boolean;
    data?: { replayMessage?: string; parentUserMessageId?: string };
    error?: string;
  };
  if (!res.ok || !json.success) {
    throw new Error(json.error ?? `Regenerate failed: HTTP ${res.status}`);
  }
  return {
    replayMessage: json.data?.replayMessage ?? "",
    parentUserMessageId: json.data?.parentUserMessageId ?? "",
  };
}

/**
 * Approve a pending write action from the chat UI. Verifies + executes on the
 * server; returns the tool's text result so the caller can render it inline.
 */
export async function approveChatAction(
  slug: string,
  userId: string,
  pendingAction: PendingAction,
): Promise<string> {
  const res = await fetch(`${AUTH_API_URL}/api/v1/agent-chat/${slug}/chat/approve-action`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", "x-user-id": userId },
    body: JSON.stringify({ pendingAction, userId }),
  });
  const json = (await res.json()) as { success: boolean; data?: { content: string }; error?: string };
  if (!res.ok || !json.success) throw new Error(json.error ?? `Approve failed: HTTP ${res.status}`);
  return json.data?.content ?? "";
}

/**
 * Delete an entire conversation (all its messages) for the caller's user.
 * Scoped server-side by user+agent+convId so it cannot touch other users'
 * data even if a convId is guessed. Resolves with the number of rows deleted.
 */
export async function deleteChatConversation(
  slug: string,
  userId: string,
  conversationId: string,
): Promise<number> {
  const res = await fetch(
    `${AUTH_API_URL}/api/v1/agent-chat/${slug}/chat/${conversationId}?userId=${encodeURIComponent(userId)}`,
    { method: "DELETE", credentials: "include", headers: { "x-user-id": userId } },
  );
  const json = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    data?: { deleted?: number };
    error?: string;
  };
  if (!res.ok || !json.success) {
    throw new Error(json.error ?? `Delete failed: HTTP ${res.status}`);
  }
  return json.data?.deleted ?? 0;
}

export interface ChatHistory {
  messages: ChatMsg[];
  /** Per-assistant-message tool invocations, keyed by message id. Backend
   *  pairs each completed agent run with its terminating assistant message
   *  by chronological order. Absent when the conversation has no tools. */
  invocationsByMsgId: Map<string, ToolInvocation[]>;
  reasoningByMsgId: Map<string, string>;
}

export async function pollChatMessages(slug: string, conversationId: string): Promise<ChatHistory> {
  const data = await request<{
    success: boolean;
    data: ChatMsg[];
    invocationsByMsgId?: Record<string, ToolInvocation[]>;
  }>(
    `${AUTH_API_URL}/api/v1/agent-chat/${slug}/chat/${conversationId}/messages`,
  );
  const invocationsByMsgId = new Map<string, ToolInvocation[]>();
  if (data.invocationsByMsgId) {
    for (const [msgId, invs] of Object.entries(data.invocationsByMsgId)) {
      invocationsByMsgId.set(msgId, invs);
    }
  }

  const reasoningByMsgId = new Map<string, string>();
  for (const m of data.data) {
    if (m.role === "assistant" && m.reasoning && m.reasoning.trim()) {
      reasoningByMsgId.set(m.id, m.reasoning);
    }
  }
  return { messages: data.data, invocationsByMsgId, reasoningByMsgId };
}

export interface LiveStreamCallbacks {
  onSnapshot?: (data: { invocationsByMsgId: Record<string, ToolInvocation[]>; inProgress: ToolInvocation[] }) => void;
  onLabel?: (toolLabel: string) => void;
  onInvocation?: (inv: ToolInvocation) => void;
  onDone?: (status: string) => void;
}

/**
 * Subscribe to the /live SSE for a conversation this tab is VIEWING (not
 * driving). Streams tool calls + progress for Spaces-originated runs. Returns a
 * close fn. Uses fetch+ReadableStream (not EventSource) so we can send the
 * `x-user-id` header the backend ACL needs. Best-effort: a 404 (feature off) or
 * any network/abort error just ends the stream silently.
 */
export function subscribeLiveConversation(
  slug: string,
  conversationId: string,
  userId: string,
  callbacks: LiveStreamCallbacks,
): () => void {
  const controller = new AbortController();
  void (async () => {
    let res: Response;
    try {
      res = await fetch(`${AUTH_API_URL}/api/v1/agent-chat/${slug}/chat/${conversationId}/live`, {
        credentials: "include",
        headers: { "x-user-id": userId, Accept: "text/event-stream" },
        signal: controller.signal,
      });
    } catch {
      return;
    }
    if (!res.ok || !res.body) return;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let currentEvent = "";
    let dataLines: string[] = [];

    const flush = () => {
      if (!currentEvent || dataLines.length === 0) {
        currentEvent = "";
        dataLines = [];
        return;
      }
      const dataStr = dataLines.join("\n");
      dataLines = [];
      const evt = currentEvent;
      currentEvent = "";
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(dataStr);
      } catch {
        return;
      }
      switch (evt) {
        case "snapshot":
          callbacks.onSnapshot?.({
            invocationsByMsgId: (data["invocationsByMsgId"] as Record<string, ToolInvocation[]>) ?? {},
            inProgress: (data["inProgress"] as ToolInvocation[]) ?? [],
          });
          break;
        case "label":
          if (typeof data["toolLabel"] === "string") callbacks.onLabel?.(data["toolLabel"]);
          break;
        case "invocation":
          if (data["toolInvocation"]) callbacks.onInvocation?.(data["toolInvocation"] as ToolInvocation);
          break;
        case "done":
          callbacks.onDone?.(typeof data["status"] === "string" ? (data["status"] as string) : "completed");
          break;
        default:
          break;
      }
    };

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, nl).replace(/\r$/, "");
          buffer = buffer.slice(nl + 1);
          if (line === "") {
            flush();
            continue;
          }
          if (line.startsWith(":")) continue; // heartbeat comment
          if (line.startsWith("event:")) currentEvent = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
        }
      }
    } catch {
      /* aborted or network error — end silently */
    }
  })();
  return () => controller.abort();
}

export interface DebugArtifactBundle {
  conversationId: string;
  debugDir: string;
  debugSession: Record<string, unknown> | null;
  debugEvents: Record<string, unknown>[] | null;
  runs: Array<{ fileName: string; data: Record<string, unknown> }>;
  subagents: Array<{ fileName: string; data: Record<string, unknown> }>;
}

export async function fetchConversationDebugArtifacts(slug: string, conversationId: string): Promise<DebugArtifactBundle> {
  const data = await request<{
    success: boolean;
    data: DebugArtifactBundle;
  }>(`${AUTH_API_URL}/api/v1/agent-chat/${slug}/chat/${conversationId}/debug`);
  return data.data;
}

export interface ConversationSummary {
  conversationId: string;
  title: string;
  messageCount: number;
  lastMessageAt: string;
}

export async function listChatConversations(slug: string, userId: string): Promise<ConversationSummary[]> {
  const data = await request<{ success: boolean; data: ConversationSummary[] }>(
    `${AUTH_API_URL}/api/v1/agent-chat/${slug}/conversations?userId=${userId}`,
  );
  return data.data;
}
// ── Knowledge Base (spaces collections) ──────────────────────────────

export interface KbFile {
  id: string;
  name: string;
  itemType: "file";
  fileId: string;
  ingestionStatus: string;
  createdAt: string;
  updatedAt: string;
}

export interface KbCollectionNode {
  id: string;
  name: string;
  description: string | null;
  isPrivate: boolean;
  ownerId: string;
  scopeType: string;
  scopeId: string;
  parentId: string | null;
  rootCollectionId: string | null;
  effectiveRole: "OWNER" | "EDITOR" | "VIEWER";
  /** Channel display name when scopeType='CHANNEL' (root nodes only). */
  channelName?: string;
  /** Project id of the channel that owns this collection (root nodes only). */
  projectId?: string;
  /** Project display name (root nodes only). */
  projectName?: string;
  children?: KbCollectionNode[];
  items?: KbFile[];
}

/** A user's accessible KB tree from spaces, used to populate the picker. */
export async function listAccessibleKnowledgeBase(): Promise<{ collections: KbCollectionNode[]; noSpacesSession: boolean }> {
  const data = await request<{ success: boolean; collections: KbCollectionNode[]; noSpacesSession?: boolean }>(
    `${AUTH_API_URL}/api/v1/knowledge-base/tree?includeItems=1`,
  );
  return { collections: data.collections ?? [], noSpacesSession: data.noSpacesSession === true };
}

/** Selected grant on an agent. fileId IS NULL = whole-collection grant. */
export interface AgentKbGrant {
  id: string;
  agentId: string;
  collectionId: string;
  fileId: string | null;
  createdAt: string;
}

export async function listAgentKnowledgeBase(slug: string): Promise<AgentKbGrant[]> {
  const data = await request<{ success: boolean; data: AgentKbGrant[] }>(
    `${AUTH_API_URL}/api/v1/agents/${encodeURIComponent(slug)}/knowledge-base`,
  );
  return data.data;
}

// ── Standalone Skills CRUD ────────────────────────────────────────────

export interface Skill {
  id: string;
  slug: string;
  name: string;
  label: string;
  description: string;
  content: string;
  source: string;
  scope: string;
  ownerUserId: string | null;
  /** Resolved owner identity (scoped to id/name/email by the backend). Null for seeded/system skills. */
  owner?: { id: string; name: string; email: string } | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export async function listSkills(userId?: string): Promise<Skill[]> {
  const qs = userId ? `?userId=${encodeURIComponent(userId)}` : "";
  const data = await request<{ success: boolean; data: Skill[] }>(
    `${AUTH_API_URL}/api/v1/skills${qs}`,
  );
  return data.data;
}

export async function createSkill(payload: { slug: string; name?: string; description?: string; content: string; source?: string }): Promise<Skill> {
  const data = await request<{ success: boolean; data: Skill }>(
    `${AUTH_API_URL}/api/v1/skills`,
    { method: "POST", body: JSON.stringify(payload) },
  );
  return data.data;
}

export async function updateSkill(slug: string, payload: { name?: string; description?: string; content?: string; enabled?: boolean }): Promise<Skill> {
  const data = await request<{ success: boolean; data: Skill }>(
    `${AUTH_API_URL}/api/v1/skills/${encodeURIComponent(slug)}`,
    { method: "PUT", body: JSON.stringify(payload) },
  );
  return data.data;
}

export async function deleteSkill(slug: string): Promise<void> {
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/skills/${encodeURIComponent(slug)}`,
    { method: "DELETE" },
  );
}

// ── Skill file bundle (directory-style skills) ───────────────────────

export interface SkillFileMeta {
  id: string;
  relativePath: string;
  contentType: string | null;
  sizeBytes: number;
  createdAt?: string;
}

export interface SkillFileFull extends SkillFileMeta {
  content: string;
}

export async function listSkillFiles(slug: string): Promise<SkillFileMeta[]> {
  const data = await request<{ success: boolean; data: SkillFileMeta[] }>(
    `${AUTH_API_URL}/api/v1/skills/${encodeURIComponent(slug)}/files`,
  );
  return data.data;
}

export async function getSkillFile(slug: string, fileId: string): Promise<SkillFileFull> {
  const data = await request<{ success: boolean; data: SkillFileFull }>(
    `${AUTH_API_URL}/api/v1/skills/${encodeURIComponent(slug)}/files/${encodeURIComponent(fileId)}`,
  );
  return data.data;
}

export async function replaceSkillFiles(
  slug: string,
  files: Array<{ relativePath: string; content: string; contentType?: string }>,
): Promise<SkillFileMeta[]> {
  const data = await request<{ success: boolean; data: SkillFileMeta[] }>(
    `${AUTH_API_URL}/api/v1/skills/${encodeURIComponent(slug)}/files`,
    { method: "PUT", body: JSON.stringify({ files }) },
  );
  return data.data;
}

// ── Agent Skill attach/detach ────────────────────────────────────────

export async function attachAgentSkill(agentSlug: string, skillId: string): Promise<void> {
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/agents/${encodeURIComponent(agentSlug)}/skills`,
    { method: "POST", body: JSON.stringify({ skillId }) },
  );
}

export async function detachAgentSkill(agentSlug: string, skillId: string): Promise<void> {
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/agents/${encodeURIComponent(agentSlug)}/skills/${encodeURIComponent(skillId)}`,
    { method: "DELETE" },
  );
}

export async function submitSkillRequest(slug: string, userId: string): Promise<void> {
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/skills/${encodeURIComponent(slug)}/request`,
    { method: "POST", headers: { "x-user-id": userId } },
  );
}

// ── User Settings (provider credentials + subagent routing) ──────────

export interface ProviderCredential {
  provider: string;
  model?: string | null;
  baseUrl?: string | null;
  authType?: "api_key" | "oauth_token" | null;
  reasoningEffort?: "low" | "medium" | "high" | null;
  hasApiKey: boolean;
}

export interface SubagentRouting {
  subagentName: string;
  provider: string;
}

export async function listProviderCredentials(userId: string): Promise<ProviderCredential[]> {
  const data = await request<{ success: boolean; data: ProviderCredential[] }>(
    `${AUTH_API_URL}/api/v1/settings/provider-credentials`,
    { headers: { "x-user-id": userId } },
  );
  return data.data;
}

export async function upsertProviderCredential(
  userId: string,
  provider: string,
  payload: { apiKey?: string; model?: string; baseUrl?: string; authType?: "api_key" | "oauth_token"; reasoningEffort?: "low" | "medium" | "high" | null },
): Promise<ProviderCredential> {
  const data = await request<{ success: boolean; data: ProviderCredential }>(
    `${AUTH_API_URL}/api/v1/settings/provider-credentials/${encodeURIComponent(provider)}`,
    { method: "PUT", headers: { "x-user-id": userId }, body: JSON.stringify(payload) },
  );
  return data.data;
}

export async function deleteProviderCredential(userId: string, provider: string): Promise<void> {
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/settings/provider-credentials/${encodeURIComponent(provider)}`,
    { method: "DELETE", headers: { "x-user-id": userId } },
  );
}

export async function listSubagentRouting(userId: string): Promise<SubagentRouting[]> {
  const data = await request<{ success: boolean; data: SubagentRouting[] }>(
    `${AUTH_API_URL}/api/v1/settings/subagent-routing`,
    { headers: { "x-user-id": userId } },
  );
  return data.data;
}

export async function upsertSubagentRouting(
  userId: string,
  subagentName: string,
  provider: string,
): Promise<SubagentRouting> {
  const data = await request<{ success: boolean; data: SubagentRouting }>(
    `${AUTH_API_URL}/api/v1/settings/subagent-routing/${encodeURIComponent(subagentName)}`,
    { method: "PUT", headers: { "x-user-id": userId }, body: JSON.stringify({ provider }) },
  );
  return data.data;
}

export async function deleteSubagentRouting(userId: string, subagentName: string): Promise<void> {
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/settings/subagent-routing/${encodeURIComponent(subagentName)}`,
    { method: "DELETE", headers: { "x-user-id": userId } },
  );
}

export async function initiateCopilotGitHubLogin(userId: string): Promise<GitHubDeviceCode> {
  const data = await request<{ success: boolean; data: GitHubDeviceCode }>(
    `${AUTH_API_URL}/api/v1/settings/copilot/github-login`,
    { method: "POST", headers: { "x-user-id": userId } },
  );
  return data.data;
}

export async function pollCopilotGitHubLogin(userId: string): Promise<{ status: string }> {
  const data = await request<{ success: boolean; data?: { status: string }; error?: string }>(
    `${AUTH_API_URL}/api/v1/settings/copilot/github-poll`,
    { method: "POST", headers: { "x-user-id": userId } },
  );
  if (!data.success) throw new Error(data.error ?? "Authorization failed");
  return data.data!;
}

export async function listCopilotModelsForUser(userId: string): Promise<Array<{ id: string; name: string }>> {
  const data = await request<{ success: boolean; data: Array<{ id: string; name: string }> }>(
    `${AUTH_API_URL}/api/v1/settings/copilot/models`,
    { headers: { "x-user-id": userId } },
  );
  return data.data;
}

export async function listClaudeModelsForUser(userId: string): Promise<ClaudeModelInfo[]> {
  const data = await request<{ success: boolean; data: ClaudeModelInfo[] }>(
    `${AUTH_API_URL}/api/v1/settings/claude/models`,
    { headers: { "x-user-id": userId } },
  );
  return data.data;
}

export async function startCodexOauth(userId: string): Promise<{ url: string; state: string; expiresIn: number }> {
  const data = await request<{ success: boolean; data: { url: string; state: string; expiresIn: number } }>(
    `${AUTH_API_URL}/api/v1/settings/codex/oauth/start`,
    { method: "POST", headers: { "x-user-id": userId } },
  );
  return data.data;
}

export async function exchangeCodexOauth(userId: string, payload: { code: string; state: string }): Promise<void> {
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/settings/codex/oauth/exchange`,
    { method: "POST", headers: { "x-user-id": userId }, body: JSON.stringify(payload) },
  );
}

export async function listCodexModelsForUser(userId: string): Promise<Array<{ id: string; name: string }>> {
  const data = await request<{ success: boolean; data: Array<{ id: string; name: string }> }>(
    `${AUTH_API_URL}/api/v1/settings/codex/models`,
    { headers: { "x-user-id": userId } },
  );
  return data.data;
}

// ── Agent Control Center ─────────────────────────────────────────────

export interface ToolInvocation {
  toolName: string;
  args: unknown;
  result: string;
  isError: boolean;
  startedAt: string;
  durationMs: number;
  /** Lifecycle state. "running" placeholders are pushed on tool start so the UI
   *  shows pending rows; they're replaced by "completed" rows on tool end. */
  status?: "running" | "completed";
  /** When this invocation happened inside a subagent, these nest it under the parent row. */
  parentToolCallId?: string;
  /** Name of the subagent that produced this child invocation (e.g. "spaces", "bitbucket"). */
  subagentName?: string;
  /** The subagent's own tool-call id — lets the frontend dedupe retries. */
  toolCallId?: string;
}

export interface AgentRun {
  id: string;
  sessionId: string;
  userId: string;
  agentSlug: string;
  triggerSource: "spaces" | "scheduled" | "chat" | "api";
  status: "running" | "completed" | "failed" | "cancelled";
  currentToolLabel: string | null;
  task: string;
  conversationId: string | null;
  scheduledJobId: string | null;
  channelId: string | null;
  result: string | null;
  error: string | null;
  toolsUsed: string[];
  toolInvocations: ToolInvocation[] | null;
  tokensIn: number | null;
  tokensOut: number | null;
  tokensCacheRead: number | null;
  tokensCacheWrite: number | null;
  /** Wall-clock breakdown — populated on /webhook/result, null on legacy rows. */
  totalMs: number | null;
  llmTotalMs: number | null;
  llmDecodeMs: number | null;
  llmWaitMs: number | null;
  llmTurns: number | null;
  llmRetries: number | null;
  ttftMs: number | null;
  tokensPerSec: number | null;
  toolMs: number | null;
  lastRetryReason: string | null;
  rating: "up" | "down" | null;
  ratingComment: string | null;
  ratedAt: string | null;
  startedAt: string;
  completedAt: string | null;
  /** Links this run to the specific assistant message it produced. Needed for
   *  branching: once a user message has multiple assistant siblings,
   *  chronology no longer pairs runs ↔ assistants — chatMessageId does. */
  chatMessageId?: string | null;
  /** Populated only by the admin "All Runs" (scope=all) listing — null elsewhere. */
  userName?: string | null;
  userEmail?: string | null;
}

export function exportSessionUrl(conversationId: string, agentSlug: string, format: "claude-code" | "markdown" | "claude-project"): string {
  const qs = new URLSearchParams({ conversationId, agentSlug, format });
  return `${AUTH_API_URL}/api/v1/runs/session/export?${qs.toString()}`;
}

export async function rateRun(userId: string, sessionId: string, rating: "up" | "down", comment?: string): Promise<void> {
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/runs/${encodeURIComponent(sessionId)}/rate`,
    {
      method: "POST",
      headers: { "x-user-id": userId },
      body: JSON.stringify({ rating, ...(comment ? { comment } : {}) }),
    },
  );
}

// ── Admin: rating aggregation ────────────────────────────────────────

export interface AgentRatingStat {
  agentSlug: string;
  totalRuns: number;
  ratedCount: number;
  upCount: number;
  downCount: number;
  negativeRate: number;
}

export interface RecentDownRun {
  sessionId: string;
  agentSlug: string;
  userId: string;
  userEmail: string | null;
  task: string;
  ratingComment: string | null;
  ratedAt: string;
  conversationId: string | null;
}

export async function listAgentRatingStats(userId: string, days: number | "all" = 30): Promise<AgentRatingStat[]> {
  const data = await request<{ success: boolean; data: AgentRatingStat[] }>(
    `${AUTH_API_URL}/api/v1/admin/ratings/stats?days=${days}`,
    { headers: { "x-user-id": userId } },
  );
  return data.data;
}

export async function listRecentDownRuns(userId: string, days: number | "all" = 30, limit = 50): Promise<RecentDownRun[]> {
  const data = await request<{ success: boolean; data: RecentDownRun[] }>(
    `${AUTH_API_URL}/api/v1/admin/ratings/recent-downs?days=${days}&limit=${limit}`,
    { headers: { "x-user-id": userId } },
  );
  return data.data;
}

export async function listRuns(userId: string, opts?: { status?: string; limit?: number; conversationId?: string; agentSlug?: string; allUsers?: boolean }): Promise<AgentRun[]> {
  const qs = new URLSearchParams();
  if (opts?.status) qs.set("status", opts.status);
  if (opts?.limit) qs.set("limit", String(opts.limit));
  if (opts?.conversationId) qs.set("conversationId", opts.conversationId);
  if (opts?.agentSlug) qs.set("agentSlug", opts.agentSlug);
  // Admin-only: every user's runs of this agent (server enforces isAdmin + the
  // usedUserToken ACL). Requires agentSlug.
  if (opts?.allUsers && opts?.agentSlug) qs.set("scope", "all");
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  const data = await request<{ success: boolean; data: AgentRun[] }>(
    `${AUTH_API_URL}/api/v1/runs${suffix}`,
    { headers: { "x-user-id": userId } },
  );
  return data.data;
}

/**
 * Subset of AgentRun returned by `listRunsLight` (GET /runs/light).
 *
 * The home page chart + sessions tile only need these six fields. The full
 * AgentRun row carries `toolInvocations` (JSON, sometimes hundreds of KB per
 * row), `task`, and `result` — sending those for the 200-300 rows the home
 * page consumes was the single biggest source of slow first paint.
 *
 * If a caller needs the heavy fields (Control Center detail view, run export),
 * keep using `listRuns` / `getRun`. Don't widen this type — that defeats the
 * point of the endpoint.
 */
type AgentRunLightRequired = Pick<
  AgentRun,
  "sessionId" | "agentSlug" | "status" | "triggerSource" | "startedAt" | "completedAt" | "conversationId" | "channelId"
>;

/**
 * Heavy fields are typed as optional/undefined so existing consumers compile
 * — but they're physically absent in the JSON returned by /runs/light. The
 * `&& run.task` style guards used throughout the home components naturally
 * skip rendering when these are undefined. The backend select-clause (see
 * `agentRunRepository.listByUserLight`) is the authoritative shape; this
 * type just lets the same components also accept full AgentRun rows.
 */
type AgentRunLightOptional = Partial<Pick<
  AgentRun,
  "id" | "userId" | "task" | "result" | "error" | "toolsUsed" | "toolInvocations" | "tokensIn" | "tokensOut" | "tokensCacheRead" | "tokensCacheWrite" | "rating" | "ratingComment" | "ratedAt" | "currentToolLabel" | "scheduledJobId"
>>;

export type AgentRunLight = AgentRunLightRequired & AgentRunLightOptional;

export async function listRunsLight(
  userId: string,
  opts?: { sinceDays?: number; limit?: number; status?: string; agentSlug?: string },
): Promise<AgentRunLight[]> {
  const qs = new URLSearchParams();
  if (opts?.sinceDays != null) qs.set("sinceDays", String(opts.sinceDays));
  if (opts?.limit != null) qs.set("limit", String(opts.limit));
  if (opts?.status) qs.set("status", opts.status);
  if (opts?.agentSlug) qs.set("agentSlug", opts.agentSlug);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  const data = await request<{ success: boolean; data: AgentRunLight[] }>(
    `${AUTH_API_URL}/api/v1/runs/light${suffix}`,
    { headers: { "x-user-id": userId } },
  );
  return data.data;
}

export async function getRun(userId: string, sessionId: string): Promise<AgentRun> {
  const data = await request<{ success: boolean; data: AgentRun }>(
    `${AUTH_API_URL}/api/v1/runs/${encodeURIComponent(sessionId)}`,
    { headers: { "x-user-id": userId } },
  );
  return data.data;
}

// ── Subagents (admin) ────────────────────────────────────────────────

export interface SubagentShareEntry {
  userId: string;
  role: string;
  name: string;
  email: string;
  sharedBy?: string | null;
  createdAt?: string;
}

export interface SubagentDef {
  source: "builtin" | "custom";
  id?: string;
  name: string;
  description: string;
  progressLabels: string[];
  systemPrompt: string;
  paramName: string;
  paramDescription: string;
  // Built-ins expose serverType; customs expose tools config.
  serverType?: string;
  tools?: { direct?: string[]; custom?: string[] };
  /** `{ serverType: instanceSlug }`. Empty/missing = inherit all agent-pinned
   *  instances. Only present on custom subagents. */
  mcpInstanceMap?: Record<string, string>;
  enabled: boolean;
  createdByUserId?: string | null;
  /** Resolved display name/email of the creator (custom subagents). */
  createdByName?: string | null;
  createdByEmail?: string | null;
  createdAt?: string;
  updatedAt?: string;
  skills: Array<{ id: string; slug: string; name: string }>;
  shares?: SubagentShareEntry[];
}

export interface SubagentInputBody {
  name: string;
  description: string;
  progressLabels: string[];
  systemPrompt: string;
  paramName?: string;
  paramDescription: string;
  tools: { direct?: string[]; custom?: string[] };
  skillIds?: string[];
  /** Optional. Omit or pass `{}` to clear/inherit-all. */
  mcpInstanceMap?: Record<string, string>;
}

export async function listSubagents(): Promise<SubagentDef[]> {
  const data = await request<{ success: boolean; data: SubagentDef[] }>(
    `${AUTH_API_URL}/api/v1/subagents`,
  );
  return data.data;
}

export async function createSubagent(payload: SubagentInputBody): Promise<SubagentDef> {
  const data = await request<{ success: boolean; data: SubagentDef }>(
    `${AUTH_API_URL}/api/v1/subagents`,
    { method: "POST", body: JSON.stringify(payload) },
  );
  return data.data;
}

export async function updateSubagent(name: string, payload: SubagentInputBody): Promise<SubagentDef> {
  const data = await request<{ success: boolean; data: SubagentDef }>(
    `${AUTH_API_URL}/api/v1/subagents/${encodeURIComponent(name)}`,
    { method: "PUT", body: JSON.stringify(payload) },
  );
  return data.data;
}

export async function deleteSubagent(name: string): Promise<void> {
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/subagents/${encodeURIComponent(name)}`,
    { method: "DELETE" },
  );
}

export async function enableSubagent(name: string): Promise<SubagentDef> {
  const data = await request<{ success: boolean; data: SubagentDef }>(
    `${AUTH_API_URL}/api/v1/subagents/${encodeURIComponent(name)}/enable`,
    { method: "POST" },
  );
  return data.data;
}

// Disabling a subagent is a soft-delete on the backend (DELETE /:name flips
// the `enabled` flag rather than removing the row). Same endpoint as
// `deleteSubagent` — exported under a distinct name so callers signal
// intent ("user toggled off in the UI" vs "user clicked the trash icon").
export async function disableSubagent(name: string): Promise<void> {
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/subagents/${encodeURIComponent(name)}`,
    { method: "DELETE" },
  );
}

export async function getSubagent(name: string): Promise<SubagentDef> {
  const data = await request<{ success: boolean; data: SubagentDef }>(
    `${AUTH_API_URL}/api/v1/subagents/${encodeURIComponent(name)}`,
  );
  return data.data;
}

export async function listSubagentShares(name: string): Promise<SubagentShareEntry[]> {
  const data = await request<{ success: boolean; data: SubagentShareEntry[] }>(
    `${AUTH_API_URL}/api/v1/subagents/${encodeURIComponent(name)}/shares`,
  );
  return data.data;
}

export async function addSubagentShare(name: string, userIdOrEmail: string): Promise<SubagentShareEntry> {
  const data = await request<{ success: boolean; data: SubagentShareEntry }>(
    `${AUTH_API_URL}/api/v1/subagents/${encodeURIComponent(name)}/shares`,
    { method: "POST", body: JSON.stringify({ userIdOrEmail, role: "EDITOR" }) },
  );
  return data.data;
}

export async function removeSubagentShare(name: string, userId: string): Promise<void> {
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/subagents/${encodeURIComponent(name)}/shares/${encodeURIComponent(userId)}`,
    { method: "DELETE" },
  );
}

// ── Agent Dashboard ──────────────────────────────────────────────────

export interface DashboardAgentStats {
  totalAgents: number;
  global: { enabled: number; disabled: number; total: number };
  personal: { enabled: number; disabled: number; total: number };
  registration: { registered: number; notRegistered: number; globalRegistered: number; personalRegistered: number };
  pendingRequests: number;
}

export interface DashboardOverview {
  totalRuns: number;
  completedRuns: number;
  failedRuns: number;
  cancelledRuns: number;
  runningRuns: number;
  uniqueUsers: number;
  totalTokensIn: number;
  totalTokensOut: number;
}

export interface DashboardAgentRow {
  agentSlug: string;
  agentName: string;
  agentScope: string | null;
  agentEnabled: boolean | null;
  agentRegistered: boolean;
  ownerEmail: string | null;
  totalRuns: number;
  uniqueUsers: number;
  completedRuns: number;
  failedRuns: number;
  avgDurationMs: number | null;
  totalTokensIn: number;
  totalTokensOut: number;
  upCount: number;
  downCount: number;
  ratedCount: number;
  negativeRate: number;
}

export interface AdminUserAgentRow {
  agentSlug: string;
  agentName: string;
  agentScope: "global" | "personal" | null;
  agentEnabled: boolean | null;
  agentRegistered: boolean;
  owned: boolean;
  runCount: number;
  completedRuns: number;
  failedRuns: number;
  avgDurationMs: number | null;
  lastRunAt: string | null;
  totalTokens: number;
}

export interface AdminUserActivityRow {
  userId: string;
  name: string | null;
  email: string | null;
  totalRuns: number;
  uniqueAgents: number;
  totalTokensIn: number;
  totalTokensOut: number;
  agents: AdminUserAgentRow[];
}

export interface DashboardTimeSeriesPoint {
  day: string;
  total: number;
  completed: number;
  failed: number;
}

export interface DashboardTriggerSource {
  triggerSource: string;
  count: number;
}

export interface DashboardAgentMeta {
  id: string;
  slug: string;
  name: string;
  description: string;
  scope: string;
  enabled: boolean;
  ownerUserId: string | null;
  spacesAppId: string | null;
  createdAt: string;
  promotedAt: string | null;
  owner: { id: string; name: string; email: string } | null;
  _count: { tools: number; skills: number; shares: number };
}


export interface SkillUsageRow {
  skillId: string;
  skillSlug: string;
  skillName: string;
  skillSource: string;
  agentCount: number;
  agentNames: string[];
}

export interface SubagentUsageRow {
  subagentName: string;
  agentCount: number;
  agentNames: string[];
}

export interface AgentDashboardData {
  agentStats: DashboardAgentStats;
  overview: DashboardOverview;
  agentTable: DashboardAgentRow[];
  agents: DashboardAgentMeta[];
  userActivityBreakdown: AdminUserActivityRow[];
  skillUsage: SkillUsageRow[];
  subagentUsage: SubagentUsageRow[];
}

export interface UserDashboardAgentRow {
  agentSlug: string;
  agentName: string;
  agentScope: "global" | "personal" | null;
  agentEnabled: boolean | null;
  agentRegistered: boolean;
  owned: boolean;
  totalRuns: number;
  completedRuns: number;
  failedRuns: number;
  avgDurationMs: number | null;
  totalTokensIn: number;
  totalTokensOut: number;
  lastRunAt: string | null;
  upCount: number;
  downCount: number;
  ratedCount: number;
  negativeRate: number;
}

export interface UserDashboardData {
  scope: "user";
  userId: string;
  overview: DashboardOverview;
  timeSeries: DashboardTimeSeriesPoint[];
  triggerSources: DashboardTriggerSource[];
  agentTable: UserDashboardAgentRow[];
  personalAgentStats: {
    total: number;
    enabled: number;
    disabled: number;
    registered: number;
    notRegistered: number;
  };
}

export async function getAgentDashboard(
  userId: string,
  days: number | "all" = 30,
  topUsersLimit = 10,
): Promise<AgentDashboardData> {
  const qs = new URLSearchParams({ days: String(days), topUsersLimit: String(topUsersLimit) });
  const data = await request<{ success: boolean; data: AgentDashboardData }>(
    `${AUTH_API_URL}/api/v1/admin/dashboard?${qs.toString()}`,
    { headers: { "x-user-id": userId } },
  );
  return data.data;
}

export async function getUserDashboard(
  userId: string,
  days: number | "all" = 30,
): Promise<UserDashboardData> {
  const qs = new URLSearchParams({ days: String(days) });
  const data = await request<{ success: boolean; data: UserDashboardData }>(
    `${AUTH_API_URL}/api/v1/dashboard?${qs.toString()}`,
    { headers: { "x-user-id": userId } },
  );
  return data.data;
}

// ── Project Insights (admin) ──────────────────────────────────────────

export interface ProjectSummary {
  projectId: string;
  projectName: string | null;
  runCount: number;
  /** tokensIn + tokensOut summed across all runs in the project. */
  totalTokens: number;
  /** COUNT(DISTINCT userId) within the project. */
  uniqueUsers: number;
  /** Runs with status = 'failed'. */
  failedRuns: number;
}

export interface ProjectAgentUsageRow {
  agentSlug: string;
  agentName: string;
  agentScope: "global" | "personal" | null;
  agentEnabled: boolean | null;
  totalRuns: number;
  uniqueUsers: number;
  completedRuns: number;
  failedRuns: number;
  avgDurationMs: number | null;
  totalTokensIn: number;
  totalTokensOut: number;
  lastRunAt: string | null;
}

export interface ProjectTopUserAgentRow {
  agentSlug: string;
  agentName: string;
  agentScope: "global" | "personal" | null;
  agentEnabled: boolean | null;
  agentRegistered: boolean;
  owned: boolean;
  runCount: number;
  completedRuns: number;
  failedRuns: number;
  avgDurationMs: number | null;
  lastRunAt: string | null;
  totalTokens: number;
}

export interface ProjectTopUserRow {
  userId: string;
  email: string | null;
  name: string | null;
  runCount: number;
  uniqueAgents: number;
  totalTokensIn: number;
  totalTokensOut: number;
  agents: ProjectTopUserAgentRow[];
}

export interface ProjectSkillUsageRow {
  skillId: string;
  skillSlug: string;
  skillName: string;
  skillSource: string;
  agentCount: number;
  agentNames: string[];
}

export interface ProjectInsightsData {
  projectId: string;
  agentUsage: ProjectAgentUsageRow[];
  topUsers: ProjectTopUserRow[];
  skillUsage: ProjectSkillUsageRow[];
  subagentUsage: SubagentUsageRow[];
}

/**
 * Project list for the dashboard / Projects page. Passing `days` so the
 * donut respects the same time window as the rest of the page — without
 * it, the donut would always show all-time data while the header filter
 * silently changed only the drill-down tables.
 */
export async function getProjectList(
  userId: string,
  days: number | "all" = "all",
): Promise<ProjectSummary[]> {
  const qs = new URLSearchParams({ days: String(days) });
  const data = await request<{ success: boolean; data: ProjectSummary[] }>(
    `${AUTH_API_URL}/api/v1/admin/dashboard/projects?${qs.toString()}`,
    { headers: { "x-user-id": userId } },
  );
  return data.data;
}

export async function getProjectInsights(
  userId: string,
  projectId: string,
  days: number | "all" = 30,
): Promise<ProjectInsightsData> {
  const qs = new URLSearchParams({ projectId, days: String(days) });
  const data = await request<{ success: boolean; data: ProjectInsightsData }>(
    `${AUTH_API_URL}/api/v1/admin/dashboard/project-insights?${qs.toString()}`,
    { headers: { "x-user-id": userId } },
  );
  return data.data;
}


// ── Doctor Bitbucket Stats (admin) ───────────────────────────────────
// Live count of PRs / commits authored by the bot identity that powers
// xyne-doctor commits in Bitbucket (default `john.doe@gmail.com`).
// Backed by an in-memory cache (~15 min TTL) on the dashboard backend, so
// this fetch is effectively a memory read on warm paths.
//
// `prsCreated` / `commitsCreated` are `null` (with `reason` set) when the
// backend doesn't have a Bitbucket token configured or the upstream fetch
// failed. The dashboard renders a friendly empty state in those cases.
export interface DoctorBitbucketStats {
  prsCreated: number | null;
  commitsCreated: number | null;
  authorEmail: string;
  authorUsername: string;
  projectKey: string;
  repoSlug: string;
  baseUrl: string;
  lastRefreshedAt: string | null;
  reason?: "bitbucket_token_missing" | "fetch_failed";
  errorMessage?: string;
}

export async function getDoctorBitbucketStats(userId: string): Promise<DoctorBitbucketStats> {
  const data = await request<{ success: boolean; data: DoctorBitbucketStats }>(
    `${AUTH_API_URL}/api/v1/admin/dashboard/bitbucket-stats`,
    { headers: { "x-user-id": userId } },
  );
  return data.data;
}

// ── Digital Twin (personal user memory) ──────────────────────────────────────

export interface DigitalTwinBackfillEntry {
  from: string;
  to: string;
  cursor: string;
  complete: boolean;
}

export interface DigitalTwinStatus {
  enabled: boolean;
  enabledAt: string | null;
  backfillState: Record<string, DigitalTwinBackfillEntry> | null;
  pendingCandidates: number;
  totalCandidates: number;
  approvedCandidates: number;
  mdFileCount: number;
  /** Optional suffix the user has configured. Empty string when unset. */
  responseSuffix: string;
  /** Memory approval mode: "manual" (review queue) or "auto" (retain
   *  high-confidence candidates immediately). */
  memoryApprovalMode: string;
  /** Min curator confidence (0–1) required to auto-approve a candidate. */
  memoryAutoApproveMinScore: number;
}

export interface DigitalTwinEstimate {
  messages: number;
  calls: number;
  canvases: number;
  totalRecords: number;
  estCandidates: number;
  estCostUSD: number;
}

export interface DigitalTwinClusterPreview {
  subsystem: string;
  pending: number;
  top3: Array<{ id: string; text: string; signalScore: number }>;
}

export interface DigitalTwinCandidate {
  id: string;
  subsystem: string;
  text: string;
  editedText: string | null;
  sourceRefs: Array<{ type: "message" | "call" | "canvas"; id: string; channelId?: string; ts: string }>;
  signalScore: number;
  status: "pending" | "approved" | "rejected";
  source: string;
  createdAt: string;
}

export async function getDigitalTwinStatus(userId: string): Promise<DigitalTwinStatus> {
  const data = await request<{ success: boolean; data: DigitalTwinStatus }>(
    `${AUTH_API_URL}/api/v1/digital-twin/status`,
    { headers: { "x-user-id": userId } },
  );
  return data.data;
}

export async function getDigitalTwinEstimate(
  userId: string,
  from: string,
  to: string,
): Promise<DigitalTwinEstimate> {
  const data = await request<{ success: boolean; data: DigitalTwinEstimate }>(
    `${AUTH_API_URL}/api/v1/digital-twin/estimate?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    { headers: { "x-user-id": userId } },
  );
  return data.data;
}

export async function enableDigitalTwin(
  userId: string,
  backfill: { from: string; to: string } | null,
): Promise<{ enabled: boolean; enabledAt: string; backfillJobIds: string[] }> {
  const data = await request<{ success: boolean; data: { enabled: boolean; enabledAt: string; backfillJobIds: string[] } }>(
    `${AUTH_API_URL}/api/v1/digital-twin/enable`,
    {
      method: "POST",
      headers: { "x-user-id": userId, "Content-Type": "application/json" },
      body: JSON.stringify({ backfill }),
    },
  );
  return data.data;
}

export async function disableDigitalTwin(
  userId: string,
  deleteMemories: boolean,
): Promise<{ disabled: boolean; deleting: boolean; cancelledJobs: number; deletedCandidates?: number; deletedHindsight?: number }> {
  const data = await request<{ success: boolean; data: { disabled: boolean; deleting: boolean; cancelledJobs: number; deletedCandidates?: number; deletedHindsight?: number } }>(
    `${AUTH_API_URL}/api/v1/digital-twin/disable`,
    {
      method: "POST",
      headers: { "x-user-id": userId, "Content-Type": "application/json" },
      body: JSON.stringify({ deleteMemories }),
    },
  );
  return data.data;
}

export async function listDigitalTwinClusters(userId: string): Promise<{ clusters: DigitalTwinClusterPreview[] }> {
  const data = await request<{ success: boolean; data: { clusters: DigitalTwinClusterPreview[] } }>(
    `${AUTH_API_URL}/api/v1/digital-twin/clusters`,
    { headers: { "x-user-id": userId } },
  );
  return data.data;
}

export async function getDigitalTwinCluster(
  userId: string,
  subsystem: string,
): Promise<{ subsystem: string; candidates: DigitalTwinCandidate[] }> {
  const data = await request<{ success: boolean; data: { subsystem: string; candidates: DigitalTwinCandidate[] } }>(
    `${AUTH_API_URL}/api/v1/digital-twin/clusters/${encodeURIComponent(subsystem)}`,
    { headers: { "x-user-id": userId } },
  );
  return data.data;
}

export async function approveDigitalTwinCluster(
  userId: string,
  subsystem: string,
  candidateIds?: string[],
): Promise<{ processing?: boolean; count?: number }> {
  const data = await request<{ success: boolean; data: { processing?: boolean; count?: number } }>(
    `${AUTH_API_URL}/api/v1/digital-twin/clusters/${encodeURIComponent(subsystem)}/approve`,
    {
      method: "POST",
      headers: { "x-user-id": userId, "Content-Type": "application/json" },
      body: JSON.stringify(candidateIds ? { candidateIds } : {}),
    },
  );
  return data.data;
}

export async function patchDigitalTwinCandidate(
  userId: string,
  id: string,
  patch: { editedText?: string; status?: "approved" | "rejected" },
): Promise<{ id: string; status: string }> {
  const data = await request<{ success: boolean; data: { id: string; status: string } }>(
    `${AUTH_API_URL}/api/v1/digital-twin/candidates/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: { "x-user-id": userId, "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    },
  );
  return data.data;
}

export async function updateDigitalTwinSettings(
  userId: string,
  patch: {
    responseSuffix?: string | null;
    memoryApprovalMode?: "manual" | "auto";
    memoryAutoApproveMinScore?: number;
  },
): Promise<{ responseSuffix: string; memoryApprovalMode: string; memoryAutoApproveMinScore: number }> {
  const data = await request<{
    success: boolean;
    data: { responseSuffix: string; memoryApprovalMode: string; memoryAutoApproveMinScore: number };
  }>(
    `${AUTH_API_URL}/api/v1/digital-twin/settings`,
    {
      method: "PATCH",
      headers: { "x-user-id": userId, "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    },
  );
  return data.data;
}

export async function uploadDigitalTwinMd(
  userId: string,
  filename: string,
  content: string,
): Promise<{ filename: string; candidatesCreated: number }> {
  const data = await request<{ success: boolean; data: { filename: string; candidatesCreated: number } }>(
    `${AUTH_API_URL}/api/v1/digital-twin/upload-md`,
    {
      method: "POST",
      headers: { "x-user-id": userId, "Content-Type": "application/json" },
      body: JSON.stringify({ filename, content }),
    },
  );
  return data.data;
}

// ── Memory Bank (Hindsight) ───────────────────────────────────────────

const MEMORY_BASE = "/claw/api/v1/memory";

export interface MemoryBankMemory {
  id: string;
  hindsightMemoryId: string;
  category: string | null;
  content: string;
  curatorReasoning: string | null;
  curatorConfidence: number | null;
  createdAt: string;
  recallHits7d: number;
  lastRecalledAt: string | null;
}

export interface MemoryBankStats {
  range: string;
  totals: {
    approved: number;
    pending: number;
    recallsInRange: number;
  };
  hot: Array<{
    hindsightMemoryId: string;
    hits: number;
    lastRecalledAt: string | null;
    content: string;
    category: string | null;
    status: string | null;
    createdAt: string | null;
  }>;
}

export interface RecallResult {
  id?: string;
  text?: string;
  fact_type?: string;
  score?: number;
  tags?: string[];
}

export async function listDigitalTwinMemories(
  userId: string,
  opts: { limit?: number; offset?: number; subsystem?: string } = {},
): Promise<{ memories: MemoryBankMemory[]; total: number }> {
  const params = new URLSearchParams();
  params.set("userTag", `user:${userId}`);
  if (opts.limit != null) params.set("limit", String(opts.limit));
  if (opts.offset != null) params.set("offset", String(opts.offset));
  // Backend filters by Hindsight subsystem tag — used by the Graph node panel.
  if (opts.subsystem) params.set("subsystem", opts.subsystem);
  const res = await fetch(`${MEMORY_BASE}/banks/digital-twin/memories?${params.toString()}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`Failed to list memories: ${res.status}`);
  // Backend shape: { success, data: MemoryBankMemory[], total, limit, offset }
  // — the array lives directly in `data`, with `total` as a sibling.
  const body = await res.json() as { success: boolean; data: MemoryBankMemory[]; total?: number };
  if (!body.success) throw new Error("Failed to list memories");
  return { memories: body.data ?? [], total: body.total ?? body.data?.length ?? 0 };
}

/**
 * Seed an agent's memory bank from a markdown document. Owner/admin only
 * (enforced server-side). The extracted facts land as PENDING review
 * candidates — they are not retained to the live bank until approved.
 */
export async function uploadAgentMemoryMd(
  agentSlug: string,
  filename: string,
  content: string,
): Promise<{ filename: string; candidatesCreated: number }> {
  const res = await fetch(`${MEMORY_BASE}/banks/${encodeURIComponent(agentSlug)}/upload-md`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ filename, content }),
  });
  const body = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string; data?: { filename: string; candidatesCreated: number } };
  if (!res.ok || !body.success || !body.data) throw new Error(body.error || `Upload failed (${res.status})`);
  return body.data;
}

export async function deleteDigitalTwinMemory(userId: string, hindsightMemoryId: string): Promise<void> {
  const res = await fetch(
    `${MEMORY_BASE}/banks/digital-twin/memories/${encodeURIComponent(hindsightMemoryId)}?userTag=${encodeURIComponent(`user:${userId}`)}`,
    { method: "DELETE", credentials: "include" },
  );
  if (!res.ok) throw new Error(`Failed to delete memory: ${res.status}`);
}


export async function getDigitalTwinStats(
  userId: string,
  range: "7d" | "30d" | "90d" = "7d",
): Promise<MemoryBankStats> {
  const res = await fetch(
    `${MEMORY_BASE}/banks/digital-twin/stats?userTag=${encodeURIComponent(`user:${userId}`)}&range=${range}`,
    { credentials: "include" },
  );
  if (!res.ok) throw new Error(`Failed to get stats: ${res.status}`);
  const body = await res.json() as { success: boolean; data: MemoryBankStats };
  if (!body.success) throw new Error("Failed to get stats");
  return body.data;
}

export async function recallDigitalTwinMemory(
  userId: string,
  query: string,
  budget?: "low" | "mid" | "high",
): Promise<RecallResult[]> {
  const res = await fetch(`${MEMORY_BASE}/banks/digital-twin/recall?userTag=${encodeURIComponent(`user:${userId}`)}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, ...(budget ? { budget } : {}) }),
  });
  if (!res.ok) throw new Error(`Recall failed: ${res.status}`);
  const body = await res.json() as { success: boolean; data: { provider: string; memories: RecallResult[] } };
  if (!body.success) throw new Error("Recall failed");
  return body.data.memories ?? [];
}

export interface DigitalTwinSubsystemNode {
  name: string;
  memoryCount: number;
  sessionCount: number;
  sampleContent: string;
  lastUpdated: string | null;
}
export interface DigitalTwinSubsystemEdge {
  source: string;
  target: string;
  sharedSessions: number;
}

export async function getDigitalTwinSubsystemGraph(
  userId: string,
): Promise<{ subsystems: DigitalTwinSubsystemNode[]; edges: DigitalTwinSubsystemEdge[] }> {
  const res = await fetch(
    `${MEMORY_BASE}/banks/digital-twin/subsystem-graph?userTag=${encodeURIComponent(`user:${userId}`)}`,
    { credentials: "include" },
  );
  if (!res.ok) throw new Error(`Failed to get graph: ${res.status}`);
  const body = await res.json() as { success: boolean; data: { subsystems?: DigitalTwinSubsystemNode[]; edges?: DigitalTwinSubsystemEdge[] } };
  if (!body.success) throw new Error("Failed to get graph");
  return { subsystems: body.data.subsystems ?? [], edges: body.data.edges ?? [] };
}

// ── Memory Batches (nightly curation review) ──────────────────────────

export interface MemoryBatch {
  id: string;
  agentSlug: string;
  reviewDate: string;
  status: "pending" | "approved" | "rejected" | "partial";
  sessionIds: string[];
  approvedSessionIds: string[];
  heuristicSkipped: Array<{ sessionId: string; reason: string }> | null;
  approvalStrategy: string;
  spacesMessageId: string | null;
  createdAt: string;
  /** True while a background approve is running — poll until it clears. */
  processing?: boolean;
}

export interface MemoryBatchSession {
  sessionId: string;
  task: string;
  toolsUsed: string[];
  tokensIn: number;
  tokensOut: number;
  missing?: boolean;
}

export async function listMemoryBatches(
  agentSlug: string,
  opts: { status?: string; limit?: number } = {},
): Promise<MemoryBatch[]> {
  const params = new URLSearchParams({ agentSlug });
  if (opts.status) params.set("status", opts.status);
  if (opts.limit != null) params.set("limit", String(opts.limit));
  const res = await fetch(`${MEMORY_BASE}/batches?${params.toString()}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`Failed to list batches: ${res.status}`);
  const body = await res.json() as { success: boolean; data: MemoryBatch[] };
  if (!body.success) throw new Error("Failed to list batches");
  return body.data;
}

export async function getMemoryBatch(
  batchId: string,
): Promise<{ batch: MemoryBatch; sessions: MemoryBatchSession[] }> {
  const res = await fetch(`${MEMORY_BASE}/batches/${encodeURIComponent(batchId)}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`Failed to get batch: ${res.status}`);
  const body = await res.json() as { success: boolean; data: { batch: MemoryBatch; sessions: MemoryBatchSession[] } };
  if (!body.success) throw new Error("Failed to get batch");
  return body.data;
}

export async function approveMemoryBatch(
  batchId: string,
  sessionIds?: string[],
): Promise<void> {
  const res = await fetch(`${MEMORY_BASE}/batches/${encodeURIComponent(batchId)}/approve`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sessionIds ? { sessionIds } : {}),
  });
  if (!res.ok) throw new Error(`Approve failed: ${res.status}`);
}

export async function rejectMemoryBatch(batchId: string): Promise<void> {
  const res = await fetch(`${MEMORY_BASE}/batches/${encodeURIComponent(batchId)}/reject`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error(`Reject failed: ${res.status}`);
}

// ── Digital Twin Metrics ────────────────────────────────────────────────────

export interface DigitalTwinSubsystemMetric {
  subsystem: string;
  approved: number;
  rejected: number;
  pending: number;
}

export interface DigitalTwinSourceMetric {
  source: string;
  approved: number;
  rejected: number;
}

export interface DigitalTwinMetrics {
  total: number;
  approvedClean: number;
  approvedEdited: number;
  totalApproved: number;
  rejected: number;
  pending: number;
  approvalRate: number | null;
  editRate: number | null;
  previousApprovalRate: number | null;
  previousEditRate: number | null;
  bySubsystem: DigitalTwinSubsystemMetric[];
  bySource: DigitalTwinSourceMetric[];
  oldestPendingDays: number | null;
  addedSinceYesterday: number;
  recallPrecision: number | null;
  recallRatedCount: number;
}

export async function getDigitalTwinMetrics(userId: string, days?: number): Promise<DigitalTwinMetrics> {
  const base = `${AUTH_API_URL}/api/v1/digital-twin/metrics`;
  const qs = days ? `?days=${days}` : "";
  const data = await request<{ success: boolean; data: DigitalTwinMetrics }>(
    `${base}${qs}`,
    { headers: { "x-user-id": userId } },
  );
  return data.data;
}

// ── Workspace-wide metrics (v3 Metrics page) ───────────────────────────

export interface SlowSessionToolRow {
  tool: string;
  ms: number;
  calls: number;
  isError: boolean;
}
export interface SlowSession {
  sessionId: string;
  agentSlug: string;
  totalMs: number | null;
  llmTotalMs: number | null;
  toolMs: number | null;
  completedAt: string;
  task: string | null;
  topTools: SlowSessionToolRow[];
}

export interface GlobalMetricsDayBucket {
  day: string;
  runs: number;
  completed: number;
  failed: number;
  cancelled: number;
  p50TotalMs: number | null;
  p95TotalMs: number | null;
  avgLlmMs: number | null;
  avgToolMs: number | null;
  errorRate: number;
}
export interface GlobalMetricsAgentRow {
  agentSlug: string;
  runs: number;
  p50TotalMs: number | null;
  p95TotalMs: number | null;
  avgLlmMs: number | null;
  avgToolMs: number | null;
  errorRate: number;
}
export interface GlobalMetricsProviderRow {
  provider: string;
  model: string | null;
  runs: number;
  p50LlmMs: number | null;
  p95LlmMs: number | null;
  p50TtftMs: number | null;
  p95TtftMs: number | null;
  avgTokensPerSec: number | null;
  errorRate: number;
}
export interface GlobalMetrics {
  days: number;
  windowStart: string;
  windowEnd: string;
  totals: {
    runs: number;
    completed: number;
    failed: number;
    cancelled: number;
    p50TotalMs: number | null;
    p95TotalMs: number | null;
    avgLlmMs: number | null;
    avgToolMs: number | null;
    errorRate: number;
  };
  delta: {
    runs: number;
    p50TotalMs: number | null;
    p95TotalMs: number | null;
    errorRate: number;
  };
  perDay: GlobalMetricsDayBucket[];
  topAgents: GlobalMetricsAgentRow[];
  byProvider: GlobalMetricsProviderRow[];
  slowSessions: SlowSession[];
}

export async function fetchGlobalMetrics(userId: string, days: 1 | 7 | 30 = 7): Promise<GlobalMetrics> {
  return request<GlobalMetrics>(
    `${AUTH_API_URL}/api/v1/metrics/global?days=${days}`,
    { headers: { "x-user-id": userId } },
  );
}

export interface SentimentComment {
  sessionId: string;
  rating: "up" | "down";
  comment: string;
  completedAt: string;
}
export interface AgentSentiment {
  totalRuns: number;
  ratingUp: number;
  ratingDown: number;
  ratingTotal: number;
  ratingRatio: number | null;
  cancelledRate: number;
  failedRate: number;
  retriedRate: number;
  apologeticRate: number;
  recentComments: SentimentComment[];
}

// Per-agent metrics — same shape as global minus `topAgents`, with a couple
// of extra single-agent rollups (avgTurns, avgTokensPerSec).
export interface AgentMetrics {
  agentSlug: string;
  days: number;
  windowStart: string;
  windowEnd: string;
  totals: GlobalMetrics["totals"] & {
    avgTurns: number | null;
    avgTokensPerSec: number | null;
  };
  delta: GlobalMetrics["delta"];
  perDay: GlobalMetricsDayBucket[];
  slowSessions: SlowSession[];
  toolLatency: ToolLatencyRow[];
  sentiment: AgentSentiment;
}

export interface ToolLatencyRow {
  tool: string;
  calls: number;
  errors: number;
  avgMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  totalMs: number;
}

// FailureCurator candidate types and endpoints
export type ImprovementBucket = "agent_unable_to_do_work" | "failure" | "user_frustrated";
export type ImprovementRootCause =
  | "need-memory" | "missing-tool" | "prompt-ambiguity" | "wrong-subagent"
  | "redundant-subagent-call" | "tool-misuse" | "ext-api-failure"
  | "permission-denied" | "memory-miss" | "identity-bleed" | "no-actionable";
export type ImprovementFixType =
  | "prompt-edit" | "add-memory" | "add-tool" | "remove-tool"
  | "tighten-subagent" | "investigate" | "ops";
export interface ImprovementCandidate {
  id: string;
  bucket: ImprovementBucket;
  rootCause: ImprovementRootCause;
  finding: string;
  evidence: string[];
  proposedFix: { type: ImprovementFixType; description: string };
  confidence: "high" | "medium" | "low";
  metadata: unknown;
  createdAt: string;
  updatedAt: string;
}

export async function fetchAgentImprovements(userId: string, slug: string): Promise<ImprovementCandidate[]> {
  const data = await request<{ agentSlug: string; candidates: ImprovementCandidate[] }>(
    `${AUTH_API_URL}/api/v1/metrics/agent/${encodeURIComponent(slug)}/improvements`,
    { headers: { "x-user-id": userId } },
  );
  return data.candidates;
}

export async function applyImprovement(userId: string, id: string): Promise<void> {
  await request<{ ok: true }>(
    `${AUTH_API_URL}/api/v1/metrics/improvements/${encodeURIComponent(id)}/apply`,
    { method: "POST", headers: { "x-user-id": userId } },
  );
}

export async function dismissImprovement(userId: string, id: string, reason?: string): Promise<void> {
  await request<{ ok: true }>(
    `${AUTH_API_URL}/api/v1/metrics/improvements/${encodeURIComponent(id)}/dismiss`,
    {
      method: "POST",
      headers: { "x-user-id": userId, "Content-Type": "application/json" },
      ...(reason ? { body: JSON.stringify({ reason }) } : {}),
    },
  );
}

export async function fetchAgentMetrics(userId: string, slug: string, days: 1 | 7 | 30 = 7): Promise<AgentMetrics> {
  return request<AgentMetrics>(
    `${AUTH_API_URL}/api/v1/metrics/agent/${encodeURIComponent(slug)}?days=${days}`,
    { headers: { "x-user-id": userId } },
  );
}
// ── Evals ─────────────────────────────────────────────────────────────────
// A folder explorer of conversations to replay against an agent. The browser
// orchestrates a run by calling sendChatMessage() per turn (the real chat SSE
// endpoint), capturing answer + reasoning + tool calls; these endpoints persist
// folders, conversations, runs and per-turn results.

export interface EvalTurn {
  message: string;
  expectedResponse?: string | null;
}

export interface EvalFolder {
  id: string;
  name: string;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { conversations: number };
}

/** List row — no turns (cheap). */
export interface EvalConversationListItem {
  id: string;
  folderId: string;
  title: string;
  source: string | null;
  createdAt: string;
}

/** Full conversation with turns. */
export interface EvalConversation extends EvalConversationListItem {
  turns: EvalTurn[];
  externalId?: string | null;
  updatedAt: string;
}

/** One judge×model verdict on a turn — the same judge can hold several rows,
 *  one per model it was scored with. */
export interface EvalTurnJudgeScore {
  id: string;
  judgeId: string;
  judgeName: string;
  score: number | null;
  reasoning: string | null;
  status?: string;
  model: string;
  passId?: string | null;
  updatedAt?: string;
}

export interface EvalTurnResult {
  id: string;
  runId: string;
  conversationId: string;
  turnIndex: number;
  inputMessage: string;
  expectedResponse: string | null;
  clawAnswer: string | null;
  reasoning: string | null;
  toolInvocations: ToolInvocation[] | null;
  status: "running" | "completed" | "failed";
  clawConversationId: string | null;
  sessionId: string | null;
  matchScore: number | null;
  judgeReasoning: string | null;
  judgeModel: string | null;
  judgedAt: string | null;
  judgeScores?: EvalTurnJudgeScore[];
  createdAt: string;
  updatedAt: string;
}

export interface EvalGeneration {
  id: string;
  agentSlug: string;
  status: "running" | "completed" | "failed" | "cancelled";
  genProvider?: string | null;
  genModel?: string | null;
  conversationIds: string[];
  folderId: string | null;
  createdBy?: string | null;
  startedAt: string;
  completedAt: string | null;
  turnResults?: EvalTurnResult[];
}

// ── Folders ──
export async function listEvalFolders(): Promise<EvalFolder[]> {
  const data = await request<{ success: boolean; folders: EvalFolder[] }>(
    `${AUTH_API_URL}/api/v1/evals/folders`,
  );
  return data.folders;
}

export async function createEvalFolder(
  payload: { name: string },
  userId: string,
): Promise<EvalFolder> {
  const data = await request<{ success: boolean; folder: EvalFolder }>(
    `${AUTH_API_URL}/api/v1/evals/folders`,
    { method: "POST", headers: { "x-user-id": userId }, body: JSON.stringify(payload) },
  );
  return data.folder;
}

export async function deleteEvalFolder(id: string, userId: string): Promise<void> {
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/evals/folders/${id}`,
    { method: "DELETE", headers: { "x-user-id": userId } },
  );
}

// ── Conversations ──
export async function listEvalConversations(
  folderId: string,
  opts?: { skip?: number; take?: number; search?: string },
): Promise<{ total: number; items: EvalConversationListItem[] }> {
  const p = new URLSearchParams();
  if (opts?.skip) p.set("skip", String(opts.skip));
  if (opts?.take) p.set("take", String(opts.take));
  if (opts?.search) p.set("search", opts.search);
  const qs = p.toString() ? `?${p.toString()}` : "";
  return request<{ success: boolean; total: number; items: EvalConversationListItem[] }>(
    `${AUTH_API_URL}/api/v1/evals/folders/${folderId}/conversations${qs}`,
  ).then((d) => ({ total: d.total, items: d.items }));
}

export async function importEvalConversations(
  folderId: string,
  conversations: Array<{ title?: string | null; source?: string | null; externalId?: string | null; turns: EvalTurn[] }>,
  userId: string,
): Promise<number> {
  const data = await request<{ success: boolean; imported: number }>(
    `${AUTH_API_URL}/api/v1/evals/folders/${folderId}/conversations`,
    { method: "POST", headers: { "x-user-id": userId }, body: JSON.stringify({ conversations }) },
  );
  return data.imported;
}

export async function getEvalConversation(id: string): Promise<EvalConversation> {
  const data = await request<{ success: boolean; conversation: EvalConversation }>(
    `${AUTH_API_URL}/api/v1/evals/conversations/${id}`,
  );
  return data.conversation;
}

export async function deleteEvalConversation(id: string, userId: string): Promise<void> {
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/evals/conversations/${id}`,
    { method: "DELETE", headers: { "x-user-id": userId } },
  );
}

// ── Runs ──
export interface GenerationProgress {
  phase: "running" | "done" | "cancelled" | "failed";
  conversationsTotal: number;
  conversationsDone: number;
  turnsTotal: number;
  turnsDone: number;
  turnsFailed: number;
}

export interface GenerationJobStatus {
  jobId: string;
  state: string;
  progress: GenerationProgress | null;
  failedReason?: string;
}

/** Start a run as a resilient background job (replays server-side). Returns
 *  runId + jobId; poll getGenerationJob. Survives the browser closing. */
/** Generation-model options for the Run dialog: providers the user configured
 *  in claw (provider + their chosen model) + platform LiteLLM models. */
export interface EvalGenModels {
  providers: Array<{ provider: string; model: string | null }>;
  litellm: string[];
}

export async function listEvalGenModels(userId: string): Promise<EvalGenModels> {
  const data = await request<{ success: boolean } & EvalGenModels>(
    `${AUTH_API_URL}/api/v1/evals/gen-models`,
    { headers: { "x-user-id": userId } },
  );
  return { providers: data.providers ?? [], litellm: data.litellm ?? [] };
}

export async function startBackgroundGeneration(
  payload: { agentSlug: string; conversationIds?: string[]; folderId?: string; genProvider?: string; genModel?: string },
  userId: string,
): Promise<{ runId: string; jobId: string }> {
  const d = await request<{ success: boolean; runId: string; jobId: string }>(
    `${AUTH_API_URL}/api/v1/evals/generations/background`,
    { method: "POST", headers: { "x-user-id": userId }, body: JSON.stringify(payload) },
  );
  return { runId: d.runId, jobId: d.jobId };
}

export async function getGenerationJob(jobId: string, userId: string): Promise<GenerationJobStatus> {
  return request<{ success: boolean } & GenerationJobStatus>(`${AUTH_API_URL}/api/v1/evals/generation-jobs/${jobId}`, {
    headers: { "x-user-id": userId },
  }).then((d) => ({ jobId: d.jobId, state: d.state, progress: d.progress, ...(d.failedReason ? { failedReason: d.failedReason } : {}) }));
}

export async function cancelGenerationJob(jobId: string, userId: string): Promise<void> {
  await request<{ success: boolean }>(`${AUTH_API_URL}/api/v1/evals/generation-jobs/${jobId}/cancel`, {
    method: "POST",
    headers: { "x-user-id": userId },
  });
}

export async function getGeneration(id: string): Promise<EvalGeneration> {
  const data = await request<{ success: boolean; run: EvalGeneration }>(
    `${AUTH_API_URL}/api/v1/evals/generations/${id}`,
  );
  return data.run;
}

export interface GenerationMeta {
  id: string;
  agentSlug: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  genProvider?: string | null;
  genModel?: string | null;
}

/** All runs for a folder (newest first) — for the regression-compare picker. */
export async function listGenerationsForFolder(folderId: string): Promise<GenerationMeta[]> {
  const data = await request<{ success: boolean; runs: GenerationMeta[] }>(
    `${AUTH_API_URL}/api/v1/evals/folders/${folderId}/generations`,
  );
  return data.runs;
}

export async function getLatestGenerationForFolder(folderId: string): Promise<EvalGeneration | null> {
  const data = await request<{ success: boolean; run: EvalGeneration | null }>(
    `${AUTH_API_URL}/api/v1/evals/folders/${folderId}/latest-generation`,
  );
  return data.run;
}

// ── Named judges ──
export interface EvalJudge {
  id: string;
  name: string;
  prompt: string;
  model: string;
  isDefault: boolean;
  createdAt: string;
}

export async function listEvalJudges(): Promise<EvalJudge[]> {
  const data = await request<{ success: boolean; judges: EvalJudge[] }>(`${AUTH_API_URL}/api/v1/evals/judges`);
  return data.judges;
}

export async function createEvalJudge(
  payload: { name: string; prompt: string; model?: string },
  userId: string,
): Promise<EvalJudge> {
  const data = await request<{ success: boolean; judge: EvalJudge }>(`${AUTH_API_URL}/api/v1/evals/judges`, {
    method: "POST",
    headers: { "x-user-id": userId },
    body: JSON.stringify(payload),
  });
  return data.judge;
}

export async function updateEvalJudge(
  id: string,
  payload: { name?: string; prompt?: string; model?: string },
  userId: string,
): Promise<EvalJudge> {
  const data = await request<{ success: boolean; judge: EvalJudge }>(`${AUTH_API_URL}/api/v1/evals/judges/${id}`, {
    method: "PUT",
    headers: { "x-user-id": userId },
    body: JSON.stringify(payload),
  });
  return data.judge;
}

export async function deleteEvalJudge(id: string, userId: string): Promise<void> {
  await request<{ success: boolean }>(`${AUTH_API_URL}/api/v1/evals/judges/${id}`, {
    method: "DELETE",
    headers: { "x-user-id": userId },
  });
}

// ── Semantic judge (background scoring job) ──
/** Enqueue a background scoring job: one or more judges grade a run's turns
 *  server-side. Omit conversationIds for the whole run, or pass them for one
 *  conversation. Omit judgeIds to use the built-in Default judge. Returns a
 *  jobId; poll getEvalJudgeJob for progress. */
export async function judgeEvalRun(
  runId: string,
  payload: {
    judges?: Array<{ judgeId: string; model?: string }>;
    conversationIds?: string[];
    onlyUnscored?: boolean;
  },
  userId: string,
): Promise<{ jobId: string }> {
  const d = await request<{ success: boolean; jobId: string }>(
    `${AUTH_API_URL}/api/v1/evals/generations/${runId}/judge`,
    { method: "POST", headers: { "x-user-id": userId }, body: JSON.stringify(payload) },
  );
  return { jobId: d.jobId };
}

export interface EvalJudgeProgress {
  phase: "scoring" | "done" | "cancelled" | "failed";
  total: number;
  done: number;
  judged: number;
  failed: number;
  judgeCount: number;
}

export interface EvalJudgeJobStatus {
  jobId: string;
  state: string;
  progress: EvalJudgeProgress | null;
  failedReason?: string;
}

export async function getEvalJudgeJob(jobId: string, userId: string): Promise<EvalJudgeJobStatus> {
  return request<{ success: boolean } & EvalJudgeJobStatus>(
    `${AUTH_API_URL}/api/v1/evals/judge-jobs/${jobId}`,
    { headers: { "x-user-id": userId } },
  ).then((d) => ({ jobId: d.jobId, state: d.state, progress: d.progress, ...(d.failedReason ? { failedReason: d.failedReason } : {}) }));
}

export async function cancelEvalJudgeJob(jobId: string, userId: string): Promise<void> {
  await request<{ success: boolean }>(`${AUTH_API_URL}/api/v1/evals/judge-jobs/${jobId}/cancel`, {
    method: "POST",
    headers: { "x-user-id": userId },
  });
}

export interface SpacesChannelOption {
  id: string;
  name: string;
  type: string;
}

/** List the user's Spaces channels (with channel `type`) for the eval import
 *  picker. `spacesAuth=false` means there's no active Spaces session. */
export async function listEvalSpacesChannels(
  userId: string,
): Promise<{ channels: SpacesChannelOption[]; spacesAuth: boolean }> {
  const data = await request<{ success: boolean; channels: SpacesChannelOption[]; spacesAuth: boolean }>(
    `${AUTH_API_URL}/api/v1/evals/spaces-channels`,
    { headers: { "x-user-id": userId } },
  );
  return { channels: data.channels, spacesAuth: data.spacesAuth };
}

export interface EvalImportProgress {
  phase: "scanning" | "done" | "cancelled";
  conversationsScanned: number;
  pairsFound: number;
  conversationsCreated: number;
  duplicatesSkipped: number;
  conversationsUpdated: number;
  capped: boolean;
  cursor?: string;
}

export interface EvalImportStatus {
  jobId: string;
  state: string; // waiting | active | completed | failed | delayed | unknown
  progress: EvalImportProgress | null;
  failedReason?: string;
}

/** Enqueue a background import of a thread / chat channel / email channel from
 *  Spaces over a time range. Returns the jobId; poll getEvalImportJob. */
export async function importEvalFromSpaces(
  folderId: string,
  payload: {
    kind: "thread" | "channel" | "email-channel";
    channelId?: string;
    conversationId?: string;
    model?: string;
    range?: string;
  },
  userId: string,
): Promise<{ jobId: string }> {
  const d = await request<{ success: boolean; jobId: string }>(
    `${AUTH_API_URL}/api/v1/evals/folders/${folderId}/import-from-spaces`,
    { method: "POST", headers: { "x-user-id": userId }, body: JSON.stringify(payload) },
  );
  return { jobId: d.jobId };
}

/** Channel-first import: the backend find-or-creates the folder bound to this
 *  channel (one folder per channel) and imports into it. Returns the resolved
 *  folder so the UI can open/expand it. */
export async function importEvalFromSpacesChannel(
  payload: { kind: "channel" | "email-channel"; channelId: string; model?: string; range?: string },
  userId: string,
): Promise<{ jobId: string; folderId: string; folderName: string }> {
  const d = await request<{ success: boolean; jobId: string; folderId: string; folderName: string }>(
    `${AUTH_API_URL}/api/v1/evals/import-from-channel`,
    { method: "POST", headers: { "x-user-id": userId }, body: JSON.stringify(payload) },
  );
  return { jobId: d.jobId, folderId: d.folderId, folderName: d.folderName };
}

export async function getEvalImportJob(jobId: string, userId: string): Promise<EvalImportStatus> {
  return request<{ success: boolean } & EvalImportStatus>(
    `${AUTH_API_URL}/api/v1/evals/import-jobs/${jobId}`,
    { headers: { "x-user-id": userId } },
  ).then((d) => ({ jobId: d.jobId, state: d.state, progress: d.progress, ...(d.failedReason ? { failedReason: d.failedReason } : {}) }));
}

export async function cancelEvalImportJob(jobId: string, userId: string): Promise<void> {
  await request<{ success: boolean }>(`${AUTH_API_URL}/api/v1/evals/import-jobs/${jobId}/cancel`, {
    method: "POST",
    headers: { "x-user-id": userId },
  });
}

/** Judge/extraction model options + what an empty ("default") model resolves to. */
export async function listEvalModels(): Promise<{ models: string[]; defaultModel: string }> {
  const data = await request<{ success: boolean; models: string[]; defaultModel?: string }>(
    `${AUTH_API_URL}/api/v1/evals/models`,
  );
  return { models: data.models ?? [], defaultModel: data.defaultModel ?? "" };
}

/**
 * Parse pasted/uploaded eval data into importable conversations. The frontend
 * half of the ingestion seam. Accepts (in priority order):
 *   1. JSONL — one conversation per line (each line any shape below).
 *   2. Canonical array: [{ title?, source?, turns: [{ message, expectedResponse }] }]
 *   3. A single turn-keyed object → one conversation:
 *        { "1": { message, response }, "2": { message, response } }
 *   4. An array of turn-keyed objects → many conversations.
 * Returns { conversations } or { error }.
 */
export function parseEvalConversations(
  raw: string,
): { conversations: Array<{ title?: string; source?: string; turns: EvalTurn[] }> } | { error: string } {
  const text = raw.trim();
  if (!text) return { error: "Empty" };

  const turnFrom = (t: unknown): EvalTurn | null => {
    if (!t || typeof t !== "object") return null;
    const o = t as Record<string, unknown>;
    const message = o["message"] ?? o["input"] ?? o["user"] ?? o["query"];
    if (typeof message !== "string" || !message.trim()) return null;
    const expected = o["expectedResponse"] ?? o["response"] ?? o["answer"] ?? o["expected"] ?? o["output"];
    return { message, expectedResponse: typeof expected === "string" ? expected : null };
  };

  const convFromKeyed = (obj: Record<string, unknown>): { turns: EvalTurn[] } | null => {
    const keys = Object.keys(obj).filter((k) => /^\d+$/.test(k)).sort((a, b) => Number(a) - Number(b));
    if (keys.length === 0) return null;
    const turns: EvalTurn[] = [];
    for (const k of keys) {
      const turn = turnFrom(obj[k]);
      if (!turn) return null;
      turns.push(turn);
    }
    return turns.length ? { turns } : null;
  };

  const convFromAny = (v: unknown): { title?: string; source?: string; turns: EvalTurn[] } | null => {
    if (!v || typeof v !== "object") return null;
    const o = v as Record<string, unknown>;
    const title = typeof o["title"] === "string" ? (o["title"] as string) : undefined;
    const source = typeof o["source"] === "string" ? (o["source"] as string) : undefined;
    // Canonical { turns: [...] }
    if (Array.isArray(o["turns"])) {
      const turns: EvalTurn[] = [];
      for (const t of o["turns"]) {
        const turn = turnFrom(t);
        if (!turn) return null;
        turns.push(turn);
      }
      return turns.length ? { ...(title ? { title } : {}), ...(source ? { source } : {}), turns } : null;
    }
    // Turn-keyed object
    const keyed = convFromKeyed(o);
    if (keyed) return { ...(title ? { title } : {}), ...(source ? { source } : {}), turns: keyed.turns };
    return null;
  };

  // JSONL: more than one non-empty line and every line parses as JSON.
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length > 1 && lines.every((l) => l.startsWith("{") || l.startsWith("["))) {
    const conversations: Array<{ title?: string; source?: string; turns: EvalTurn[] }> = [];
    let allParsed = true;
    for (const line of lines) {
      try {
        const conv = convFromAny(JSON.parse(line));
        if (!conv) { allParsed = false; break; }
        conversations.push(conv);
      } catch {
        allParsed = false;
        break;
      }
    }
    if (allParsed && conversations.length) return { conversations };
    // fall through to whole-document parse
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: "Not valid JSON or JSONL" };
  }

  if (Array.isArray(parsed)) {
    if (parsed.length === 0) return { error: "Empty array" };
    // Simplest shape: a flat array of { message, response } turns → ONE
    // conversation. Detected when every element parses as a turn and none is
    // itself a conversation (no nested `turns`).
    const asTurns = parsed.map(turnFrom);
    const allBareTurns =
      asTurns.every((t) => t !== null) &&
      parsed.every((it) => !it || typeof it !== "object" || !Array.isArray((it as Record<string, unknown>)["turns"]));
    if (allBareTurns) {
      return { conversations: [{ turns: asTurns as EvalTurn[] }] };
    }
    // Otherwise: an array of conversations (each with `turns` or numbered keys).
    const conversations: Array<{ title?: string; source?: string; turns: EvalTurn[] }> = [];
    for (const item of parsed) {
      const conv = convFromAny(item);
      if (!conv) return { error: "Each item needs a 'turns' array or numbered message/response keys" };
      conversations.push(conv);
    }
    return { conversations };
  }

  if (parsed && typeof parsed === "object") {
    const conv = convFromAny(parsed);
    if (!conv) return { error: "Could not read turns (need a 'turns' array or numbered message/response keys)" };
    return { conversations: [conv] };
  }

  return { error: "Unrecognized shape" };
}
