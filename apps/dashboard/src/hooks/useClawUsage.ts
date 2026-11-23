import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useAuth } from './useAuth';
import { ClawApiError } from '../services/claw/clawRequest';
import {
  deleteUsagePrice,
  fetchUsageBreakdown,
  fetchUsageOptions,
  fetchUsagePrices,
  fetchUsageSeries,
  fetchUsageSession,
  fetchUsageSummary,
  fetchUsageTools,
  saveUsagePrice,
  type BreakdownOptions,
  type GroupBy,
  type ModelPrice,
  type PriceInput,
  type SessionTimeline,
  type ToolUsageRow,
  type UsageBreakdown,
  type UsageFilterParams,
  type UsageOptions,
  type UsagePrices,
  type UsageSeries,
  type UsageSummary,
} from '../services/claw/clawUsageService';

export const CLAW_USAGE_KEY = 'claw-usage';

const shared = { staleTime: 30_000, placeholderData: keepPreviousData } as const;

export const useUsageSummary = (p: UsageFilterParams): UseQueryResult<UsageSummary, Error> => {
  const { user } = useAuth();
  return useQuery({
    queryKey: [CLAW_USAGE_KEY, 'summary', p, user?.id],
    queryFn: () => fetchUsageSummary(user!.id, p),
    enabled: !!user?.id,
    ...shared,
  });
};

export const useUsageSeries = (
  p: UsageFilterParams,
  groupBy: GroupBy,
): UseQueryResult<UsageSeries, Error> => {
  const { user } = useAuth();
  return useQuery({
    queryKey: [CLAW_USAGE_KEY, 'series', p, groupBy, user?.id],
    queryFn: () => fetchUsageSeries(user!.id, p, groupBy),
    enabled: !!user?.id,
    ...shared,
  });
};

export const useUsageBreakdown = (
  p: UsageFilterParams,
  o: BreakdownOptions,
): UseQueryResult<UsageBreakdown, Error> => {
  const { user } = useAuth();
  return useQuery({
    queryKey: [CLAW_USAGE_KEY, 'breakdown', p, o, user?.id],
    queryFn: () => fetchUsageBreakdown(user!.id, p, o),
    enabled: !!user?.id,
    ...shared,
  });
};

export const useUsageSession = (
  conversationId: string | undefined,
  tz: string,
): UseQueryResult<SessionTimeline, Error> => {
  const { user } = useAuth();
  return useQuery({
    queryKey: [CLAW_USAGE_KEY, 'session', conversationId, tz, user?.id],
    queryFn: () => fetchUsageSession(user!.id, conversationId!, { tz }),
    enabled: !!user?.id && !!conversationId,
    staleTime: 30_000,
    retry: (count, error) => !(error instanceof ClawApiError && error.status === 404) && count < 2,
  });
};

export const useUsageTools = (p: UsageFilterParams): UseQueryResult<ToolUsageRow[], Error> => {
  const { user } = useAuth();
  return useQuery({
    queryKey: [CLAW_USAGE_KEY, 'tools', p, user?.id],
    queryFn: async () => (await fetchUsageTools(user!.id, p)).rows,
    enabled: !!user?.id,
    ...shared,
  });
};

export const useUsageOptions = (
  p: Pick<UsageFilterParams, 'from' | 'to' | 'tz'>,
): UseQueryResult<UsageOptions, Error> => {
  const { user } = useAuth();
  return useQuery({
    queryKey: [CLAW_USAGE_KEY, 'options', p.from, p.to, p.tz, user?.id],
    queryFn: () => fetchUsageOptions(user!.id, p),
    enabled: !!user?.id,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
};

export const useUsagePrices = (): UseQueryResult<UsagePrices, Error> => {
  const { user } = useAuth();
  return useQuery({
    queryKey: [CLAW_USAGE_KEY, 'prices', user?.id],
    queryFn: () => fetchUsagePrices(user!.id),
    enabled: !!user?.id,
    staleTime: 30_000,
  });
};

/** A price change reprices stored calls, so every usage query is stale afterwards. */
export const useSaveUsagePrice = (): UseMutationResult<
  { price: ModelPrice; repriced: number },
  Error,
  PriceInput
> => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PriceInput) => saveUsagePrice(user!.id, input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: [CLAW_USAGE_KEY] }),
  });
};

export const useDeleteUsagePrice = (): UseMutationResult<{ repriced: number }, Error, string> => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteUsagePrice(user!.id, id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: [CLAW_USAGE_KEY] }),
  });
};
