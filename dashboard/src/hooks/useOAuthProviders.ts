import { useQuery, UseQueryResult } from '@tanstack/react-query';
import axios from 'axios';
import { API_BASE_URL } from '../config';

export interface OAuthProviders {
  google: boolean;
  microsoft: boolean;
}

export const useOAuthProviders = (): UseQueryResult<OAuthProviders> => {
  return useQuery({
    queryKey: ['oauth', 'providers'],
    queryFn: async (): Promise<OAuthProviders> => {
      const response = await axios.get<OAuthProviders>(`${API_BASE_URL}/v2/auth/providers`, {
        withCredentials: true,
      });
      return response.data;
    },
    staleTime: Infinity,
    retry: 1,
    refetchOnWindowFocus: false,
  });
};
