import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiInstance } from '../services/clients/apiClient';

interface SlackUserStatus {
  connected: boolean;
  providerUserId?: string;
  connectedAt?: string;
}

export const SLACK_USER_AUTH_QUERY_KEY = ['slack-user-auth', 'status'];

export function useSlackUserAuth() {
  return useQuery({
    queryKey: SLACK_USER_AUTH_QUERY_KEY,
    queryFn: async (): Promise<SlackUserStatus> => {
      const { data } = await apiInstance.get<SlackUserStatus>('/integrations/slack-user/status');
      return data;
    },
    staleTime: 5 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
}

export function useDisconnectSlackUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      await apiInstance.delete('/integrations/slack-user/disconnect');
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SLACK_USER_AUTH_QUERY_KEY });
    },
  });
}
