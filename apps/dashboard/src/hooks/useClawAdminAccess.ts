import { createContext, useContext } from 'react';
import { useQuery } from '@tanstack/react-query';
import { checkAdminAccess } from '@/services/claw/clawAdminService';
import type { AdminAccessFlags } from '@/services/claw/clawAdminTypes';

export interface ClawAdminAccess extends AdminAccessFlags {
  isLoading: boolean;
}

const DEFAULT_ACCESS: ClawAdminAccess = {
  isAdmin: false,
  hasSearchEvalAccess: false,
  isLoading: true,
};

export const ClawAdminAccessContext = createContext<ClawAdminAccess>(DEFAULT_ACCESS);

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

export function useClawAdminAccess(): ClawAdminAccess {
  return useContext(ClawAdminAccessContext);
}
