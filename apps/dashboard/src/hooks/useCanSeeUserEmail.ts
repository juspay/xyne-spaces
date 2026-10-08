import { useCallback } from 'react';
import { useAuth } from './useAuth';
import { useIsCommunityWorkspace } from './useIsCommunityWorkspace';

/**
 * Returns a predicate telling whether a user's email may be shown in the UI.
 * In community workspaces emails are hidden from everyone except the user themselves
 * (the Administration module renders emails directly and does not use this).
 * Pass `email` where the row has no Spaces user id (e.g. Claw records).
 */
export const useCanSeeUserEmail = (): ((
  userId?: string | null,
  email?: string | null,
) => boolean) => {
  const isCommunityWorkspace = useIsCommunityWorkspace();
  const { user: currentUser } = useAuth();
  const currentUserId = currentUser?.id;
  const currentUserEmail = currentUser?.email?.toLowerCase();
  return useCallback(
    (userId?: string | null, email?: string | null) =>
      !isCommunityWorkspace ||
      (!!userId && userId === currentUserId) ||
      (!!email && email.toLowerCase() === currentUserEmail),
    [isCommunityWorkspace, currentUserId, currentUserEmail],
  );
};
