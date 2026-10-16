import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { apiInstance } from '../services/clients/apiClient';

export interface AiBudgetUsage {
  maxBudget: number | null;
  spend: number;
  budgetDuration: string | null;
  budgetResetAt: string | null;
  remaining: number | null;
}

export interface OrgAiUsage {
  provisioned: boolean;
  org: AiBudgetUsage | null;
  user: AiBudgetUsage | null;
}

export const useOrgAiUsage = (orgId: string): UseQueryResult<OrgAiUsage, Error> =>
  useQuery({
    queryKey: ['org-ai-usage', orgId],
    queryFn: async () => {
      const response = await apiInstance.get<OrgAiUsage>(`/organizations/${orgId}/ai-usage`);
      return response.data;
    },
    enabled: !!orgId,
    staleTime: 60 * 1000,
  });
