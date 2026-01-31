import { ReactElement } from 'react';
import { useZero } from '@rocicorp/zero/react';
import SearchUser from '../../../ui/SearchUser/SearchUser';
import type { User } from '@xyne/shared';
import { mutators } from '../../../../zero/mutators';
import { v4 as uuidv4 } from 'uuid';

interface UserSelectorProps {
  userGroupId: string;
  excludeUserIds: string[];
  onUsersAdded: () => void;
  disabled?: boolean | { value: boolean; reason?: string };
  selectedUsersOverride?: User[];
  onSelectedUsersChange?: (users: User[]) => void;
}

export const UserSelector = ({
  userGroupId,
  excludeUserIds,
  onUsersAdded,
  disabled = false,
  selectedUsersOverride,
  onSelectedUsersChange,
}: UserSelectorProps): ReactElement => {
  const zero = useZero();

  const handleUsersAdd = (usersToAdd: User[]): void => {
    if (selectedUsersOverride && onSelectedUsersChange) {
      // Create mode - merge with existing selected users (avoid duplicates)
      const mergedUsers = [...selectedUsersOverride];
      usersToAdd.forEach(user => {
        if (!mergedUsers.some(existing => existing.id === user.id)) {
          mergedUsers.push(user);
        }
      });
      onSelectedUsersChange(mergedUsers);
      return;
    }

    if (usersToAdd.length === 0) return;

    // Generate mapping IDs for each user
    const mappingIds = usersToAdd.reduce(
      (acc, user) => {
        acc[user.id] = uuidv4();
        return acc;
      },
      {} as Record<string, string>,
    );

    // Simple mutator call without error handling
    void zero.mutate(
      mutators.userGroup.addUsers({
        userGroupId,
        userIds: usersToAdd.map(user => user.id),
        mappingIds,
        timestamp: Date.now(),
      }),
    );
    onUsersAdded();
  };

  return (
    <SearchUser
      excludeUserIds={[...excludeUserIds, ...(selectedUsersOverride?.map(u => u.id) || [])]}
      selectedUsers={selectedUsersOverride || []}
      onUsersChange={handleUsersAdd}
      placeholder='Search and add users to this group...'
      label='Add Users'
      hintText='Search by name or email to add users to this group'
      disabled={
        typeof disabled === 'boolean'
          ? disabled
            ? { value: true, reason: 'Cannot add users while creating' }
            : { value: false }
          : disabled
      }
    />
  );
};

export default UserSelector;
