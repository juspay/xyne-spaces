import { useAuth } from '@/src/contexts/AuthContext';
import { useUser } from '@/src/hooks/useUsers';
import { useUserProfile as useUserProfileQuery } from '@/src/hooks/useUserProfile';
import { useUserPresence } from '@/src/hooks/usePresence';

import type { UserProfileContextValue } from '../user-profile.types';

const useUserProfileData = (userId: string): UserProfileContextValue => {
  const { user: authUser } = useAuth();
  const user = useUser(userId);
  const profile = useUserProfileQuery(userId);
  const { status: presenceStatus, isOnline } = useUserPresence(userId);
  const isOwnProfile = authUser?.user_id === userId;

  return {
    userId,
    user,
    profile,
    isOwnProfile,
    isOnline,
    presenceStatus,
  };
};

export { useUserProfileData };
