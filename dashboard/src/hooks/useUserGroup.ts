import { useSelector } from '@xstate/react';
import { useMemo } from 'react';
import { stateMachineActor, type UserGroup } from '../machines/stateMachine';

export const useUserGroups = (): UserGroup[] => {
  const userGroups = useSelector(stateMachineActor, state => state.context.allUserGroups);
  return useMemo(() => userGroups, [userGroups]);
};

export const useUserGroupById = (userGroupId: string): UserGroup | undefined => {
  const userGroups = useUserGroups();
  return useMemo(() => userGroups.find(g => g.id === userGroupId), [userGroups, userGroupId]);
};
