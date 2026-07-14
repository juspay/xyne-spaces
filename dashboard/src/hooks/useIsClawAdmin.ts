import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { checkIsClawAdmin } from '../services/claw/clawSkillsService';
import { useAuth } from './useAuth';

/** Shared claw-admin lookup used when deriving owner-equivalent permissions. */
export const useIsClawAdmin = (): UseQueryResult<boolean, Error> => {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['claw-admin-status', user?.id],
    queryFn: () => checkIsClawAdmin(user!.id),
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
  });
};
