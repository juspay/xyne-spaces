import { useUserSnapshot } from '@/src/components/ui/avatar/avatar.utils';
import { useProfilePictureUri } from '@/src/hooks/useProfilePictureUri';

function getMetadataPicture(metadata: string | undefined): string | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata) as { picture?: string } | null;
    return parsed?.picture || null;
  } catch {
    return null;
  }
}

/**
 * A participant's photo as a loadable URI. LiveKit identity is the app user id, so prefer the
 * synced user's picture and fall back to whatever the token metadata carried. Uploaded photos
 * are storage paths that need the authenticated fetch, which `useProfilePictureUri` handles.
 */
export function useParticipantPicture(userId: string, metadata?: string): string | null {
  const storeUser = useUserSnapshot(userId);
  const picturePath = storeUser?.picture || getMetadataPicture(metadata);
  return useProfilePictureUri(userId, picturePath);
}
