import { useQuery } from '@tanstack/react-query';
import { apiInstance } from '../services/clients/apiClient';

/**
 * Fetch the authenticated workspace logo and return it as a blob URL.
 *
 * Cache strategy mirrors the user profile-picture hook: the stored `logo` path
 * includes a timestamp and changes on every upload, so keying the query on it
 * guarantees a fresh fetch when the logo changes and a cache hit otherwise.
 */
export const useWorkspaceLogoUrl = (
  workspaceId: string | undefined,
  logoPath: string | null | undefined,
): {
  url: string | undefined;
  isLoading: boolean;
} => {
  const { data: blobUrl, isLoading } = useQuery<string | undefined>({
    queryKey: ['workspace-logo', workspaceId, logoPath],
    queryFn: async () => {
      if (!workspaceId || !logoPath) return undefined;

      const cacheParam = encodeURIComponent(logoPath);
      const url = `/workspaces/${workspaceId}/logo?v=${cacheParam}`;

      const response = await apiInstance.get(url, { responseType: 'blob' });
      const blob = response.data as Blob;
      return URL.createObjectURL(blob);
    },
    enabled: !!workspaceId && !!logoPath && !logoPath.startsWith('http'),
    staleTime: 10 * 60 * 1000,
  });

  const isHttpUrl = logoPath?.startsWith('http');
  const url = isHttpUrl ? (logoPath ?? undefined) : blobUrl;

  return { url, isLoading: isHttpUrl ? false : isLoading };
};
