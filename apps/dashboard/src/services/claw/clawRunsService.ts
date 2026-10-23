import { clawApiRequest } from './clawRequest';
import type { AgentRun, AgentRunMonitorDetail, AgentRunStatus } from './clawRunsTypes';

export interface ListAgentRunsOptions {
  status?: AgentRunStatus;
  allUsers?: boolean;
  limit?: number;
}

export function listAgentRuns(
  userId: string,
  agentSlug: string,
  options: ListAgentRunsOptions = {},
): Promise<AgentRun[]> {
  const params = new URLSearchParams({
    agentSlug,
    limit: String(options.limit ?? (options.allUsers ? 200 : 50)),
  });
  if (options.status) params.set('status', options.status);
  if (options.allUsers) params.set('scope', 'all');

  return clawApiRequest<AgentRun[]>(`/runs?${params.toString()}`, { userId });
}

const agentMonitorPath = (agentSlug: string): string =>
  `/agents/${encodeURIComponent(agentSlug)}/monitor`;

export function getAgentRunMonitorDetail(
  userId: string,
  agentSlug: string,
  sessionId: string,
): Promise<AgentRunMonitorDetail> {
  return clawApiRequest<AgentRunMonitorDetail>(
    `${agentMonitorPath(agentSlug)}/runs/${encodeURIComponent(sessionId)}`,
    { userId },
  );
}

export function closeLostAgentRuns(
  userId: string,
  agentSlug: string,
  sessionIds: string[],
): Promise<{ closed: string[]; skipped: string[] }> {
  return clawApiRequest<{ closed: string[]; skipped: string[] }>(
    `${agentMonitorPath(agentSlug)}/close-lost`,
    { userId, method: 'POST', body: JSON.stringify({ sessionIds }) },
  );
}

export function getAgentRun(userId: string, sessionId: string): Promise<AgentRun> {
  return clawApiRequest<AgentRun>(`/runs/${encodeURIComponent(sessionId)}`, { userId });
}

export function listConversationRuns(
  userId: string,
  conversationId: string,
  agentSlug: string,
): Promise<AgentRun[]> {
  const params = new URLSearchParams({ conversationId, agentSlug, limit: '200' });
  return clawApiRequest<AgentRun[]>(`/runs?${params.toString()}`, { userId });
}
