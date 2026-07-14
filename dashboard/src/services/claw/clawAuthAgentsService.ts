import type {
  Agent,
  AgentShare,
  AgentRequestType,
  AgentShareRole,
  ClawUser,
  CloneAgentResult,
  CloneRequestItem,
  PromptVersion,
  UpdateAgentPayload,
} from './clawAuthAgentTypes';
import { clawApiRequest, clawRequest } from './clawRequest';
export { ClawApiError } from './clawRequest';

/**
 * Fetches the list of agents the given user can see. `userId` is the internal
 * Spaces user id (useAuth().user.id).
 */
export async function listClawAuthAgents(userId: string): Promise<Agent[]> {
  return clawApiRequest<Agent[]>(`/agents?userId=${encodeURIComponent(userId)}`);
}

/** Fetches a single agent's full detail by slug. */
export async function getClawAgentDetail(slug: string): Promise<Agent> {
  return clawApiRequest<Agent>(`/agents/${encodeURIComponent(slug)}`);
}

/**
 * Patches an agent (`PUT /agents/{slug}`). Send only changed fields. Returns the
 * updated agent. Requires edit permission server-side (throws 403 otherwise).
 */
export async function updateClawAgent(slug: string, payload: UpdateAgentPayload): Promise<Agent> {
  return clawApiRequest<Agent>(`/agents/${encodeURIComponent(slug)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

/** Deletes an agent (owner only). */
export async function deleteClawAgent(slug: string, userId: string): Promise<void> {
  await clawApiRequest<unknown>(`/agents/${encodeURIComponent(slug)}`, {
    method: 'DELETE',
    userId,
  });
}

/**
 * Clones an agent. Owners/contributors/admins get an instant copy; everyone
 * else raises an approval request routed to the owner (see {@link CloneAgentResult}).
 */
export async function cloneClawAgent(
  slug: string,
  userId: string,
  name?: string,
): Promise<CloneAgentResult> {
  const response = await clawRequest<{
    success: boolean;
    data: Agent | CloneRequestItem;
    cloned: boolean;
  }>(`/api/v1/agents/${encodeURIComponent(slug)}/clone`, {
    method: 'POST',
    headers: { 'x-user-id': userId },
    body: JSON.stringify({ name }),
  });
  return response.cloned
    ? { cloned: true, agent: response.data as Agent }
    : { cloned: false, request: response.data as CloneRequestItem };
}

/** Submits a push-to-Spaces / push-to-Global request (routed to an admin). */
export async function submitClawAgentRequest(
  slug: string,
  userId: string,
  requestType: AgentRequestType,
): Promise<void> {
  await clawApiRequest<unknown>(`/agents/${encodeURIComponent(slug)}/request`, {
    method: 'POST',
    userId,
    body: JSON.stringify({ requestType }),
  });
}

/** Lists the agent's contributor shares (used to derive permissions). */
export async function listClawAgentShares(slug: string, userId: string): Promise<AgentShare[]> {
  return clawApiRequest<AgentShare[]>(`/agents/${encodeURIComponent(slug)}/shares`, { userId });
}

/** Adds (or updates) a contributor share. Owner-gated server-side. */
export async function addClawAgentShare(
  slug: string,
  requesterId: string,
  targetUserId: string,
  role: AgentShareRole,
): Promise<AgentShare> {
  return clawApiRequest<AgentShare>(`/agents/${encodeURIComponent(slug)}/shares`, {
    method: 'POST',
    userId: requesterId,
    body: JSON.stringify({ userId: targetUserId, role }),
  });
}

/** Removes a contributor share. Owner-gated server-side. */
export async function removeClawAgentShare(
  slug: string,
  requesterId: string,
  targetUserId: string,
): Promise<void> {
  await clawApiRequest<unknown>(
    `/agents/${encodeURIComponent(slug)}/shares/${encodeURIComponent(targetUserId)}`,
    { method: 'DELETE', userId: requesterId },
  );
}

/** Searches claw-auth users for the contributor picker (min 2 chars upstream). */
export async function searchClawUsers(query: string, requesterId: string): Promise<ClawUser[]> {
  return clawApiRequest<ClawUser[]>(`/users?q=${encodeURIComponent(query)}`, {
    userId: requesterId,
  });
}

export async function promoteClawAgent(slug: string, userId: string): Promise<void> {
  await clawApiRequest<unknown>(`/agents/${encodeURIComponent(slug)}/promote`, {
    method: 'POST',
    userId,
  });
}

export async function demoteClawAgent(slug: string, userId: string): Promise<void> {
  await clawApiRequest<unknown>(`/agents/${encodeURIComponent(slug)}/demote`, {
    method: 'POST',
    userId,
  });
}

export function listIncomingCloneRequests(userId: string): Promise<CloneRequestItem[]> {
  return clawApiRequest<CloneRequestItem[]>('/agents/clone-requests/incoming', { userId });
}

export function listOutgoingCloneRequests(userId: string): Promise<CloneRequestItem[]> {
  return clawApiRequest<CloneRequestItem[]>('/agents/clone-requests/outgoing', { userId });
}

export function approveCloneRequest(requestId: string, userId: string): Promise<Agent | null> {
  return clawApiRequest<Agent | null>(
    `/agents/clone-requests/${encodeURIComponent(requestId)}/approve`,
    { method: 'POST', userId },
  );
}

export async function rejectCloneRequest(
  requestId: string,
  userId: string,
  note?: string,
): Promise<void> {
  await clawApiRequest<unknown>(`/agents/clone-requests/${encodeURIComponent(requestId)}/reject`, {
    method: 'POST',
    userId,
    body: JSON.stringify(note ? { note } : {}),
  });
}

export function getPromptVersions(
  slug: string,
): Promise<{ activeVersion: number | null; versions: PromptVersion[] }> {
  return clawApiRequest(`/agents/${encodeURIComponent(slug)}/prompt-versions`);
}

export function activatePromptVersion(slug: string, version: number): Promise<Agent> {
  return clawApiRequest(`/agents/${encodeURIComponent(slug)}/prompt-versions/${version}/activate`, {
    method: 'POST',
  });
}
