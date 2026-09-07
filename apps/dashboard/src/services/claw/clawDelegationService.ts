import { clawApiRequest, clawRequest } from './clawRequest';
import type { AgentDelegationGrant, CreateDelegationGrantInput } from './clawDelegationTypes';

const agentPath = (slug: string): string => `/agents/${encodeURIComponent(slug)}`;

/** Outgoing: agents this agent may delegate to, with their approval state. */
export async function listDelegationGrants(
  slug: string,
  userId: string,
): Promise<AgentDelegationGrant[]> {
  return clawApiRequest<AgentDelegationGrant[]>(`${agentPath(slug)}/delegation-grants`, {
    userId,
  });
}

/**
 * Request delegation from `slug` to `input.calleeSlug`. Auto-approves when the
 * requester owns both agents; otherwise the callee's owner is notified and the
 * grant comes back `pending`.
 */
export async function createDelegationGrant(
  slug: string,
  userId: string,
  input: CreateDelegationGrantInput,
): Promise<AgentDelegationGrant> {
  return clawApiRequest<AgentDelegationGrant>(`${agentPath(slug)}/delegation-grants`, {
    method: 'POST',
    userId,
    body: JSON.stringify({
      calleeSlug: input.calleeSlug,
      identityMode: input.identityMode ?? 'user',
      ...(input.requestReason ? { requestReason: input.requestReason } : {}),
    }),
  });
}

export async function deleteDelegationGrant(
  slug: string,
  grantId: string,
  userId: string,
): Promise<void> {
  await clawRequest<{ success: boolean }>(
    `/api/v1${agentPath(slug)}/delegation-grants/${encodeURIComponent(grantId)}`,
    { method: 'DELETE', headers: { 'x-user-id': userId } },
  );
}

/** Incoming: who has asked to call this agent (pending + approved). */
export async function listDelegationRequests(
  slug: string,
  userId: string,
): Promise<AgentDelegationGrant[]> {
  return clawApiRequest<AgentDelegationGrant[]>(`${agentPath(slug)}/delegation-requests`, {
    userId,
  });
}

/** Every pending request across all agents the user owns. */
export async function listPendingDelegationRequestsForMe(
  userId: string,
): Promise<AgentDelegationGrant[]> {
  return clawApiRequest<AgentDelegationGrant[]>('/agents/delegation-requests/pending-for-me', {
    userId,
  });
}

export async function decideDelegationRequest(
  slug: string,
  grantId: string,
  approve: boolean,
  userId: string,
): Promise<AgentDelegationGrant> {
  return clawApiRequest<AgentDelegationGrant>(
    `${agentPath(slug)}/delegation-requests/${encodeURIComponent(grantId)}/decision`,
    { method: 'POST', userId, body: JSON.stringify({ approve }) },
  );
}

/** Withdraw an already-approved delegation. */
export async function revokeDelegation(
  slug: string,
  grantId: string,
  userId: string,
): Promise<AgentDelegationGrant> {
  return clawApiRequest<AgentDelegationGrant>(
    `${agentPath(slug)}/delegation-requests/${encodeURIComponent(grantId)}/revoke`,
    { method: 'POST', userId },
  );
}
