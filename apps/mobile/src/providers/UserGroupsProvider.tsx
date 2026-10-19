import { useMemo, type ReactElement, type ReactNode } from 'react';

import { useQuery } from '@/src/hooks/useQuery';
import { queries } from '@/src/zero/queries';
import { EMPTY_USER_GROUPS, UserGroupsContext } from './userGroupsContext';

export const UserGroupsProvider = ({ children }: { children: ReactNode }): ReactElement => {
  const query = useMemo(() => queries.getAllUserGroups(), []);

  const [userGroups, details] = useQuery(query, { ttl: '10m' });

  const value = useMemo(() => {
    if (details.type !== 'complete') {
      return EMPTY_USER_GROUPS;
    }

    return userGroups.filter(group => group.isActive !== false);
  }, [userGroups, details.type]);

  return <UserGroupsContext.Provider value={value}>{children}</UserGroupsContext.Provider>;
};
