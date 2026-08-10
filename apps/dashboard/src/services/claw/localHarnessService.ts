import { clawRequest } from './clawRequest';
import { listClawAuthAgents } from './clawAuthAgentsService';
import type { Agent } from './clawAuthAgentTypes';

const USER_ID_HEADER = 'x-user-id';

export async function setUserAgentProvider(
  slug: string,
  userId: string,
  provider: string,
): Promise<{ provider: string }> {
  const body = await clawRequest<{ success: boolean; data: { provider: string } }>(
    `/api/v1/agents/${encodeURIComponent(slug)}/user-config/${encodeURIComponent(userId)}`,
    {
      method: 'PUT',
      headers: { [USER_ID_HEADER]: userId },
      body: JSON.stringify({ provider }),
    },
  );
  return body.data;
}

export async function getUserAgentProvider(slug: string, userId: string): Promise<string> {
  const body = await clawRequest<{ success: boolean; data: { provider: string } }>(
    `/api/v1/agents/${encodeURIComponent(slug)}/user-config/${encodeURIComponent(userId)}`,
    { headers: { [USER_ID_HEADER]: userId } },
  );
  return body.data.provider;
}

export async function clearUserAgentProvider(slug: string, userId: string): Promise<void> {
  await clawRequest<{ success: boolean }>(
    `/api/v1/agents/${encodeURIComponent(slug)}/user-config/${encodeURIComponent(userId)}`,
    { method: 'DELETE', headers: { [USER_ID_HEADER]: userId } },
  );
}

export async function findDefaultAgent(userId: string): Promise<Agent | null> {
  const agents = await listClawAuthAgents(userId);
  const enabled = agents.filter(agent => agent.enabled);
  return enabled.find(agent => agent.isDefault) ?? enabled[0] ?? null;
}
