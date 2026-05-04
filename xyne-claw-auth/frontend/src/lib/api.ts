import type { User, McpServer, UserConnection, HealthResult, CredentialField, Gateway, GatewayIdentity, Agent, ScheduledJob, ScheduledJobRun } from "./types";

const BACKEND_URL = import.meta.env.VITE_XYNE_BACKEND_URL || "";
const AUTH_API_URL = import.meta.env.VITE_AUTH_API_URL || "/claw";

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
    throw new Error(body.error ?? `Request failed: ${res.status}`);
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

export async function listAgents(userId?: string): Promise<Agent[]> {
  const qs = userId ? `?userId=${encodeURIComponent(userId)}` : "";
  const data = await request<{ success: boolean; data: Agent[] }>(
    `${AUTH_API_URL}/api/v1/agents${qs}`,
  );
  return data.data;
}

export interface AvailableTools {
  subagents: Array<{ name: string; description: string; serverType: string; progressLabel: string }>;
  mcpServers: Array<{ id: string; name: string; type: string }>;
  writeTools: Array<{ name: string; source: string }>;
  customGroups: Array<{ source: string; tools: Array<{ slug: string; name: string }> }>;
  serverTools: Record<string, Array<{ slug: string; name: string }>>;
}

export async function getAvailableTools(): Promise<AvailableTools> {
  const data = await request<{ success: boolean; data: AvailableTools }>(
    `${AUTH_API_URL}/api/v1/tools/available`,
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
  payload: { slug: string; name: string; description?: string; systemPrompt: string; color?: string; ownerUserId?: string },
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
  payload: { enabled?: boolean; name?: string; description?: string; systemPrompt?: string; color?: string; modelId?: string; config?: Record<string, unknown>; skills?: string[] },
): Promise<Agent> {
  const data = await request<{ success: boolean; data: Agent }>(
    `${AUTH_API_URL}/api/v1/agents/${slug}`,
    { method: "PUT", body: JSON.stringify(payload) },
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
  payload?: { apiKey?: string; baseUrl?: string },
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
}

export async function submitAgentRequest(slug: string, userId: string, requestType: "push_to_spaces" | "push_to_global"): Promise<void> {
  await request<{ success: boolean }>(
    `${AUTH_API_URL}/api/v1/agents/${slug}/request`,
    { method: "POST", headers: { "x-user-id": userId }, body: JSON.stringify({ requestType }) },
  );
}

export async function listPendingRequests(userId: string): Promise<AgentRequestItem[]> {
  const data = await request<{ success: boolean; data: AgentRequestItem[] }>(
    `${AUTH_API_URL}/api/v1/agents/requests/pending`,
    { headers: { "x-user-id": userId } },
  );
  return data.data;
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

export interface StreamCallbacks {
  onProgress?: (toolLabel: string) => void;
  onInvocation?: (inv: ToolInvocation) => void;
  onReasoningDelta?: (delta: string) => void;
  onTextDelta?: (delta: string) => void;
  onAttachment?: (att: StreamedAttachment) => void;
  onRunMeta?: (meta: { sessionId: string }) => void;
}

export interface PendingAction {
  serverType: string;
  tool: string;
  params: Record<string, unknown>;
  userId: string;
  signature: string;
}

export interface ChatReply {
  role: string;
  content: string;
  status: string;
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
  signal?: AbortSignal,
): Promise<{ conversationId: string; reply: ChatReply }> {
  // Backward-compat: allow passing a single onProgress function (old signature).
  const cb: StreamCallbacks = typeof callbacks === "function"
    ? { onProgress: callbacks }
    : (callbacks ?? {});

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
    }),
    ...(signal ? { signal } : {}),
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

export async function pollChatMessages(slug: string, conversationId: string): Promise<ChatMsg[]> {
  const data = await request<{ success: boolean; data: ChatMsg[] }>(
    `${AUTH_API_URL}/api/v1/agent-chat/${slug}/chat/${conversationId}/messages`,
  );
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
  payload: { apiKey?: string; model?: string; baseUrl?: string; authType?: "api_key" | "oauth_token" },
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
  rating: "up" | "down" | null;
  ratingComment: string | null;
  ratedAt: string | null;
  startedAt: string;
  completedAt: string | null;
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

export async function listRuns(userId: string, opts?: { status?: string; limit?: number; conversationId?: string; agentSlug?: string }): Promise<AgentRun[]> {
  const qs = new URLSearchParams();
  if (opts?.status) qs.set("status", opts.status);
  if (opts?.limit) qs.set("limit", String(opts.limit));
  if (opts?.conversationId) qs.set("conversationId", opts.conversationId);
  if (opts?.agentSlug) qs.set("agentSlug", opts.agentSlug);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  const data = await request<{ success: boolean; data: AgentRun[] }>(
    `${AUTH_API_URL}/api/v1/runs${suffix}`,
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
