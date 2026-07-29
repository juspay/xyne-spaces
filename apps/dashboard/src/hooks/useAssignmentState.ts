import { useAuth } from './useAuth';
import { useSelf } from './useUsers';
import { useCachedQuery } from './useCachedQuery';
import { queries } from '../zero/queries';
import type { UserAssignmentState } from '@xyne/shared';
interface UseCurrentUserAssignmentStateReturn {
  isCurrentlyUnavailable: boolean;
  unavailableUntil: number | undefined;
  isLoading: boolean;
  userGroupId: string | null;
  allStates: UserAssignmentState[];
  isActiveInAtLeastOneGroup: boolean;
  hasAssignmentStates: boolean;
}

export const useCurrentUserAssignmentState = (): UseCurrentUserAssignmentStateReturn => {
  const { user } = useAuth();
  const currentUser = useSelf();

  const assignmentUnavailableUntil = currentUser?.assignmentUnavailableUntil as number | undefined;
  const isCurrentlyUnavailable = assignmentUnavailableUntil
    ? assignmentUnavailableUntil > Date.now()
    : false;

  // Fetch assignment states using Zero query (for all groups the user belongs to)
  const [allStates] = useCachedQuery(
    queries.getUserAssignmentStatesByUserId({ userId: user?.id || '' }),
    { enabled: !!user?.id },
  );

  // Check if user belongs to at least one group (has assignment states)
  // This determines if the assignment section should be shown in Settings
  const hasAssignmentStates = (allStates ?? []).length > 0;

  // Check if user is active in at least one group (onCall OR isActiveForAssignment is true)
  const isActiveInAtLeastOneGroup = (allStates ?? []).some(
    state => state.onCall || state.isActiveForAssignment,
  );

  // Get the first group the user belongs to (for display purposes)
  const primaryUserGroupId = allStates?.[0]?.userGroupId ?? null;

  return {
    isCurrentlyUnavailable,
    unavailableUntil: assignmentUnavailableUntil,
    isLoading: false, // Zero queries don't expose isLoading, but they're synchronous
    userGroupId: primaryUserGroupId,
    allStates: allStates ?? [],
    isActiveInAtLeastOneGroup,
    hasAssignmentStates,
  };
};
