import { createContext } from 'react';

export interface UserGroup {
  id: string;
  name: string;
  alias?: string | null;
  description?: string | null;
  isActive?: boolean;
  createdAt?: number;
  updatedAt?: number;
}

export const EMPTY_USER_GROUPS: UserGroup[] = [];

export const UserGroupsContext = createContext<UserGroup[] | null>(null);
