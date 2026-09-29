import { ReactElement, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, MoreHorizontal, Search, Shield, User, UserMinus } from 'lucide-react';
import { toast } from 'sonner';
import { WorkspaceRole } from '@xyne/shared';
import { Button } from '../../components/ui/Button/Button';
import Input from '../../components/ui/Input/Input';
import Dialog from '../../components/ui/Dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { ResourceAccessModal, UserListView } from '../../components/ResourceAccess';
import { searchUsers, useSelf, useUsers } from '../../hooks/useUsers';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useHasResourceAccess } from '../../hooks/usePermissions';
import { usePlatform } from '../../hooks/usePlatform';
import { useZero } from '../../hooks/useZero';
import { mutators } from '../../zero/mutators';
import { cn } from '../../utils/classNames';
import type { User as UserType } from '../../machines/stateMachine';

const isWorkspaceAdmin = (role: WorkspaceRole | null | undefined): boolean =>
  role === WorkspaceRole.ADMIN || role === WorkspaceRole.OWNER;

const WorkspaceRoleBadge = ({ role }: { role: WorkspaceRole | null }): ReactElement => {
  const isAdmin = isWorkspaceAdmin(role);
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
        isAdmin
          ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
          : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400',
      )}
    >
      {isAdmin ? <Shield className='w-3 h-3' /> : <User className='w-3 h-3' />}
      {role === WorkspaceRole.OWNER ? 'Owner' : isAdmin ? 'Admin' : 'Member'}
    </span>
  );
};

/**
 * Workspace members — one list for what used to be split between
 * Workspace Management → Members (workspace role, removal) and
 * User Management (per-resource access).
 */
export const MembersTab = (): ReactElement => {
  const self = useSelf();
  const z = useZero();
  const users = useUsers();
  const { isMobile } = usePlatform();
  const canEditAccess = useHasResourceAccess('USERS');
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 300);
  const [editingUser, setEditingUser] = useState<UserType | null>(null);
  const [userToRemove, setUserToRemove] = useState<UserType | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const workspaceId = self?.workspaceId;
  const canManageMembers = isWorkspaceAdmin(self?.role);

  const filteredUsers = useMemo(() => {
    if (!debouncedSearchQuery.trim()) return users;
    return searchUsers(users, debouncedSearchQuery, users.length);
  }, [users, debouncedSearchQuery]);

  const adminCount = useMemo(
    () => users.filter(u => u.role === WorkspaceRole.ADMIN).length,
    [users],
  );

  useEffect(() => {
    if (isMobile || editingUser) return;
    const rafId = requestAnimationFrame(() => searchInputRef.current?.focus());
    return (): void => cancelAnimationFrame(rafId);
  }, [isMobile, editingUser]);

  // The last admin can be neither demoted nor removed.
  const isLastAdmin = (user: UserType): boolean =>
    user.role === WorkspaceRole.ADMIN && adminCount <= 1;

  const handleUpdateRole = (
    user: UserType,
    newRole: WorkspaceRole.ADMIN | WorkspaceRole.MEMBER,
  ): void => {
    if (!workspaceId) return;
    z.mutate(
      mutators.users.updateRole({
        workspaceId,
        userId: user.id,
        updates: { role: newRole },
        timestamp: Date.now(),
      }),
    );
    toast.success(
      `${user.name} is now ${newRole === WorkspaceRole.ADMIN ? 'an admin' : 'a member'}`,
    );
  };

  const confirmRemoveMember = (): void => {
    if (!workspaceId || !userToRemove) return;
    z.mutate(
      mutators.users.remove({ workspaceId, userId: userToRemove.id, timestamp: Date.now() }),
    );
    toast.success(`${userToRemove.name} has been removed from the workspace`);
    setUserToRemove(null);
  };

  const renderUserBadge = (user: UserType): ReactElement => (
    <>
      <WorkspaceRoleBadge role={user.role} />
      {user.id === self?.id && <span className='text-xs text-muted-foreground'>(You)</span>}
    </>
  );

  const renderActions = (user: UserType): ReactElement => (
    <>
      {canEditAccess && (
        <Button
          variant='secondary'
          size='sm'
          onClick={() => setEditingUser(user)}
          data-track-category='workspace-management'
          data-track-name='EDIT_USER_ACCESS'
        >
          Edit access
        </Button>
      )}
      {canManageMembers && user.role !== WorkspaceRole.OWNER && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant='ghost'
              size='sm'
              aria-label={`More actions for ${user.name}`}
              className='h-8 w-8 p-0'
              data-track-category='workspace-management'
              data-track-name='OPEN_MEMBER_ACTIONS'
            >
              <MoreHorizontal className='w-4 h-4' />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            {user.role === WorkspaceRole.ADMIN ? (
              <DropdownMenuItem
                onClick={() => handleUpdateRole(user, WorkspaceRole.MEMBER)}
                disabled={isLastAdmin(user)}
                data-track-category='workspace-management'
                data-track-name='SET_MEMBER_ROLE_MEMBER'
              >
                <User className='w-4 h-4 mr-2' />
                Make member
                {isLastAdmin(user) && (
                  <span className='ml-2 text-xs text-muted-foreground'>(Last admin)</span>
                )}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                onClick={() => handleUpdateRole(user, WorkspaceRole.ADMIN)}
                data-track-category='workspace-management'
                data-track-name='SET_MEMBER_ROLE_ADMIN'
              >
                <Shield className='w-4 h-4 mr-2' />
                Make admin
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => setUserToRemove(user)}
              disabled={isLastAdmin(user)}
              className='text-destructive focus:text-destructive'
              data-track-category='workspace-management'
              data-track-name='OPEN_REMOVE_MEMBER_CONFIRM'
            >
              <UserMinus className='w-4 h-4 mr-2' />
              Remove from workspace
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </>
  );

  const loading = users === undefined;

  return (
    <div data-testid='user-management-page' className='space-y-6'>
      <div>
        <h2 className='text-lg font-semibold text-foreground'>Members</h2>
        <p className='text-sm text-muted-foreground'>
          {users.length} member{users.length !== 1 ? 's' : ''} • {adminCount} admin
          {adminCount !== 1 ? 's' : ''}
          {canEditAccess && ' · Edit access controls which resources each member can use'}
        </p>
      </div>

      <div className='relative max-w-md'>
        <Search className='absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none' />
        <Input
          ref={searchInputRef}
          type='text'
          placeholder='Search members by name or email...'
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className='pl-10 w-full'
        />
      </div>

      {loading ? (
        <div className='h-64 flex items-center justify-center'>
          <p className='text-muted-foreground'>Loading members...</p>
        </div>
      ) : filteredUsers.length === 0 ? (
        <div className='rounded-lg border border-border bg-card p-8 text-center'>
          <h3 className='text-sm font-semibold text-foreground mb-1'>
            {users.length === 0 ? 'No members yet' : 'No members match'}
          </h3>
          <p className='text-xs text-muted-foreground'>
            {users.length === 0
              ? 'Invite people from Invitations to get started'
              : 'Try a different name or email'}
          </p>
        </div>
      ) : (
        <UserListView
          users={filteredUsers}
          renderUserBadge={renderUserBadge}
          renderActions={renderActions}
        />
      )}

      {editingUser && (
        <ResourceAccessModal
          userId={editingUser.id}
          isOpen={true}
          onClose={() => setEditingUser(null)}
        />
      )}

      <Dialog
        open={userToRemove !== null}
        onOpenChange={open => !open && setUserToRemove(null)}
        className='max-w-md rounded-xl'
      >
        <div className='p-6 space-y-4'>
          <div className='flex items-center gap-3'>
            <div className='w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center'>
              <AlertTriangle className='w-5 h-5 text-destructive' />
            </div>
            <h2 className='text-lg font-semibold text-foreground'>Remove Member</h2>
          </div>
          <p className='text-sm text-muted-foreground'>
            Are you sure you want to remove{' '}
            <span className='font-medium text-foreground'>{userToRemove?.name}</span> from this
            workspace? They will lose access to all workspace resources.
          </p>
          <div className='flex gap-3 justify-end pt-2'>
            <Button
              variant='outline'
              onClick={() => setUserToRemove(null)}
              data-track-category='workspace-management'
              data-track-name='CANCEL_REMOVE_MEMBER'
            >
              Cancel
            </Button>
            <Button
              variant='destructive'
              onClick={confirmRemoveMember}
              data-track-category='workspace-management'
              data-track-name='CONFIRM_REMOVE_MEMBER'
            >
              Remove
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
};

export default MembersTab;
