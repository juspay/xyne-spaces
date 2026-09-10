import { ReactElement, useState, useMemo, useRef } from 'react';
import { useZero } from '../../../../hooks/useZero';
import { toast } from 'sonner';
import { Button } from '../../../ui/Button/Button';
import Avatar from '../../../ui/Avatar/Avatar';
import Input from '../../../ui/Input/Input';
import { EntitySelector } from '../../../ui/EntitySelector/EntitySelector';
import type { SelectorOption } from '../../../ui/EntitySelector/EntitySelector.types';
import type { User, Role } from '@xyne/shared';
import { mutators } from '../../../../zero/mutators';
import { v4 as uuidv4 } from 'uuid';
import { Search, Trash2 } from 'lucide-react';
import { useUserSearch } from '../../../../hooks/useUsers';
import { useCachedQuery } from '../../../../hooks/useCachedQuery';
import { queries } from '../../../../zero/queries';
import {
  getUserDisplayName,
  isUserDeactivated,
  matchesUserQuery,
} from '../../../../utils/userDisplayName';
import { usePlatform } from '../../../../hooks/usePlatform';
import { RemoveMemberDialog } from './RemoveMemberDialog';

interface UserListProps {
  users: User[];
  roleIds: Map<string, string>;
  onUserRemove?: () => void;
  onUsersAdded?: () => void;
  disabled?: boolean;
  userGroupId: string | undefined;
  onAddUser?: (user: User) => void;
  onRemoveUser?: (userId: string) => void;
}

export const UserList = ({
  users,
  roleIds,
  onUserRemove,
  onUsersAdded,
  disabled = false,
  userGroupId,
  onAddUser,
  onRemoveUser,
}: UserListProps): ReactElement => {
  const zero = useZero();
  const [searchTerm, setSearchTerm] = useState('');
  const [, forceUpdate] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const isCreateMode = !userGroupId;
  const { isMobile } = usePlatform();
  const [removeTarget, setRemoveTarget] = useState<User | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);
  // Get users matching search query (for adding)
  const searchResults = useUserSearch(searchTerm, 10);

  // Fetch workspace roles for the role dropdown
  const [roles] = useCachedQuery(queries.roles({}));

  // The group setting decides whether removing a member can hand their open tickets off
  const [userGroup] = useCachedQuery(queries.getUserGroupById({ userGroupId: userGroupId ?? '' }), {
    enabled: !isCreateMode,
  });

  // Filter existing users by search term
  const filteredUsers = useMemo(() => {
    if (!searchTerm.trim()) return users;

    return users.filter(user => matchesUserQuery(user, searchTerm));
  }, [users, searchTerm]);

  // Get users that can be added (not already in the group)
  const usersToAdd = useMemo(() => {
    if (!searchResults || !searchTerm.trim()) return [];

    const existingUserIds = new Set(users.map(u => u.id));
    return searchResults.filter(user => !existingUserIds.has(user.id));
  }, [searchResults, users, searchTerm]);

  const handleAddUser = (user: User): void => {
    // Create mode: use callback
    if (isCreateMode) {
      onAddUser?.(user);
      inputRef.current?.focus();
      return;
    }

    // Edit mode: call API
    const mappingId = uuidv4();
    try {
      zero.mutate(
        mutators.userGroup.addUsers({
          userGroupId: userGroupId,
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

  const handleRemoveUser = (user: User): void => {
    // Create mode: nothing is persisted yet, so there are no tickets to hand off
    if (isCreateMode) {
      onRemoveUser?.(user.id);
      return;
    }

    // Edit mode: confirm first — their open tickets stay with them unless handed off
    setRemoveTarget(user);
  };

  const confirmRemoveUser = async (reassignTickets: boolean): Promise<void> => {
    if (!removeTarget || !userGroupId) return;

    const userId = removeTarget.id;
    setIsRemoving(true);
    try {
      // The handoff rides along with the removal: the server queues it only after the
      // mapping delete commits, so a failed removal can never strand reassigned tickets.
      const result = await zero.mutate(
        mutators.userGroup.removeUsers({
          userGroupId: userGroupId,
          userIds: [userId],
          reassignTickets,
        }),
      ).server;
      if (result.type === 'error') {
        throw new Error(result.error.message || 'Failed to remove user from group.');
      }

      // "Queued", not "handed off": the enqueue happens post-commit and the job leaves
      // tickets in place when no eligible replacement exists.
      toast.success(
        'Member removed',
        reassignTickets
          ? { description: 'Reassignment of their open tickets has been queued.' }
          : undefined,
      );
      setRemoveTarget(null);
      onUserRemove?.();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Failed to remove user from group. Please try again.',
      );
    } finally {
      setIsRemoving(false);
    }
  };

  const handleRoleChange = (userId: string, roleId: string | null): void => {
    if (roleId === null) {
      // Deselect: only supported in create mode (no clear-role mutator in edit mode)
      if (isCreateMode) {
        roleIds.delete(userId);
        forceUpdate(n => n + 1);
      }
      return;
    }

    if (isCreateMode) {
      roleIds.set(userId, roleId);
      forceUpdate(n => n + 1);
      return;
    }

    // Edit mode: persist via mutator
    try {
      zero.mutate(
        mutators.userGroup.update({
          userGroupId: userGroupId,
          userRoleUpdates: { [userId]: roleId },
          timestamp: Date.now(),
        }),
      );
      roleIds.set(userId, roleId);
      forceUpdate(n => n + 1);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to update user role. Please try again.',
      );
    }
  };

  return (
    <div className='flex flex-col h-full'>
      {/* Search Bar */}
      <div className='px-4 py-3 border-b border-border'>
        <div className='relative'>
          <Search className='absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground pointer-events-none z-10' />
          <Input
            ref={inputRef}
            type='text'
            placeholder='Search members or add people'
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className='w-full pl-10 pr-4 h-9 text-sm'
            disabled={disabled}
            data-testid='search-members-input'
            autoFocus={!isMobile}
          />
        </div>
      </div>

      {/* Unified Scrollable List */}
      <div className='flex-1 overflow-y-auto'>
        {users.length === 0 && usersToAdd.length === 0 ? (
          <div className='text-center py-8 px-4'>
            <p className='text-sm text-muted-foreground'>No members in this channel yet</p>
            <p className='text-xs text-muted-foreground mt-1'>Search to add people</p>
          </div>
        ) : (
          <div>
            {/* Existing members */}
            {filteredUsers.length > 0 && (
              <div>
                <div className='py-2 pl-6 text-xs font-semibold text-muted-foreground uppercase bg-muted'>
                  Members
                </div>
                <div className='divide-y divide-border'>
                  {filteredUsers.map(user => {
                    const deactivated = isUserDeactivated(user);
                    const selectedRoleId = roleIds.get(user.id);
                    return (
                      <div
                        key={user.id}
                        className='flex items-center justify-between px-6 py-2.5 hover:bg-muted transition-colors group'
                      >
                        <div className='flex items-center gap-2.5 flex-1 min-w-0'>
                          <Avatar userId={user.id} size='sm' showActiveStatus={true} />
                          <div className='flex flex-col min-w-0'>
                            <div className='flex items-center gap-1.5'>
                              <span
                                className={`text-sm font-medium truncate ${deactivated ? 'text-muted-foreground' : 'text-foreground'}`}
                              >
                                {getUserDisplayName(user)}
                              </span>
                              {deactivated && (
                                <span className='inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground shrink-0'>
                                  Deactivated
                                </span>
                              )}
                            </div>
                            <span className='text-xs text-muted-foreground truncate'>
                              {user.email}
                            </span>
                          </div>
                        </div>

                        <div className='flex items-center gap-3 ml-3'>
                          {/* Remove Button */}
                          {!disabled && (
                            <Button
                              type='button'
                              variant='ghost'
                              size='sm'
                              onClick={() => handleRemoveUser(user)}
                              className='shrink-0 h-7 w-7 p-0 text-muted-foreground hover:text-red-600 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity'
                              data-track-category='UserGroups'
                              data-track-name='RemoveUserFromGroup'
                              data-track-metadata={JSON.stringify({ userId: user.id })}
                            >
                              <Trash2 className='w-4 h-4' />
                            </Button>
                          )}

                          {/* Role Selector (searchable) */}
                          {!disabled && (
                            <div className='w-[160px] shrink-0'>
                              <RoleSelector
                                roles={roles ?? []}
                                selectedRoleId={selectedRoleId}
                                onSelect={roleId => handleRoleChange(user.id, roleId)}
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Users not in channel */}
            {usersToAdd.length > 0 && (
              <div>
                {filteredUsers.length > 0 && (
                  <div className='py-2 pl-6 text-xs font-semibold text-muted-foreground uppercase bg-muted border-t border-border'>
                    Not in this channel
                  </div>
                )}
                <div className='divide-y divide-border'>
                  {usersToAdd.map(user => {
                    const deactivated = isUserDeactivated(user);
                    return (
                      <div
                        key={user.id}
                        className='flex items-center justify-between px-6 py-2.5 hover:bg-muted transition-colors group'
                      >
                        <div className='flex items-center gap-2.5 flex-1 min-w-0'>
                          <Avatar userId={user.id} size='sm' showActiveStatus={false} />
                          <div className='flex flex-col min-w-0'>
                            <div className='flex items-center gap-1.5'>
                              <span
                                className={`text-sm font-medium truncate ${deactivated ? 'text-muted-foreground' : 'text-foreground'}`}
                              >
                                {getUserDisplayName(user)}
                              </span>
                              {deactivated && (
                                <span className='inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground shrink-0'>
                                  Deactivated
                                </span>
                              )}
                            </div>
                            <span className='text-xs text-muted-foreground truncate'>
                              {user.email}
                            </span>
                          </div>
                        </div>
                        <Button
                          type='button'
                          variant='outline'
                          size='sm'
                          onClick={() => void handleAddUser(user)}
                          className='shrink-0 h-7 w-[140px] text-xs'
                          data-track-category='UserGroups'
                          data-track-name='AddUserToChannel'
                          data-track-metadata={JSON.stringify({ userId: user.id })}
                        >
                          Add to Group
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* No results message */}
            {filteredUsers.length === 0 && usersToAdd.length === 0 && searchTerm.trim() && (
              <div className='text-center py-8 px-4'>
                <p className='text-sm text-muted-foreground'>{`No results found for "${searchTerm}"`}</p>
              </div>
            )}
          </div>
        )}
      </div>

      <RemoveMemberDialog
        user={removeTarget}
        canReassignTickets={userGroup?.reassignOnUnavailable === true}
        isRemoving={isRemoving}
        onCancel={() => setRemoveTarget(null)}
        onConfirm={reassignTickets => void confirmRemoveUser(reassignTickets)}
        userGroupId={userGroupId}
      />
    </div>
  );
};

interface RoleSelectorProps {
  roles: Role[];
  selectedRoleId: string | null | undefined;
  onSelect: (roleId: string | null) => void;
}

const RoleSelector = ({ roles, selectedRoleId, onSelect }: RoleSelectorProps): ReactElement => {
  const options: SelectorOption[] = useMemo(
    () =>
      roles.map(r => ({
        value: r.id,
        label: r.name,
        subtitle: r.description ?? null,
        icon: null,
      })),
    [roles],
  );

  return (
    <EntitySelector
      options={options}
      selectedValue={selectedRoleId ?? null}
      onSelect={onSelect}
      placeholder='Select role'
      searchPlaceholder='Search roles...'
      showSearch={true}
      width='160px'
      testId='member-role-selector'
    />
  );
};

export default UserList;
