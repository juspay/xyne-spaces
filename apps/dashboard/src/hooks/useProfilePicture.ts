import { useQuery } from '@tanstack/react-query';
import { apiInstance } from '../services/clients/apiClient';

/**
 * Hook to fetch authenticated profile picture and return as blob URL
 * Cache strategy mirrors emoji service with content-addressed caching:
 * - Picture path includes timestamp, so it changes with each upload
 * - Include picturePath as query param to make URL unique per picture
 * - URL changes = browser never has it cached = always fresh
 */
export const useProfilePictureUrl = (
  userId: string | undefined,
  picturePath: string | null | undefined,
): {
  url: string | undefined;
  isLoading: boolean;
} => {
  const { data: blobUrl, isLoading } = useQuery<string | undefined>({
    queryKey: ['profile-picture', userId, picturePath],
    queryFn: async () => {
      if (!userId || !picturePath) return undefined;

      // Cache-bust with picturePath (includes timestamp)
      // When picture updates, picturePath changes → different URL → no cache hit
      const cacheParam = encodeURIComponent(picturePath);
      const url = `/users/${userId}/picture?v=${cacheParam}`;

      const response = await apiInstance.get(url, {
        responseType: 'blob',
      });

      const blob = response.data as Blob;
      return URL.createObjectURL(blob);
    },
    enabled: !!userId && !!picturePath && !picturePath.startsWith('http'),
    staleTime: 10 * 60 * 1000,
  });

  // If picturePath is an absolute URL, return it directly
  const isHttpUrl = picturePath?.startsWith('http');
  const url = isHttpUrl ? (picturePath ?? undefined) : blobUrl;

  return { url, isLoading: isHttpUrl ? false : isLoading };
};
