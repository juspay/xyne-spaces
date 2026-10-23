import type { User, McpServer, UserConnection, HealthResult, CredentialField, Gateway, GatewayIdentity, GatewayServiceRow, GatewayServiceRequest, Agent, AgentLight, ScheduledJob, ScheduledJobRun } from "./types";

import { frontendConfig } from "./config";

const BACKEND_URL = frontendConfig.spacesAuthBaseUrl;
const AUTH_API_URL = frontendConfig.clawApiBaseUrl;

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface DesignArtifactShare {
  id: string;
  title: string;
  attachmentId: string;
  conversationId: string;
  sharePath: string;
  expiresAt: string | null;
  revokedAt: string | null;
  viewCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PublicDesignArtifact {
  title: string;
  updatedAt: string;
  expiresAt: string | null;
}

export async function publishDesignArtifact(input: {
  attachmentId: string;
  conversationId: string;
  title: string;
  expiresInDays?: 1 | 7 | 30 | 90 | null;
}): Promise<DesignArtifactShare> {
  const result = await request<{ success: true; data: DesignArtifactShare }>(
    `${AUTH_API_URL}/api/v1/design-shares`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  return result.data;
}

export async function getDesignArtifactShare(conversationId: string): Promise<DesignArtifactShare | null> {
  const result = await request<{ success: true; data: DesignArtifactShare | null }>(
    `${AUTH_API_URL}/api/v1/design-shares/conversation/${encodeURIComponent(conversationId)}`,
  );
  return result.data;
}

export async function revokeDesignArtifactShare(shareId: string): Promise<void> {
  await request<{ success: true }>(
    `${AUTH_API_URL}/api/v1/design-shares/${encodeURIComponent(shareId)}`,
    { method: "DELETE" },
  );
}

export async function getPublicDesignArtifact(token: string): Promise<PublicDesignArtifact> {
  const response = await fetch(`${AUTH_API_URL}/api/v1/public/design-shares/metadata`, {
    credentials: "include",
    headers: { "x-design-share-token": token },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new ApiError(response.status, body.error ?? "Shared design is unavailable");
  }
  const result = await response.json() as { success: true; data: PublicDesignArtifact };
  return result.data;
}

export async function getPublicDesignArtifactHtml(token: string): Promise<Blob> {
  const response = await fetch(`${AUTH_API_URL}/api/v1/public/design-shares/content`, {
    credentials: "include",
    headers: { "x-design-share-token": token },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new ApiError(response.status, body.error ?? "Shared design is unavailable");
  }
  return response.blob();
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
    const body = await res.json().catch(() => ({})) as { error?: string; code?: string };
    throw new ApiError(res.status, body.error ?? `Request failed: ${res.status}`, body.code);
  }

  return res.json() as Promise<T>;
}

export type AdminOrgScope = "org" | "all";

function applyAdminOrgScope(params: URLSearchParams, orgScope?: AdminOrgScope): void {
  if (orgScope === "all") params.set("orgScope", "all");
}

export async function getMe(): Promise<User> {
  const data = await request<{ success: boolean; user: User }>(
    `${BACKEND_URL}/api/auth/validate`,
  );
  return data.user;
}

/**
 * The Claw-side identity for the logged-in user. `userId` is the canonical
 * Claw id (what Claw-owned rows like Agent.ownerUserId store); `spacesUserId`
 * is the raw workspace-scoped Spaces id (what `getMe().id` returns). A user's
 * agent rows may be keyed by either, so ownership comparisons must accept both.
 */
export interface ClawIdentity {
  userId: string;
  spacesUserId?: string;
  spacesWorkspaceId?: string;
  spacesOrgMemberId?: string;
}

export async function getClawIdentity(): Promise<ClawIdentity | null> {
  try {
    const data = await request<{ success: boolean; data: ClawIdentity }>(
      `${AUTH_API_URL}/api/v1/users/me`,
    );
    return data.data;
  } catch {
    return null;
  }
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

/**
 * Outcome of POST /api/v1/servers.
 *  - "saved":       a personal connector was created/updated in place.
 *  - "editRequest": a shared (scope=global) connector edit was queued for
 *                   admin approval; the live definition is unchanged and there
 *                   is nothing to reconnect. Callers MUST branch on `kind`.
 */
export type CreateServerResult =
  | { kind: "saved"; server: McpServer }
  | { kind: "editRequest"; editRequestId: string; message: string };

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
): Promise<CreateServerResult> {
  const data = await request<{ success: boolean; data: unknown }>(
    `${AUTH_API_URL}/api/v1/servers`,
    { method: "POST", headers: { "x-user-id": userId }, body: JSON.stringify(payload) },
  );
  const payloadData = data.data;
  // A scope=global connector definition is never edited in place. The backend
  // queues an McpConnectorEditRequest (HTTP 202) for admin review and returns
  // { editRequest, message } instead of a server row. Detect that shape so
  // callers can show an approval toast instead of silently reverting the form.
  if (
    payloadData &&
    typeof payloadData === "object" &&
    "editRequest" in payloadData &&
    (payloadData as { editRequest?: unknown }).editRequest
  ) {
    const queued = payloadData as { editRequest: { id: string }; message?: string };
    return {
      kind: "editRequest",
      editRequestId: queued.editRequest.id,
      message: queued.message ?? "Change submitted for admin review.",
    };
  }
  return { kind: "saved", server: payloadData as McpServer };
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

export async function approveCliLogin(userCode: string): Promise<void> {
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/cli/auth/approve`,
    { method: "POST", body: JSON.stringify({ userCode }) },
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

function agentListQuery(userId?: string, allAgents?: boolean, orgScope?: AdminOrgScope, view?: "full"): string {
  // allAgents=true asks the backend for the FULL roster (admins only — server
  // enforces). Use it only where you genuinely need every user's agents (e.g.
  // the metrics agent filter); the default list stays filtered to
  // global ∪ owned ∪ shared.
  const params = new URLSearchParams();
  if (userId) params.set("userId", userId);
  if (allAgents) params.set("scope", "all");
  if (view) params.set("view", view);
  applyAdminOrgScope(params, orgScope);
  return params.toString() ? `?${params.toString()}` : "";
}

export async function listAgents(userId?: string, allAgents?: boolean, orgScope?: AdminOrgScope): Promise<AgentLight[]> {
  const data = await request<{ success: boolean; data: AgentLight[] }>(
    `${AUTH_API_URL}/api/v1/agents${agentListQuery(userId, allAgents, orgScope)}`,
  );
  return data.data;
}

export async function listAgentsFull(userId?: string, allAgents?: boolean, orgScope?: AdminOrgScope): Promise<Agent[]> {
  const data = await request<{ success: boolean; data: Agent[] }>(
    `${AUTH_API_URL}/api/v1/agents${agentListQuery(userId, allAgents, orgScope, "full")}`,
  );
  return data.data;
}

export interface SandboxRepoOption {
  key: string;
  name: string;
  description?: string;
}

export interface OptimizationOption {
  key: string;
  label: string;
  summary: string;
  detail: string;
  group: string;
  defaultOn: boolean;
  /** "fleet" switches are decided outside agent runs, so only env changes them. */
  scope: "agent" | "fleet";
  requires?: string;
}

export interface OptimizationCatalog {
  groups: Array<{ id: string; title: string; description: string }>;
  optimizations: OptimizationOption[];
  /** Per delegation tier: switches that default on (or off) for that tier. */
  tierDefaults: Record<string, Record<string, boolean>>;
}

/** Every claw optimization switch, for the agent page's Optimizations section. */
export async function getOptimizationCatalog(): Promise<OptimizationCatalog> {
  const data = await request<{ success: boolean; data: OptimizationCatalog }>(
    `${AUTH_API_URL}/api/v1/agents/optimizations`,
  );
  return data.data;
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

export type DelegationIdentityMode = "user" | "callee_app";

export interface AgentDelegationGrant {
  id: string;
  callerAgentId: string;
  calleeAgentId: string;
  identityMode: DelegationIdentityMode;
  enabled: boolean;
  status: "pending" | "approved" | "rejected";
  approvedByUserId: string | null;
  approvedAt: string | null;
  createdByUserId: string | null;
  requestReason: string | null;
  createdAt: string;
  updatedAt: string;
  callee: (Pick<AgentLight, "id" | "slug" | "name" | "description" | "enabled"> & {
    ownerUserId?: string | null;
    /** Display name of the callee agent's owner — who must approve a pending grant. */
    ownerName?: string | null;
  }) | null;
}

export interface AgentDelegationRequest {
  id: string;
  callerAgentId: string;
  calleeAgentId: string;
  identityMode: DelegationIdentityMode;
  enabled: boolean;
  status: "pending" | "approved" | "rejected";
  approvedByUserId: string | null;
  approvedAt: string | null;
  createdByUserId: string | null;
  requestReason: string | null;
  createdAt: string;
  updatedAt: string;
  caller: (Pick<AgentLight, "id" | "slug" | "name" | "description" | "enabled" | "ownerUserId" | "owner">) | null;
}

export interface AgentDelegationPendingRequest extends AgentDelegationRequest {
  callee: Pick<AgentLight, "id" | "slug" | "name" | "description" | "enabled" | "ownerUserId"> | null;
}

export async function listDelegationGrants(slug: string): Promise<AgentDelegationGrant[]> {
  const data = await request<{ success: boolean; data: AgentDelegationGrant[] }>(
    `${AUTH_API_URL}/api/v1/agents/${encodeURIComponent(slug)}/delegation-grants`,
  );
  return data.data;
}

export async function createDelegationGrant(
  slug: string,
  payload: { calleeSlug: string; identityMode?: DelegationIdentityMode; requestReason?: string },
): Promise<AgentDelegationGrant> {
  const data = await request<{ success: boolean; data: AgentDelegationGrant }>(
    `${AUTH_API_URL}/api/v1/agents/${encodeURIComponent(slug)}/delegation-grants`,
    { method: "POST", body: JSON.stringify(payload) },
  );
  return data.data;
}

export async function deleteDelegationGrant(slug: string, grantId: string): Promise<void> {
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/agents/${encodeURIComponent(slug)}/delegation-grants/${encodeURIComponent(grantId)}`,
    { method: "DELETE" },
  );
}

export async function listDelegationRequests(slug: string): Promise<AgentDelegationRequest[]> {
  const data = await request<{ success: boolean; data: AgentDelegationRequest[] }>(
    `${AUTH_API_URL}/api/v1/agents/${encodeURIComponent(slug)}/delegation-requests`,
  );
  return data.data;
}

export async function listPendingDelegationRequestsForMe(userId: string): Promise<AgentDelegationPendingRequest[]> {
  const data = await request<{ success: boolean; data: AgentDelegationPendingRequest[] }>(
    `${AUTH_API_URL}/api/v1/agents/delegation-requests/pending-for-me`,
    { headers: { "x-user-id": userId } },
  );
  return data.data;
}

export async function decideDelegationRequest(
  slug: string,
  grantId: string,
  approve: boolean,
): Promise<AgentDelegationGrant> {
  const data = await request<{ success: boolean; data: AgentDelegationGrant }>(
    `${AUTH_API_URL}/api/v1/agents/${encodeURIComponent(slug)}/delegation-requests/${encodeURIComponent(grantId)}/decision`,
    { method: "POST", body: JSON.stringify({ approve }) },
  );
  return data.data;
}

export type RunSource = "automation" | "scheduled" | "people" | "workflow" | "delegated" | "awakening";
export type InflightState = "live" | "stuck" | "lost";
type SourceCounts = Partial<Record<RunSource, { completed: number; failed: number; lost: number }>>;

export interface AgentRunHealth {
  windowDays: number;
  sampled: boolean;
  sources: Array<{
    id: RunSource | "all";
    runs: number;
    completed: number;
    failed: number;
    cancelled: number;
    lost: number;
    p50Ms: number | null;
    p90Ms: number | null;
  }>;
  inflight: Array<{
    sessionId: string;
    state: InflightState;
    source: RunSource;
    task: string;
    startedAt: string;
    ageMs: number;
    idleMs: number;
    owned: boolean;
    currentStep: string | null;
  }>;
  daily: Array<{ day: string; bySource: SourceCounts }>;
  reasons: Array<{ error: string; count: number; lastAt: string; bySource: Partial<Record<RunSource, number>> }>;
  models: Array<{
    provider: string;
    model: string;
    runs: number;
    failed: number;
    llmP50Ms: number | null;
    bySource: Partial<Record<RunSource, { runs: number; failed: number }>>;
  }>;
  recentRuns: Array<{
    sessionId: string;
    source: RunSource;
    status: string;
    startedBy: string | null;
    startedAt: string;
    durationMs: number | null;
    model: string | null;
    task: string;
  }>;
  thresholds: { liveIdleMs: number; lostIdleMs: number };
}

export interface AgentRunDetail {
  run: {
    sessionId: string;
    agentSlug: string;
    status: string;
    triggerSource: string;
    task: string;
    result: string | null;
    error: string | null;
    provider: string | null;
    model: string | null;
    conversationId: string | null;
    channelId: string | null;
    parentSessionId: string | null;
    currentToolLabel: string | null;
    toolInvocations: ToolInvocation[] | null;
    tokensIn: number | null;
    tokensOut: number | null;
    llmTotalMs: number | null;
    toolMs: number | null;
    llmTurns: number | null;
    llmRetries: number | null;
    lastRetryReason: string | null;
    startedAt: string;
    completedAt: string | null;
  };
  source: RunSource;
  inflight: { state: InflightState; idleMs: number; owned: boolean } | null;
  requester: { id: string; name: string | null; email: string | null } | null;
  children: Array<{ sessionId: string; agentSlug: string; status: string; startedAt: string; durationMs: number | null; task: string }>;
}

export async function getAgentRunDetail(slug: string, sessionId: string): Promise<AgentRunDetail> {
  const data = await request<{ success: boolean; data: AgentRunDetail }>(
    `${AUTH_API_URL}/api/v1/agents/${encodeURIComponent(slug)}/monitor/runs/${encodeURIComponent(sessionId)}`,
  );
  return data.data;
}

export async function getAgentRunHealth(slug: string, days: number): Promise<AgentRunHealth> {
  const data = await request<{ success: boolean; data: AgentRunHealth }>(
    `${AUTH_API_URL}/api/v1/agents/${encodeURIComponent(slug)}/monitor?days=${days}`,
  );
  return data.data;
}

export async function closeLostRuns(slug: string, sessionIds?: string[]): Promise<{ closed: string[]; skipped: string[] }> {
  const data = await request<{ success: boolean; data: { closed: string[]; skipped: string[] } }>(
    `${AUTH_API_URL}/api/v1/agents/${encodeURIComponent(slug)}/monitor/close-lost`,
    { method: "POST", body: JSON.stringify(sessionIds ? { sessionIds } : {}) },
  );
  return data.data;
}

export async function revokeDelegationRequest(slug: string, grantId: string): Promise<AgentDelegationGrant> {
  const data = await request<{ success: boolean; data: AgentDelegationGrant }>(
    `${AUTH_API_URL}/api/v1/agents/${encodeURIComponent(slug)}/delegation-requests/${encodeURIComponent(grantId)}/revoke`,
    { method: "POST" },
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

/**
 * Live awakening state for an agent — the row the background workers actually
 * read, which is NOT the same flag as `config.awakening.enabled` that the
 * editor writes. When a worker cannot resolve an agent's identity it disables
 * that row and records why; without surfacing this the tab shows a toggle that
 * is on while the agent is switched off.
 */
export interface AwakeningStatus {
  state: {
    enabled: boolean;
    lastError: string | null;
    nextDueAt: string | null;
    reflexNextCheckAt: string | null;
    consecutiveFailures: number;
  } | null;
  recent: Array<{
    kind: string;
    outcome: string;
    skipReason: string | null;
    eventCount: number;
    startedAt: string;
  }>;
}

export async function getAwakeningStatus(agentId: string): Promise<AwakeningStatus> {
  const data = await request<{ success: boolean; data: AwakeningStatus }>(
    `${AUTH_API_URL}/api/v1/awakening/${agentId}/status`,
    { method: "GET" },
  );
  return data.data;
}

/** Regenerates the card Spaces routes unprompted questions by. */
export async function regenerateRoutingCard(
  slug: string,
): Promise<{ text: string; sourceHash: string; generatedAt: string }> {
  const data = await request<{ success: boolean; data: { text: string; sourceHash: string; generatedAt: string } }>(
    `${AUTH_API_URL}/api/v1/agents/${slug}/proactivity/card`,
    { method: "POST" },
  );
  return data.data;
}

export async function updateAgentDesignSystem(
  slug: string,
  designSystem: string | null,
): Promise<Agent> {
  const data = await request<{ success: boolean; data: Agent }>(
    `${AUTH_API_URL}/api/v1/agents/${encodeURIComponent(slug)}/design-system`,
    { method: "PATCH", body: JSON.stringify({ designSystem }) },
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
  /** Set when this credential is a BINDING to an org-level shared credential
   *  (one OAuth session shared by several agents) rather than a dedicated key. */
  sharedCredentialId: string | null;
  sharedCredentialName: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Promote this agent's credential to an org-level shared credential and bind
 *  the given agents to it (re-call with more agentIds to extend). */
export async function shareAgentProviderCredential(
  slug: string,
  provider: string,
  payload: { name?: string; agentIds: string[] },
): Promise<{ sharedCredentialId: string; results: Array<{ agentId: string; slug?: string; ok: boolean; error?: string }> }> {
  const data = await request<{ success: boolean; data: { sharedCredentialId: string; results: Array<{ agentId: string; slug?: string; ok: boolean; error?: string }> } }>(
    `${AUTH_API_URL}/api/v1/agents/${encodeURIComponent(slug)}/provider-credentials/${encodeURIComponent(provider)}/share`,
    { method: "POST", body: JSON.stringify(payload) },
  );
  return data.data;
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

// Agent-scoped LiteLLM model list. POST (not GET like Codex) so the add-
// credential form can list models for a JUST-TYPED key + base URL before the
// credential is saved. With no apiKey, the backend lists against the saved
// `litellm` cred. Returns the models the key can access on the proxy.
export async function listAgentLitellmModels(
  slug: string,
  payload?: { apiKey?: string; baseUrl?: string },
): Promise<Array<{ id: string; name: string }>> {
  const data = await request<{ success: boolean; data: Array<{ id: string; name: string }> }>(
    `${AUTH_API_URL}/api/v1/agents/${encodeURIComponent(slug)}/provider-credentials/litellm/models`,
    { method: "POST", body: JSON.stringify(payload ?? {}) },
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

export interface UserAgentConfigEntry extends UserAgentConfig {
  agentSlug: string;
  chainConfig?: Record<string, unknown> | null;
  updatedAt?: string;
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

export async function listUserAgentConfigs(userId: string): Promise<UserAgentConfigEntry[]> {
  const data = await request<{ success: boolean; data: { configs: UserAgentConfigEntry[] } }>(
    `${AUTH_API_URL}/api/v1/agents/user-config?userId=${encodeURIComponent(userId)}`,
  );
  return data.data.configs;
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
  mode?: "always" | "tools" | "judge" | "commands";
  toolsMustInclude?: string[];
  toolsMustExclude?: string[];
  commandsMustMatch?: string[];
  commandsMustNotMatch?: string[];
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
  orgId?: string;
  orgName?: string | null;
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
export async function listWorkflowGlobalRequests(userId: string, orgScope?: AdminOrgScope): Promise<WorkflowGlobalRequest[]> {
  const qs = new URLSearchParams();
  applyAdminOrgScope(qs, orgScope);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  const data = await request<{ success: boolean; data: WorkflowGlobalRequest[] }>(
    `${AUTH_API_URL}/api/v1/chain-workflows/global-requests${suffix}`,
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

// ── ClickUp OAuth ──────────────────────────────────────────────────────────

/** Start the ClickUp OAuth flow (DCR + PKCE, public client) — returns the consent URL. */
export async function connectClickUp(userId: string): Promise<string> {
  const data = await request<{ success: boolean; data: { authUrl: string } }>(
    `${AUTH_API_URL}/api/v1/users/${userId}/oauth/clickup/authorize`,
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
    task?: string;
    context?: string | null;
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

export interface ScheduledJobControlResult {
  id: string;
  status: string;
  nextRunAt?: string;
}

// Pause an active job: unbinds it from the BullMQ scheduler but keeps the row
// (status -> "paused"). Owner or CLAW_ADMIN only (enforced server-side).
export async function pauseScheduledJob(
  id: string,
): Promise<ScheduledJobControlResult> {
  const data = await request<{ success: boolean; data: ScheduledJobControlResult }>(
    `${AUTH_API_URL}/api/v1/scheduled-jobs/${id}/pause`,
    { method: "POST" },
  );
  return data.data;
}

// Resume a paused job: re-binds it to the BullMQ scheduler (status -> "active").
export async function resumeScheduledJob(
  id: string,
): Promise<ScheduledJobControlResult> {
  const data = await request<{ success: boolean; data: ScheduledJobControlResult }>(
    `${AUTH_API_URL}/api/v1/scheduled-jobs/${id}/resume`,
    { method: "POST" },
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
  user: { id: string; name: string; email: string; orgId?: string; orgName?: string | null };
}

export type AdminDigitalTwinBackfillStatus =
  | "not_started"
  | "running"
  | "paused"
  | "complete"
  | "error";

export interface AdminDigitalTwinUser {
  id: string;
  name: string;
  email: string;
  orgId: string;
  orgName: string;
  enabled: boolean;
  enabledAt: string | null;
  backfill: {
    status: AdminDigitalTwinBackfillStatus;
    from: string | null;
    to: string | null;
    progressPct: number | null;
    recordsSeen: number;
    candidatesMade: number;
    lastError: string | null;
  };
}

export interface AdminDigitalTwinUsersPage {
  rows: AdminDigitalTwinUser[];
  total: number;
  limit: number;
  offset: number;
  summary: { enabled: number; disabled: number; total: number };
  organizations: Array<{ id: string; name: string }>;
}

export interface AdminDigitalTwinUsersQuery {
  search?: string;
  status?: "all" | "enabled" | "disabled";
  orgId?: string;
  sort?: "name_asc" | "name_desc" | "email_asc" | "recently_enabled";
  limit?: 10 | 25 | 50 | 100;
  offset?: number;
}

export interface AdminDigitalTwinBackfillWindow {
  from: string;
  to: string;
}

export async function listAdminDigitalTwinUsers(
  userId: string,
  query: AdminDigitalTwinUsersQuery = {},
): Promise<AdminDigitalTwinUsersPage> {
  const params = new URLSearchParams();
  if (query.search) params.set("search", query.search);
  if (query.status) params.set("status", query.status);
  if (query.orgId) params.set("orgId", query.orgId);
  if (query.sort) params.set("sort", query.sort);
  if (query.limit) params.set("limit", String(query.limit));
  if (query.offset != null) params.set("offset", String(query.offset));
  const data = await request<{ success: boolean; data: AdminDigitalTwinUsersPage }>(
    `${AUTH_API_URL}/api/v1/admin/digital-twin/users?${params.toString()}`,
    { headers: { "x-user-id": userId } },
  );
  return data.data;
}

export async function adminEnableDigitalTwinForUser(
  userId: string,
  targetUserId: string,
  backfill: AdminDigitalTwinBackfillWindow | null,
): Promise<{ enabled: true; enabledAt: string; backfillJobIds: string[] }> {
  const data = await request<{
    success: boolean;
    data: { enabled: true; enabledAt: string; backfillJobIds: string[] };
  }>(`${AUTH_API_URL}/api/v1/admin/digital-twin/users/${encodeURIComponent(targetUserId)}/enable`, {
    method: "POST",
    headers: { "x-user-id": userId },
    body: JSON.stringify({ backfill }),
  });
  return data.data;
}

export async function adminDisableDigitalTwinForUser(
  userId: string,
  targetUserId: string,
): Promise<{ disabled: true; cancelledJobs: number }> {
  const data = await request<{
    success: boolean;
    data: { disabled: true; cancelledJobs: number };
  }>(`${AUTH_API_URL}/api/v1/admin/digital-twin/users/${encodeURIComponent(targetUserId)}/disable`, {
    method: "POST",
    headers: { "x-user-id": userId },
    body: JSON.stringify({}),
  });
  return data.data;
}

export async function adminStartDigitalTwinBackfillForUser(
  userId: string,
  targetUserId: string,
  backfill: AdminDigitalTwinBackfillWindow,
): Promise<{ backfillJobIds: string[] }> {
  const data = await request<{ success: boolean; data: { backfillJobIds: string[] } }>(
    `${AUTH_API_URL}/api/v1/admin/digital-twin/users/${encodeURIComponent(targetUserId)}/backfill`,
    {
      method: "POST",
      headers: { "x-user-id": userId },
      body: JSON.stringify({ backfill }),
    },
  );
  return data.data;
}

export interface AuditLogEntry {
  id: string;
  actorUserId: string | null;
  eventType: string;
  targetId: string;
  description: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  orgId?: string | null;
  orgName?: string | null;
}

export async function checkIsAdmin(userId: string): Promise<boolean> {
  const data = await request<{ success: boolean; data: { isAdmin: boolean } }>(
    `${AUTH_API_URL}/api/v1/admin/roles/check/${userId}`,
    { headers: { "x-user-id": userId } },
  );
  return data.data.isAdmin;
}

/** Combined self-check — one round trip for both the blanket CLAW_ADMIN flag
 *  and the narrower Search Evals grant (CLAW_ADMIN or SEARCH_EVAL_ACCESS). */
export async function checkAccess(
  userId: string,
): Promise<{ isAdmin: boolean; hasSearchEvalAccess: boolean }> {
  const data = await request<{
    success: boolean;
    data: { isAdmin: boolean; hasSearchEvalAccess: boolean };
  }>(`${AUTH_API_URL}/api/v1/admin/roles/check/${userId}`, { headers: { "x-user-id": userId } });
  return data.data;
}

// ── Organizations (phase 1, org-only) ──────────────────────────────────────
export type OrgRole = "OWNER" | "ADMIN" | "MEMBER";

export interface OrgSummary {
  id: string;
  name: string;
  description: string | null;
  status: string;
  createdAt: string;
  role: OrgRole;
}

export interface OrgMemberRow {
  userId: string;
  email: string;
  name: string;
  role: OrgRole;
  joinedAt: string;
}

export interface OrgDetail {
  id: string;
  name: string;
  description: string | null;
  status: string;
  createdAt: string;
  createdBy: string;
  members: OrgMemberRow[];
}

export interface ServiceAccessToken {
  id: string;
  name: string | null;
  prefix: string;
  userId: string;
  scopes?: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface MintedServiceAccessToken extends ServiceAccessToken {
  /** Returned only by the mint endpoint. It cannot be retrieved later. */
  token: string;
}

export interface ConnectedSurface {
  id: string;
  orgId: string;
  surfaceId: string;
  surfaceTenantId: string;
  status: "ACTIVE" | "INACTIVE";
  config: Record<string, unknown> | null;
  surface: {
    id: string;
    key: string;
    identityMode: "USER_ID" | "ACCESS_TOKEN";
    supportsUserResolution: boolean;
    status: "ACTIVE" | "INACTIVE";
  };
}

/** Orgs the caller belongs to (with one-org-per-user, this is their org). */
export async function listOrganizations(userId: string): Promise<OrgSummary[]> {
  const data = await request<{ success: boolean; data: OrgSummary[] }>(
    `${AUTH_API_URL}/api/v1/organizations`,
    { headers: { "x-user-id": userId } },
  );
  return data.data;
}

export async function getOrganization(userId: string, orgId: string): Promise<OrgDetail> {
  const data = await request<{ success: boolean; data: OrgDetail }>(
    `${AUTH_API_URL}/api/v1/organizations/${orgId}`,
    { headers: { "x-user-id": userId } },
  );
  return data.data;
}

export async function listOrgSurfaces(userId: string, orgId: string): Promise<ConnectedSurface[]> {
  return request<ConnectedSurface[]>(
    `${AUTH_API_URL}/api/v1/organizations/${orgId}/surfaces`,
    { headers: { "x-user-id": userId } },
  );
}

export async function storeSlackConfigToken(
  orgId: string,
  accessToken: string,
  refreshToken: string,
): Promise<void> {
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/surfaces/slack/config-token`,
    { method: "POST", body: JSON.stringify({ orgId, accessToken, refreshToken }) },
  );
}

export async function createSlackAgentApp(
  slug: string,
  orgId?: string,
): Promise<{ appId: string; installUrl: string; reused: boolean }> {
  const response = await request<{
    success: boolean;
    data: { appId: string; installUrl: string; reused: boolean };
  }>(`${AUTH_API_URL}/api/v1/surfaces/slack/agents/${encodeURIComponent(slug)}/create-app`, {
    method: "POST",
    body: JSON.stringify(orgId ? { orgId } : {}),
  });
  return response.data;
}

export async function syncSlackAgentApp(
  slug: string,
  orgId?: string,
): Promise<{ appId: string; installUrl: string; scopesChanged: boolean }> {
  const response = await request<{
    success: boolean;
    data: { appId: string; installUrl: string; scopesChanged: boolean };
  }>(`${AUTH_API_URL}/api/v1/surfaces/slack/agents/${encodeURIComponent(slug)}/sync-app`, {
    method: "POST",
    body: JSON.stringify(orgId ? { orgId } : {}),
  });
  return response.data;
}

export interface SlackAgentStatus {
  agentId: string;
  agentSlug: string;
  appId: string;
  status: "command" | "created" | "installed";
  commandName?: string;
  installs: Array<{ teamId: string; teamName: string; installedAt: string }>;
  installUrl: string | null;
  manifestStale: boolean;
}

export async function removeSlackAgentRegistration(slug: string, orgId?: string): Promise<void> {
  const query = orgId ? `?orgId=${encodeURIComponent(orgId)}` : "";
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/surfaces/slack/agents/${encodeURIComponent(slug)}/slack-app${query}`,
    { method: "DELETE" },
  );
}

export async function registerSlackCommand(
  slug: string,
  options: { orgId?: string; commandName?: string } = {},
): Promise<{ commandName: string; appId: string }> {
  const response = await request<{
    success: boolean;
    data: { commandName: string; appId: string };
  }>(`${AUTH_API_URL}/api/v1/surfaces/slack/agents/${encodeURIComponent(slug)}/register-command`, {
    method: "POST",
    body: JSON.stringify({
      ...(options.orgId ? { orgId: options.orgId } : {}),
      ...(options.commandName ? { commandName: options.commandName } : {}),
    }),
  });
  return response.data;
}

export async function listSlackAgentStatuses(orgId?: string): Promise<SlackAgentStatus[]> {
  const query = orgId ? `?orgId=${encodeURIComponent(orgId)}` : "";
  const response = await request<{ success: boolean; data: SlackAgentStatus[] }>(
    `${AUTH_API_URL}/api/v1/surfaces/slack/agents/status${query}`,
  );
  return response.data;
}

export async function addOrgMember(
  userId: string,
  orgId: string,
  userIdOrEmail: string,
  role: "ADMIN" | "MEMBER",
): Promise<void> {
  await request(`${AUTH_API_URL}/api/v1/organizations/${orgId}/members`, {
    method: "POST",
    headers: { "x-user-id": userId },
    body: JSON.stringify({ userIdOrEmail, role }),
  });
}

export async function updateOrgMemberRole(
  userId: string,
  orgId: string,
  targetUserId: string,
  role: OrgRole,
): Promise<void> {
  await request(`${AUTH_API_URL}/api/v1/organizations/${orgId}/members/${targetUserId}`, {
    method: "PATCH",
    headers: { "x-user-id": userId },
    body: JSON.stringify({ role }),
  });
}

export async function removeOrgMember(
  userId: string,
  orgId: string,
  targetUserId: string,
): Promise<void> {
  await request(`${AUTH_API_URL}/api/v1/organizations/${orgId}/members/${targetUserId}`, {
    method: "DELETE",
    headers: { "x-user-id": userId },
  });
}

export async function listOrgServiceTokens(
  userId: string,
  orgId: string,
): Promise<ServiceAccessToken[]> {
  const data = await request<{ success: boolean; data: ServiceAccessToken[] }>(
    `${AUTH_API_URL}/api/v1/organizations/${orgId}/service-tokens`,
    { headers: { "x-user-id": userId } },
  );
  return data.data;
}

export async function mintOrgServiceToken(
  userId: string,
  orgId: string,
  input: { name: string; userId: string; expiresAt?: string | null; allowedAgentSlugs: string[]; allowChannelPost?: boolean },
): Promise<MintedServiceAccessToken> {
  const data = await request<{ success: boolean; data: MintedServiceAccessToken }>(
    `${AUTH_API_URL}/api/v1/organizations/${orgId}/service-tokens`,
    {
      method: "POST",
      headers: { "x-user-id": userId },
      body: JSON.stringify(input),
    },
  );
  return data.data;
}

export async function revokeOrgServiceToken(
  userId: string,
  orgId: string,
  tokenId: string,
): Promise<void> {
  await request(`${AUTH_API_URL}/api/v1/organizations/${orgId}/service-tokens/${tokenId}`, {
    method: "DELETE",
    headers: { "x-user-id": userId },
  });
}

/** `role` defaults to "CLAW_ADMIN" server-side; pass "SEARCH_EVAL_ACCESS" to
 *  manage the narrower Search Evals grant instead. */
export async function listAdminRoles(
  userId: string,
  orgScope?: AdminOrgScope,
  role?: string,
): Promise<AdminRole[]> {
  const qs = new URLSearchParams();
  applyAdminOrgScope(qs, orgScope);
  if (role) qs.set("role", role);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  const data = await request<{ success: boolean; data: AdminRole[] }>(
    `${AUTH_API_URL}/api/v1/admin/roles${suffix}`,
    { headers: { "x-user-id": userId } },
  );
  return data.data;
}

export async function grantAdmin(userId: string, targetUserId: string, role?: string): Promise<void> {
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/admin/roles`,
    {
      method: "POST",
      headers: { "x-user-id": userId },
      body: JSON.stringify({ userId: targetUserId, ...(role ? { role } : {}) }),
    },
  );
}

export async function revokeAdmin(userId: string, targetUserId: string, role?: string): Promise<void> {
  const qs = role ? `?role=${encodeURIComponent(role)}` : "";
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/admin/roles/${targetUserId}${qs}`,
    { method: "DELETE", headers: { "x-user-id": userId } },
  );
}

export async function listAuditLogs(userId: string, limit = 50, orgScope?: AdminOrgScope): Promise<AuditLogEntry[]> {
  const qs = new URLSearchParams();
  qs.set("limit", String(limit));
  applyAdminOrgScope(qs, orgScope);
  const data = await request<{ success: boolean; data: AuditLogEntry[] }>(
    `${AUTH_API_URL}/api/v1/admin/audit-logs?${qs.toString()}`,
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
  opts: {
    limit?: number;
    offset?: number;
    orgScope?: AdminOrgScope;
    eventType?: string;
    targetId?: string;
    startDate?: string;
    endDate?: string;
  } = {},
): Promise<{ rows: AuditLogEntry[]; total: number }> {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  const qs = new URLSearchParams();
  qs.set("limit", String(limit));
  qs.set("offset", String(offset));
  if (opts.eventType) qs.set("eventType", opts.eventType);
  if (opts.targetId) qs.set("targetId", opts.targetId);
  if (opts.startDate) qs.set("startDate", opts.startDate);
  if (opts.endDate) qs.set("endDate", opts.endDate);
  applyAdminOrgScope(qs, opts.orgScope);
  const data = await request<{ success: boolean; data: AuditLogEntry[]; total: number }>(
    `${AUTH_API_URL}/api/v1/admin/audit-logs?${qs.toString()}`,
    { headers: { "x-user-id": userId } },
  );
  return { rows: data.data, total: data.total };
}

export interface AgentUsageStat {
  agentSlug: string;
  orgId?: string;
  orgName?: string | null;
  runs: number;
  tokensIn: number;
  tokensOut: number;
  tokensCacheRead: number;
  tokensCacheWrite: number;
}

export async function listAgentUsageStats(userId: string, days: number | "all" = 30, orgScope?: AdminOrgScope): Promise<AgentUsageStat[]> {
  const qs = new URLSearchParams();
  qs.set("days", String(days));
  applyAdminOrgScope(qs, orgScope);
  const data = await request<{ success: boolean; data: AgentUsageStat[] }>(
    `${AUTH_API_URL}/api/v1/admin/usage/stats?${qs.toString()}`,
    { headers: { "x-user-id": userId } },
  );
  return data.data;
}

export interface AdminScheduledJob extends ScheduledJob {
  orgId?: string;
  orgName?: string | null;
  user: { id: string; name: string; email: string } | null;
}

export async function listAdminScheduledJobs(
  userId: string,
  params: { status?: string; agentSlug?: string; userId?: string; limit?: number; offset?: number; orgScope?: AdminOrgScope } = {},
): Promise<{ rows: AdminScheduledJob[]; total: number }> {
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.agentSlug) qs.set("agentSlug", params.agentSlug);
  if (params.userId) qs.set("userId", params.userId);
  if (params.limit != null) qs.set("limit", String(params.limit));
  if (params.offset != null) qs.set("offset", String(params.offset));
  applyAdminOrgScope(qs, params.orgScope);
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
  orgId?: string;
  orgName?: string | null;
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

export async function listPendingRequests(userId: string, orgScope?: AdminOrgScope): Promise<AgentRequestItem[]> {
  const qs = new URLSearchParams();
  applyAdminOrgScope(qs, orgScope);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  const data = await request<{ success: boolean; data: AgentRequestItem[] }>(
    `${AUTH_API_URL}/api/v1/agents/requests/pending${suffix}`,
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

/**
 * Transfer agent ownership to another user. Immediate — there is no acceptance
 * step — and owner/admin-only, same-org only (enforced server side).
 *
 * The agent row itself is kept, so the Spaces app identity, every channel
 * install and all existing schedules survive the transfer. By default the
 * outgoing owner is kept on as an EDITOR; without that they would lose sight of
 * a personal-scope agent entirely, since visibility is derived from ownership
 * OR a share row.
 */
export async function transferAgentOwnership(
  slug: string,
  requesterId: string,
  newOwnerUserId: string,
  keepPreviousOwnerAsEditor = true,
): Promise<{ ownerUserId: string; previousOwnerUserId: string | null }> {
  const data = await request<{ success: boolean; data: { ownerUserId: string; previousOwnerUserId: string | null } }>(
    `${AUTH_API_URL}/api/v1/agents/${slug}/transfer-ownership`,
    {
      method: "POST",
      headers: { "x-user-id": requesterId, "Content-Type": "application/json" },
      body: JSON.stringify({ newOwnerUserId, keepPreviousOwnerAsEditor }),
    },
  );
  return data.data;
}

/**
 * Health-check a single agent-pinned MCP instance. Hits the agent-scoped
 * health route (mirrors checkConnectionHealth for global connections) so the
 * agent MCP tab can show a real reachability status instead of a hardcoded
 * "connected" badge.
 */
export async function checkAgentMcpConnectionHealth(
  slug: string,
  requesterId: string,
  mcpServerType: string,
  instanceSlug = "default",
): Promise<HealthResult> {
  const data = await request<{ success: boolean; data: HealthResult }>(
    `${AUTH_API_URL}/api/v1/agents/${slug}/mcp/connections/${encodeURIComponent(mcpServerType)}/${encodeURIComponent(instanceSlug)}/health`,
    { headers: { "x-user-id": requesterId } },
  );
  return data.data;
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

export interface SubagentMcpConnectionMeta {
  id: string;
  mcpServerId: string;
  mcpServerType: string;
  mcpServerName: string;
  slug: string;
  displayName: string;
  nonOverridable: boolean;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function listSubagentMcpConnections(
  name: string,
  requesterId: string,
): Promise<SubagentMcpConnectionMeta[]> {
  const data = await request<{ success: boolean; data: SubagentMcpConnectionMeta[] }>(
    `${AUTH_API_URL}/api/v1/subagents/${encodeURIComponent(name)}/mcp/connections`,
    { headers: { "x-user-id": requesterId } },
  );
  return data.data;
}

export async function upsertSubagentMcpConnection(
  name: string,
  requesterId: string,
  mcpServerType: string,
  credentials: Record<string, string>,
  opts?: { slug?: string; displayName?: string; nonOverridable?: boolean },
): Promise<SubagentMcpConnectionMeta> {
  const data = await request<{ success: boolean; data: SubagentMcpConnectionMeta }>(
    `${AUTH_API_URL}/api/v1/subagents/${encodeURIComponent(name)}/mcp/connections`,
    {
      method: "POST",
      headers: { "x-user-id": requesterId, "Content-Type": "application/json" },
      body: JSON.stringify({
        mcpServerType,
        credentials,
        ...(opts?.slug ? { slug: opts.slug } : {}),
        ...(opts?.displayName ? { displayName: opts.displayName } : {}),
        ...(opts?.nonOverridable !== undefined ? { nonOverridable: opts.nonOverridable } : {}),
      }),
    },
  );
  return data.data;
}

export async function deleteSubagentMcpConnection(
  name: string,
  requesterId: string,
  mcpServerType: string,
  instanceSlug = "default",
): Promise<void> {
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/subagents/${encodeURIComponent(name)}/mcp/connections/${encodeURIComponent(mcpServerType)}/${encodeURIComponent(instanceSlug)}`,
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
  /** Agent this turn was sent to / answered by. A chat can switch agents
   *  mid-conversation, so identity is per message, not per conversation. */
  agentSlug?: string;
  attachments?: ChatAttachmentMeta[];
  contextItems?: AttachedContextRef[];
}

/** `conversation` = every agent's turns in a direct chat, for a window that
 *  lets the user switch agents mid-conversation. Omitted = one agent's turns. */
export type ChatReadScope = "conversation";

function chatReadQuery(allRuns: boolean, scope?: ChatReadScope): string {
  const params = new URLSearchParams();
  if (allRuns) params.set("allRuns", "1");
  if (scope) params.set("scope", scope);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export type ContextType = "channel" | "ticket" | "canvas" | "call" | "app" | "repository";
export type ContextSearchType = ContextType | "all";

export interface ContextItem {
  id: string;
  type: ContextType;
  title: string;
  subtitle?: string;
  meta?: Record<string, unknown>;
}

export interface AttachedContextRef {
  type: Exclude<ContextType, "repository">;
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

/** An attachment's bytes as text. Used for the small text files a brand
 *  extraction delivers (DESIGN.md, tokens.css) — not for binaries. */
export async function fetchChatAttachmentText(attachmentId: string, userId: string): Promise<string> {
  const res = await fetch(chatAttachmentDownloadUrl(attachmentId), {
    credentials: "include",
    headers: { "x-user-id": userId },
  });
  if (!res.ok) throw new ApiError(res.status, `Could not read attachment: HTTP ${res.status}`);
  return res.text();
}

// --- Brand extraction (XYNE-66818) -----------------------------------------
//
// Render-only mirrors of the BrandSummary contract in
// packages/xyne-claw-shared/src/brand-extraction.ts. They are declared here
// rather than imported because this frontend has no workspace dependencies by
// design — shared constants are fetched at runtime (see SettingsTab).
//
// Validation is NOT duplicated: the backend parses and validates with the
// canonical implementation and this client only ever sees an accepted payload.
// Keep these in step with that file when a field is added.

export type BrandColorRole =
  | "primary" | "accent" | "background" | "surface" | "text"
  | "muted" | "border" | "success" | "warning" | "danger";

export interface BrandColor {
  hex: string;
  token: string;
  role: BrandColorRole;
  occurrences?: number;
}

export interface BrandFont {
  family: string;
  fallbacks?: string[];
  role: "heading" | "body" | "mono";
  weights?: number[];
  sourceUrl?: string;
}

export interface BrandTypeStep {
  name: string;
  sizePx: number;
  lineHeightPx?: number;
  weight?: number;
  letterSpacingPx?: number;
}

export interface BrandScaleValue {
  token: string;
  value: string;
}

export interface BrandAssetRef {
  kind: "logo" | "favicon" | "screenshot-desktop" | "screenshot-mobile";
  file: string;
  mimeType?: string;
  width?: number;
  height?: number;
}

export interface BrandSummary {
  version: 1;
  name: string;
  source: "url" | "screenshot" | "repo";
  sourceUrl?: string;
  sourceRepo?: string;
  sourceCommit?: string;
  extractedAt: string;
  colors: BrandColor[];
  fonts: BrandFont[];
  typeScale: BrandTypeStep[];
  radii?: BrandScaleValue[];
  spacing?: BrandScaleValue[];
  shadows?: BrandScaleValue[];
  assets?: BrandAssetRef[];
  gaps?: string[];
}

/** Filenames a brand extraction delivers. Both XYNE-66818 (url/screenshot)
 *  and XYNE-66819 (repo) emit exactly these. */
export const BRAND_SUMMARY_FILENAME = "brand.json";
export const BRAND_DESIGN_MD_FILENAME = "DESIGN.md";
export const BRAND_TOKENS_CSS_FILENAME = "tokens.css";

/**
 * The validated brand summary for a delivered `brand.json`.
 *
 * Returns null when the attachment is not a valid summary (422) — the card
 * then says so rather than rendering a half-understood payload.
 */
// --- Contrast audit (XYNE-66828) -------------------------------------------
//
// Render-only mirrors of packages/xyne-claw-shared/src/wcag-contrast.ts. The
// MATHS is not mirrored and must not be: the server computes every audit with
// the canonical implementation, which is the only one under test. Re-auditing
// an edited palette is a round trip (`auditContrastTokens`) for exactly that
// reason.

export type ContrastSlot =
  | "background" | "surface" | "body" | "muted"
  | "primary" | "onPrimary" | "onSurface" | "link";

export interface ContrastRatings {
  aaNormal: boolean;
  aaLarge: boolean;
  aaaNormal: boolean;
  aaaLarge: boolean;
}

export interface ContrastSuggestion {
  hex: string;
  ratio: number;
}

/** `missing` means one side has no token, `invalid` that it has one whose value
 *  is not a flat hex. Neither counts as a failure. */
export type ContrastPairStatus = "pass" | "fail" | "missing" | "invalid";

export interface ContrastPairResult {
  id: string;
  label: string;
  status: ContrastPairStatus;
  foreground: ContrastSlot;
  background: ContrastSlot;
  foregroundHex: string | null;
  backgroundHex: string | null;
  /** The custom property behind each side, without `--`. What Apply rewrites —
   *  never the hex, since two tokens routinely share one colour. */
  foregroundToken: string | null;
  backgroundToken: string | null;
  ratio: number | null;
  ratings: ContrastRatings | null;
  suggestion: ContrastSuggestion | null;
  unresolved: ContrastSlot[];
}

export interface ContrastAudit {
  pairs: ContrastPairResult[];
  audited: number;
  failing: number;
  hasIssues: boolean;
}

/** What a list response carries: the verdict without the pair detail. The full
 *  audit is a superset, so `hasIssues` reads the same on both. */
export interface ContrastAuditCounts {
  audited: number;
  failing: number;
  hasIssues: boolean;
}

/**
 * Audit a palette that is still being edited.
 *
 * Takes the token CSS, not a slot map, because that is the artifact a saved
 * DesignSystem stores and therefore the one its badge will be computed from.
 * Auditing anything else lets the card and the saved system disagree — which
 * they did: a token named outside the known slot list was checked on the card
 * via its brand.json ROLE and then invisible once saved, so the warning badge
 * vanished at exactly the moment it started to matter.
 */
export async function auditContrastTokens(input: {
  tokensCss: string;
}): Promise<ContrastAudit> {
  const result = await request<{ success: true; data: ContrastAudit }>(
    `${AUTH_API_URL}/api/v1/design-systems/contrast-audit`,
    { method: "POST", body: JSON.stringify(input) },
  );
  return result.data;
}

export interface BrandSummaryResult {
  summary: BrandSummary;
  /** Set once this brand.json has been saved, so the card stays saved across
   *  a reload instead of offering to create a duplicate. */
  savedDesignSystemId: string | null;
}

export async function fetchBrandSummary(
  attachmentId: string,
  userId: string,
): Promise<BrandSummaryResult | null> {
  const res = await fetch(
    `${AUTH_API_URL}/api/v1/agent-chat/attachments/${encodeURIComponent(attachmentId)}/brand-summary`,
    { credentials: "include", headers: { "x-user-id": userId } },
  );
  if (res.status === 422) return null;
  if (!res.ok) throw new ApiError(res.status, `Could not read brand summary: HTTP ${res.status}`);
  const body = (await res.json()) as {
    success: boolean;
    data: BrandSummary;
    savedDesignSystemId?: string | null;
  };
  if (!body.data) return null;
  return { summary: body.data, savedDesignSystemId: body.savedDesignSystemId ?? null };
}

/** Record the DesignSystem a brand.json was saved as. Returns the id that is
 *  now recorded — which may be an EARLIER one if this attachment was already
 *  saved, so the caller shows that rather than its own duplicate. */
export async function recordBrandSaved(
  attachmentId: string,
  designSystemId: string,
  userId: string,
): Promise<string> {
  const res = await fetch(
    `${AUTH_API_URL}/api/v1/agent-chat/attachments/${encodeURIComponent(attachmentId)}/brand-saved`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "x-user-id": userId },
      body: JSON.stringify({ designSystemId }),
    },
  );
  if (!res.ok) throw new ApiError(res.status, `Could not record the save: HTTP ${res.status}`);
  const body = (await res.json()) as { data: { savedDesignSystemId: string } };
  return body.data.savedDesignSystemId;
}

// --- Design systems (XYNE-66817) -------------------------------------------

export interface DesignSystemRecord {
  id: string;
  orgId: string;
  name: string;
  designMd: string;
  tokensCss: string;
  assets: unknown;
  source: string;
  sourceUrl: string | null;
  sourceRepo: string | null;
  sourceCommit: string | null;
  version: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** XYNE-66828. The full audit on a single-row response, the counts alone on a
   *  list — derived from `tokensCss` on every read, never stored, so it cannot
   *  go stale against an edited palette. */
  contrast?: ContrastAudit | ContrastAuditCounts;
}

export interface CreateDesignSystemInput {
  name: string;
  designMd?: string;
  tokensCss?: string;
  assets?: Record<string, unknown> | null;
  /** "manual" | "url" | "screenshot" | "repo" | "file" | "library". */
  source?: string;
  sourceUrl?: string | null;
  sourceRepo?: string | null;
  sourceCommit?: string | null;
}

export async function createDesignSystem(
  input: CreateDesignSystemInput,
): Promise<DesignSystemRecord> {
  const result = await request<{ success: true; data: DesignSystemRecord }>(
    `${AUTH_API_URL}/api/v1/design-systems`,
    { method: "POST", body: JSON.stringify(input) },
  );
  return result.data;
}

export async function listDesignSystems(): Promise<DesignSystemRecord[]> {
  const result = await request<{ success: true; data: DesignSystemRecord[] }>(
    `${AUTH_API_URL}/api/v1/design-systems`,
  );
  return result.data ?? [];
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

export type PlanTodoStatus = "pending" | "in_progress" | "completed" | "failed";

export interface PlanTodo {
  id: string;
  title: string;
  status: PlanTodoStatus;
}

/** A payload interned into the v2 blob log and referenced by hash. Large fields
 *  (system prompt, tool result, transcript) arrive as one of these instead of a
 *  string whenever the blob content could not be inlined — capture level
 *  `metadata`, or a blob log that lost its tail. `preview` is the first ~200
 *  chars so a reader always has something to show. */
export interface DebugBlobRef {
  hash: string;
  bytes: number;
  originalBytes?: number;
  truncated?: true;
  preview?: string;
}

export interface DebugSkillRef {
  name: string;
  description?: string;
  location?: string;
}

export interface DebugToolDefinition {
  name: string;
  description?: string;
  /** JSON Schema the model was given for this tool's arguments. */
  parameters?: unknown;
}

/**
 * Event payload. Every field is optional and must be guarded at the read site:
 * older runs predate them, capture level can drop them, and the big ones may
 * come through as a `DebugBlobRef`. The index signature stays because readers
 * (the debug drawer, the trace exporter) treat data as an open bag.
 */
export interface DebugEventData {
  [key: string]: unknown;
  /** On `session_prompt`, the TRUE prompt pi sent — persona plus the
   *  `<available_skills>` block — not just the persona prompt. */
  systemPrompt?: string | DebugBlobRef;
  availableSkills?: DebugSkillRef[];
  tools?: DebugToolDefinition[];
  toolNames?: string[];
  /** Mid-run tool-palette diff (load-tools / fast-mode). */
  paletteAdded?: string[];
  paletteRemoved?: string[];
  temperature?: number;
  maxTokens?: number;
  thinkingLevel?: string;
  fastMode?: boolean;
  model?: string;
  provider?: string;
  /** `cacheRead`/`cacheWrite` are the prompt-cache hit/miss signal. */
  responseUsage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
  responseStopReason?: string;
  ttftMs?: number;
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
  /** Run id of the child trace a `subagent_start` / `delegation` event spawned. */
  childRunId?: string;
  data: DebugEventData;
}

export interface StreamCallbacks {
  onProgress?: (toolLabel: string) => void;
  onInvocation?: (inv: ToolInvocation) => void;
  onReasoningDelta?: (delta: string) => void;
  onTextDelta?: (delta: string) => void;
  onAttachment?: (att: StreamedAttachment) => void;
  onPlan?: (todos: PlanTodo[]) => void;
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

// Models the agent's shared LiteLLM credential can access, for the in-chat model
// switcher. Any chat participant may call this — the backend reads the agent's
// admin-set key and never returns it. Empty models ⇒ hide the picker.
// `defaultModel` is the agent's configured model, used to preselect the dropdown.
export interface EvalAgentModel {
  provider: string;
  model: string | null;
  isDefault: boolean;
}

/** Providers (with the model each would use) this agent can really run on for the caller. */
export async function listEvalAgentModels(slug: string): Promise<EvalAgentModel[]> {
  const data = await request<{ success: boolean; models?: EvalAgentModel[] }>(
    `${AUTH_API_URL}/api/v1/evals/agent-models/${encodeURIComponent(slug)}`,
  );
  return data.models ?? [];
}

export async function listChatLitellmModels(
  slug: string,
  userId: string,
): Promise<{ models: Array<{ id: string; name: string }>; defaultModel: string | null; pinProvider: string | null }> {
  const res = await fetch(
    `${AUTH_API_URL}/api/v1/agent-chat/${encodeURIComponent(slug)}/litellm-models`,
    { credentials: "include", headers: { "x-user-id": userId } },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as {
    success: boolean;
    data?: Array<{ id: string; name: string }>;
    defaultModel?: string | null;
    pinProvider?: string | null;
  };
  return { models: data.data ?? [], defaultModel: data.defaultModel ?? null, pinProvider: data.pinProvider ?? null };
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
    studioMode?: "design";
    designArtifactAttachmentId?: string;
    designSelection?: {
      scope: "element" | "component" | "design-system";
      selector: string;
      tagName: string;
      label: string;
      id?: string;
      classes: string[];
      text: string;
      ancestors: string[];
      styles: Record<string, string>;
      rect: { x: number; y: number; width: number; height: number };
    };
    /** Per-request model/provider override. Used by the in-chat model switcher
     *  to pin a LiteLLM model off the agent's shared key for this turn. */
    providerOverride?: { provider: string; model?: string };
    /** Trusted SDLC repository selection. The backend resolves and authorizes
     *  the id; URL/branch values are never accepted from the browser. */
    researchContext?: { type: "repository"; id: string; name?: string };
    /** Per-turn provider fast mode (Anthropic `speed: "fast"`): same credential
     *  and model, faster tier. Overrides the agent's modelSettings.speed for
     *  this run only. */
    speed?: "standard" | "fast";
    /** Per-turn thinking level (composer model menu). Overrides the agent's
     *  modelSettings.thinkingLevel for this run only. */
    thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high";
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
      ...(requestOptions?.studioMode ? { studioMode: requestOptions.studioMode } : {}),
      ...(requestOptions?.designArtifactAttachmentId
        ? { designArtifactAttachmentId: requestOptions.designArtifactAttachmentId }
        : {}),
      ...(requestOptions?.designSelection ? { designSelection: requestOptions.designSelection } : {}),
      ...(requestOptions?.providerOverride ? { providerOverride: requestOptions.providerOverride } : {}),
      ...(requestOptions?.researchContext ? { researchContext: requestOptions.researchContext } : {}),
      ...(requestOptions?.speed ? { speed: requestOptions.speed } : {}),
      ...(requestOptions?.thinkingLevel ? { thinkingLevel: requestOptions.thinkingLevel } : {}),
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
      } else if (currentEvent === "plan" && Array.isArray(data.todos) && cb.onPlan) {
        cb.onPlan(data.todos as PlanTodo[]);
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

export async function pollChatMessages(
  slug: string,
  conversationId: string,
  // OPT-IN cross-user read (admin "All Runs" inspector only). Default false so
  // the normal chat window shows only the caller's own turns — the backend ACL
  // gates on ?allRuns=1 AND admin, so passing this from a non-admin is a no-op.
  allRuns = false,
  scope?: ChatReadScope,
): Promise<ChatHistory> {
  const data = await request<{
    success: boolean;
    data: ChatMsg[];
    invocationsByMsgId?: Record<string, ToolInvocation[]>;
  }>(
    `${AUTH_API_URL}/api/v1/agent-chat/${slug}/chat/${conversationId}/messages${chatReadQuery(allRuns, scope)}`,
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
  // The backend persists the user's attached context per message in the
  // `attachedContext` JSON column and returns it on each row. Surface it as
  // `contextItems` (the field the UI renders) so the read-only pills survive a
  // reload. Assistant/legacy rows have none.
  const messages = data.data.map((m) => {
    const raw = (m as unknown as { attachedContext?: AttachedContextRef[] }).attachedContext;
    return raw && raw.length > 0 ? { ...m, contextItems: raw } : m;
  });
  return { messages, invocationsByMsgId, reasoningByMsgId };
}

export interface LiveStreamCallbacks {
  onSnapshot?: (data: {
    invocationsByMsgId: Record<string, ToolInvocation[]>;
    inProgress: ToolInvocation[];
    /** Answer-so-far persisted mid-run — lets a reloaded viewer show the partial
     *  assistant text/reasoning before the first live `delta` arrives. */
    partial?: { msgId: string; content: string; reasoning: string };
  }) => void;
  onLabel?: (toolLabel: string) => void;
  onInvocation?: (inv: ToolInvocation) => void;
  /** Coalesced assistant text/reasoning fragments for a VIEWED run (viewers +
   *  reloaded tabs stream the answer live instead of seeing it appear on `done`). */
  onTextDelta?: (delta: string) => void;
  onReasoningDelta?: (delta: string) => void;
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
  // OPT-IN cross-user live stream (admin "All Runs" only) — mirrors pollChatMessages.
  allRuns = false,
  scope?: ChatReadScope,
): () => void {
  const controller = new AbortController();
  void (async () => {
    let res: Response;
    try {
      res = await fetch(`${AUTH_API_URL}/api/v1/agent-chat/${slug}/chat/${conversationId}/live${chatReadQuery(allRuns, scope)}`, {
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
            ...(data["partial"] ? { partial: data["partial"] as { msgId: string; content: string; reasoning: string } } : {}),
          });
          break;
        case "label":
          if (typeof data["toolLabel"] === "string") callbacks.onLabel?.(data["toolLabel"]);
          break;
        case "invocation":
          if (data["toolInvocation"]) callbacks.onInvocation?.(data["toolInvocation"] as ToolInvocation);
          break;
        case "delta":
          if (typeof data["textDelta"] === "string" && data["textDelta"]) callbacks.onTextDelta?.(data["textDelta"] as string);
          if (typeof data["reasoningDelta"] === "string" && data["reasoningDelta"]) callbacks.onReasoningDelta?.(data["reasoningDelta"] as string);
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
  debugDir: string | null;
  debugSession: Record<string, unknown> | null;
  debugEvents: Record<string, unknown>[] | null;
  runs: Array<{ fileName: string; data: Record<string, unknown> }>;
  subagents: Array<{ fileName: string; data: Record<string, unknown> }>;
  /** Non-fatal problems hit while reading these artifacts (dropped torn line,
   *  unreadable blob log, GCS miss). Surfaced in the drawer so a partial trace
   *  never reads as "no data". Individual runs carry their own `data.warnings`. */
  warnings?: string[];
  /** Runs this viewer may see in the whole conversation. `runs` is one capped
   *  page of them; without these a long thread silently loses its older runs. */
  totalRuns?: number;
  /** True when runs older than this page exist — ask again with a bigger
   *  `limit`, or with `before` set to the oldest runId on this page. */
  truncated?: boolean;
}

export async function fetchConversationDebugArtifacts(
  slug: string,
  conversationId: string,
  opts?: { limit?: number; before?: string },
): Promise<DebugArtifactBundle> {
  const params = new URLSearchParams();
  if (opts?.limit !== undefined) params.set("limit", String(opts.limit));
  if (opts?.before !== undefined) params.set("before", opts.before);
  const query = params.toString();
  const data = await request<{
    success: boolean;
    data: DebugArtifactBundle;
  }>(`${AUTH_API_URL}/api/v1/agent-chat/${slug}/chat/${conversationId}/debug${query ? `?${query}` : ""}`);
  return data.data;
}

/** One row of the chat history: a chat the user switched agents in is one row. */
export interface ConversationSummary {
  /** Unique per row (a Spaces thread is listed once per agent). */
  rowId: string;
  conversationId: string;
  title: string;
  messageCount: number;
  lastMessageAt: string;
  /** The agent to open and continue the chat with — the most recent one. */
  agentSlug: string;
  /** Every agent that answered, in first-use order. */
  agentSlugs: string[];
}

export interface ConversationPage {
  conversations: ConversationSummary[];
  /** Pass back as `cursor` for the next page; null on the last one. */
  nextCursor: string | null;
}

/** One page of the user's chat history across every agent — newest first, 50
 *  rows a page with every pinned chat on the first; the same endpoint the
 *  Spaces AI screen and sidebar use. `agentSlug` keeps only that agent's chats. */
export async function listChatConversations(
  userId: string,
  opts: { agentSlug?: string | null; cursor?: string | null; limit?: number } = {},
): Promise<ConversationPage> {
  const query = new URLSearchParams({ userId });
  if (opts.agentSlug) query.set("agentSlug", opts.agentSlug);
  if (opts.cursor) query.set("cursor", opts.cursor);
  if (opts.limit) query.set("limit", String(opts.limit));
  const data = await request<{ success: boolean; data: ConversationSummary[]; nextCursor?: string | null }>(
    `${AUTH_API_URL}/api/v1/agent-chat/conversations?${query.toString()}`,
  );
  return { conversations: data.data, nextCursor: data.nextCursor ?? null };
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

/** Promote the user's PERSONAL provider credential into an org-level shared
 *  credential and bind the given agents to it. The personal row becomes a
 *  binding too (one OAuth session — copies would invalidate each other). */
export async function shareMyProviderCredential(
  userId: string,
  provider: string,
  payload: { name?: string; agentIds: string[] },
): Promise<{ sharedCredentialId: string; results: Array<{ agentId: string; ok: boolean; error?: string }> }> {
  const data = await request<{ success: boolean; data: { sharedCredentialId: string; results: Array<{ agentId: string; ok: boolean; error?: string }> } }>(
    `${AUTH_API_URL}/api/v1/settings/provider-credentials/${encodeURIComponent(provider)}/share`,
    { method: "POST", headers: { "x-user-id": userId }, body: JSON.stringify(payload) },
  );
  return data.data;
}

export async function listLitellmModelsForUser(
  userId: string,
  payload?: { apiKey?: string; baseUrl?: string },
): Promise<Array<{ id: string; name: string }>> {
  const data = await request<{ success: boolean; data: Array<{ id: string; name: string }> }>(
    `${AUTH_API_URL}/api/v1/settings/provider-credentials/litellm/models`,
    { method: "POST", headers: { "x-user-id": userId }, body: JSON.stringify(payload ?? {}) },
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
  /** Background (run_in_background) subagent lifecycle. `background` marks a
   *  wrapper invocation whose subagent runs DETACHED; the spawning tool call
   *  returns immediately (so `status` becomes "completed" right away), and the
   *  real progress is tracked by `backgroundState`. Rendered as a non-blocking
   *  chip, distinct from a blocking tool. */
  background?: boolean;
  backgroundState?: "running" | "completed" | "error";
  backgroundTaskId?: string;
}

export interface AgentRun {
  id: string;
  sessionId: string;
  userId: string;
  agentSlug: string;
  triggerSource: "spaces" | "scheduled" | "chat" | "api" | "automation" | "delegation";
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
  /** Set when another run spawned this one through `call-agent`: the caller's
   *  session and slug, for telling a child run apart from a top-level one. */
  parentSessionId?: string | null;
  parentAgentSlug?: string | null;
  /** Populated only by the elevated "All Runs" (scope=all) listing — null elsewhere. */
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
  // Elevated view: every user's runs of this agent (server enforces admin or
  // agent contributor access + the usedUserToken ACL). Requires agentSlug.
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

// ── Paged run listing (GET /runs/paged) ──────────────────────────────

/**
 * One row of the paged listing. A deliberate light projection: no
 * `toolInvocations` (JSON, often hundreds of KB per row), no `result`/`error`,
 * no latency block — nothing a list row renders. Use `getRun` when the heavy
 * fields are actually needed.
 *
 * The field set is a structural SUBSET of `AgentRun`, so a full `AgentRun` is
 * assignable to it. That is what lets one shared `RunRow` component render
 * rows from `listRuns`, `listRunsPaged`, and `getRun` alike.
 */
export interface AgentRunListItem {
  id: string;
  sessionId: string;
  userId: string;
  agentSlug: string;
  triggerSource: AgentRun["triggerSource"];
  status: AgentRun["status"];
  /** Capped at 2000 chars server-side — long enough that the UI-only task
   *  search isn't lying about what it matched. */
  task: string;
  conversationId: string | null;
  channelId: string | null;
  startedAt: string;
  completedAt: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  rating: "up" | "down" | null;
  /** Set when another run spawned this one through `call-agent`: the caller's
   *  session and slug, for telling a child run apart from a top-level one. */
  parentSessionId?: string | null;
  parentAgentSlug?: string | null;
  /** Hydrated only by scope=all — null/absent otherwise. */
  userName?: string | null;
  userEmail?: string | null;
}

export interface RunAgentFacet {
  agentSlug: string;
  count: number;
}

export interface RunUserFacet {
  userId: string;
  name: string | null;
  email: string | null;
  count: number;
}

export interface AgentRunListPage {
  rows: AgentRunListItem[];
  total: number;
  limit: number;
  offset: number;
  /** Present only when the caller asked for `facets`. `users` is always `[]`
   *  under scope=own — the server never ships an org's roster to a caller that
   *  passed no elevation check. */
  facets?: { agents: RunAgentFacet[]; users: RunUserFacet[] };
}

export interface AgentRunListQuery {
  scope?: "own" | "all";
  /** Omit for a CROSS-AGENT listing (scope=all + no slug requires CLAW_ADMIN). */
  agentSlug?: string;
  /** scope=all only — sending it with scope=own is a 400, not a silent ignore. */
  userId?: string;
  status?: string;
  /** Case-insensitive sessionId PREFIX, min 4 chars. Setting it makes the
   *  server IGNORE from/to — an id names one run, so intersecting it with a
   *  date window just hides the run the caller already identified. Scope and
   *  org ACL still apply. */
  sessionId?: string;
  /** ISO datetimes. Server defaults to the last 30 days and rejects a range
   *  wider than 366 days. Ignored when `sessionId` is set. */
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
  facets?: boolean;
}

/**
 * Offset-paged run listing with an exact `total`, backing both the agent
 * Activity tab and the admin Runs page.
 *
 * The wire shape is FLAT — `{ success, data: rows, total, limit, offset,
 * facets? }`, with `total` a SIBLING of `data` rather than nested inside it —
 * the same envelope `listAuditLogsPaged` parses. Do NOT copy
 * `listAdminScheduledJobs`' nested `data.rows` parser here: against this
 * endpoint it yields `undefined` rows.
 */
export async function listRunsPaged(requesterId: string, q: AgentRunListQuery): Promise<AgentRunListPage> {
  const qs = new URLSearchParams();
  if (q.scope) qs.set("scope", q.scope);
  if (q.agentSlug) qs.set("agentSlug", q.agentSlug);
  if (q.userId) qs.set("userId", q.userId);
  if (q.status) qs.set("status", q.status);
  if (q.sessionId) qs.set("sessionId", q.sessionId);
  if (q.from) qs.set("from", q.from);
  if (q.to) qs.set("to", q.to);
  if (q.limit != null) qs.set("limit", String(q.limit));
  if (q.offset != null) qs.set("offset", String(q.offset));
  if (q.facets) qs.set("facets", "1");
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  const data = await request<{
    success: boolean;
    data: AgentRunListItem[];
    total: number;
    limit: number;
    offset: number;
    facets?: { agents: RunAgentFacet[]; users: RunUserFacet[] };
  }>(
    `${AUTH_API_URL}/api/v1/runs/paged${suffix}`,
    { headers: { "x-user-id": requesterId } },
  );
  return {
    rows: data.data,
    total: data.total,
    limit: data.limit,
    offset: data.offset,
    ...(data.facets ? { facets: data.facets } : {}),
  };
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
  fast?: boolean;
  checks?: SubagentCheck[];
  checksVersion?: number;
  samples?: SubagentSample[];
  model?: string | null;
  budget?: { maxToolCalls?: number };
  evalReport?: SubagentEvalReport | null;
}

export interface EvalStats {
  labelled: number;
  correct: number;
  confidentWrong: number;
  unsure: number;
  accuracy: number;
  unsureRate: number;
}

export interface EvalModelReport {
  model: string;
  overall: EvalStats;
  checks: Array<EvalStats & { id: string; question: string; variantOf?: string }>;
  meanMs: number;
  unavailable: number;
}

export interface SubagentEvalReport {
  report: { samples: number; models: EvalModelReport[]; ranAt: string };
  regressions: Array<{ model: string; regressions: Array<{ id: string; question: string; from: number; to: number; confidentWrongFrom: number; confidentWrongTo: number }> }>;
  markdown: string;
  checksVersion: number;
}

export interface SubagentTemplateSummary {
  id: string;
  title: string;
  summary: string;
  requires: string[];
  defaultName: string;
  fast: boolean;
  tools: string[];
  checks: number;
  samples: number;
  screenshotSamples: boolean;
}

export interface FastSubagentStats {
  subagentName: string;
  fast: boolean;
  models: string[];
  calls: number;
  errorRate: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  tokensOffloaded: number;
  xorCalls: number;
  xorItems: number;
  unsureRate: number | null;
  unavailableRate: number | null;
  cacheHitRate: number | null;
  escalations: number;
  quotaBlocked: number;
  daily: Array<{ day: string; calls: number; unsureRate: number | null }>;
  costRows: Array<{ model: string | null; parentModel: string | null; calls: number; xorCalls: number; tokensIn: number; tokensOut: number; cacheRead: number; cacheWrite: number }>;
}

export interface FastSubagentRow {
  subagentName: string;
  builtin: boolean;
  calls: number;
  stats: FastSubagentStats | null;
  budget: { maxToolCalls?: number; xorItemsPerHour?: number } | null;
  eval: { accuracy: number | null; confidentWrong: number | null; ranAt: string | null; stale: boolean } | null;
  reviews: { pending: number; correct: number; wrong: number; wrongRate: number | null };
}

export interface FastSubagentAlert {
  id: string;
  subagentName: string;
  kind: string;
  baseline: number;
  current: number;
  samples: number;
  message: string;
  createdAt: string;
  acknowledgedAt: string | null;
}

export interface XorReviewItem {
  id: string;
  subagentName: string;
  item: string;
  questionId: string;
  question: string;
  value: string;
  confidence: number;
  createdAt: string;
}

export async function getFastSubagentStats(days: number): Promise<{ days: number; subagents: FastSubagentRow[]; alerts: FastSubagentAlert[] }> {
  const data = await request<{ success: boolean; data: { days: number; subagents: FastSubagentRow[]; alerts: FastSubagentAlert[] } }>(`${AUTH_API_URL}/api/v1/subagents/fast/stats?days=${days}`);
  return data.data;
}

export async function runFastDriftCheck(): Promise<{ created: FastSubagentAlert[] }> {
  const data = await request<{ success: boolean; data: { created: FastSubagentAlert[] } }>(`${AUTH_API_URL}/api/v1/subagents/fast/drift/check`, { method: "POST" });
  return data.data;
}

export async function ackFastSubagentAlert(id: string): Promise<void> {
  await request(`${AUTH_API_URL}/api/v1/subagents/fast/alerts/${encodeURIComponent(id)}/ack`, { method: "POST" });
}

export async function listXorReviews(subagent?: string): Promise<XorReviewItem[]> {
  const q = subagent ? `?subagent=${encodeURIComponent(subagent)}` : "";
  const data = await request<{ success: boolean; data: XorReviewItem[] }>(`${AUTH_API_URL}/api/v1/subagents/fast/reviews${q}`);
  return data.data;
}

export async function submitXorReview(id: string, verdict: "correct" | "wrong"): Promise<void> {
  await request(`${AUTH_API_URL}/api/v1/subagents/fast/reviews/${encodeURIComponent(id)}`, { method: "POST", body: JSON.stringify({ verdict }) });
}

export async function listSubagentTemplates(): Promise<SubagentTemplateSummary[]> {
  const data = await request<{ success: boolean; data: SubagentTemplateSummary[] }>(`${AUTH_API_URL}/api/v1/subagents/templates`);
  return data.data;
}

export async function cloneSubagentTemplate(id: string, name?: string): Promise<SubagentDef> {
  const data = await request<{ success: boolean; data: SubagentDef }>(
    `${AUTH_API_URL}/api/v1/subagents/templates/${encodeURIComponent(id)}/clone`,
    { method: "POST", body: JSON.stringify(name ? { name } : {}) },
  );
  return data.data;
}

export async function runSubagentEvals(name: string, payload: { compare?: string[]; variants?: Record<string, string[]> }): Promise<SubagentEvalReport> {
  const data = await request<{ success: boolean; data: SubagentEvalReport }>(
    `${AUTH_API_URL}/api/v1/subagents/${encodeURIComponent(name)}/checks/eval`,
    { method: "POST", body: JSON.stringify(payload) },
  );
  return data.data;
}

export type SubagentCheckType = "yesno" | "choice" | "score" | "value";

export interface SubagentCheck {
  id: string;
  question: string;
  type: SubagentCheckType;
  options?: Record<string, string> | string[];
  dtype?: "string" | "int" | "float";
  pattern?: string;
  expect?: string | number | boolean;
  threshold?: number;
}

export type CheckValue = string | number | boolean | null;

export interface SubagentSample {
  input: string;
  image?: string;
  expected: Record<string, CheckValue>;
  label?: string;
}

export interface CheckAnswer {
  value: CheckValue;
  confidence: number | null;
  unsure: boolean;
  ok?: boolean;
}

export interface CheckTryResult {
  answers: Record<string, CheckAnswer>;
  unavailable: boolean;
  ms: number;
}

export async function tryChecks(payload: { checks: SubagentCheck[]; text?: string; image?: string; context?: string }): Promise<CheckTryResult> {
  const data = await request<{ success: boolean; data: CheckTryResult }>(
    `${AUTH_API_URL}/api/v1/subagents/checks/try`,
    { method: "POST", body: JSON.stringify(payload) },
  );
  return data.data;
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
  fast?: boolean;
  checks?: SubagentCheck[] | null;
  samples?: SubagentSample[] | null;
  force?: boolean;
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
  /** Fresh (non-cached) input tokens. Real input volume = this + totalTokensCached. */
  totalTokensIn: number;
  totalTokensOut: number;
  /** cacheRead + cacheWrite — replayed/stored context; dominates on cache-heavy agents. */
  totalTokensCached?: number;
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

export interface DigitalTwinBackfillProgress {
  windowsTotal: number;
  windowsDone: number;
  recordsSeen: number;
  candidatesMade: number;
  currentWindow: { from: string; to: string } | null;
  lastError: { message: string; windowUpper: string; at: string } | null;
  startedAt: string;
  updatedAt: string;
}

export interface DigitalTwinBackfillEntry {
  from: string;
  to: string;
  cursor: string;
  complete: boolean;
  /** Added by the observability work — richer per-window counters. Absent on
   *  rows written before the feature shipped (fall back to cursor math). */
  progress?: DigitalTwinBackfillProgress;
}

/** BullMQ job probe attached to each source in the normalized backfill block. */
export interface DigitalTwinBackfillJobInfo {
  state: string;
  attemptsMade: number;
  maxAttempts: number;
  failedReason: string | null;
}

export interface DigitalTwinBackfillSourceProgress {
  complete: boolean;
  /** True when this incomplete source was paused by the user (kept, not running). */
  paused?: boolean;
  pausedAt?: string | null;
  windowsDone: number | null;
  windowsTotal: number | null;
  recordsSeen: number | null;
  candidatesMade: number | null;
  currentWindow: { from: string; to: string } | null;
  pctByWindows: number | null;
  pctByTime: number | null;
  lastError: { message: string; windowUpper: string; at: string } | null;
  job: DigitalTwinBackfillJobInfo | null;
}

/** Server-normalized backfill view (counts + BullMQ state + server-side stall).
 *  Preferred over raw backfillState when present. */
export interface DigitalTwinBackfillBlock {
  overall: {
    running: boolean;
    /** True when the backfill is paused (kept, resumable). Never running/stalled. */
    paused: boolean;
    stalled: boolean;
    windowsDone: number;
    windowsTotal: number;
    recordsSeen: number;
    candidatesMade: number;
    pctByWindows: number | null;
    updatedAt: string | null;
  };
  sources: Record<string, DigitalTwinBackfillSourceProgress>;
}

export interface DigitalTwinStatus {
  enabled: boolean;
  enabledAt: string | null;
  backfillState: Record<string, DigitalTwinBackfillEntry> | null;
  /** Normalized backfill observability block. Null when no backfill has run. */
  backfill?: DigitalTwinBackfillBlock | null;
  pendingCandidates: number;
  totalCandidates: number;
  approvedCandidates: number;
  /** Real count of the user's memories live in Hindsight (matches the memories
   *  tab). Differs from approvedCandidates, which counts approved candidate rows
   *  and inflates via Hindsight dedup + re-backfills. Use this for "N memories". */
  memoryCount?: number;
  /** True while a manual "delete memories" (all / range) is running in the
   *  background — drives the deletion indicator. */
  memoryDeleteInProgress?: boolean;
  mdFileCount: number;
  /** Optional suffix the user has configured. Empty string when unset. */
  responseSuffix: string;
  /** Memory approval mode: "manual" (review queue) or "auto" (retain
   *  high-confidence candidates immediately). */
  memoryApprovalMode: string;
  /** Min curator confidence (0–1) required to auto-approve a candidate. */
  memoryAutoApproveMinScore: number;
  /** When the twin auto-replies: "always" (every mention) or "learned"
   *  (consult captured respond/ignore patterns, stay silent on high-confidence
   *  ignore). */
  respondPolicy?: string;
}

// ── Pipeline observability (curator trace + per-window events) ────────────────

export type PipelineRunType = "backfill" | "daily" | "upload" | "twin-approval";
export type PipelineSourceKind = "messages" | "calls" | "canvases";
export type PipelineStatus = "ok" | "empty" | "error";

/** One candidate exactly as the LLM emitted it, with the server-side verdict. */
export interface CuratorEmittedCandidate {
  text: string;
  subsystem?: string;
  signalScore?: number;
  groundedOnIds?: string[];
  verdict: "kept" | "dropped";
  dropReason?: "empty" | "empty-or-too-long" | "bad-subsystem" | "low-signal" | "ungrounded" | "malformed" | "classifier-duplicate" | "classifier-noise";
  jevVerdict?: "new" | "duplicate" | "update" | "noise";
  jevConfidence?: number;
  jevScore?: number;
}

/** Full trace of one curator LLM call. Mirrors UserMemoryCuratorTrace in
 *  xyne-claw-shared. */
export interface CuratorTrace {
  model: string;
  durationMs: number;
  systemPrompt?: string;
  prompt?: string;
  /** Absent while the run is still RUNNING — the trace is partial until the
   *  curator LLM responds. Guard (`trace?.promptChars != null`) before reading. */
  promptChars?: number;
  /** Model reasoning / "thinking" when the provider returns it. */
  reasoning?: string;
  /** finish_reason from the model's first choice. */
  finishReason?: string;
  /** Non-tool assistant text (populated when the model answered in content). */
  rawContent?: string;
  toolCallName?: string;
  /** How the args were obtained: proper tool_calls vs recovered from content. */
  toolCallSource?: "tool_calls" | "recovered-content";
  rawResponse?: string;
  usage?: { promptTokens?: number; completionTokens?: number };
  /** Absent while the run is still RUNNING (populated once the LLM responds).
   *  Guard (`trace?.emitted`) before reading `.length` / `.map`. */
  emitted?: CuratorEmittedCandidate[];
  error?: string;
  /** Classifier (Jev) pass after the LLM (R8), stored with the LLM exchange. */
  classifier?: CuratorClassifierTrace;
}

/** Per-file outcome of a soul-synthesis run (runType="synthesize"). */
export interface SynthFileResult {
  name: string;
  factsUsed: number;
  /** "held" = rewrite generated, but the nightly update check kept the old file. */
  action: "updated" | "skipped" | "error" | "held";
  chars?: number;
  check?: {
    verdict: "accept" | "review" | "reject";
    keepsOld?: number;
    supported?: number;
    choice?: string;
    source: "jev" | "fallback";
    ms: number;
    exchange?: ClassifierExchange;
  };
  error?: string;
  model?: string;
  durationMs?: number;
  systemPrompt?: string;
  userPrompt?: string;
  rawOutput?: string;
  promptChars?: number;
  factsAvailable?: number;
  factsDropped?: number;
  factsClipped?: number;
  factInputChars?: number;
  factInputBudgetChars?: number;
  contextLimited?: boolean;
  finishReason?: string;
  usage?: { promptTokens?: number; completionTokens?: number };
}

/** Trace stored on a synthesize pipeline event (instead of a CuratorTrace). */
export interface SynthTrace {
  kind: "synthesize";
  trigger: "daily" | "manual";
  running?: boolean;
  files: SynthFileResult[];
}

/** Trace stored on a runType="gate" event: one respond/ignore decision + (for
 *  LLM decisions) the full exchange. */
export interface GateTrace {
  kind: "gate";
  respond: boolean;
  confidence: number;
  reason: string;
  decisionSource: string;
  incoming: string;
  channelName?: string;
  channelType?: string;
  senderName?: string;
  systemPrompt?: string;
  userPrompt?: string;
  response?: string;
  thinking?: string;
  model?: string;
  /** Set when the gate FAILED (timeout / HTTP error / bad response) and
   *  fail-opened — the event is recorded with status="error". */
  error?: string;
  /** Every classifier (Jev) call the gate made, in full. */
  classifier?: ClassifierExchange[];
}

export interface PipelineRecordPreview {
  id: string;
  type: string;
  ts: string;
  channelId?: string;
  channelName?: string;
  title?: string;
  textPreview: string;
}

export interface PipelineEventSummary {
  id: string;
  createdAt: string;
  runType: string;
  source: string;
  sourceKind: string | null;
  windowFrom: string;
  windowTo: string;
  status: string;
  recordCount: number;
  existingMemoryCount: number;
  emittedCount: number;
  keptCount: number;
  candidatesCreated: number;
  autoApproved: number;
  durationMs: number;
  error: string | null;
  hasTrace: boolean;
  /** Live approval outcome — candidates currently approved / pending / rejected
   *  for this event. "accepted" (approvedCount) changes as the user reviews. */
  approvedCount?: number;
  pendingCount?: number;
  rejectedCount?: number;
}

export interface PipelineEventDetail extends PipelineEventSummary {
  records: PipelineRecordPreview[] | null;
  trace: CuratorTrace | SynthTrace | GateTrace | null;
}

export interface PipelineEventsPage {
  events: PipelineEventSummary[];
  nextBefore: string | null;
}

export interface PipelineEventFilters {
  limit?: number;
  before?: string;
  runType?: string;
  status?: string;
  sourceKind?: string;
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

export async function listDigitalTwinPipelineEvents(
  userId: string,
  filters: PipelineEventFilters = {},
): Promise<PipelineEventsPage> {
  const params = new URLSearchParams();
  if (filters.limit) params.set("limit", String(filters.limit));
  if (filters.before) params.set("before", filters.before);
  if (filters.runType) params.set("runType", filters.runType);
  if (filters.status) params.set("status", filters.status);
  if (filters.sourceKind) params.set("sourceKind", filters.sourceKind);
  const qs = params.toString();
  const data = await request<{ success: boolean; data: PipelineEventsPage }>(
    `${AUTH_API_URL}/api/v1/digital-twin/pipeline/events${qs ? `?${qs}` : ""}`,
    { headers: { "x-user-id": userId } },
  );
  return data.data;
}

export async function getDigitalTwinPipelineEvent(
  userId: string,
  id: string,
): Promise<PipelineEventDetail> {
  const data = await request<{ success: boolean; data: PipelineEventDetail }>(
    `${AUTH_API_URL}/api/v1/digital-twin/pipeline/events/${encodeURIComponent(id)}`,
    { headers: { "x-user-id": userId } },
  );
  return data.data;
}

/** Re-run one pipeline event's window. 202 — the work continues server-side and
 *  shows up as new events in the feed. Only error/empty runs are retryable. */
export async function retryDigitalTwinPipelineEvent(
  userId: string,
  id: string,
): Promise<{ status: string }> {
  const data = await request<{ success: boolean; data: { status: string } }>(
    `${AUTH_API_URL}/api/v1/digital-twin/pipeline/events/${encodeURIComponent(id)}/retry`,
    { method: "POST", headers: { "x-user-id": userId } },
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

/** Pause the in-flight backfill: cancels the queue jobs but KEEPS progress (the
 *  cursor). The Twin stays enabled. Resume continues from exactly here. */
export async function pauseDigitalTwinBackfill(
  userId: string,
): Promise<{ paused: boolean; pausedSources: number; cancelledJobs: number }> {
  const data = await request<{ success: boolean; data: { paused: boolean; pausedSources: number; cancelledJobs: number } }>(
    `${AUTH_API_URL}/api/v1/digital-twin/backfill/pause`,
    { method: "POST", headers: { "x-user-id": userId, "Content-Type": "application/json" } },
  );
  return data.data;
}

/** Resume a paused (or wedged) backfill: re-enqueues each incomplete source from
 *  its persisted cursor. */
export async function resumeDigitalTwinBackfill(
  userId: string,
): Promise<{ resumed: number; jobIds: string[] }> {
  const data = await request<{ success: boolean; data: { resumed: number; jobIds: string[] } }>(
    `${AUTH_API_URL}/api/v1/digital-twin/backfill/resume`,
    { method: "POST", headers: { "x-user-id": userId, "Content-Type": "application/json" } },
  );
  return data.data;
}

/** Delete the user's stored memories — all, or a created-date range. Runs in
 *  the background (202); poll status.memoryDeleteInProgress for the indicator. */
export async function deleteDigitalTwinMemories(
  userId: string,
  opts: { mode: "all" | "range"; from?: string; to?: string },
): Promise<{ deleting: boolean; mode?: string }> {
  const data = await request<{ success: boolean; data: { deleting: boolean; mode?: string } }>(
    `${AUTH_API_URL}/api/v1/digital-twin/memories/delete`,
    {
      method: "POST",
      headers: { "x-user-id": userId, "Content-Type": "application/json" },
      body: JSON.stringify(opts),
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

/** Memory constellation graph from Hindsight — nodes = memories (id === the
 *  memory id from listDigitalTwinMemories), edges = real semantic/temporal/entity
 *  relationships, plus per-memory extracted entities. */
export interface DigitalTwinGraphNode {
  id: string;
  entities?: string[];
  factType?: string;
}
export interface DigitalTwinGraphEdge {
  source: string;
  target: string;
  /** "semantic" | "temporal" | "entity". */
  linkType: string;
  weight?: number;
}
export interface DigitalTwinGraph {
  nodes: DigitalTwinGraphNode[];
  edges: DigitalTwinGraphEdge[];
}

export async function getDigitalTwinGraph(userId: string): Promise<DigitalTwinGraph> {
  const data = await request<{ success: boolean; data: DigitalTwinGraph }>(
    `${AUTH_API_URL}/api/v1/digital-twin/graph`,
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
    respondPolicy?: "always" | "learned";
  },
): Promise<{ responseSuffix: string; memoryApprovalMode: string; memoryAutoApproveMinScore: number; respondPolicy?: string }> {
  const data = await request<{
    success: boolean;
    data: { responseSuffix: string; memoryApprovalMode: string; memoryAutoApproveMinScore: number; respondPolicy?: string };
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

// ── Memory files (Memory v2 — deterministic, file-based persona) ──────

export interface DigitalTwinMemoryFile {
  id: string;
  name: string;
  content: string;
  loadInPrompt: boolean;
  sortOrder: number;
  updatedBy: string | null;
  updatedAt: string;
}

export async function listDigitalTwinMemoryFiles(
  userId: string,
): Promise<{ files: DigitalTwinMemoryFile[]; maxLoaded: number; maxChars: number }> {
  const data = await request<{
    success: boolean;
    data: { files: DigitalTwinMemoryFile[]; maxLoaded: number; maxChars: number };
  }>(`${AUTH_API_URL}/api/v1/digital-twin/memory-files`, {
    headers: { "x-user-id": userId },
  });
  return data.data;
}

export async function saveDigitalTwinMemoryFile(
  userId: string,
  name: string,
  content: string,
): Promise<{ file: DigitalTwinMemoryFile; truncated: boolean; maxChars: number }> {
  const data = await request<{
    success: boolean;
    data: { file: DigitalTwinMemoryFile; truncated: boolean; maxChars: number };
  }>(`${AUTH_API_URL}/api/v1/digital-twin/memory-files/${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: { "x-user-id": userId, "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  return data.data;
}

export async function setDigitalTwinMemoryFileLoad(
  userId: string,
  name: string,
  load: boolean,
): Promise<{ file: DigitalTwinMemoryFile }> {
  const data = await request<{ success: boolean; data: { file: DigitalTwinMemoryFile } }>(
    `${AUTH_API_URL}/api/v1/digital-twin/memory-files/${encodeURIComponent(name)}/load`,
    {
      method: "POST",
      headers: { "x-user-id": userId, "Content-Type": "application/json" },
      body: JSON.stringify({ load }),
    },
  );
  return data.data;
}

export async function deleteDigitalTwinMemoryFile(
  userId: string,
  name: string,
): Promise<{ deleted: boolean }> {
  const data = await request<{ success: boolean; data: { deleted: boolean } }>(
    `${AUTH_API_URL}/api/v1/digital-twin/memory-files/${encodeURIComponent(name)}`,
    { method: "DELETE", headers: { "x-user-id": userId } },
  );
  return data.data;
}

/** Kick off a background persona rebuild from approved memories (202). */
export async function synthesizeDigitalTwin(userId: string): Promise<{ status: string }> {
  const data = await request<{ success: boolean; data: { status: string } }>(
    `${AUTH_API_URL}/api/v1/digital-twin/synthesize`,
    { method: "POST", headers: { "x-user-id": userId } },
  );
  return data.data;
}

// ── Memory Bank (Hindsight) ───────────────────────────────────────────

const MEMORY_BASE = "/claw/api/v1/memory";

export interface MemoryBankMemory {
  id: string;
  hindsightMemoryId: string;
  category: string | null;
  /** Hindsight storage type. Observations are derived and cannot be curated
   *  directly; delete their supporting world/experience facts instead. */
  factType?: string | null;
  content: string;
  curatorReasoning: string | null;
  curatorConfidence: number | null;
  createdAt: string;
  recallHits7d: number;
  lastRecalledAt: string | null;
  /** Pipeline event that proposed this memory, for the "View reasoning"
   *  deep-link. Null for memories retained before the link existed. */
  pipelineEventId?: string | null;
  /** Raw Hindsight tags (user:… / subsystem:… / scope:… / pipeline:…). Present
   *  on the digital-twin list response; used by the constellation view. */
  tags?: string[];
  /** Canonical entity names for this memory. Entity edges are the majority of
   *  the constellation graph, so these must survive an export/restore round
   *  trip or restored memories render unconnected. */
  entities?: string[];
  /** Source-fact count. `> 1` on an observation means it has version history —
   *  used to show the History affordance without probing the API per memory. */
  proofCount?: number | null;
}

/** One prior version of an observation, newest first. */
export interface MemoryHistoryEntry {
  previousText: string;
  previousTags?: string[];
  previousMentionedAt?: string;
  changedAt: string;
  sourceFacts?: Array<{ id: string; text: string }>;
}

/**
 * Prior versions of one memory. Only derived observations have any; everything
 * else returns []. Fetched on demand — there is no batch endpoint, so this is
 * called when a memory is opened, not for the list.
 */
export async function getDigitalTwinMemoryHistory(
  userId: string,
  hindsightMemoryId: string,
): Promise<MemoryHistoryEntry[]> {
  const res = await fetch(
    `${MEMORY_BASE}/banks/digital-twin/memories/${encodeURIComponent(hindsightMemoryId)}/history` +
      `?userTag=${encodeURIComponent(`user:${userId}`)}`,
    { credentials: "include" },
  );
  if (!res.ok) throw new Error(`Failed to load history: ${res.status}`);
  const body = (await res.json()) as { success: boolean; data: MemoryHistoryEntry[] };
  if (!body.success) throw new Error("Failed to load history");
  return body.data ?? [];
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
    factType?: string | null;
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

/** One memory in an exported archive. Only these three fields are read back on
 *  import — everything else an archive carries is for humans and diffing. */
export interface TwinArchiveRecord {
  content: string;
  subsystem?: string | null;
  /** Original event time, so a restored fact keeps its place in the timeline. */
  timestamp?: string | null;
  category?: string | null;
  factType?: string | null;
  curatorReasoning?: string | null;
  curatorConfidence?: number | null;
  /** Source ids, kept for audit. Hindsight assigns new ids on import. */
  hindsightMemoryId?: string;
  tags?: string[];
  /** Entities to re-attach on import — without them a verbatim restore has no
   *  entity data at all, since it runs no extraction. */
  entities?: string[];
}

export interface TwinMemoryArchive {
  format: "xyne.digital-twin.memories";
  version: 1;
  exportedAt: string;
  /** Whose twin this came from. Advisory — import always re-scopes to the
   *  authenticated caller, so an archive cannot write into another account. */
  userId: string;
  count: number;
  records: TwinArchiveRecord[];
}

/**
 * Records per request. The server paces its own submission to stay inside
 * Hindsight's LLM rate limit, so a request costs roughly (batch / chunk) ×
 * delay — keep this small enough that no single request approaches a proxy
 * timeout. Must not exceed the server's own per-request cap.
 */
const IMPORT_BATCH = 50;

/**
 * Queue a consolidation run for your own memories.
 *
 * Consolidation is what derives observations from raw facts — and what writes
 * their version history. Hindsight schedules it after every retain, but only
 * once the bank has observations enabled, so facts stored before that stay
 * unconsolidated until something asks. This is that ask.
 *
 * Always scoped server-side to the caller: the twin bank is shared, and an
 * unscoped run would consolidate everyone's memories. Returns once the job is
 * QUEUED, not once it has finished; `deduplicated` means an equivalent job was
 * already pending and this one joined it.
 */
export async function triggerDigitalTwinConsolidation(): Promise<{
  operationId: string;
  deduplicated: boolean;
}> {
  const res = await fetch(`${MEMORY_BASE}/banks/digital-twin/consolidate`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const body = (await res.json().catch(() => null)) as
    | { success?: boolean; error?: string; data?: { operationId: string; deduplicated: boolean } }
    | null;
  if (!res.ok || !body?.success || !body.data) {
    throw new Error(body?.error ?? `Failed to start consolidation: ${res.status}`);
  }
  return body.data;
}

/**
 * Restore memories from an exported archive.
 *
 * Sends in sequential batches: the server deliberately throttles submission to
 * Hindsight (whose fact-extraction LLM has a small parallel-request budget),
 * so one giant request would just sit open. Sequential batches also mean a
 * failure part-way through still leaves everything before it imported, and
 * `onProgress` can drive a real progress bar.
 *
 * The server discards any tags in the payload and re-derives scope from the
 * session, so this cannot write into another user's twin. Retain re-runs fact
 * extraction, so `submitted` counts RECORDS SENT, not memories created — one
 * record may become several facts, or merge into an existing one, and they
 * surface asynchronously (typically under a couple of minutes).
 */
export async function importDigitalTwinMemories(
  records: TwinArchiveRecord[],
  /** "verbatim" stores the records as-is (no LLM) — correct for a Xyne archive,
   *  whose records are already-extracted facts. "extract" re-runs fact
   *  extraction, for files whose records are raw prose. */
  mode: "verbatim" | "extract" = "verbatim",
  onProgress?: (sent: number, total: number) => void,
): Promise<{ submitted: number; failed: number; skipped: number }> {
  const totals = { submitted: 0, failed: 0, skipped: 0 };
  for (let i = 0; i < records.length; i += IMPORT_BATCH) {
    const batch = records.slice(i, i + IMPORT_BATCH);
    const res = await fetch(`${MEMORY_BASE}/banks/digital-twin/memories/import`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ records: batch, mode }),
    });
    const body = (await res.json().catch(() => null)) as
      | { success?: boolean; error?: string; data?: { submitted: number; failed: number; skipped: number } }
      | null;
    if (!res.ok || !body?.success || !body.data) {
      // Report what already landed — the caller must not tell the user nothing
      // was imported when earlier batches succeeded.
      const sent = totals.submitted;
      throw new Error(
        `${body?.error ?? `Failed to import memories: ${res.status}`}` +
          (sent > 0 ? ` (${sent} memor${sent === 1 ? "y" : "ies"} imported before this)` : ""),
      );
    }
    totals.submitted += body.data.submitted;
    totals.failed += body.data.failed;
    totals.skipped += body.data.skipped;
    onProgress?.(Math.min(i + batch.length, records.length), records.length);
  }
  return totals;
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
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    throw new ApiError(
      res.status,
      body.error ?? `Failed to delete memory: ${res.status}`,
      body.code,
    );
  }
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

// ── Twin reply activity (admin, cross-user) ──────────────────────────────────
// Backed by GET /control-center/twin-reply-metrics (requireClawAdmin). Rates are
// fractions in [0,1]. Distinct from DigitalTwinMetrics (per-user memory
// candidates). See docs/twin-reply-system.md.

export interface TwinReplyResponseTime {
  medianSec: number | null;
  p90Sec: number | null;
  avgSec: number | null;
  count: number;
}

export interface TwinReplyAgg {
  total: number;
  pending: number;
  accepted: number;
  acceptedEdited: number;
  totalApproved: number;
  declined: number;
  ignored: number;
  approvalRate: number | null;
  editRate: number | null;
  declineRate: number | null;
  byAction: { action: string; count: number }[];
  responseTime: TwinReplyResponseTime;
  previousApprovalRate: number | null;
  previousEditRate: number | null;
  /** Per-week approval trend, oldest first (absent on older backends). */
  weekly?: TwinWeeklyReplyPoint[];
}

export interface TwinWeeklyReplyPoint {
  weekStart: string;
  proposed: number;
  accepted: number;
  acceptedEdited: number;
  declined: number;
  ignored: number;
  approvalRate: number | null;
  cleanApprovalRate: number | null;
}

export interface TwinGateAgg {
  total: number;
  respond: number;
  ignore: number;
  error: number;
  respondRate: number | null;
  errorRate: number | null;
  avgConfidence: number | null;
  avgDurationMs: number | null;
  medianDurationMs: number | null;
  byDecisionSource: { source: string; respond: number; ignore: number }[];
  previousRespondRate: number | null;
}

export interface TwinBehaviorAgg {
  total: number;
  responded: number;
  ignored: number;
  shouldHaveResponded: number;
}

export interface TwinReplyPerUserRow {
  userId: string;
  name: string;
  email: string;
  replies: {
    accepted: number;
    acceptedEdited: number;
    declined: number;
    ignored: number;
    pending: number;
    totalApproved: number;
    approvalRate: number | null;
    medianResponseSec: number | null;
  };
  gate: { respond: number; ignore: number; error: number };
  behavior: { responded: number; ignored: number; shouldHaveResponded: number };
  activity: number;
}

export interface TwinReplyMetrics {
  scope: { orgScope: "org" | "all"; userCount: number };
  window: { since: string | null; until: string | null; days: number | null };
  replies: TwinReplyAgg;
  gate: TwinGateAgg;
  behavior: TwinBehaviorAgg;
  byUser: TwinReplyPerUserRow[];
}

export interface TwinReplyMetricsParams {
  days?: number | null;
  from?: string | null;
  to?: string | null;
  orgScope?: AdminOrgScope;
}

export async function getTwinReplyMetrics(
  userId: string,
  params: TwinReplyMetricsParams = {},
): Promise<TwinReplyMetrics> {
  const qs = new URLSearchParams();
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  if (!params.from && !params.to && params.days) qs.set("days", String(params.days));
  applyAdminOrgScope(qs, params.orgScope);
  const q = qs.toString();
  const data = await request<{ success: boolean; data: TwinReplyMetrics }>(
    `${AUTH_API_URL}/api/v1/control-center/twin-reply-metrics${q ? `?${q}` : ""}`,
    { headers: { "x-user-id": userId } },
  );
  return data.data;
}

// ── Metrics page: awakening, sentiment, improvements ─────────────────────

/**
 * Activity for agents that wake on their own. Kept out of the main metrics
 * payload because awakened runs have no `userId` — the user-scoped filters the
 * other endpoints apply would drop them entirely.
 */
export interface AwakeningActivity {
  days: number;
  totals: {
    runs: number; ran: number; skipped: number; failed: number;
    shadow: number; injections: number; events: number;
  };
  perDay: Array<{ day: string; ran: number; skipped: number; failed: number }>;
  byAgent: Array<{
    agentId: string; agentSlug: string; kind: string; runs: number; ran: number;
    skipped: number; failed: number; events: number; lastRunAt: string | null;
  }>;
  skipReasons: Array<{ reason: string; count: number }>;
  agents: Array<{
    agentSlug: string; enabled: boolean; lastError: string | null;
    nextDueAt: string | null; reflexNextCheckAt: string | null;
    consecutiveFailures: number;
  }>;
}

export async function fetchAwakeningActivity(
  userId: string,
  days: 1 | 7 | 30 = 7,
  orgScope?: AdminOrgScope,
): Promise<AwakeningActivity> {
  const qs = new URLSearchParams();
  qs.set("days", String(days));
  applyAdminOrgScope(qs, orgScope);
  return request<AwakeningActivity>(
    `${AUTH_API_URL}/api/v1/metrics/awakening?${qs.toString()}`,
    { headers: { "x-user-id": userId } },
  );
}

/** One wake ATTEMPT — skipped wakes are rows too, and carry the gate rule. */
export interface AwakeningRun {
  id: string;
  kind: string;
  outcome: string;
  skipReason: string | null;
  eventCount: number;
  injectionsUsed: number;
  sessionId: string | null;
  /** Present only when the wake actually dispatched — links to the transcript. */
  conversationId: string | null;
  runStatus: string | null;
  windowStartMs: number;
  windowEndMs: number;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
}

export interface AwakeningRunsPage {
  total: number;
  limit: number;
  offset: number;
  runs: AwakeningRun[];
}

export async function fetchAwakeningRuns(
  userId: string,
  agentId: string,
  days: 1 | 7 | 30 = 7,
  limit = 20,
  offset = 0,
  orgScope?: AdminOrgScope,
  /** "heartbeat" | "reflex" — the rollup lists one row per kind, so a
   *  drill-down must stay scoped to the row that was clicked. */
  kind?: string,
): Promise<AwakeningRunsPage> {
  const qs = new URLSearchParams();
  qs.set("days", String(days));
  qs.set("limit", String(limit));
  qs.set("offset", String(offset));
  if (kind) qs.set("kind", kind);
  applyAdminOrgScope(qs, orgScope);
  return request<AwakeningRunsPage>(
    `${AUTH_API_URL}/api/v1/metrics/awakening/${encodeURIComponent(agentId)}/runs?${qs.toString()}`,
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

/**
 * Admin-only. Summarises historical runs so the tool panels stop under-reporting.
 * `force` re-summarises rows written by an older summariser version.
 */
export async function backfillToolStats(
  userId: string,
  body?: { batchSize?: number; maxRows?: number; sinceDays?: number; force?: boolean },
): Promise<ToolStatsBackfillReport> {
  return request<ToolStatsBackfillReport>(
    `${AUTH_API_URL}/api/v1/metrics/tools/backfill`,
    {
      method: "POST",
      headers: { "x-user-id": userId },
      body: JSON.stringify(body ?? {}),
    },
  );
}

// ── Metrics v2 (one endpoint per card) ────────────────────────────────────
// Every GET answers `{ window, ...body }` with `n` beside each average, percentile and rate.
// Fetchers take an optional AbortSignal so the page cache can cancel unused requests.

export type MetricsDays = 1 | 7 | 30;

/** The filter context every metrics endpoint shares (a subset of the page's MetricsScopeParams). */
export interface MetricsQueryScope {
  userId: string;
  days: MetricsDays;
  orgScope: AdminOrgScope;
  agentSlugs: readonly string[];
}

export type MetricsWindowColumn = "completedAt" | "startedAt";

/** Echo of the window a response was computed over. Every v2 response starts with it. */
export interface WindowInfo {
  days: MetricsDays;
  start: string;
  end: string;
  column: MetricsWindowColumn;
  scope: { level: "org" | "own" | "all-orgs"; agentSlugs: string[] };
  computedAt: string;
  cached: boolean;
}

export type TriggerGroup = "user" | "automation" | "scheduled" | "api" | "awakened" | "delegation" | "messaging" | "other";

export interface PctBlock {
  n: number;
  p50Ms: number | null;
  p95Ms: number | null;
}

export interface SummaryFigures {
  runs: number;
  /** A2A callee rows inside `runs` — context, not a separate population. */
  delegatedRuns: number;
  completed: number;
  failed: number;
  cancelled: number;
  /** completed / runs. */
  successRate: number | null;
  users: number;
  /** End-to-end wall clock (completedAt − startedAt) over completed runs. */
  wall: PctBlock;
  /** Agent-reported totalMs; its own n, never coalesced with `wall`. */
  agent: PctBlock & { avgLlmMs: number | null; avgToolMs: number | null; avgOtherMs: number | null };
  /** Run-level ttftMs — "Reply starts after". */
  replyStart: PctBlock;
  tokens: {
    n: number;
    promptPerRun: number | null;
    outputPerRun: number | null;
    freshPerRun: number | null;
    cachedPerRun: number | null;
    cacheHitRate: number | null;
    promptTotal: number;
    outputTotal: number;
  };
  /** Σout ÷ Σ decode seconds over rows with both > 0. */
  throughput: { n: number; tokensPerSec: number | null };
  /** From agent_run_stats; compare runsSummarised with `runs` for capture coverage. */
  tools: {
    runsWithTools: number;
    runsSummarised: number;
    calls: number;
    errors: number;
    errorRate: number | null;
  };
  llm: { runsWithSeries: number };
}

export interface SummaryResponse {
  window: WindowInfo;
  current: SummaryFigures;
  previous: SummaryFigures | null;
}

export interface DailyPoint {
  /** YYYY-MM-DD in the requested tz. */
  day: string;
  runs: number;
  completed: number;
  failed: number;
  cancelled: number;
  byTrigger: Partial<Record<TriggerGroup, number>>;
  wall: PctBlock;
  agent: { n: number; avgLlmMs: number | null; avgToolMs: number | null; totalLlmMs: number; totalToolMs: number };
  tokens: { n: number; prompt: number; output: number };
}

export interface TriggerRow {
  group: TriggerGroup;
  runs: number;
  completed: number;
  failed: number;
  cancelled: number;
  successRate: number | null;
  wall: PctBlock;
}

export interface RunDailyResponse {
  window: WindowInfo;
  tz: string;
  /** Zero-filled, oldest first. */
  days: DailyPoint[];
  /** Groups with runs > 0 only. */
  triggers: TriggerRow[];
}

export interface AgentLeaderRow {
  agentSlug: string;
  orgId: string;
  orgName?: string | null;
  runs: number;
  failed: number;
  successRate: number | null;
  wall: PctBlock;
  agent: { n: number; avgLlmMs: number | null; avgToolMs: number | null };
  tokens: { n: number; promptPerRun: number | null; outputPerRun: number | null };
  toolCalls: number;
  toolErrorRate: number | null;
}

export interface AgentsTopResponse {
  window: WindowInfo;
  rows: AgentLeaderRow[];
}

export interface ActiveAgentRow {
  agentSlug: string;
  orgId: string;
  runs: number;
}

/** Always a 30-day window, whatever `days` the page is on — it feeds the agent picker. */
export interface ActiveAgentsResponse {
  window: WindowInfo;
  agents: ActiveAgentRow[];
}

/** One run-level route (agent_runs.provider) + model. "Route", not "Provider": see spec decisions. */
export interface RouteRow {
  route: string;
  model: string | null;
  runs: number;
  /** Runs carrying LLM timing — the n behind `llm`. */
  timed: number;
  llm: PctBlock;
  replyStart: PctBlock;
  tokensPerSec: number | null;
  failed: number;
  errorRate: number | null;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface RoutesResponse {
  window: WindowInfo;
  rows: RouteRow[];
}

export interface JudgeSummaryRow {
  backend: string;
  runs: number;
  calls: number;
  failed: number;
  compactions: number;
}

export interface JudgeResponse {
  window: WindowInfo;
  rows: JudgeSummaryRow[];
}

export interface MetricsSentiment extends AgentSentiment {
  /** Runs with a non-null llmRetries — the denominator of retriedRate. */
  retriesKnown: number;
}

export interface MemoryRecallFigures {
  recalled: number;
  runs: number;
  rate: number | null;
  /** False when recall is not instrumented for this scope — render "not captured", not 0%. */
  captured: boolean;
}

export interface SentimentResponse {
  window: WindowInfo;
  sentiment: MetricsSentiment;
  memoryRecall: MemoryRecallFigures;
}

/* Tools */

/** Sortable columns of GET /metrics/tools. An unknown key makes the server sort by `errors` and echo that in `page.sort`. */
export type ToolSortKey =
  | "tool" | "calls" | "errors" | "errorRate" | "recoveryRate" | "dropped" | "duplicateRate" | "duplicates"
  | "emptyRate" | "citeRate" | "uncited" | "avgMs" | "p95Ms" | "maxMs" | "totalMs" | "bytes" | "avgBytes";

export const TOOL_SORT_KEYS: readonly ToolSortKey[] = [
  "tool", "calls", "errors", "errorRate", "recoveryRate", "dropped", "duplicateRate", "duplicates",
  "emptyRate", "citeRate", "uncited", "avgMs", "p95Ms", "maxMs", "totalMs", "bytes", "avgBytes",
];

/** One tool, window-wide. Every rate is null (not 0) when its denominator is 0. */
export interface ToolRow {
  tool: string;
  calls: number;
  runs: number;
  topLevelCalls: number;
  childCalls: number;
  errors: number;
  errorRate: number | null;
  /** Errors of the form "tool X not found" — a palette problem, not a tool problem. */
  notFound: number;
  dropped: number;
  droppedRate: number | null;
  empty: number;
  emptyRate: number | null;
  duplicates: number;
  duplicateRate: number | null;
  recovered: number;
  /** recovered / errors. */
  recoveryRate: number | null;
  unrecovered: number;
  citeable: number;
  cited: number;
  citeRate: number | null;
  timedCalls: number;
  avgMs: number | null;
  /** Estimated from the duration buckets (linear within the bucket the percentile falls in). */
  p50Ms: number | null;
  p95Ms: number | null;
  /** True when p95 fell in the overflow bucket: render "> 5m", not a number. */
  p95Overflow: boolean;
  maxMs: number;
  totalMs: number;
  bytes: number;
  avgBytes: number | null;
  contextShare: number | null;
  /** RUN counts per signal — the drill-down total, which can be smaller than the call counts. */
  sessions: { errored: number; recovered: number; unrecovered: number; dropped: number; duplicated: number; empty: number; cited: number };
}

/** Window-wide sums, independent of the table page and the search box. */
export interface ToolTotals {
  distinctTools: number;
  calls: number;
  errors: number;
  notFound: number;
  dropped: number;
  duplicates: number;
  empty: number;
  recovered: number;
  citeable: number;
  cited: number;
  bytes: number;
  totalMs: number;
  timedCalls: number;
  avgMsPerCall: number | null;
  runsWithTools: number;
}

export interface RankPoint {
  tool: string;
  calls: number;
  value: number;
  share: number | null;
  avg: number | null;
  errorRate: number | null;
  p95Ms: number | null;
}

export interface RankRemainder {
  tools: number;
  value: number;
  share: number | null;
}

export interface RankSet {
  byTotal: RankPoint[];
  /** Tools with >= 5 calls. */
  byAvg: RankPoint[];
  other: RankRemainder;
}

export interface ToolRollup {
  totals: ToolTotals;
  rows: ToolRow[];
  ranking: {
    time: RankSet;
    bytes: RankSet;
    /** byRate: tools with >= 10 calls. */
    errors: { byCount: RankPoint[]; byRate: RankPoint[]; other: RankRemainder };
  };
}

/** Share of the window's runs with tool stats. `coverage` null when the window has no runs. */
export interface ToolSummaryCoverage {
  runsInWindow: number;
  runsSummarised: number;
  coverage: number | null;
}

export interface ToolsPageInfo {
  limit: number;
  offset: number;
  /** Tools matching the search across the whole window. */
  total: number;
  sort: ToolSortKey;
  dir: "asc" | "desc";
}

/** GET /metrics/tools: the cached rollup, with `rows` sliced to the requested page. */
export interface ToolsResponse extends ToolRollup {
  window: WindowInfo;
  coverage: ToolSummaryCoverage;
  page: ToolsPageInfo;
}

export interface ToolsRequest {
  sort?: ToolSortKey;
  dir?: "asc" | "desc";
  limit?: number;
  offset?: number;
  search?: string;
}

export interface ErrorClassRow {
  tool: string;
  /** Normalised one-liner (ids, numbers, literals replaced). */
  errorClass: string;
  occurrences: number;
  runs: number;
  /** One raw example, <= 400 chars. */
  sample: string;
  lastSeen: string | null;
  notFound: boolean;
}

export interface ErrorClassesResponse {
  window: WindowInfo;
  rows: ErrorClassRow[];
  total: number;
  occurrences: number;
}

export interface ErrorClassesRequest {
  tool?: string;
  limit?: number;
  offset?: number;
  /** Top N classes per tool when `tool` is absent. */
  perTool?: number;
}

export interface CitationReflectionOutcome {
  outcome: string;
  runs: number;
  share: number;
}

export interface CitationFlagRow {
  orgId: string;
  agentSlug: string;
  autoToolCitations: boolean;
  citationReflection: boolean;
}

export interface ExactCitationRow {
  tool: string;
  calls: number;
  citeableCalls: number;
  citedCalls: number;
  citeRate: number | null;
}

export interface CitationsResponse {
  window: WindowInfo;
  scope: "same-turn" | "conversation";
  funnel: { citeable: number; cited: number };
  reflection: CitationReflectionOutcome[];
  flags: CitationFlagRow[];
  /** Only with `exact=1`; the server answers 400 unless one agent is selected or days <= 7. */
  exact: ExactCitationRow[] | null;
}

/** open-palette = tools.openPalette read|all: every tool is allowed, so "granted nothing" is wrong. */
export type PaletteState = "scoped" | "open-palette" | "unscoped";

export interface AgentPaletteRow {
  orgId: string;
  agentSlug: string;
  state: PaletteState;
  openPalette?: "read" | "all";
  /** toolsUsed ∪ toolStats[].t in the window. */
  observedTools: number;
  /** Null unless state = scoped. */
  granted: number | null;
  used: number | null;
  unused: number | null;
  usedShare: number | null;
}

export interface UnusedGrant {
  orgId: string;
  agentSlug: string;
  kind: string;
  grant: string;
  server?: string | null;
}

export interface UnusedGrantsResponse {
  window: WindowInfo;
  agents: AgentPaletteRow[];
  unusedGrants: UnusedGrant[];
}

/* LLM calls */

export interface LlmSummary {
  calls: number;
  runs: number;
  nTtft: number;
  p50TtftMs: number | null;
  p95TtftMs: number | null;
  nDecode: number;
  p50DecodeMs: number | null;
  /** Weighted: Σout ÷ Σ decode seconds. */
  tokensPerSec: number | null;
  avgContextTokens: number | null;
  avgOutputTokens: number | null;
  cacheHitRate: number | null;
  compactions: number;
  retries: number;
  subagentCalls: number;
  errorStops: number;
}

export interface LlmBucketRow {
  /** Lower edge of the context-size bucket, in tokens. */
  contextBucket: number;
  calls: number;
  nTtft: number;
  p50TtftMs: number | null;
  p95TtftMs: number | null;
  tokensPerSec: number | null;
  avgOutputTokens: number | null;
}

export interface LlmIndexRow {
  callIndex: number;
  calls: number;
  nTtft: number;
  p50TtftMs: number | null;
  p95TtftMs: number | null;
  avgContextTokens: number | null;
  tokensPerSec: number | null;
  compactionShare: number | null;
  retriedShare: number | null;
}

export interface LlmModelRow {
  model: string | null;
  provider: string | null;
  calls: number;
  runs: number;
  nTtft: number;
  p50TtftMs: number | null;
  p95TtftMs: number | null;
  tokensPerSec: number | null;
  avgContextTokens: number | null;
  avgOutputTokens: number | null;
  errorStops: number;
  retries: number;
}

export interface LlmCallsResponse {
  window: WindowInfo;
  coverage: {
    runsInWindow: number;
    runsWithSeries: number;
    coverage: number | null;
    /** ISO completedAt of the earliest in-window run carrying a per-call series. */
    seriesSince?: string | null;
  };
  summary: LlmSummary;
  byContext: LlmBucketRow[];
  /** At most 40 positions. */
  byCallIndex: LlmIndexRow[];
  byModel: LlmModelRow[];
}

/* Sessions drill-down */

export type SessionKind = "tool" | "failed" | "slow" | "model";
export type ToolSignal = "calls" | "errors" | "recovered" | "unrecovered" | "dropped" | "duplicates" | "empty" | "cited" | "notFound";

export interface MetricSessionToolFigures {
  c: number;
  e: number;
  rec: number;
  unrec: number;
  d: number;
  dup: number;
  z: number;
  ci: number;
  nf: number;
  ms: number;
}

export interface MetricSessionRow {
  id: string;
  sessionId: string;
  conversationId: string | null;
  channelId: string | null;
  agentSlug: string;
  userId: string;
  userName: string | null;
  userEmail: string | null;
  triggerSource: string;
  status: string;
  task: string | null;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  totalMs: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  rating: string | null;
  /** Ran on the owner's personal credentials: task/error/sample/links are withheld. */
  restricted: boolean;
  /** kind=tool: this tool's figures in this run. */
  tool?: MetricSessionToolFigures;
  /** First error sample of that tool, for error-shaped signals. */
  sample?: string | null;
  /** kind=failed, <= 300 chars. */
  error?: string | null;
  /** kind=slow. */
  split?: {
    llmMs: number | null;
    toolMs: number | null;
    totalMs: number | null;
    topTools: Array<{ tool: string; ms: number; calls: number; errored: boolean }>;
  };
  /** kind=model. calls = 0 means no per-call series was recorded for the run. */
  model?: { calls: number; ttftMaxMs: number | null; ctxMax: number | null; retries: number; errorStops: number };
}

export interface MetricSessionsRequest {
  kind: SessionKind;
  tool?: string;
  signal?: ToolSignal;
  errorClass?: string;
  status?: Array<"failed" | "cancelled">;
  minMs?: number;
  model?: string;
  provider?: string;
  limit: number;
  cursor?: string;
  /** Page 1 only: ask for the capped session total. */
  count?: boolean;
}

export interface MetricSessionsResponse {
  window: WindowInfo;
  rows: MetricSessionRow[];
  page: { limit: number; nextCursor: string | null; hasMore: boolean };
  /** Distinct sessions, capped at 1000 (capped = true → "1,000+"). Null unless count was asked for. */
  total: { value: number; capped: boolean } | null;
  coverage: { runsInWindow: number; runsSummarised: number };
}

/* Backfill */

export interface ToolStatsBackfillReport {
  scanned: number;
  summarised: number;
  /** Runs scanned that had no tool calls to summarise. */
  emptied: number;
  /** agent_run_tool_stats rows written (one per tool per run). */
  toolRows?: number;
  /** Errored tool calls recorded in those rows. */
  errorRows?: number;
  /** Runs left without a row for the next call to retry: their write failed for a reason a retry can fix. */
  failed?: number;
  batches: number;
  durationMs: number;
  /** Finished runs still without tool stats after this call. */
  remaining?: number;
}

/* Fetchers */

const METRICS_BASE = `${AUTH_API_URL}/api/v1/metrics`;

type QueryValue = string | number | boolean | readonly string[] | null | undefined;

/** Builds `/metrics<path>?…`; the page cache keys on this URL. `agentSlug` repeats (slugs may contain commas); empty values are dropped. */
export function metricsUrl(
  path: string,
  scope: Pick<MetricsQueryScope, "days" | "orgScope" | "agentSlugs">,
  extra?: Record<string, QueryValue>,
): string {
  const qs = new URLSearchParams();
  qs.set("days", String(scope.days));
  applyAdminOrgScope(qs, scope.orgScope);
  for (const slug of scope.agentSlugs) if (slug) qs.append("agentSlug", slug);
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (value == null || value === false || value === "") continue;
    if (Array.isArray(value)) {
      if (value.length > 0) qs.set(key, value.join(","));
    } else {
      qs.set(key, value === true ? "1" : String(value));
    }
  }
  return `${METRICS_BASE}${path}?${qs.toString()}`;
}

function metricsGet<T>(userId: string, url: string, signal?: AbortSignal): Promise<T> {
  return request<T>(url, { headers: { "x-user-id": userId }, signal });
}

export function fetchMetricsSummary(scope: MetricsQueryScope, signal?: AbortSignal): Promise<SummaryResponse> {
  return metricsGet(scope.userId, metricsUrl("/summary", scope), signal);
}

export function fetchMetricsRunDaily(scope: MetricsQueryScope, tz: string, signal?: AbortSignal): Promise<RunDailyResponse> {
  return metricsGet(scope.userId, metricsUrl("/runs/daily", scope, { tz }), signal);
}

export function fetchMetricsAgentsTop(scope: MetricsQueryScope, limit = 20, signal?: AbortSignal): Promise<AgentsTopResponse> {
  return metricsGet(scope.userId, metricsUrl("/agents/top", scope, { limit }), signal);
}

/** The server always answers for 30 days; `days` is pinned so every range shares one cache entry. */
export function fetchMetricsActiveAgents(scope: MetricsQueryScope, signal?: AbortSignal): Promise<ActiveAgentsResponse> {
  return metricsGet(scope.userId, metricsUrl("/agents/active", { ...scope, days: 30, agentSlugs: [] }), signal);
}

export function fetchMetricsRoutes(scope: MetricsQueryScope, signal?: AbortSignal): Promise<RoutesResponse> {
  return metricsGet(scope.userId, metricsUrl("/routes", scope), signal);
}

export function fetchMetricsJudge(scope: MetricsQueryScope, signal?: AbortSignal): Promise<JudgeResponse> {
  return metricsGet(scope.userId, metricsUrl("/judge", scope), signal);
}

/** Exactly one agent must be selected — the server answers 400 otherwise. */
export function fetchMetricsSentiment(scope: MetricsQueryScope, signal?: AbortSignal): Promise<SentimentResponse> {
  return metricsGet(scope.userId, metricsUrl("/sentiment", scope), signal);
}

/** `status` goes out comma-joined (`status=failed,cancelled`). */
export function metricSessionsParams(req: MetricSessionsRequest): Record<string, QueryValue> {
  return {
    kind: req.kind,
    tool: req.tool,
    signal: req.signal,
    errorClass: req.errorClass,
    status: req.status,
    minMs: req.minMs,
    model: req.model,
    provider: req.provider,
    limit: req.limit,
    cursor: req.cursor,
    count: req.count,
  };
}

export function fetchMetricSessions(
  scope: MetricsQueryScope,
  req: MetricSessionsRequest,
  signal?: AbortSignal,
): Promise<MetricSessionsResponse> {
  return metricsGet(scope.userId, metricsUrl("/sessions", scope, metricSessionsParams(req)), signal);
}

export function fetchMetricsTools(scope: MetricsQueryScope, req: ToolsRequest = {}, signal?: AbortSignal): Promise<ToolsResponse> {
  return metricsGet(
    scope.userId,
    metricsUrl("/tools", scope, { sort: req.sort, dir: req.dir, limit: req.limit, offset: req.offset, search: req.search }),
    signal,
  );
}

export function fetchMetricsErrorClasses(
  scope: MetricsQueryScope,
  req: ErrorClassesRequest = {},
  signal?: AbortSignal,
): Promise<ErrorClassesResponse> {
  return metricsGet(
    scope.userId,
    metricsUrl("/tools/error-classes", scope, { tool: req.tool, limit: req.limit, offset: req.offset, perTool: req.perTool }),
    signal,
  );
}

/** `exact` is the conversation-scoped join: allowed only with an agent filter or days <= 7. */
export function fetchMetricsCitations(
  scope: MetricsQueryScope,
  req: { exact?: boolean } = {},
  signal?: AbortSignal,
): Promise<CitationsResponse> {
  return metricsGet(scope.userId, metricsUrl("/tools/citations", scope, { exact: req.exact }), signal);
}

export function fetchMetricsUnusedGrants(scope: MetricsQueryScope, signal?: AbortSignal): Promise<UnusedGrantsResponse> {
  return metricsGet(scope.userId, metricsUrl("/tools/unused-grants", scope), signal);
}

export function fetchMetricsLlmCalls(
  scope: MetricsQueryScope,
  req: { includeSubagents?: boolean } = {},
  signal?: AbortSignal,
): Promise<LlmCallsResponse> {
  return metricsGet(scope.userId, metricsUrl("/llm-calls", scope, { includeSubagents: req.includeSubagents }), signal);
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
  /** Groups the sibling runs (one per agent, up to 3) of a multi-agent
   *  comparison; null for a plain single-agent run. */
  comparisonId?: string | null;
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

/** One agent to run, with its own optional generation-model pin. */
export interface StartGenerationAgent {
  agentSlug: string;
  genProvider?: string;
  genModel?: string;
  optimizations?: string;
}

/** Start a comparison of 1-3 agents over the same conversations. Each agent gets
 *  its own runId (+ jobId to poll); they share a comparisonId so results align. */
export async function startBackgroundGeneration(
  payload: { agents: StartGenerationAgent[]; conversationIds?: string[]; folderId?: string },
  userId: string,
): Promise<{ comparisonId: string | null; runs: Array<{ agentSlug: string; runId: string; jobId: string }> }> {
  const d = await request<{
    success: boolean;
    comparisonId?: string;
    runs?: Array<{ agentSlug: string; runId: string; jobId: string }>;
    runId?: string;
    jobId?: string;
  }>(`${AUTH_API_URL}/api/v1/evals/generations/background`, {
    method: "POST",
    headers: { "x-user-id": userId },
    body: JSON.stringify(payload),
  });
  if (Array.isArray(d.runs)) return { comparisonId: d.comparisonId ?? null, runs: d.runs };
  // Defensive: a legacy single-agent {runId,jobId} response.
  return {
    comparisonId: null,
    runs: d.runId && d.jobId ? [{ agentSlug: payload.agents[0]?.agentSlug ?? "", runId: d.runId, jobId: d.jobId }] : [],
  };
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
  comparisonId?: string | null;
}

/** Per-run score rollup returned by the comparison endpoint (mirrors the
 *  backend summarizeRun). */
export interface GenerationSummary {
  judgedCount: number;
  totalTurns: number;
  avgScore: number | null;
  distribution: { good: number; weak: number; fail: number };
  perConversation: Array<{ conversationId: string; avgScore: number; count: number }>;
}

export interface EvalComparisonAgent {
  run: EvalGeneration;
  summary: GenerationSummary;
}

/** All sibling agent runs of a comparison, each with turns + a score summary. */
export async function getComparison(
  comparisonId: string,
): Promise<{ comparisonId: string; agents: EvalComparisonAgent[] }> {
  const d = await request<{ success: boolean; comparisonId: string; agents: EvalComparisonAgent[] }>(
    `${AUTH_API_URL}/api/v1/evals/comparisons/${comparisonId}`,
  );
  return { comparisonId: d.comparisonId, agents: d.agents ?? [] };
}

/** Score every agent's run in a comparison in one call (same judges across all
 *  agents). Returns one background judge job per sibling run. */
export async function judgeComparison(
  comparisonId: string,
  payload: { judges?: Array<{ judgeId: string; model?: string }>; conversationIds?: string[]; onlyUnscored?: boolean },
  userId: string,
): Promise<{ jobs: Array<{ runId: string; agentSlug: string; jobId: string }> }> {
  const d = await request<{ success: boolean; jobs: Array<{ runId: string; agentSlug: string; jobId: string }> }>(
    `${AUTH_API_URL}/api/v1/evals/comparisons/${comparisonId}/judge`,
    { method: "POST", headers: { "x-user-id": userId }, body: JSON.stringify(payload) },
  );
  return { jobs: d.jobs ?? [] };
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
export async function listEvalModels(): Promise<{
  models: string[];
  defaultModel: string;
  judgeBackends: Array<{ id: string; label: string }>;
  optimizations: Array<{ key: string; summary: string; defaultOn: boolean }>;
}> {
  const data = await request<{
    success: boolean;
    models: string[];
    defaultModel?: string;
    judgeBackends?: string[];
    judgeBackendLabels?: Record<string, string>;
    optimizations?: Array<{ key: string; summary: string; defaultOn: boolean }>;
  }>(`${AUTH_API_URL}/api/v1/evals/models`);
  return {
    models: data.models ?? [],
    defaultModel: data.defaultModel ?? "",
    judgeBackends: (data.judgeBackends ?? []).map((id) => ({ id, label: data.judgeBackendLabels?.[id] ?? id })),
    optimizations: data.optimizations ?? [],
  };
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

// ── Search Evals (Vespa search retrieval-relevance testing) ────────────────

export interface SearchEvalSheetSummary {
  id: string;
  name: string;
  description: string | null;
  permissionMode: SearchEvalPermissionMode;
  asOfTimestamp: string | null;
  createdAt: string;
  _count: { queries: number };
  runs: Array<{ id: string; status: string; startedAt: string; permissionMode: string }>;
}

export interface SearchEvalQueryRow {
  id: string;
  query: string;
  goldAnswer: string | null;
  goldId: string;
}

export interface SearchEvalSheetDetail extends SearchEvalSheetSummary {
  queries: SearchEvalQueryRow[];
}

export async function listSearchEvalSheets(userId: string): Promise<SearchEvalSheetSummary[]> {
  const data = await request<{ success: boolean; sheets: SearchEvalSheetSummary[] }>(
    `${AUTH_API_URL}/api/v1/search-evals/sheets`,
    { headers: { "x-user-id": userId } },
  );
  return data.sheets ?? [];
}

export async function uploadSearchEvalSheet(
  payload: {
    name: string;
    description?: string;
    permissionMode: SearchEvalPermissionMode;
    asOfTimestamp?: string;
    queries: Array<{ query: string; goldAnswer?: string; goldId: string }>;
  },
  userId: string,
): Promise<SearchEvalSheetDetail> {
  const data = await request<{ success: boolean; sheet: SearchEvalSheetDetail }>(
    `${AUTH_API_URL}/api/v1/search-evals/sheets`,
    { method: "POST", headers: { "x-user-id": userId }, body: JSON.stringify(payload) },
  );
  return data.sheet;
}

export async function getSearchEvalSheet(id: string, userId: string): Promise<SearchEvalSheetDetail> {
  const data = await request<{ success: boolean; sheet: SearchEvalSheetDetail }>(
    `${AUTH_API_URL}/api/v1/search-evals/sheets/${id}`,
    { headers: { "x-user-id": userId } },
  );
  return data.sheet;
}

export type SearchEvalPermissionMode = "with" | "without";

export async function startSearchEvalRun(
  sheetId: string,
  payload: { queryType: string[]; rankProfile?: string; rankProfileInputs?: Record<string, number> },
  userId: string,
): Promise<{ runId: string; jobId: string }> {
  return request<{ success: boolean; runId: string; jobId: string }>(
    `${AUTH_API_URL}/api/v1/search-evals/sheets/${sheetId}/runs`,
    { method: "POST", headers: { "x-user-id": userId }, body: JSON.stringify(payload) },
  );
}

/** Live rank-profile names for a UI entity type ("messages"/"tickets"/
 *  "files"/"emails"/"channels"), or the common-to-every-schema set when
 *  `queryType` is "" ("All types") — read straight off Vespa's deployed .sd
 *  schema (see rank-profiles.ts), not a hardcoded list. */
export async function getSearchEvalRankProfiles(queryType: string, userId: string): Promise<string[]> {
  const data = await request<{ success: boolean; profiles: string[] }>(
    `${AUTH_API_URL}/api/v1/search-evals/rank-profiles?type=${encodeURIComponent(queryType)}`,
    { headers: { "x-user-id": userId } },
  );
  return data.profiles ?? [];
}

interface SearchEvalTopKStat {
  count: number;
  pct: number | null;
}

/** Top1/Top3/Top10 count+% and Mean Reciprocal Rank — persisted on the run
 *  (stamped alongside completedAt) so past runs are comparable over time. */
export interface SearchEvalMetricsSummary {
  queriesTotal: number;
  queriesScored: number;
  top1: SearchEvalTopKStat;
  top3: SearchEvalTopKStat;
  top10: SearchEvalTopKStat;
  mrr: number | null;
}

export interface SearchEvalRunSummary {
  id: string;
  status: string;
  permissionMode: SearchEvalPermissionMode;
  queryType: string[];
  rankProfile: string | null;
  rankProfileInputs: Record<string, number> | null;
  asOfTimestamp: string | null;
  startedAt: string;
  completedAt: string | null;
  summary: SearchEvalMetricsSummary | null;
  _count: { results: number };
}

/** Run history for a sheet, newest first — powers the run "chat list". */
export async function listSearchEvalRuns(sheetId: string, userId: string): Promise<SearchEvalRunSummary[]> {
  const data = await request<{ success: boolean; runs: SearchEvalRunSummary[] }>(
    `${AUTH_API_URL}/api/v1/search-evals/sheets/${sheetId}/runs`,
    { headers: { "x-user-id": userId } },
  );
  return data.runs ?? [];
}

export interface SearchEvalTopResult {
  id: string | null;
  xyneId: string | null;
  messageId: string | null;
  conversationId: string | null;
  relevanceScore: number | null;
  snippet: string | null;
  /** Full untouched result object (title, type, subtitle, metadata, the
   *  complete searchContext) for full inspection of any of the top-20. */
  raw: Record<string, unknown> | null;
}

export interface SearchEvalDebugPayload {
  stage: string;
  yql: string;
  vespaParams: Record<string, unknown>;
}

export interface SearchEvalResultRow {
  queryId: string;
  query: string;
  goldAnswer: string | null;
  goldId: string;
  hit: boolean | null;
  rank: number | null;
  topResults: SearchEvalTopResult[] | null;
  debug: SearchEvalDebugPayload[] | null;
}

export interface SearchEvalRunDetail {
  run: {
    id: string;
    sheetId: string;
    sheetName: string;
    sheetDescription: string | null;
    status: string;
    permissionMode: SearchEvalPermissionMode;
    queryType: string[];
    rankProfile: string | null;
    rankProfileInputs: Record<string, number> | null;
    asOfTimestamp: string | null;
    startedAt: string;
    completedAt: string | null;
  };
  progress: { phase: string; queriesTotal: number; queriesDone: number } | null;
  summary: SearchEvalMetricsSummary;
  rows: SearchEvalResultRow[];
}

export async function getSearchEvalRun(runId: string, userId: string): Promise<SearchEvalRunDetail> {
  return request<{ success: boolean } & SearchEvalRunDetail>(
    `${AUTH_API_URL}/api/v1/search-evals/runs/${runId}`,
    { headers: { "x-user-id": userId } },
  );
}

/** Downloads the full per-query result data for a run as a real .xlsx
 *  workbook (Summary + Results sheets, incl. match-features breakdown) —
 *  binary response, so this bypasses the JSON `request()` helper and
 *  triggers a browser download directly via a temporary object-URL anchor. */
export async function downloadSearchEvalRunExport(runId: string, userId: string): Promise<void> {
  const res = await fetch(`${AUTH_API_URL}/api/v1/search-evals/runs/${runId}/export`, {
    credentials: "include",
    headers: { "x-user-id": userId },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new ApiError(res.status, body.error ?? `Export failed: ${res.status}`);
  }
  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = /filename="([^"]+)"/.exec(disposition);
  const filename = match?.[1] ?? `search-eval-run-${runId}.xlsx`;

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ── Error pipeline (Grafana → Claw auto-fix) admin inspection ──────────────

export interface ErrorPipelineBucketStat {
  queued: number;
  pending: number;
}

export interface ErrorPipelineItem {
  errorKey: string;
  enqueuedAt: number;
  attempts: number;
  error: { source: string; message: string; normMessage?: string; sampleRequestId?: string; count?: number; occurredAt?: number };
  classification: { bucket: string; reason: string; signal: string };
}

/**
 * Private per-user thread for a pipeline error. Returns the forked
 * conversationId (`<conv>__u__<userId>`), creating it — with a full clone of
 * the run's agent session — on first call. Idempotent.
 */
export async function forkErrorPipelineConversation(userId: string, conversationId: string): Promise<string> {
  const data = await request<{ success: boolean; data: { conversationId: string } }>(
    `${AUTH_API_URL}/api/v1/admin/error-pipeline/fork-conversation`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-user-id": userId },
      body: JSON.stringify({ conversationId }),
    },
  );
  return data.data.conversationId;
}

export async function getErrorPipelineBuckets(userId: string): Promise<Record<string, ErrorPipelineBucketStat>> {
  const data = await request<{ success: boolean; data: { buckets: Record<string, ErrorPipelineBucketStat> } }>(
    `${AUTH_API_URL}/api/v1/admin/error-pipeline/buckets`,
    { headers: { "x-user-id": userId } },
  );
  return data.data.buckets;
}

export async function listErrorPipelineItems(userId: string, bucket: string, limit = 100): Promise<ErrorPipelineItem[]> {
  const data = await request<{ success: boolean; data: { items: ErrorPipelineItem[] } }>(
    `${AUTH_API_URL}/api/v1/admin/error-pipeline/items/${encodeURIComponent(bucket)}?limit=${limit}`,
    { headers: { "x-user-id": userId } },
  );
  return data.data.items;
}

export interface ErrorPipelineFix {
  errorKey: string;
  bucket: string;
  status: "running" | "completed" | "failed";
  message: string;
  sessionId?: string;
  conversationId?: string;
  summary?: string;
  attempts: number;
  updatedAt: number;
}

export async function listErrorPipelineFixes(userId: string, limit = 200): Promise<ErrorPipelineFix[]> {
  const data = await request<{ success: boolean; data: { fixes: ErrorPipelineFix[] } }>(
    `${AUTH_API_URL}/api/v1/admin/error-pipeline/fixes?limit=${limit}`,
    { headers: { "x-user-id": userId } },
  );
  return data.data.fixes;
}

// ── Editable bucket rules (the DB taxonomy) ──────────────────────────
export interface ErrorPipelineRule {
  name: string;
  description: string;
  keywords: string[];
  markers: string;
  matchOrder: number;
  enabled: boolean;
  updatedAt: string;
}

export async function listErrorPipelineRules(userId: string): Promise<ErrorPipelineRule[]> {
  const data = await request<{ success: boolean; data: ErrorPipelineRule[] }>(
    `${AUTH_API_URL}/api/v1/admin/error-pipeline/rules`,
    { headers: { "x-user-id": userId } },
  );
  return data.data;
}

export async function saveErrorPipelineRule(
  userId: string,
  name: string,
  body: { description: string; keywords: string[]; markers: string; matchOrder: number; enabled: boolean },
): Promise<void> {
  await request(
    `${AUTH_API_URL}/api/v1/admin/error-pipeline/rules/${encodeURIComponent(name)}`,
    { method: "PUT", headers: { "x-user-id": userId, "Content-Type": "application/json" }, body: JSON.stringify(body) },
  );
}

export async function deleteErrorPipelineRule(userId: string, name: string): Promise<void> {
  await request(
    `${AUTH_API_URL}/api/v1/admin/error-pipeline/rules/${encodeURIComponent(name)}`,
    { method: "DELETE", headers: { "x-user-id": userId } },
  );
}

export interface SandboxRepoConfigRow {
  key: string;
  source: "database" | "default";
  hasDefault: boolean;
  enabled: boolean;
  active: boolean;
  config: Record<string, unknown>;
  updatedAt: string | null;
  updatedByUserId: string | null;
  workspaceId: string | null;
}

export async function listSandboxRepoConfigs(userId: string): Promise<SandboxRepoConfigRow[]> {
  const data = await request<{ success: boolean; data: SandboxRepoConfigRow[] }>(
    `${AUTH_API_URL}/api/v1/admin/sandbox-repos`,
    { headers: { "x-user-id": userId } },
  );
  return data.data;
}

export async function saveSandboxRepoConfig(
  userId: string,
  key: string,
  body: { config: unknown; enabled: boolean; workspaceId?: string },
): Promise<void> {
  await request(
    `${AUTH_API_URL}/api/v1/admin/sandbox-repos/${encodeURIComponent(key)}`,
    { method: "PUT", headers: { "x-user-id": userId, "Content-Type": "application/json" }, body: JSON.stringify(body) },
  );
}

export async function deleteSandboxRepoConfig(userId: string, key: string): Promise<void> {
  await request(
    `${AUTH_API_URL}/api/v1/admin/sandbox-repos/${encodeURIComponent(key)}`,
    { method: "DELETE", headers: { "x-user-id": userId } },
  );
}

// ── Entity extraction ────────────────────────────────────────────────────────
// Type discovery over a channel: read its threads/tickets, propose an entity
// type vocabulary, pause for human approval. Approving writes the channel's
// types onto its Vespa document so search can filter by them.

export type EntityRunStatus =
  | "RUNNING"
  | "AWAITING_TYPE_APPROVAL"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export interface EntityExtractionRun {
  id: string;
  channelId: string;
  status: EntityRunStatus;
  stage: string;
  messageCount: number;
  documentCount: number;
  approvedTypeNames: string[];
  startedAt: string;
  completedAt: string | null;
  errorMessage: string | null;
}

export interface ProposedEntityType {
  name: string;
  prefix: string;
  rule: string;
  examples?: string[];
}

export interface ProposedTypesPayload {
  types: ProposedEntityType[];
  /** Labels the pipeline merged away or discarded, with its reason. */
  dropped: Array<{ label?: string; reason?: string } | string>;
}

export async function startEntityExtractionRun(
  channelId: string,
  userId: string,
  context?: string,
): Promise<{ runId: string; status: EntityRunStatus }> {
  return request<{ runId: string; status: EntityRunStatus }>(
    `${AUTH_API_URL}/api/v1/entity-extraction/channels/${channelId}/runs`,
    {
      method: "POST",
      headers: { "x-user-id": userId },
      body: JSON.stringify(context?.trim() ? { context: context.trim() } : {}),
    },
  );
}

export async function getEntityExtractionRun(
  runId: string,
  userId: string,
): Promise<EntityExtractionRun> {
  return request<EntityExtractionRun>(
    `${AUTH_API_URL}/api/v1/entity-extraction/runs/${runId}`,
    { headers: { "x-user-id": userId } },
  );
}

export async function getEntityExtractionTypes(
  runId: string,
  userId: string,
): Promise<ProposedTypesPayload> {
  return request<ProposedTypesPayload>(
    `${AUTH_API_URL}/api/v1/entity-extraction/runs/${runId}/types`,
    { headers: { "x-user-id": userId } },
  );
}

export interface ApproveTypesResult {
  runId: string;
  approvedTypes: string[];
  /** The channel's full type set as written to Vespa (union across its runs). */
  channelEntityTypes: string[];
  vespaSync: "ok" | "failed";
  vespaSyncError?: string;
}

export async function approveEntityTypes(
  runId: string,
  userId: string,
  payload: {
    approve: string[];
    edit?: Record<string, Partial<ProposedEntityType>>;
    add?: ProposedEntityType[];
  },
): Promise<ApproveTypesResult> {
  return request<ApproveTypesResult>(
    `${AUTH_API_URL}/api/v1/entity-extraction/runs/${runId}/types`,
    { method: "POST", headers: { "x-user-id": userId }, body: JSON.stringify(payload) },
  );
}

export async function resyncChannelEntityTypes(
  channelId: string,
  userId: string,
): Promise<{ channelId: string; entityTypes: string[]; vespaSync: "ok" | "failed"; error?: string }> {
  return request(
    `${AUTH_API_URL}/api/v1/entity-extraction/channels/${channelId}/resync-types`,
    { method: "POST", headers: { "x-user-id": userId } },
  );
}

// ── Messaging channels (WhatsApp, Telegram, …) — surfaces/messaging admin API ──

export type MessagingChannelKey = "whatsapp" | "whatsapp-cloud";
export type ChannelConnState = "pending_login" | "connected" | "disconnected" | "logged_out";
export type ChannelDmPolicy = "linked" | "disabled";
export type ChannelGroupPolicy = "allowlist" | "open" | "disabled";

export interface ChannelAccountView {
  id: string;
  accountKey: string;
  channel: MessagingChannelKey;
  orgId: string;
  label: string;
  desiredState: "running" | "stopped";
  connState: ChannelConnState;
  selfId?: string;
  displayId?: string;
  lastConnectedAt?: string;
  lastDisconnect?: { code?: number; reason?: string; at: string };
  dmPolicy: ChannelDmPolicy;
  groupPolicy: ChannelGroupPolicy;
  groupAllowlist: string[];
  requireMention: boolean;
  groupHistoryLimit: number;
  ackReaction?: string;
  rateLimitPerMinute: number;
  channelConfig: Record<string, unknown> | null;
  agent: { slug: string; name: string } | null;
  login: { kind: "qr" | "token" };
  /** "org": one shared business number. "user": this is one person's own
   *  number and only they (or an admin) can see or manage it. */
  scope: "org" | "user";
  ownerUserId: string | null;
  loginFields: Array<{ key: string; label: string; type: "text" | "password"; placeholder?: string; hint?: string }>;
  transport: "connection" | "webhook";
  /** Webhook channels only: where the provider must POST. */
  webhookUrl?: string;
  webhookPath?: string;
  capabilities: { groups: boolean; media: boolean; typing: boolean; reactions: boolean; maxTextChars: number };
  leaseHolder: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChannelAccountPolicyPatch {
  label?: string;
  agentSlug?: string;
  dmPolicy?: ChannelDmPolicy;
  groupPolicy?: ChannelGroupPolicy;
  groupAllowlist?: string[];
  requireMention?: boolean;
  groupHistoryLimit?: number;
  ackReaction?: string;
  rateLimitPerMinute?: number;
  channel?: Record<string, unknown>;
}

export interface ChannelLoginArtifact {
  connState: ChannelConnState;
  desiredState: "running" | "stopped";
  login: { kind: "qr" | "token" };
  artifact: string | null;
  /** Data URL of the rendered QR (login.kind === "qr"). */
  qr: string | null;
}

function channelBase(channel: MessagingChannelKey): string {
  return `${AUTH_API_URL}/api/v1/surfaces/${channel}`;
}

/** Omit `orgId` for a user-scoped channel: the server uses the session's org
 *  and returns only the caller's own accounts. */
export async function listChannelAccounts(channel: MessagingChannelKey, orgId?: string): Promise<ChannelAccountView[]> {
  const query = orgId ? `?orgId=${encodeURIComponent(orgId)}` : "";
  const data = await request<{ success: boolean; accounts: ChannelAccountView[] }>(
    `${channelBase(channel)}/accounts${query}`,
  );
  return data.accounts;
}

export async function createChannelAccount(
  channel: MessagingChannelKey,
  input: { orgId?: string; label?: string; agentSlug: string; channel?: Record<string, unknown> },
): Promise<ChannelAccountView> {
  const data = await request<{ success: boolean; account: ChannelAccountView }>(`${channelBase(channel)}/accounts`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return data.account;
}

export async function updateChannelAccount(
  channel: MessagingChannelKey,
  accountId: string,
  patch: ChannelAccountPolicyPatch,
): Promise<ChannelAccountView> {
  const data = await request<{ success: boolean; account: ChannelAccountView }>(
    `${channelBase(channel)}/accounts/${encodeURIComponent(accountId)}`,
    { method: "PATCH", body: JSON.stringify(patch) },
  );
  return data.account;
}

/** Publish the WhatsApp question form (Flows) into the business account, so
 *  multi-part questions arrive as one native form. Returns the form id. */
export async function publishChannelQuestionForm(
  channel: MessagingChannelKey,
  accountId: string,
  wabaId: string,
): Promise<string> {
  const data = await request<{ success: boolean; questionFormId: string }>(
    `${channelBase(channel)}/accounts/${encodeURIComponent(accountId)}/question-form`,
    { method: "POST", body: JSON.stringify({ wabaId }) },
  );
  return data.questionFormId;
}

export async function deleteChannelAccount(channel: MessagingChannelKey, accountId: string): Promise<void> {
  await request<{ success: boolean }>(`${channelBase(channel)}/accounts/${encodeURIComponent(accountId)}`, {
    method: "DELETE",
  });
}

export async function loginChannelAccount(
  channel: MessagingChannelKey,
  accountId: string,
  input: { token?: string; secrets?: Record<string, string> } = {},
): Promise<void> {
  await request<{ success: boolean }>(`${channelBase(channel)}/accounts/${encodeURIComponent(accountId)}/login`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function logoutChannelAccount(channel: MessagingChannelKey, accountId: string): Promise<void> {
  await request<{ success: boolean }>(`${channelBase(channel)}/accounts/${encodeURIComponent(accountId)}/logout`, {
    method: "POST",
    body: "{}",
  });
}

export async function getChannelLoginArtifact(
  channel: MessagingChannelKey,
  accountId: string,
): Promise<ChannelLoginArtifact> {
  return request<ChannelLoginArtifact & { success: boolean }>(
    `${channelBase(channel)}/accounts/${encodeURIComponent(accountId)}/login-artifact`,
  );
}

// ── my numbers (self-service linking) ──

export interface LinkedChannelNumber {
  senderId: string;
  linkedAt: string;
  lastSeenAt: string | null;
}

export interface ChannelNumberLink {
  senderId: string;
  /** The number to message, when the org has exactly one to offer. */
  sendTo: string | null;
  linkedAt: string;
}

export async function listMyChannelNumbers(channel: MessagingChannelKey): Promise<LinkedChannelNumber[]> {
  const data = await request<{ success: boolean; numbers: LinkedChannelNumber[] }>(`${channelBase(channel)}/my-numbers`);
  return data.numbers;
}

export async function linkChannelNumber(channel: MessagingChannelKey, phone: string): Promise<ChannelNumberLink> {
  const data = await request<{ success: boolean; linked: ChannelNumberLink }>(`${channelBase(channel)}/my-numbers`, {
    method: "POST",
    body: JSON.stringify({ phone }),
  });
  return data.linked;
}

export async function unlinkMyChannelNumber(channel: MessagingChannelKey, senderId: string): Promise<void> {
  await request<{ success: boolean }>(`${channelBase(channel)}/my-numbers/${encodeURIComponent(senderId)}`, {
    method: "DELETE",
  });
}

export interface ChannelGroup {
  id: string;
  name: string;
  participants: number;
}

/** Groups the account is a member of, for the allowlist picker. Only the server
 *  holding the account's connection can answer, so this can legitimately fail
 *  with 503 while the account moves between servers. */
export async function listChannelGroups(channel: MessagingChannelKey, accountId: string): Promise<ChannelGroup[]> {
  const data = await request<{ success: boolean; groups: ChannelGroup[] }>(
    `${channelBase(channel)}/accounts/${encodeURIComponent(accountId)}/groups`,
  );
  return data.groups;
}

// ── Agent index ────────────────────────────────────────────────────────────
// The per-org Hindsight bank holding one searchable document per agent.

export type AgentIndexKind = "identity" | "persona" | "usage";

export interface AgentIndexStatus {
  slug: string;
  name: string;
  agentId: string;
  indexed: AgentIndexKind[];
  missing: AgentIndexKind[];
  stale: boolean;
  liveUpdatedAt: string;
  indexedUpdatedAt: string | null;
  promptVersion: number | null;
  indexedPromptVersion: number | null;
  chars: number;
}

/** One stored document. The provider splits long content into chunks; `chunks`
 *  reports how many it took, and `text` is the reassembled whole. */
export interface AgentIndexDocument {
  kind: AgentIndexKind | "unknown";
  slug: string;
  contentHash: string | null;
  text: string;
  chars: number;
  chunks: number;
  indexedAt: string | null;
}

export interface AgentIndexOverview {
  agents: AgentIndexStatus[];
  indexed: number;
  total: number;
  stale: number;
  entries: number;
  chars: number;
  bankId: string;
  bankConfig: Record<string, unknown>;
}

export interface AgentIndexMatch {
  slug: string;
  agentId: string | null;
  score: number;
  matchedKinds: AgentIndexKind[];
  evidence: string;
}

export async function getAgentIndexOverview(): Promise<AgentIndexOverview> {
  const data = await request<{ success: boolean; data: AgentIndexOverview }>(
    `${AUTH_API_URL}/api/v1/agent-index/overview`,
  );
  return data.data;
}

export async function getAgentIndexDetail(
  slug: string,
): Promise<{ status: AgentIndexStatus; documents: AgentIndexDocument[] }> {
  const data = await request<{
    success: boolean;
    data: { status: AgentIndexStatus; documents: AgentIndexDocument[] };
  }>(`${AUTH_API_URL}/api/v1/agent-index/agents/${encodeURIComponent(slug)}`);
  return data.data;
}

export async function syncAgentIndex(slug: string): Promise<void> {
  await request(`${AUTH_API_URL}/api/v1/agent-index/agents/${encodeURIComponent(slug)}/sync`, {
    method: "POST",
  });
}

export async function rebuildAgentIndex(): Promise<{ synced: number; failed: number; purged: number }> {
  const data = await request<{
    success: boolean;
    data: { synced: number; failed: number; purged: number };
  }>(`${AUTH_API_URL}/api/v1/agent-index/rebuild`, { method: "POST" });
  return data.data;
}

export async function searchAgentIndex(need: string, limit = 10): Promise<AgentIndexMatch[]> {
  const data = await request<{ success: boolean; data: { matches: AgentIndexMatch[] } }>(
    `${AUTH_API_URL}/api/v1/agent-index/search`,
    { method: "POST", body: JSON.stringify({ need, limit }) },
  );
  return data.data.matches;
}

export interface UsagePatternFile {
  content: string;
  updatedBy: string | null;
  updatedAt: string;
  chars: number;
  /** Server-owned: it is the same flag the synthesizer checks before it writes,
   *  so the UI cannot promise a protection the backend will not honour. */
  humanEdited: boolean;
}

export interface UsagePatternSynthesis {
  slug: string;
  runCount: number;
  distinctUsers: number;
  patternsWritten: number;
  skipped?: string;
  chars: number;
  window: { start: string; end: string };
}

/** Synthesis runs longer than a gateway will hold a connection, so the POST
 *  starts a pass and returns immediately. Poll {@link getUsagePatternJob}. */
export type UsagePatternJob =
  | { status: "running"; startedAt: string }
  | { status: "busy"; running: number }
  | { status: "done"; startedAt: string; finishedAt: string; outcome: Omit<UsagePatternSynthesis, "window"> }
  | { status: "error"; startedAt: string; finishedAt: string; error: string };

export async function triggerUsagePatternSynthesis(
  slug: string,
  start?: string,
  end?: string,
): Promise<{ job: UsagePatternJob; window: { start: string; end: string } }> {
  const data = await request<{
    success: boolean;
    data: { job: UsagePatternJob; window: { start: string; end: string } };
  }>(
    `${AUTH_API_URL}/api/v1/agent-index/agents/${encodeURIComponent(slug)}/usage-patterns`,
    { method: "POST", body: JSON.stringify({ start, end }) },
  );
  return data.data;
}

export async function getUsagePatternFile(slug: string): Promise<UsagePatternFile | null> {
  const data = await request<{ success: boolean; data: UsagePatternFile | null }>(
    `${AUTH_API_URL}/api/v1/agent-index/agents/${encodeURIComponent(slug)}/usage-patterns`,
  );
  return data.data;
}

/** Progress of a pass started on the server this request lands on. Null when
 *  nothing ran there, which includes a poll reaching a different replica. */
export async function getUsagePatternJob(slug: string): Promise<UsagePatternJob | null> {
  const data = await request<{ success: boolean; job: UsagePatternJob | null }>(
    `${AUTH_API_URL}/api/v1/agent-index/agents/${encodeURIComponent(slug)}/usage-patterns`,
  );
  return data.job ?? null;
}

/** Hand-edit the shared usage-pattern file. Marks it human-written, which stops
 *  the synthesizer overwriting it. Admin only. */
export async function writeUsagePatternFile(slug: string, content: string): Promise<UsagePatternFile | null> {
  const data = await request<{ success: boolean; data: UsagePatternFile | null }>(
    `${AUTH_API_URL}/api/v1/agent-index/agents/${encodeURIComponent(slug)}/usage-patterns`,
    { method: "PUT", body: JSON.stringify({ content }) },
  );
  return data.data;
}

// ── MCP Gateway service registry (session-authed UI surface) ──────────────
// The secret x-s2s-key / tenant are injected server-side by the
// /gateway-registry route; the browser only sends its session cookie.

export interface GatewayToolInput {
  name: string;
  description?: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path?: string;
  requiresApproval?: boolean;
  isWriteTool?: boolean;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

export interface RegisterGatewayServiceInput {
  serviceName: string;
  backendId: string;
  backendUrl: string;
  tokenEndpointUrl: string;
  xAuthHeaderName?: string;
  tools: GatewayToolInput[];
}

/** Submit an MCP-gateway service registration for admin approval (does not go live). */
export async function registerGatewayService(
  input: RegisterGatewayServiceInput,
): Promise<{ success: boolean; message: string; status?: string; requestId?: string }> {
  const data = await request<{ success: boolean; data: { success: boolean; message: string; status?: string; requestId?: string } }>(
    `${AUTH_API_URL}/api/v1/gateway-registry`,
    { method: "POST", body: JSON.stringify(input) },
  );
  return data.data;
}

/** The caller's own registration requests (pending/approved/rejected). */
export async function listMyGatewayRequests(): Promise<GatewayServiceRequest[]> {
  const data = await request<{ success: boolean; data: GatewayServiceRequest[] }>(
    `${AUTH_API_URL}/api/v1/gateway-registry/my-requests`,
  );
  return data.data;
}

/** Pending registration requests awaiting review (admin only). */
export async function listGatewayRequests(): Promise<GatewayServiceRequest[]> {
  const data = await request<{ success: boolean; data: GatewayServiceRequest[] }>(
    `${AUTH_API_URL}/api/v1/gateway-registry/requests`,
  );
  return data.data;
}

/** Approve a pending request → registers it live (admin only). */
export async function approveGatewayRequest(id: string): Promise<void> {
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/gateway-registry/requests/${encodeURIComponent(id)}/approve`,
    { method: "POST", body: JSON.stringify({}) },
  );
}

/** Reject a pending request (admin only). */
export async function rejectGatewayRequest(id: string): Promise<void> {
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/gateway-registry/requests/${encodeURIComponent(id)}/reject`,
    { method: "POST", body: JSON.stringify({}) },
  );
}

export interface GatewayServiceDetail {
  serviceName: string;
  backendId: string;
  backendUrl: string;
  xAuthHeaderName: string | null;
  tokenEndpointUrl: string | null;
  tools: GatewayToolInput[];
}

/** Fetch one registered service with its full tool definitions (for editing). */
export async function getGatewayService(serviceName: string, backendId?: string): Promise<GatewayServiceDetail> {
  const q = backendId ? `?backendId=${encodeURIComponent(backendId)}` : "";
  const data = await request<{ success: boolean; data: GatewayServiceDetail }>(
    `${AUTH_API_URL}/api/v1/gateway-registry/${encodeURIComponent(serviceName)}${q}`,
  );
  return data.data;
}

/** List MCP-gateway services registered for the workspace tenant. */
export async function listGatewayServices(): Promise<GatewayServiceRow[]> {
  const data = await request<{ success: boolean; data: GatewayServiceRow[] }>(
    `${AUTH_API_URL}/api/v1/gateway-registry`,
  );
  return data.data;
}

/** Deregister all backends for a service under the workspace tenant. */
export async function deregisterGatewayService(serviceName: string): Promise<void> {
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/gateway-registry/${encodeURIComponent(serviceName)}`,
    { method: "DELETE" },
  );
}

/** One classifier (Jev) call in full: what it was told, asked, and answered. */
export interface ClassifierExchange {
  purpose: string;
  backend: string;
  ms: number;
  ok: boolean;
  error?: string;
  state: string;
  questionSpec: Record<string, unknown>;
  answers: Record<string, unknown> | null;
  at: string;
}

export interface CuratorClassifierTrace {
  checked: number;
  kept: number;
  dropped: number;
  unavailable: number;
  ms: number;
  calls: Array<{
    text: string;
    verdict?: "new" | "duplicate" | "update" | "noise";
    confidence?: number;
    worth?: number;
    exchange: ClassifierExchange;
  }>;
}

export type LoopTemplateId = "deadline-checker" | "frontier" | "cursor-walk" | "until-condition" | "fix-retry" | "sequence";

export interface LoopSequenceStep {
  command: string;
  args: string;
}

export interface LoopTemplateInfo {
  id: LoopTemplateId;
  title: string;
  summary: string;
  example: string;
  exit: "deadline" | "frontier" | "judge";
  question: { label: string; placeholder: string; retryWhen: boolean } | null;
  deliverable: "required" | "optional" | "none";
  defaultDurationMin: number;
  maxDurationMin: number;
  composite?: boolean;
}

export interface LoopTemplateCatalogue {
  templates: LoopTemplateInfo[];
  skillBundles: Array<{ id: string; label: string; summary: string }>;
  providers: string[];
  builtinLoops: Array<{ command: string; summary: string; positional: string | null }>;
}

export interface LoopCommandBody {
  name?: string;
  description: string;
  template: LoopTemplateId;
  instruction: string;
  skills: string[];
  subagents: string[];
  provider?: string | null;
  modelId?: string | null;
  maxDurationMinutes: number;
  maxPasses?: number | null;
  deliverable?: "md" | "html" | null;
  judgeQuestion?: string | null;
  steps?: LoopSequenceStep[] | null;
}

export interface LoopCommandRow extends Required<Omit<LoopCommandBody, "name">> {
  id: string;
  name: string;
  command: string;
  published: boolean;
  enabled: boolean;
  mine: boolean;
  createdByUserId: string;
  updatedAt: string;
  version: number;
}

export interface LoopCommandVersionInfo {
  version: number;
  createdAt: string;
  createdByUserId: string;
  current: boolean;
  snapshot: Partial<LoopCommandBody>;
}

export async function listLoopCommandVersions(id: string): Promise<LoopCommandVersionInfo[]> {
  const data = await request<{ success: boolean; data: LoopCommandVersionInfo[] }>(`${AUTH_API_URL}/api/v1/loop-commands/${encodeURIComponent(id)}/versions`);
  return data.data;
}

export async function rollbackLoopCommand(id: string, version: number): Promise<LoopCommandRow> {
  const data = await request<{ success: boolean; data: LoopCommandRow }>(`${AUTH_API_URL}/api/v1/loop-commands/${encodeURIComponent(id)}/rollback`, { method: "POST", body: JSON.stringify({ version }) });
  return data.data;
}

export async function getLoopTemplates(): Promise<LoopTemplateCatalogue> {
  const data = await request<{ success: boolean; data: LoopTemplateCatalogue }>(`${AUTH_API_URL}/api/v1/loop-commands/templates`);
  return data.data;
}

export async function listLoopCommands(): Promise<LoopCommandRow[]> {
  const data = await request<{ success: boolean; data: LoopCommandRow[] }>(`${AUTH_API_URL}/api/v1/loop-commands`);
  return data.data;
}

export async function createLoopCommand(body: LoopCommandBody): Promise<LoopCommandRow> {
  const data = await request<{ success: boolean; data: LoopCommandRow }>(`${AUTH_API_URL}/api/v1/loop-commands`, { method: "POST", body: JSON.stringify(body) });
  return data.data;
}

export async function updateLoopCommand(id: string, body: LoopCommandBody): Promise<LoopCommandRow> {
  const data = await request<{ success: boolean; data: LoopCommandRow }>(`${AUTH_API_URL}/api/v1/loop-commands/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(body) });
  return data.data;
}

export async function publishLoopCommand(id: string, published: boolean): Promise<LoopCommandRow> {
  const data = await request<{ success: boolean; data: LoopCommandRow }>(`${AUTH_API_URL}/api/v1/loop-commands/${encodeURIComponent(id)}/publish`, { method: "POST", body: JSON.stringify({ published }) });
  return data.data;
}

export async function deleteLoopCommand(id: string): Promise<void> {
  await request(`${AUTH_API_URL}/api/v1/loop-commands/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export interface LoopCostRow {
  model: string | null;
  runs: number;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface LoopRunSummary {
  runs: number;
  outcomes: { completed: number; "no-report": number; stopped: number; running: number };
  completionRate: number | null;
  avgPasses: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
}

export interface LoopCommandStats extends LoopRunSummary {
  id: string;
  name: string;
  template: string;
  version: number;
  published: boolean;
  composite: boolean;
  findings: { proved: number; refuted: number; conjecture: number };
  costRows: LoopCostRow[];
  byVersion: Array<LoopRunSummary & { version: number }>;
  daily: Array<{ day: string; runs: number }>;
  recent: Array<{ id: string; version: number | null; status: string; passes: number; ms: number; createdAt: string; report: string | null }>;
}

export async function getLoopCommandStats(days: number): Promise<{ days: number; commands: LoopCommandStats[] }> {
  const data = await request<{ success: boolean; data: { days: number; commands: LoopCommandStats[] } }>(`${AUTH_API_URL}/api/v1/loop-commands/stats?days=${days}`);
  return data.data;
}
