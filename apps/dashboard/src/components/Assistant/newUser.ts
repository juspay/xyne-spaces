import { useAuth } from '../../hooks/useAuth';

// Finishing onboarding clears `isNewUser` before the user reaches a channel, so the last
// onboarding step leaves this mark for the rest of the browser session.
const markKey = (userId: string): string => `xyne-assistant-new-user:${userId}`;

export const markJustOnboarded = (userId: string): void => {
  try {
    sessionStorage.setItem(markKey(userId), 'true');
  } catch {
    // Without storage the user is treated as already onboarded.
  }
};

const isMarked = (userId: string): boolean => {
  try {
    return sessionStorage.getItem(markKey(userId)) !== null;
  } catch {
    return false;
  }
};

// True only for someone going through onboarding for the first time, not for an existing
// user who creates or joins another workspace.
export const useIsNewUser = (): boolean => {
  const { user, isNewUser } = useAuth();
  return isNewUser || (user?.id !== undefined && isMarked(user.id));
};
