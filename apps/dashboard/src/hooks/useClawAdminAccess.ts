import { useQuery } from '@tanstack/react-query';
import { checkAdminAccess } from '@/services/claw/clawAdminService';
import type { AdminAccessFlags } from '@/services/claw/clawAdminTypes';

export interface ClawAdminAccess extends AdminAccessFlags {
  isLoading: boolean;
}

export const clawAdminAccessKey = (userId: string | undefined): unknown[] => [
  'claw-admin-access',
  userId ?? 'anonymous',
];

export function useClawAdminAccessQuery(userId: string | undefined): ClawAdminAccess {
  const { data, isPending } = useQuery({
    queryKey: clawAdminAccessKey(userId),
    queryFn: () => checkAdminAccess(userId as string),
    enabled: Boolean(userId),
    staleTime: 5 * 60 * 1000,
  });

  if (!userId) return { isAdmin: false, hasSearchEvalAccess: false, isLoading: false };
  return {
    isAdmin: data?.isAdmin ?? false,
    hasSearchEvalAccess: data?.hasSearchEvalAccess ?? false,
    isLoading: isPending,
  };
}
