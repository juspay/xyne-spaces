import { ReactElement, useMemo } from 'react';
import { queries } from '../../../../zero/queries';
import { useCachedQuery } from '../../../../hooks/useCachedQuery';
import { UserList } from '../UserList/UserList';
import type { User } from '@xyne/shared';
import { UserResponsibility } from '@xyne/shared';
import { useUsers } from '../../../../hooks/useUsers';

interface UserManagementProps {
  userGroupId: string | undefined;
  selectedUsers: User[] | undefined;
  onUsersChange: ((users: User[]) => void) | undefined;
  disabled: boolean | undefined;
  responsibilities: Map<string, UserResponsibility>;
}

export const UserManagement = ({
  userGroupId,
  selectedUsers,
  onUsersChange,
  disabled = false,
  responsibilities,
}: UserManagementProps): ReactElement => {
  const isCreateMode = !userGroupId;

  // Edit mode: fetch from server
  const [userGroupMembers] = useCachedQuery(
    queries.getUserGroupMembers({ userGroupId: userGroupId ?? '' }),
    { enabled: !!userGroupId },
  );

  const allUsers = useUsers();
  const usersById = useMemo(() => {
    const map = new Map<string, User>();
    for (const u of allUsers) {
      map.set(u.id, u);
    }
    return map;
  }, [allUsers]);

  // Edit mode: use server data; Create mode: use local state
  const currentUsers = isCreateMode
    ? selectedUsers || []
    : userGroupMembers
        ?.map(mapping => usersById.get(mapping.userId))
        .filter((user): user is User => Boolean(user)) || [];

  const handleAddUser = (user: User): void => {
    if (isCreateMode) {
      responsibilities.set(user.id, UserResponsibility.MEMBER);
      onUsersChange?.([...currentUsers, user]);
    }
  };

  const handleRemoveUser = (userId: string): void => {
    if (isCreateMode) {
      responsibilities.delete(userId);
      onUsersChange?.(currentUsers.filter(u => u.id !== userId));
    }
  };

  return (
    <div className='h-full flex flex-col'>
      <div className='px-6 pt-6 pb-3'>
        <h3 className='text-sm font-medium text-foreground'>Group Members</h3>
      </div>

      {/* Unified Search, Add and List Users */}
      <div className='flex-1 overflow-hidden'>
        <UserList
          userGroupId={userGroupId}
          users={currentUsers}
          responsibilities={responsibilities}
          onAddUser={handleAddUser}
          onRemoveUser={handleRemoveUser}
          disabled={disabled}
        />
      </div>
    </div>
  );
};

export default UserManagement;
