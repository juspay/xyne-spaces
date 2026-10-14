/**
 * User Groups Hook - Reads workspace user groups from `UserGroupsProvider`.
 *
 * The live Zero query is owned by the provider (one subscription for the whole
 * app). Message rows must not call `queries.getAllUserGroups()` themselves —
 * each `useQuery` keeps a client view, and a chat/thread list was opening
 * dozens of copies of the same 256-row result until the Android Java heap OOM'd.
 */

import { useContext } from 'react';
import {
  EMPTY_USER_GROUPS,
  UserGroupsContext,
  type UserGroup,
} from '@/src/providers/userGroupsContext';

export type { UserGroup } from '@/src/providers/userGroupsContext';

export const useUserGroups = (): UserGroup[] => {
  return useContext(UserGroupsContext) ?? EMPTY_USER_GROUPS;
};
