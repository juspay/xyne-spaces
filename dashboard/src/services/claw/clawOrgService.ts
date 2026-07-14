import { clawApiRequest } from './clawRequest';
import type { AddableOrgRole, OrgDetail, OrgRole, OrgSummary } from './clawOrgTypes';

export const listClawOrganizations = (userId: string): Promise<OrgSummary[]> =>
  clawApiRequest<OrgSummary[]>('/organizations', { userId });

export const getClawOrganization = (orgId: string, userId: string): Promise<OrgDetail> =>
  clawApiRequest<OrgDetail>(`/organizations/${encodeURIComponent(orgId)}`, { userId });

export const addClawOrganizationMember = async (
  orgId: string,
  userIdOrEmail: string,
  role: AddableOrgRole,
  userId: string,
): Promise<void> => {
  await clawApiRequest<unknown>(`/organizations/${encodeURIComponent(orgId)}/members`, {
    method: 'POST',
    userId,
    body: JSON.stringify({ userIdOrEmail, role }),
  });
};

export const updateClawOrganizationMemberRole = async (
  orgId: string,
  targetUserId: string,
  role: OrgRole,
  userId: string,
): Promise<void> => {
  await clawApiRequest<unknown>(
    `/organizations/${encodeURIComponent(orgId)}/members/${encodeURIComponent(targetUserId)}`,
    {
      method: 'PATCH',
      userId,
      body: JSON.stringify({ role }),
    },
  );
};

export const removeClawOrganizationMember = async (
  orgId: string,
  targetUserId: string,
  userId: string,
): Promise<void> => {
  await clawApiRequest<unknown>(
    `/organizations/${encodeURIComponent(orgId)}/members/${encodeURIComponent(targetUserId)}`,
    { method: 'DELETE', userId },
  );
};
