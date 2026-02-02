import { ReactElement, useState } from 'react';
import { useZero } from '@rocicorp/zero/react';
import { toast } from 'sonner';
import { Search } from 'lucide-react';
import { SingleSelect } from '@juspay/blend-design-system';
import { Button } from '../../../ui/Button/Button';
import Avatar from '../../../ui/Avatar/Avatar';
import Input from '../../../ui/Input/Input';
import type { User } from '@xyne/shared';
import { UserResponsibility } from '@xyne/shared';
import { mutators } from '../../../../zero/mutators';

interface UserListProps {
  users: User[];
  responsibilities: Map<string, UserResponsibility>;
  onUserRemove?: () => void;
  disabled?: boolean;
  userGroupId: string;
}

export const UserList = ({
  users,
  responsibilities,
  onUserRemove,
  disabled = false,
  userGroupId,
}: UserListProps): ReactElement => {
  const zero = useZero();
  const [searchTerm, setSearchTerm] = useState('');
  const [, forceUpdate] = useState(0);

  // Responsibility options for SingleSelect
  const responsibilityOptions = [
    { label: 'Manager', value: UserResponsibility.MANAGER },
    { label: 'Team Lead', value: UserResponsibility.TEAM_LEAD },
    { label: 'Member', value: UserResponsibility.MEMBER },
  ];

  // Filter users based on search term
  const filteredUsers = users.filter(
    user =>
      user.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.email?.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const handleRemoveUser = (userId: string): void => {
    try {
      zero.mutate(
        mutators.userGroup.removeUsers({
          userGroupId,
          userIds: [userId],
        }),
      );

      onUserRemove?.();

      // Show success feedback
      toast.success('User removed successfully from the group');
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to remove user from group:', error);

      // Show user-facing error feedback
      toast.error('Failed to remove user from group. Please try again.');
    }
  };

  return (
    <div className='overflow-hidden'>
      {/* Search Input */}
      {users.length > 0 && (
        <div className='mb-3 px-1'>
          <div className='relative'>
            <Search className='absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4 z-10' />
            <Input
              type='text'
              placeholder='Search users by name or email...'
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className='w-full pl-10 pr-4'
            />
          </div>
        </div>
      )}

      <div
        className={
          users.length > 0
            ? 'overflow-y-auto space-y-2 px-1 scrollbar-thin scrollbar-thumb-gray-300 hover:scrollbar-thumb-gray-400 h-[320px]'
            : 'space-y-2 px-1 h-auto'
        }
      >
        {users.length === 0 ? (
          <div className='text-center py-6 bg-gray-50 rounded-lg border border-gray-200'>
            <p className='text-sm text-gray-500'>No members in this group yet</p>
            <p className='text-xs text-gray-400 mt-1'>Add users using the selector below</p>
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className='text-center py-6 bg-gray-50 rounded-lg border border-gray-200'>
            <p className='text-sm text-gray-500'>{`No users found matching "${searchTerm}"`}</p>
            <p className='text-xs text-gray-400 mt-1'>Try a different search term</p>
          </div>
        ) : (
          filteredUsers.map(user => (
            <div
              key={user.id}
              className='flex items-center justify-between p-3 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors'
            >
              <div className='flex items-center gap-3'>
                <Avatar userId={user.id} size='sm' showActiveStatus={true} />
                <div>
                  <p className='font-medium text-gray-900'>{user.name}</p>
                  <p className='text-sm text-gray-500'>{user.email}</p>
                </div>
              </div>

              <div className='flex items-center'>
                {/* Responsibility Selector */}
                {!disabled && (
                  <div className='w-[130px] [&>div]:h-9 [&_button]:h-9 [&_button]:rounded-md'>
                    <SingleSelect
                      placeholder='Select role'
                      items={[{ items: responsibilityOptions }]}
                      selected={responsibilities.get(user.id) || UserResponsibility.MEMBER}
                      onSelect={selected => {
                        responsibilities.set(user.id, selected as UserResponsibility);
                        forceUpdate(n => n + 1);
                      }}
                    />
                  </div>
                )}

                {/* Remove Button */}
                {!disabled && (
                  <Button
                    variant='outline'
                    onClick={() => void handleRemoveUser(user.id)}
                    className='-ml-2'
                  >
                    Remove
                  </Button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default UserList;
