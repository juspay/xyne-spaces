// Set when the user creates an org during signup, so onboarding asks the org-size question
// only of the org creator. Holds the org name they entered, for the preview and the response.
const markKey = (email: string): string => `onboarding_org_creator_${email}`;

export const markOrgCreator = (email: string, orgName: string): void => {
  try {
    localStorage.setItem(markKey(email), orgName);
  } catch {
    // Without storage the org-size step is skipped.
  }
};

export const getCreatedOrgName = (email?: string): string | null => {
  if (!email) return null;
  try {
    return localStorage.getItem(markKey(email));
  } catch {
    return null;
  }
};

export const clearOrgCreator = (email?: string): void => {
  if (!email) return;
  try {
    localStorage.removeItem(markKey(email));
  } catch {
    // Nothing to clear.
  }
};
