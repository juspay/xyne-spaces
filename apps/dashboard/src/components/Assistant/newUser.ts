// Set by the last onboarding step and cleared once the assistant panel has opened, so the
// panel opens once, only for someone who has just finished onboarding.
const markKey = (userId: string): string => `xyne-assistant-new-user:${userId}`;

export const markJustOnboarded = (userId: string): void => {
  try {
    sessionStorage.setItem(markKey(userId), 'true');
  } catch {
    // Without storage the panel simply does not open.
  }
};

export const hasJustOnboarded = (userId: string): boolean => {
  try {
    return sessionStorage.getItem(markKey(userId)) !== null;
  } catch {
    return false;
  }
};

export const clearJustOnboarded = (userId: string): void => {
  try {
    sessionStorage.removeItem(markKey(userId));
  } catch {
    // Nothing to clear.
  }
};
