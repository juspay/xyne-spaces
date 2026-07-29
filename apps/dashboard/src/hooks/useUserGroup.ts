import { useSelector } from '@xstate/react';
import { useMemo } from 'react';
import { stateMachineActor, type UserGroup, type UserGroupMapping } from '../machines/stateMachine';

export const useUserGroups = (): UserGroup[] => {
  const userGroups = useSelector(stateMachineActor, state => state.context.allUserGroups);
  return useMemo(() => userGroups, [userGroups]);
};

export const useUserGroupsHydrated = (): boolean =>
  useSelector(stateMachineActor, state => state.context.allUserGroupsHydrated);

export const useUserGroupById = (userGroupId: string): UserGroup | undefined => {
  const userGroups = useUserGroups();
  return useMemo(() => userGroups.find(g => g.id === userGroupId), [userGroups, userGroupId]);
};

export const useUserGroupMappings = (): UserGroupMapping[] => {
  const userGroupMappings = useSelector(
    stateMachineActor,
    state => state.context.userGroupMappings,
  );
  return useMemo(() => userGroupMappings, [userGroupMappings]);
};

export const useCurrentUserGroupIds = (): Set<string> => {
  const userGroupMappings = useUserGroupMappings();
  return useMemo(
    () =>
      new Set(
        userGroupMappings
          .map(mapping => mapping.userGroupId)
          .filter((groupId): groupId is string => Boolean(groupId)),
      ),
    [userGroupMappings],
  );
};
