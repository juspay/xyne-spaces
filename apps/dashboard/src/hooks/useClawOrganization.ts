import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useAuth } from './useAuth';
import {
  addClawOrganizationMember,
  getClawOrganization,
  listClawOrganizationServiceTokens,
  listClawOrganizationSurfaces,
  listClawOrganizations,
  removeClawOrganizationMember,
  mintClawOrganizationServiceToken,
  revokeClawOrganizationServiceToken,
  storeClawSlackConfigToken,
  updateClawOrganizationMemberRole,
} from '../services/claw/clawOrgService';
import type {
  AddableOrgRole,
  ClawOrganization,
  ConnectedSurface,
  MintedServiceAccessToken,
  MintServiceAccessTokenInput,
  OrgMemberRow,
  OrgMembersPage,
  OrgMembersQuery,
  OrgRole,
  OrgSummary,
  ServiceAccessToken,
} from '../services/claw/clawOrgTypes';

export const clawOrganizationKey = (userId: string | undefined): readonly unknown[] => [
  'claw-organization',
  userId,
];

export const clawOrganizationSurfacesKey = (
  orgId: string,
  userId: string | undefined,
): readonly unknown[] => ['claw-organization-surfaces', orgId, userId];

export const clawOrganizationServiceTokensKey = (
  orgId: string,
  userId: string | undefined,
): readonly unknown[] => ['claw-organization-service-tokens', orgId, userId];

export const clawOrganizationDetailKey = (orgId: string): readonly unknown[] => [
  'claw-organization-detail',
  orgId,
];

export const useClawOrganization = (): UseQueryResult<ClawOrganization | null, Error> => {
  const { user } = useAuth();
  const userId = user?.id;

  return useQuery({
    queryKey: clawOrganizationKey(userId),
    queryFn: async () => {
      const organizations = await listClawOrganizations(userId!);
      const summary = organizations[0];
      if (!summary) return null;
      const detail = await getClawOrganization(summary.id, userId!);
      return { summary, detail };
    },
    enabled: !!userId,
    staleTime: 30 * 1000,
  });
};

export const useClawOrganizationSurfaces = (
  orgId: string,
  enabled: boolean,
): UseQueryResult<ConnectedSurface[], Error> => {
  const { user } = useAuth();
  const userId = user?.id;

  return useQuery({
    queryKey: clawOrganizationSurfacesKey(orgId, userId),
    queryFn: () => listClawOrganizationSurfaces(orgId, userId!),
    enabled: enabled && !!orgId && !!userId,
    staleTime: 30 * 1000,
  });
};

export const useStoreClawSlackConfigToken = (
  orgId: string,
): UseMutationResult<void, Error, { accessToken: string; refreshToken: string }> => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ accessToken, refreshToken }) =>
      storeClawSlackConfigToken(orgId, accessToken, refreshToken, user!.id),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: clawOrganizationSurfacesKey(orgId, user?.id),
      }),
  });
};

export const useClawOrganizationServiceTokens = (
  orgId: string,
  enabled: boolean,
): UseQueryResult<ServiceAccessToken[], Error> => {
  const { user } = useAuth();
  const userId = user?.id;

  return useQuery({
    queryKey: clawOrganizationServiceTokensKey(orgId, userId),
    queryFn: () => listClawOrganizationServiceTokens(orgId, userId!),
    enabled: enabled && !!orgId && !!userId,
    staleTime: 30 * 1000,
  });
};

export const useMintClawOrganizationServiceToken = (
  orgId: string,
): UseMutationResult<MintedServiceAccessToken, Error, MintServiceAccessTokenInput> => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: input => mintClawOrganizationServiceToken(orgId, input, user!.id),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: clawOrganizationServiceTokensKey(orgId, user?.id),
      }),
  });
};

export const useRevokeClawOrganizationServiceToken = (
  orgId: string,
): UseMutationResult<void, Error, string> => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: tokenId => revokeClawOrganizationServiceToken(orgId, tokenId, user!.id),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: clawOrganizationServiceTokensKey(orgId, user?.id),
      }),
  });
};

export const clawOrganizationSummaryKey = (userId: string | undefined): readonly unknown[] => [
  'claw-organization-summary',
  userId,
];

export const useClawOrganizationSummary = (): UseQueryResult<OrgSummary | null, Error> => {
  const { user } = useAuth();
  const userId = user?.id;

  return useQuery({
    queryKey: clawOrganizationSummaryKey(userId),
    queryFn: async () => (await listClawOrganizations(userId!))[0] ?? null,
    enabled: !!userId,
    staleTime: 30 * 1000,
  });
};

export const useClawOrgManageAccess = (): { canManage: boolean; isLoading: boolean } => {
  const { data, isPending } = useClawOrganizationSummary();
  const role = data?.role;
  return { canManage: role === 'OWNER' || role === 'ADMIN', isLoading: isPending };
};

const pageMembers = (members: OrgMemberRow[], { q, limit, offset = 0 }: OrgMembersQuery) => {
  const needle = q?.trim().toLowerCase() ?? '';
  const matched = needle
    ? members.filter(member => `${member.name} ${member.email}`.toLowerCase().includes(needle))
    : members;
  return {
    rows: limit === undefined ? matched.slice(offset) : matched.slice(offset, offset + limit),
    total: matched.length,
  };
};

export const useClawOrganizationMembers = (
  orgId: string,
  query: OrgMembersQuery,
  enabled = true,
): UseQueryResult<OrgMembersPage, Error> => {
  const { user } = useAuth();
  const userId = user?.id;

  return useQuery({
    queryKey: clawOrganizationDetailKey(orgId),
    queryFn: () => getClawOrganization(orgId, userId!),
    select: detail => pageMembers(detail.members, query),
    enabled: enabled && !!userId && !!orgId,
    staleTime: 30 * 1000,
  });
};

const useInvalidateClawOrganization = (orgId: string) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: clawOrganizationKey(user?.id) });
    await queryClient.invalidateQueries({ queryKey: clawOrganizationSummaryKey(user?.id) });
    await queryClient.invalidateQueries({ queryKey: clawOrganizationDetailKey(orgId) });
  };
};

export const useAddClawOrganizationMember = (
  orgId: string,
): UseMutationResult<void, Error, { userIdOrEmail: string; role: AddableOrgRole }> => {
  const { user } = useAuth();
  const invalidate = useInvalidateClawOrganization(orgId);
  return useMutation({
    mutationFn: ({ userIdOrEmail, role }) =>
      addClawOrganizationMember(orgId, userIdOrEmail, role, user!.id),
    onSuccess: invalidate,
  });
};

export const useUpdateClawOrganizationMemberRole = (
  orgId: string,
): UseMutationResult<void, Error, { targetUserId: string; role: OrgRole }> => {
  const { user } = useAuth();
  const invalidate = useInvalidateClawOrganization(orgId);
  return useMutation({
    mutationFn: ({ targetUserId, role }) =>
      updateClawOrganizationMemberRole(orgId, targetUserId, role, user!.id),
    onSuccess: invalidate,
  });
};

export const useRemoveClawOrganizationMember = (
  orgId: string,
): UseMutationResult<void, Error, string> => {
  const { user } = useAuth();
  const invalidate = useInvalidateClawOrganization(orgId);
  return useMutation({
    mutationFn: targetUserId => removeClawOrganizationMember(orgId, targetUserId, user!.id),
    onSuccess: invalidate,
  });
};
