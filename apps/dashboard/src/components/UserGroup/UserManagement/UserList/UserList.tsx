import { ReactElement, useState, useMemo, useRef } from 'react';
import { useZero } from '../../../../hooks/useZero';
import { toast } from 'sonner';
import { Button } from '../../../ui/Button/Button';
import Avatar from '../../../ui/Avatar/Avatar';
import Input from '../../../ui/Input/Input';
import { SearchableMultiSelect } from '../../../ui/SearchableMultiSelect/SearchableMultiSelect';
import type { SearchableMultiSelectOption } from '../../../ui/SearchableMultiSelect/SearchableMultiSelect.types';
import type { User, Role } from '@xyne/shared';
import { mutators } from '../../../../zero/mutators';
import { v4 as uuidv4 } from 'uuid';
import { Search, Trash2, X, Plus, ChevronDown } from 'lucide-react';
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
  // userId -> the full set of role ids that user holds in this group.
  roleIds: Map<string, string[]>;
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

  // Update the local desired-role set only — nothing is persisted here. Role changes are
  // batched and written in one shot when the user clicks "Update user group"
  // (UserGroupForm.handleSubmit sends the full set per member; the mutator diffs it against
  // each member's current roles). An empty array is kept (not deleted) so a member whose
  // roles were fully cleared is still sent on submit and gets their removals applied.
  const applyRoles = (userId: string, nextRoles: string[]): void => {
    roleIds.set(userId, nextRoles);
    forceUpdate(n => n + 1);
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
                    const selectedRoleIds = roleIds.get(user.id) ?? [];
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

                          {/* Roles (multi-select): chips + a dropdown you can multi-toggle in one open */}
                          {!disabled && (
                            <MemberRoles
                              roles={roles ?? []}
                              selectedRoleIds={selectedRoleIds}
                              onChange={next => applyRoles(user.id, next)}
                            />
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

interface MemberRolesProps {
  roles: Role[];
  selectedRoleIds: string[];
  // Receives the FULL new set of role ids for the member (toggled in the dropdown or via a chip's X).
  onChange: (roleIds: string[]) => void;
}

// Multi-role picker: assigned roles show as removable chips, and a single dropdown lets you
// toggle many roles on/off in one open (checkbox-style, stays open) via SearchableMultiSelect.
const MemberRoles = ({ roles, selectedRoleIds, onChange }: MemberRolesProps): ReactElement => {
  const [open, setOpen] = useState(false);

  const rolesById = useMemo(() => {
    const map = new Map<string, Role>();
    for (const r of roles) map.set(r.id, r);
    return map;
  }, [roles]);

  // All roles are offered; selected ones render checked, so a single open can add and remove.
  const options: SearchableMultiSelectOption[] = useMemo(
    () => roles.map(r => ({ value: r.id, label: r.name })),
    [roles],
  );

  const trigger = (
    <button
      type='button'
      className='inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted'
      data-testid='member-role-selector'
      data-track-category='UserGroups'
      data-track-name='OpenMemberRoleSelector'
    >
      <Plus className='w-3 h-3' />
      {selectedRoleIds.length > 0 ? 'Add / edit' : 'Select roles'}
      <ChevronDown className='w-3 h-3' />
    </button>
  );

  return (
    <div className='flex flex-wrap items-center justify-end gap-1 max-w-[280px]'>
      {selectedRoleIds.map(roleId => {
        const role = rolesById.get(roleId);
        return (
          <span
            key={roleId}
            className='inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-foreground'
            data-testid='member-role-chip'
          >
            {role?.name ?? roleId}
            <button
              type='button'
              onClick={() => onChange(selectedRoleIds.filter(r => r !== roleId))}
              className='text-muted-foreground hover:text-red-600'
              aria-label={`Remove role ${role?.name ?? roleId}`}
              data-testid='member-role-chip-remove'
              data-track-category='UserGroups'
              data-track-name='RemoveMemberRole'
            >
              <X className='w-3 h-3' />
            </button>
          </span>
        );
      })}
      <SearchableMultiSelect
        options={options}
        selectedValues={selectedRoleIds}
        onSelectedValuesChange={onChange}
        trigger={trigger}
        isOpen={open}
        onOpenChange={setOpen}
        searchPlaceholder='Search roles...'
        searchAriaLabel='Search roles'
        listAriaLabel='Roles'
        emptyMessage='No roles found'
        align='end'
      />
    </div>
  );
};

export default UserList;
