import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { apiInstance } from '../clients/apiClient';
import type { PendingHumanInterventionResponse } from '@xyne/shared';

export const usePendingHumanIntervention = (
  ticketId: string | undefined,
): UseQueryResult<PendingHumanInterventionResponse, Error> => {
  return useQuery<PendingHumanInterventionResponse, Error>({
    queryKey: ['pending-human-intervention', ticketId],
    queryFn: async (): Promise<PendingHumanInterventionResponse> => {
      if (!ticketId) {
        return { requiresIntervention: false, step: null };
      }
      const response = await apiInstance.get<PendingHumanInterventionResponse>(
        `/tickets/${ticketId}/pending-human-intervention`,
      );
      return response.data;
    },
    enabled: !!ticketId,
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
  });
};
