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
  listClawOrganizations,
  removeClawOrganizationMember,
  updateClawOrganizationMemberRole,
} from '../services/claw/clawOrgService';
import type { AddableOrgRole, ClawOrganization, OrgRole } from '../services/claw/clawOrgTypes';

export const clawOrganizationKey = (userId: string | undefined): readonly unknown[] => [
  'claw-organization',
  userId,
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

const useInvalidateClawOrganization = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return (): Promise<void> =>
    queryClient.invalidateQueries({ queryKey: clawOrganizationKey(user?.id) });
};

export const useAddClawOrganizationMember = (
  orgId: string,
): UseMutationResult<void, Error, { userIdOrEmail: string; role: AddableOrgRole }> => {
  const { user } = useAuth();
  const invalidate = useInvalidateClawOrganization();
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
  const invalidate = useInvalidateClawOrganization();
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
  const invalidate = useInvalidateClawOrganization();
  return useMutation({
    mutationFn: targetUserId => removeClawOrganizationMember(orgId, targetUserId, user!.id),
    onSuccess: invalidate,
  });
};
