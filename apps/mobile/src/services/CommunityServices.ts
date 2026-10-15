/**
 * Community workspace REST calls (`/api/community/*`).
 *
 * The listing endpoint is deliberately public — no auth middleware is mounted on it server-side —
 * which is what lets the community landing screen render before the user signs in. The join call
 * itself lives in `AuthServices.ts` because it completes an auth session.
 */

import { apiGet, apiPost } from './apiClient';

export const WorkspaceJoinPolicy = {
  INVITE_ONLY: 'INVITE_ONLY',
  OPEN: 'OPEN',
  REQUEST_TO_JOIN: 'REQUEST_TO_JOIN',
} as const;
export type WorkspaceJoinPolicy = (typeof WorkspaceJoinPolicy)[keyof typeof WorkspaceJoinPolicy];

export const CommunityJoinResultStatus = {
  JOINED: 'JOINED',
  REQUEST_PENDING: 'REQUEST_PENDING',
  REQUEST_REJECTED: 'REQUEST_REJECTED',
} as const;
export type CommunityJoinResultStatus =
  (typeof CommunityJoinResultStatus)[keyof typeof CommunityJoinResultStatus];

export const WorkspaceJoinRequestStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
} as const;
export type WorkspaceJoinRequestStatus =
  (typeof WorkspaceJoinRequestStatus)[keyof typeof WorkspaceJoinRequestStatus];

export const WorkspaceJoinRequestAction = {
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
} as const;
export type WorkspaceJoinRequestAction =
  (typeof WorkspaceJoinRequestAction)[keyof typeof WorkspaceJoinRequestAction];

export interface CommunityWorkspace {
  id: string;
  name: string;
  description?: string | null;
  joinPolicy?: WorkspaceJoinPolicy | null;
  landingChannelId?: string | null;
}

export interface CommunityWorkspaceOrganization {
  orgId: string;
  orgName: string;
  workspaces: CommunityWorkspace[];
}

export interface WorkspaceJoinRequestItem {
  id: string;
  workspaceId: string;
  email: string;
  status: WorkspaceJoinRequestStatus;
  reviewNote?: string | null;
  createdAt: string;
  updatedAt: string;
  workspaceName?: string | null;
  workspaceType?: string | null;
}

interface CommunityWorkspacesResponse {
  organizations?: CommunityWorkspaceOrganization[];
}

interface JoinRequestsResponse {
  success: boolean;
  requests?: WorkspaceJoinRequestItem[];
}

interface ReviewJoinRequestResponse {
  success: boolean;
  status: WorkspaceJoinRequestStatus;
  approved: boolean;
}

/** Public — intentionally sends no token so it works on the signed-out landing screen. */
export async function listCommunityWorkspaces(): Promise<CommunityWorkspaceOrganization[]> {
  const data = await apiGet<CommunityWorkspacesResponse>('/community/workspaces');
  return data.organizations ?? [];
}

/** Flattens the org-grouped listing into the flat row list the landing screen renders. */
export function flattenCommunityWorkspaces(
  organizations: CommunityWorkspaceOrganization[],
): CommunityWorkspace[] {
  return organizations.flatMap(organization => organization.workspaces ?? []);
}

export async function listOrgJoinRequests(
  input: { orgId: string; status?: WorkspaceJoinRequestStatus },
  token: string,
): Promise<WorkspaceJoinRequestItem[]> {
  const params = new URLSearchParams({ orgId: input.orgId });
  if (input.status) {
    params.set('status', input.status);
  }
  const data = await apiGet<JoinRequestsResponse>(`/community/join-requests?${params.toString()}`, {
    token,
  });
  return data.requests ?? [];
}

export async function reviewJoinRequest(
  input: {
    workspaceId: string;
    requestId: string;
    action: WorkspaceJoinRequestAction;
    reviewNote?: string;
  },
  token: string,
): Promise<ReviewJoinRequestResponse> {
  const body: { action: string; reviewNote?: string } = { action: input.action };
  if (input.reviewNote) {
    body.reviewNote = input.reviewNote;
  }
  return apiPost<ReviewJoinRequestResponse>(
    `/community/${encodeURIComponent(input.workspaceId)}/join-requests/${encodeURIComponent(
      input.requestId,
    )}/review`,
    body,
    { token },
  );
}
