import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useAuth } from './useAuth';
import {
  applyImprovement,
  dismissImprovement,
  fetchAgentImprovements,
  fetchAgentMetrics,
  fetchGlobalMetrics,
  listMetricsAgentSlugs,
} from '../services/claw/clawMetricsService';
import type {
  AdminOrgScope,
  AgentMetrics,
  ClawMetricsDays,
  GlobalMetrics,
  ImprovementCandidate,
} from '../services/claw/clawMetricsTypes';

export const clawAgentImprovementsKey = (
  slug: string | undefined,
  userId: string | undefined,
): readonly unknown[] => ['claw-agent-improvements', slug, userId];

export const useClawGlobalMetrics = (
  days: ClawMetricsDays,
  orgScope: AdminOrgScope,
): UseQueryResult<GlobalMetrics, Error> => {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['claw-metrics-global', days, orgScope, user?.id],
    queryFn: () => fetchGlobalMetrics(user!.id, days, orgScope),
    enabled: !!user?.id,
    staleTime: 30 * 1000,
  });
};

export const useClawAgentMetrics = (
  slug: string | undefined,
  days: ClawMetricsDays,
  orgScope: AdminOrgScope,
): UseQueryResult<AgentMetrics, Error> => {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['claw-metrics-agent', slug, days, orgScope, user?.id],
    queryFn: () => fetchAgentMetrics(user!.id, slug!, days, orgScope),
    enabled: !!user?.id && !!slug,
    staleTime: 30 * 1000,
  });
};

export const useClawMetricsAgentSlugs = (
  orgScope: AdminOrgScope,
): UseQueryResult<string[], Error> => {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['claw-metrics-agent-slugs', orgScope, user?.id],
    queryFn: () => listMetricsAgentSlugs(user!.id, orgScope),
    enabled: !!user?.id,
    staleTime: 60 * 1000,
  });
};

export const useClawAgentImprovements = (
  slug: string | undefined,
): UseQueryResult<ImprovementCandidate[], Error> => {
  const { user } = useAuth();
  return useQuery({
    queryKey: clawAgentImprovementsKey(slug, user?.id),
    queryFn: () => fetchAgentImprovements(user!.id, slug!),
    enabled: !!user?.id && !!slug,
    staleTime: 30 * 1000,
    retry: false,
  });
};

export const useApplyImprovement = (slug: string): UseMutationResult<void, Error, string> => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => applyImprovement(user!.id, id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: clawAgentImprovementsKey(slug, user?.id) });
    },
  });
};

export const useDismissImprovement = (
  slug: string,
): UseMutationResult<void, Error, { id: string; reason?: string }> => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      dismissImprovement(user!.id, id, reason),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: clawAgentImprovementsKey(slug, user?.id) });
    },
  });
};
