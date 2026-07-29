import type { Agent } from './clawAuthAgentTypes';
import { clawApiRequest, clawRequest } from './clawRequest';
import type {
  AdminOrgScope,
  AgentMetrics,
  ClawMetricsDays,
  GlobalMetrics,
  ImprovementCandidate,
} from './clawMetricsTypes';

const USER_ID_HEADER = 'x-user-id';

const metricsParams = (days: ClawMetricsDays, orgScope?: AdminOrgScope): string => {
  const params = new URLSearchParams({ days: String(days) });
  if (orgScope === 'all') params.set('orgScope', 'all');
  return params.toString();
};

export function fetchGlobalMetrics(
  userId: string,
  days: ClawMetricsDays,
  orgScope?: AdminOrgScope,
): Promise<GlobalMetrics> {
  return clawRequest(`/api/v1/metrics/global?${metricsParams(days, orgScope)}`, {
    headers: { [USER_ID_HEADER]: userId },
  });
}

export function fetchAgentMetrics(
  userId: string,
  slug: string,
  days: ClawMetricsDays,
  orgScope?: AdminOrgScope,
): Promise<AgentMetrics> {
  return clawRequest(
    `/api/v1/metrics/agent/${encodeURIComponent(slug)}?${metricsParams(days, orgScope)}`,
    { headers: { [USER_ID_HEADER]: userId } },
  );
}

export async function fetchAgentImprovements(
  userId: string,
  slug: string,
): Promise<ImprovementCandidate[]> {
  const response = await clawRequest<{
    agentSlug: string;
    candidates: ImprovementCandidate[];
  }>(`/api/v1/metrics/agent/${encodeURIComponent(slug)}/improvements`, {
    headers: { [USER_ID_HEADER]: userId },
  });
  return response.candidates;
}

export async function applyImprovement(userId: string, id: string): Promise<void> {
  await clawRequest(`/api/v1/metrics/improvements/${encodeURIComponent(id)}/apply`, {
    method: 'POST',
    headers: { [USER_ID_HEADER]: userId },
  });
}

export async function dismissImprovement(
  userId: string,
  id: string,
  reason?: string,
): Promise<void> {
  await clawRequest(`/api/v1/metrics/improvements/${encodeURIComponent(id)}/dismiss`, {
    method: 'POST',
    headers: { [USER_ID_HEADER]: userId },
    ...(reason ? { body: JSON.stringify({ reason }) } : {}),
  });
}

export async function listMetricsAgentSlugs(
  userId: string,
  orgScope?: AdminOrgScope,
): Promise<string[]> {
  const params = new URLSearchParams({ userId, scope: 'all' });
  if (orgScope === 'all') params.set('orgScope', 'all');
  const [agents, metrics] = await Promise.all([
    clawApiRequest<Agent[]>(`/agents?${params.toString()}`).catch(() => []),
    fetchGlobalMetrics(userId, 30, orgScope).catch(() => null),
  ]);
  const slugs = new Set(agents.map(agent => agent.slug));
  metrics?.topAgents.forEach(agent => slugs.add(agent.agentSlug));
  return [...slugs].sort((a, b) => a.localeCompare(b));
}
