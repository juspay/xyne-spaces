import { clawApiRequest, clawRequest } from './clawRequest';
import type {
  AddableOrgRole,
  ConnectedSurface,
  MintedServiceAccessToken,
  MintServiceAccessTokenInput,
  OrgDetail,
  OrgRole,
  OrgSummary,
  ServiceAccessToken,
} from './clawOrgTypes';

export const listClawOrganizations = (userId: string): Promise<OrgSummary[]> =>
  clawApiRequest<OrgSummary[]>('/organizations', { userId });

export const getClawOrganization = (orgId: string, userId: string): Promise<OrgDetail> =>
  clawApiRequest<OrgDetail>(`/organizations/${encodeURIComponent(orgId)}`, { userId });

export const listClawOrganizationSurfaces = (
  orgId: string,
  userId: string,
): Promise<ConnectedSurface[]> =>
  clawRequest<ConnectedSurface[]>(`/api/v1/organizations/${encodeURIComponent(orgId)}/surfaces`, {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    headers: { 'x-user-id': userId },
  });

export const storeClawSlackConfigToken = async (
  orgId: string,
  accessToken: string,
  refreshToken: string,
  userId: string,
): Promise<void> => {
  await clawApiRequest<unknown>('/surfaces/slack/config-token', {
    method: 'POST',
    userId,
    body: JSON.stringify({ orgId, accessToken, refreshToken }),
  });
};

export const listClawOrganizationServiceTokens = (
  orgId: string,
  userId: string,
): Promise<ServiceAccessToken[]> =>
  clawApiRequest<ServiceAccessToken[]>(
    `/organizations/${encodeURIComponent(orgId)}/service-tokens`,
    { userId },
  );

export const mintClawOrganizationServiceToken = (
  orgId: string,
  input: MintServiceAccessTokenInput,
  userId: string,
): Promise<MintedServiceAccessToken> =>
  clawApiRequest<MintedServiceAccessToken>(
    `/organizations/${encodeURIComponent(orgId)}/service-tokens`,
    {
      method: 'POST',
      userId,
      body: JSON.stringify(input),
    },
  );

export const revokeClawOrganizationServiceToken = async (
  orgId: string,
  tokenId: string,
  userId: string,
): Promise<void> => {
  await clawApiRequest<unknown>(
    `/organizations/${encodeURIComponent(orgId)}/service-tokens/${encodeURIComponent(tokenId)}`,
    { method: 'DELETE', userId },
  );
};

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
