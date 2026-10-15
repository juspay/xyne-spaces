import { useMemo } from 'react';

import { useUserGroups } from '@/src/hooks/useUserGroups';
import { useUsers } from '@/src/hooks/useUsers';
import { getUserDisplayName } from '@/src/utils/channel-utils';

import type { ChannelTicketsLookups } from '../types';

/**
 * Id → name maps the table cells read from. Built once at the container from
 * the already-loaded users / user-groups stores, so no cell ever subscribes to
 * global state on its own.
 */
export function useChannelTicketsLookups(
  boardNameById: ReadonlyMap<string, string>,
): ChannelTicketsLookups {
  const users = useUsers();
  const userGroups = useUserGroups();

  const userNameById = useMemo(
    () => new Map(users.map(user => [user.id, getUserDisplayName(user)])),
    [users],
  );
  const groupNameById = useMemo(
    () => new Map(userGroups.map(group => [group.id, group.name])),
    [userGroups],
  );

  return useMemo(
    () => ({ boardNameById, groupNameById, userNameById }),
    [boardNameById, groupNameById, userNameById],
  );
}
