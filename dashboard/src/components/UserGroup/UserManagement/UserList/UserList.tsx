import { ReactElement, useState, useMemo, useRef } from 'react';
import { useZero } from '../../../../hooks/useZero';
import { toast } from 'sonner';
import { SingleSelect } from '@juspay/blend-design-system';
import { Button } from '../../../ui/Button/Button';
import Avatar from '../../../ui/Avatar/Avatar';
import Input from '../../../ui/Input/Input';
import type { User } from '@xyne/shared';
import { UserResponsibility } from '@xyne/shared';
import { mutators } from '../../../../zero/mutators';
import { v4 as uuidv4 } from 'uuid';
import { Search, Trash2 } from 'lucide-react';
import { useUserSearch } from '../../../../hooks/useUsers';

interface UserListProps {
  users: User[];
  responsibilities: Map<string, UserResponsibility>;
  onUserRemove?: () => void;
  onUsersAdded?: () => void;
  disabled?: boolean;
  userGroupId: string;
}

export const UserList = ({
  users,
  responsibilities,
  onUserRemove,
  onUsersAdded,
  disabled = false,
  userGroupId,
}: UserListProps): ReactElement => {
  const zero = useZero();
  const [searchTerm, setSearchTerm] = useState('');
  const [, forceUpdate] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Get users matching search query (for adding)
  const searchResults = useUserSearch(searchTerm, 10);

  // Responsibility options for SingleSelect
  const responsibilityOptions = [
    { label: 'Manager', value: UserResponsibility.MANAGER },
    { label: 'Team Lead', value: UserResponsibility.TEAM_LEAD },
    { label: 'Member', value: UserResponsibility.MEMBER },
    { label: 'PR Reviewer', value: UserResponsibility.PR_REVIEWER },
    { label: 'QA', value: UserResponsibility.QA },
  ];

  // Filter existing users by search term
  const filteredUsers = useMemo(() => {
    if (!searchTerm.trim()) return users;

    const searchLower = searchTerm.toLowerCase();
    return users.filter(
      user =>
        user.name?.toLowerCase().includes(searchLower) ||
        user.email?.toLowerCase().includes(searchLower),
    );
  }, [users, searchTerm]);

  // Get users that can be added (not already in the group)
  const usersToAdd = useMemo(() => {
    if (!searchResults || !searchTerm.trim()) return [];

    const existingUserIds = new Set(users.map(u => u.id));
    return searchResults.filter(user => !existingUserIds.has(user.id));
  }, [searchResults, users, searchTerm]);

  const handleAddUser = (user: User): void => {
    const mappingId = uuidv4();

    try {
      zero.mutate(
        mutators.userGroup.addUsers({
          userGroupId,
          userIds: [user.id],
          mappingIds: { [user.id]: mappingId },
          timestamp: Date.now(),
        }),
      );
      inputRef.current?.focus();
      onUsersAdded?.();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to add user to group. Please try again.',
      );
    }
  };

  const handleRemoveUser = (userId: string): void => {
    try {
      zero.mutate(
        mutators.userGroup.removeUsers({
          userGroupId,
          userIds: [userId],
        }),
      );

      onUserRemove?.();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Failed to remove user from group. Please try again.',
      );
    }
  };

  return (
    <div className='flex flex-col h-full'>
      {/* Search Bar */}
      <div className='px-4 py-3 border-b border-gray-200'>
        <div className='relative'>
          <Search className='absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400 pointer-events-none z-10' />
          <Input
            ref={inputRef}
            type='text'
            placeholder='Search members or add people'
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className='w-full pl-10 pr-4 h-9 text-sm'
            disabled={disabled}
          />
        </div>
      </div>

      {/* Unified Scrollable List */}
      <div className='flex-1 overflow-y-auto'>
        {users.length === 0 && usersToAdd.length === 0 ? (
          <div className='text-center py-8 px-4'>
            <p className='text-sm text-gray-500'>No members in this channel yet</p>
            <p className='text-xs text-gray-400 mt-1'>Search to add people</p>
          </div>
        ) : (
          <div>
            {/* Existing members */}
            {filteredUsers.length > 0 && (
              <div>
                <div className='py-2 pl-6 text-xs font-semibold text-gray-500 uppercase bg-gray-50'>
                  Members
                </div>
                <div className='divide-y divide-gray-100'>
                  {filteredUsers.map(user => (
                    <div
                      key={user.id}
                      className='flex items-center justify-between px-6 py-2.5 hover:bg-gray-50 transition-colors group'
                    >
                      <div className='flex items-center gap-2.5 flex-1 min-w-0'>
                        <Avatar userId={user.id} size='sm' showActiveStatus={true} />
                        <div className='flex flex-col min-w-0'>
                          <span className='text-sm font-medium text-gray-900 truncate'>
                            {user.name}
                          </span>
                          <span className='text-xs text-gray-500 truncate'>{user.email}</span>
                        </div>
                      </div>

                      <div className='flex items-center gap-3 ml-3'>
                        {/* Remove Button */}
                        {!disabled && (
                          <Button
                            variant='ghost'
                            size='sm'
                            onClick={() => void handleRemoveUser(user.id)}
                            className='shrink-0 h-7 w-7 p-0 text-gray-600 hover:text-red-600 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity'
                            data-track-category='UserGroups'
                            data-track-name='RemoveUserFromGroup'
                            data-track-metadata={JSON.stringify({ userId: user.id })}
                          >
                            <Trash2 className='w-4 h-4' />
                          </Button>
                        )}

                        {/* Responsibility Selector */}
                        {!disabled && (
                          <div className='w-[140px] shrink-0 [&>div]:h-7 [&>div]:w-[140px] [&_button]:h-7 [&_button]:w-[140px] [&_button]:!text-xs [&_button]:rounded-md [&_span]:!text-xs [&_div]:!text-xs [&_*]:!text-xs'>
                            <SingleSelect
                              placeholder='Role'
                              items={[{ items: responsibilityOptions }]}
                              selected={responsibilities.get(user.id) || UserResponsibility.MEMBER}
                              onSelect={selected => {
                                responsibilities.set(user.id, selected as UserResponsibility);
                                forceUpdate(n => n + 1);
                              }}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Users not in channel */}
            {usersToAdd.length > 0 && (
              <div>
                {filteredUsers.length > 0 && (
                  <div className='py-2 pl-6 text-xs font-semibold text-gray-500 uppercase bg-gray-50 border-t border-gray-200'>
                    Not in this channel
                  </div>
                )}
                <div className='divide-y divide-gray-100'>
                  {usersToAdd.map(user => (
                    <div
                      key={user.id}
                      className='flex items-center justify-between px-6 py-2.5 hover:bg-gray-50 transition-colors group'
                    >
                      <div className='flex items-center gap-2.5 flex-1 min-w-0'>
                        <Avatar userId={user.id} size='sm' showActiveStatus={false} />
                        <div className='flex flex-col min-w-0'>
                          <span className='text-sm font-medium text-gray-900 truncate'>
                            {user.name}
                          </span>
                          <span className='text-xs text-gray-500 truncate'>{user.email}</span>
                        </div>
                      </div>
                      <Button
                        variant='outline'
                        size='sm'
                        onClick={() => void handleAddUser(user)}
                        className='shrink-0 h-7 w-[140px] text-xs'
                        data-track-category='UserGroups'
                        data-track-name='AddUserToChannel'
                        data-track-metadata={JSON.stringify({ userId: user.id })}
                      >
                        Add to Channel
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* No results message */}
            {filteredUsers.length === 0 && usersToAdd.length === 0 && searchTerm.trim() && (
              <div className='text-center py-8 px-4'>
                <p className='text-sm text-gray-500'>{`No results found for "${searchTerm}"`}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default UserList;
