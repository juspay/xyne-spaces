import { CLAW_API_BASE, ClawApiError, clawApiRequest, clawRequest } from './clawRequest';
import type {
  AdminAccessFlags,
  AdminDateRange,
  AdminOrgScope,
  AdminScheduledJob,
  AgentRequestItem,
  AdminMcpServerSummary,
  AgentUsageStat,
  AuditLogEntry,
  CredentialField,
  McpGlobalCredsDetail,
  McpPublishRequest,
  WorkflowGlobalRequest,
} from './clawAdminTypes';

const scopeQuery = (scope: AdminOrgScope): string => (scope === 'all' ? '?orgScope=all' : '');

export async function checkAdminAccess(userId: string): Promise<AdminAccessFlags> {
  try {
    return await clawApiRequest<AdminAccessFlags>(
      `/admin/roles/check/${encodeURIComponent(userId)}`,
      { userId },
    );
  } catch {
    return { isAdmin: false, hasSearchEvalAccess: false };
  }
}

export async function listPendingRequests(
  userId: string,
  scope: AdminOrgScope,
): Promise<AgentRequestItem[]> {
  return clawApiRequest<AgentRequestItem[]>(`/agents/requests/pending${scopeQuery(scope)}`, {
    userId,
  });
}

export async function getClawAgentBySlug(
  userId: string,
  slug: string,
): Promise<{ name?: string; spacesAppId: string | null; spacesAppTokenConfigured?: boolean }> {
  return clawApiRequest(`/agents/${encodeURIComponent(slug)}`, { userId });
}

export async function approveAgentRequest(userId: string, requestId: string): Promise<void> {
  await clawApiRequest<unknown>(`/agents/requests/${encodeURIComponent(requestId)}/approve`, {
    userId,
    method: 'POST',
  });
}

export async function rejectAgentRequest(
  userId: string,
  requestId: string,
  note?: string,
): Promise<void> {
  await clawApiRequest<unknown>(`/agents/requests/${encodeURIComponent(requestId)}/reject`, {
    userId,
    method: 'POST',
    body: JSON.stringify(note ? { note } : {}),
  });
}

export async function listAuditLogs(
  userId: string,
  opts: {
    scope: AdminOrgScope;
    limit?: number;
    offset?: number;
    eventType?: string;
    targetId?: string;
    startDate?: string;
  },
): Promise<{ rows: AuditLogEntry[]; total: number }> {
  const params = new URLSearchParams({
    limit: String(opts.limit ?? 50),
    offset: String(opts.offset ?? 0),
  });
  if (opts.eventType) params.set('eventType', opts.eventType);
  if (opts.targetId) params.set('targetId', opts.targetId);
  if (opts.startDate) params.set('startDate', opts.startDate);
  if (opts.scope === 'all') params.set('orgScope', 'all');

  const body = await clawRequest<{ data: AuditLogEntry[]; total: number }>(
    `/api/v1/admin/audit-logs?${params.toString()}`,
    { headers: { 'x-user-id': userId } },
  );
  return { rows: body.data, total: body.total };
}

export async function listAgentUsageStats(
  userId: string,
  days: AdminDateRange,
  scope: AdminOrgScope,
): Promise<AgentUsageStat[]> {
  const params = new URLSearchParams({ days: String(days) });
  if (scope === 'all') params.set('orgScope', 'all');
  return clawApiRequest<AgentUsageStat[]>(`/admin/usage/stats?${params.toString()}`, { userId });
}

export async function listAdminScheduledJobs(
  userId: string,
  opts: {
    scope: AdminOrgScope;
    status?: string;
    agentSlug?: string;
    jobUserId?: string;
    limit?: number;
    offset?: number;
  },
): Promise<{ rows: AdminScheduledJob[]; total: number }> {
  const params = new URLSearchParams({
    limit: String(opts.limit ?? 50),
    offset: String(opts.offset ?? 0),
  });
  if (opts.status) params.set('status', opts.status);
  if (opts.agentSlug) params.set('agentSlug', opts.agentSlug);
  if (opts.jobUserId) params.set('userId', opts.jobUserId);
  if (opts.scope === 'all') params.set('orgScope', 'all');
  return clawApiRequest<{ rows: AdminScheduledJob[]; total: number }>(
    `/admin/scheduled-jobs?${params.toString()}`,
    { userId },
  );
}

export async function cancelScheduledJob(userId: string, jobId: string): Promise<void> {
  await clawApiRequest<unknown>(`/scheduled-jobs/${encodeURIComponent(jobId)}`, {
    userId,
    method: 'DELETE',
  });
}

export async function listMcpPublishRequests(userId: string): Promise<McpPublishRequest[]> {
  return clawApiRequest<McpPublishRequest[]>('/servers/publish-requests', { userId });
}

export async function approveServerPublish(userId: string, serverId: string): Promise<void> {
  await clawApiRequest<unknown>(
    `/servers/publish-requests/${encodeURIComponent(serverId)}/approve`,
    { userId, method: 'POST' },
  );
}

export async function rejectServerPublish(
  userId: string,
  serverId: string,
  note?: string,
): Promise<void> {
  await clawApiRequest<unknown>(
    `/servers/publish-requests/${encodeURIComponent(serverId)}/reject`,
    { userId, method: 'POST', body: JSON.stringify(note ? { note } : {}) },
  );
}

export async function listWorkflowGlobalRequests(
  userId: string,
  scope: AdminOrgScope,
): Promise<WorkflowGlobalRequest[]> {
  return clawApiRequest<WorkflowGlobalRequest[]>(
    `/chain-workflows/global-requests${scopeQuery(scope)}`,
    { userId },
  );
}

export async function approveWorkflowGlobalRequest(
  userId: string,
  requestId: string,
): Promise<void> {
  await clawApiRequest<unknown>(
    `/chain-workflows/global-requests/${encodeURIComponent(requestId)}/approve`,
    { userId, method: 'POST' },
  );
}

export async function rejectWorkflowGlobalRequest(
  userId: string,
  requestId: string,
  note?: string,
): Promise<void> {
  await clawApiRequest<unknown>(
    `/chain-workflows/global-requests/${encodeURIComponent(requestId)}/reject`,
    { userId, method: 'POST', body: JSON.stringify(note ? { note } : {}) },
  );
}

export async function listAdminMcpServers(userId: string): Promise<AdminMcpServerSummary[]> {
  return clawApiRequest<AdminMcpServerSummary[]>('/admin/mcp-servers', { userId });
}

export async function setMcpGlobalFallback(
  userId: string,
  type: string,
  allowGlobalFallback: boolean,
): Promise<void> {
  await clawApiRequest<unknown>(`/admin/mcp-servers/${encodeURIComponent(type)}/global-fallback`, {
    userId,
    method: 'PUT',
    body: JSON.stringify({ allow: allowGlobalFallback }),
  });
}

export async function listCredentialFields(): Promise<Record<string, CredentialField[]>> {
  return clawApiRequest<Record<string, CredentialField[]>>('/servers/credential-fields');
}

export async function getMcpGlobalCredentials(
  userId: string,
  type: string,
): Promise<McpGlobalCredsDetail> {
  return clawApiRequest<McpGlobalCredsDetail>(
    `/admin/mcp-servers/${encodeURIComponent(type)}/global-credentials`,
    { userId },
  );
}

export async function setMcpGlobalCredentials(
  userId: string,
  type: string,
  credentials: Record<string, string>,
): Promise<void> {
  await clawApiRequest<unknown>(
    `/admin/mcp-servers/${encodeURIComponent(type)}/global-credentials`,
    { userId, method: 'PUT', body: JSON.stringify({ credentials }) },
  );
}

export async function deleteMcpGlobalCredentials(userId: string, type: string): Promise<void> {
  await clawApiRequest<unknown>(
    `/admin/mcp-servers/${encodeURIComponent(type)}/global-credentials`,
    { userId, method: 'DELETE' },
  );
}

export async function promoteAgent(userId: string, slug: string): Promise<void> {
  await clawApiRequest<unknown>(`/agents/${encodeURIComponent(slug)}/promote`, {
    userId,
    method: 'POST',
  });
}

export async function demoteAgent(userId: string, slug: string): Promise<void> {
  await clawApiRequest<unknown>(`/agents/${encodeURIComponent(slug)}/demote`, {
    userId,
    method: 'POST',
  });
}

export async function deleteAgent(userId: string, slug: string): Promise<void> {
  await clawApiRequest<unknown>(`/agents/${encodeURIComponent(slug)}`, {
    userId,
    method: 'DELETE',
  });
}

export async function createAgentApp(slug: string): Promise<void> {
  await clawApiRequest<unknown>(`/agents/${encodeURIComponent(slug)}/create-app`, {
    method: 'POST',
  });
}

export async function installAgentApp(slug: string): Promise<void> {
  await clawApiRequest<unknown>(`/agents/${encodeURIComponent(slug)}/install-app`, {
    method: 'POST',
  });
}

export async function configureAgentWebhook(slug: string): Promise<void> {
  await clawApiRequest<unknown>(`/agents/${encodeURIComponent(slug)}/configure-webhook`, {
    method: 'POST',
  });
}

export async function grantAgentPermissions(slug: string): Promise<void> {
  await clawApiRequest<unknown>(`/agents/${encodeURIComponent(slug)}/grant-permissions`, {
    method: 'POST',
  });
}

export async function uploadAgentPicture(slug: string, file: File): Promise<void> {
  const form = new FormData();
  form.append('picture', file, file.name);
  // eslint-disable-next-line local-rules/no-fetch-use-axios
  const res = await fetch(
    `${CLAW_API_BASE}/api/v1/agents/${encodeURIComponent(slug)}/upload-picture`,
    { method: 'POST', credentials: 'include', body: form },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ClawApiError(res.status, body.error ?? `Upload failed: ${res.status}`);
  }
}
