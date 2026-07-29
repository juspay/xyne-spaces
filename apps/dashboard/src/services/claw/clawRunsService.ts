import { clawApiRequest } from './clawRequest';
import type { AgentRun, AgentRunStatus } from './clawRunsTypes';

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

export function getAgentRun(userId: string, sessionId: string): Promise<AgentRun> {
  return clawApiRequest<AgentRun>(`/runs/${encodeURIComponent(sessionId)}`, { userId });
}
