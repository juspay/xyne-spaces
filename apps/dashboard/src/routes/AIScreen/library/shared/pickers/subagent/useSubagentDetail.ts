import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { getClawSubagent } from '@/services/claw/clawSubagentsService';
import type { SubagentDef } from '@/services/claw/clawSubagentsTypes';

export interface SubagentDetail {
  def: SubagentDef | undefined;
  loading: boolean;
}

export function useSubagentDetail(name: string, fallback: SubagentDef | undefined): SubagentDetail {
  const { user } = useAuth();
  const userId = user?.id;

  const query = useQuery({
    queryKey: ['claw-subagent-detail', userId, name],
    queryFn: () => getClawSubagent(name, userId as string),
    enabled: Boolean(name && userId),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  return {
    def: query.data ?? fallback,
    loading: query.isLoading && !fallback,
  };
}
