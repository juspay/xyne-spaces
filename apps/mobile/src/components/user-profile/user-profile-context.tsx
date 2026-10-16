import { createContext, useContext } from 'react';

import type { UserProfileContextValue } from './user-profile.types';

const UserProfileContext = createContext<UserProfileContextValue | null>(null);

const useUserProfile = (): UserProfileContextValue => {
  const ctx = useContext(UserProfileContext);
  if (!ctx) {
    throw new Error('useUserProfile must be used within <UserProfile.Root>');
  }
  return ctx;
};

export { UserProfileContext, useUserProfile };
