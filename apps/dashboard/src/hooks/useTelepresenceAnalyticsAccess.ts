import { useAuth } from './useAuth';
import { TELEPRESENCE_ANALYTICS_ALLOWED_EMAILS } from '../config';

export const isTelepresenceAnalyticsAllowed = (email: string | null | undefined): boolean =>
  Boolean(email) && TELEPRESENCE_ANALYTICS_ALLOWED_EMAILS.includes((email as string).toLowerCase());

// Whether the logged-in user may see the Telepresence System Analytics section.
// UI gating only — the data routes enforce the same allow-list server-side.
export const useTelepresenceAnalyticsAccess = (): boolean => {
  const { user } = useAuth();
  return isTelepresenceAnalyticsAllowed(user?.email);
};
