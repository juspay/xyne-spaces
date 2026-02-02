import { ReactElement, useMemo } from 'react';
import { queries } from '../../../../zero/queries';
import { useCachedQuery } from '../../../../hooks/useCachedQuery';
import { UserList } from '../UserList/UserList';
import { UserSelector } from '../UserSelector/UserSelector';
import type { User } from '@xyne/shared';
import { UserResponsibility } from '@xyne/shared';
import { useUsers } from '../../../../hooks/useUsers';

interface UserManagementProps {
  userGroupId: string;
  disabled?: boolean;
  onUsersChange?: () => void;
  responsibilities: Map<string, UserResponsibility>;
}

export const UserManagement = ({
  userGroupId,
  disabled = false,
  onUsersChange,
  responsibilities,
}: UserManagementProps): ReactElement => {
  const [userGroupMembers] = useCachedQuery(
    queries.getUserGroupMembers({ userGroupId: userGroupId }),
  );

  const allUsers = useUsers();
  const usersById = useMemo(() => {
    const map = new Map<string, User>();
    for (const u of allUsers) {
      map.set(u.id, u);
    }
    return map;
  }, [allUsers]);

  // Extract users from mappings using userId and XState user store
  const currentUsers =
    userGroupMembers
      ?.map(mapping => usersById.get(mapping.userId))
      .filter((user): user is User => Boolean(user)) || [];

  const handleUsersAdded = (): void => {
    onUsersChange?.();
  };

  const handleUserRemoved = (): void => {
    onUsersChange?.();
  };

  return (
    <div className='space-y-4'>
      <div>
        <h3 className='text-sm font-medium text-gray-900 mb-3'>Group Members</h3>

        {/* Current Users */}
        <UserList
          userGroupId={userGroupId}
          users={currentUsers}
          responsibilities={responsibilities}
          onUserRemove={handleUserRemoved}
          disabled={disabled}
        />
      </div>

      {/* User Selector */}
      <div>
        <UserSelector
          userGroupId={userGroupId}
          excludeUserIds={currentUsers.map(user => user.id)}
          onUsersAdded={handleUsersAdded}
          disabled={disabled}
        />
      </div>
    </div>
  );
};

export default UserManagement;
