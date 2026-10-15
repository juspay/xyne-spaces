export type ProfileActionId = 'message' | 'info' | 'call';

export type ProfileActionFlags = {
  isOwnProfile: boolean;
  hasUserId: boolean;
};

export const profileActionEnabled = (id: ProfileActionId, flags: ProfileActionFlags): boolean => {
  if (id === 'info') {
    return flags.hasUserId;
  }
  return !flags.isOwnProfile;
};

/** Own profile cannot call. Already-in-a-call is an alert, not a disabled tile. */
export const profileCallBlockedReason = (
  isOwnProfile: boolean,
  isInCall: boolean,
): 'own' | 'in-call' | null => {
  if (isOwnProfile) {
    return 'own';
  }
  if (isInCall) {
    return 'in-call';
  }
  return null;
};
