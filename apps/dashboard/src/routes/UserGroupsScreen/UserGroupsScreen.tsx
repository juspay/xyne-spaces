import { ReactElement, useState, useMemo, useRef, useEffect } from 'react';
import { useZero } from '../../hooks/useZero';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { PlusDefault, SearchBig, UserThree } from '@xyne/icons';
import { Button } from '../../components/ui/Button/Button';
import { Dialog } from '../../components/ui/Dialog/Dialog';
import Input from '../../components/ui/Input/Input';
import { UserGroupListItem } from '../../components/UserGroup/UserGroupListItem/UserGroupListItem';
import { UserGroupForm } from '../../components/UserGroup/UserGroupForm/UserGroupForm';
import { apiInstance } from '../../services/clients/apiClient';
import type { UserGroup as ZeroUserGroup } from '@xyne/shared';
import { mutators } from '../../zero/mutators';
import { useUserGroups, useUserGroupsHydrated } from '../../hooks/useUserGroup';
import { usePlatform } from '../../hooks/usePlatform';
import { useHasResourceAccess, usePermissions } from '../../hooks/usePermissions';
import { useAuth } from '../../hooks/useAuth';
import { searchUserGroups } from './UserGroupsScreen.utils';
import { AccessType } from '@xyne/shared';

const UserGroupsScreen = (): ReactElement => {
  const zero = useZero();
  const { user } = useAuth();
  const { isMobile } = usePlatform();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingUserGroup, setEditingUserGroup] = useState<ZeroUserGroup | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const userGroups = useUserGroups();
  const userGroupsHydrated = useUserGroupsHydrated();
  const permissions = usePermissions();
  const hasUserGroupsAdminAccess = useHasResourceAccess('USER-GROUPS');
  const canCreateUserGroup = permissions.some(
    permission =>
      permission.resourceName === 'USER-GROUPS' &&
      (permission.accessType === AccessType.WRITE || permission.accessType === AccessType.ADMIN),
  );

  const loading = !userGroupsHydrated;

  // Non-admins only see the groups they created; the search is fuzzy so typos
  // and partial names still resolve.
  const filteredUserGroups = useMemo(() => {
    const visible = hasUserGroupsAdminAccess
      ? userGroups
      : userGroups.filter(group => group.createdBy === user?.id);

    return searchUserGroups(visible, searchQuery);
  }, [userGroups, hasUserGroupsAdminAccess, user?.id, searchQuery]);

  const createUserGroupMutation = useMutation({
    mutationFn: async (data: {
      name?: string;
      alias?: string;
      description?: string;
      userIds?: string[];
      userRoleUpdates?: Record<string, string>;
    }) => {
      const response = await apiInstance.post('/user-groups', data);
      return response.data as { id: string };
    },
    onSuccess: () => {
      setShowCreateModal(false);
    },
  });

  const handleCreateUserGroup = async (data: {
    name?: string;
    alias?: string;
    description?: string;
    userIds?: string[];
    userRoleUpdates?: Record<string, string>;
  }): Promise<{ id: string }> => {
    return await createUserGroupMutation.mutateAsync(data);
  };

  const handleUpdateUserGroup = async (
    userGroupId: string,
    data: {
      name?: string;
      alias?: string;
      description?: string;
      userRoleUpdates?: Record<string, string>;
    },
  ): Promise<void> => {
    const result = zero.mutate(
      mutators.userGroup.update({
        userGroupId,
        ...(data.name !== undefined && { name: data.name }),
        ...(data.alias !== undefined && { alias: data.alias }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.userRoleUpdates !== undefined && {
          userRoleUpdates: data.userRoleUpdates,
        }),
        timestamp: Date.now(),
      }),
    );
    const res = await result.server;
    if (res.type === 'error') {
      toast.error('Update Failed', {
        description: res.error.message || 'Failed to update user group',
        duration: 5000,
      });
    } else {
      toast.success('User Group Updated', {
        description: 'User group has been successfully updated',
        duration: 3000,
      });
      setEditingUserGroup(null);
    }
  };

  const handleDeactivateUserGroup = async (userGroupId: string): Promise<void> => {
    try {
      const timestamp = Date.now();
      const result = zero.mutate(mutators.userGroup.deactivate({ userGroupId, timestamp }));
      const res = await result.server;
      if (res.type === 'error') {
        toast.error('Deactivate Failed', {
          description: res.error.message || 'Failed to deactivate user group',
          duration: 5000,
        });
      } else {
        toast.success('User Group Deactivated', {
          description: 'User group has been successfully deactivated',
          duration: 3000,
        });
      }
    } catch (error) {
      toast.error('Deactivate Failed', {
        description: error instanceof Error ? error.message : 'An unexpected error occurred',
        duration: 5000,
      });
    }
  };

  const handleReactivateUserGroup = async (userGroupId: string): Promise<void> => {
    try {
      const timestamp = Date.now();
      const result = zero.mutate(mutators.userGroup.reactivate({ userGroupId, timestamp }));
      const res = await result.server;
      if (res.type === 'error') {
        toast.error('Reactivate Failed', {
          description: res.error.message || 'Failed to reactivate user group',
          duration: 5000,
        });
      } else {
        toast.success('User Group Reactivated', {
          description: 'User group has been successfully reactivated',
          duration: 3000,
        });
      }
    } catch (error) {
      toast.error('Reactivate Failed', {
        description: error instanceof Error ? error.message : 'An unexpected error occurred',
        duration: 5000,
      });
    }
  };

  useEffect((): (() => void) | undefined => {
    if (isMobile || editingUserGroup || showCreateModal) return;
    const rafId = requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
    return () => cancelAnimationFrame(rafId);
  }, [isMobile, editingUserGroup, showCreateModal]);

  if (loading) {
    return (
      <div className='h-full bg-background flex items-center justify-center'>
        <p className='text-muted-foreground'>Loading...</p>
      </div>
    );
  }

  return (
    <div className='h-full w-full bg-background md:rounded-2xl overflow-hidden shadow-md flex flex-col'>
      {/* Header */}
      <div className='shrink-0'>
        <div className='flex w-full flex-col gap-5 px-6 pt-5'>
          <div className='flex items-center gap-5'>
            <div className='flex min-w-0 flex-1 flex-col gap-1'>
              <h2 className='text-base font-bold leading-7 tracking-[-0.32px] text-foreground'>
                User Groups
              </h2>
              <p className='text-[15px] leading-[1.2] text-muted-foreground'>
                Manage your organization user groups and teams
              </p>
            </div>
            {canCreateUserGroup && (
              <Button
                className='h-auto shrink-0 gap-1.5 rounded-lg p-2 text-sm'
                onClick={() => setShowCreateModal(true)}
                data-track-category='UserGroups'
                data-track-name='CreateUserGroup'
                data-testid='create-user-group-btn'
              >
                <PlusDefault size={16} />
                Create User Group
              </Button>
            )}
          </div>

          {/* Search */}
          <div className='flex h-[33px] w-full max-w-[416px] items-center gap-[5px] rounded-md border border-border pl-[5px] pr-2 transition-colors focus-within:border-ring'>
            <span className='flex size-7 shrink-0 items-center justify-center text-muted-foreground'>
              <SearchBig size={16} />
            </span>
            <Input
              ref={searchInputRef}
              type='text'
              placeholder='Search user groups by name...'
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className='h-full min-w-0 flex-1 rounded-none border-0 p-0 text-[13px] shadow-none focus-visible:border-0 focus-visible:ring-0 md:text-[13px]'
            />
          </div>
        </div>
      </div>

      {/* User Groups */}
      <div className='flex-1 overflow-y-auto'>
        <div className='w-full px-6 pb-8 pt-8'>
          {filteredUserGroups.length > 0 ? (
            <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
              {filteredUserGroups.map((userGroup: ZeroUserGroup) => (
                <UserGroupListItem
                  key={userGroup.id}
                  userGroup={userGroup}
                  onEdit={setEditingUserGroup}
                  onDeactivate={handleDeactivateUserGroup}
                  onReactivate={handleReactivateUserGroup}
                />
              ))}
            </div>
          ) : (
            <div className='flex flex-col items-center py-16 text-center'>
              <UserThree size={40} className='mb-4 text-muted-foreground' />
              <h3 className='mb-2 text-base font-semibold text-foreground'>
                {searchQuery ? 'No matching user groups' : 'No user groups yet'}
              </h3>
              <p className='text-[13px] text-muted-foreground'>
                {searchQuery
                  ? 'Try adjusting your search'
                  : 'Get started by creating your first user group'}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Create Modal */}
      {canCreateUserGroup && (
        <Dialog
          open={showCreateModal}
          onOpenChange={setShowCreateModal}
          title='Create New User Group'
          className='max-w-xl'
        >
          <UserGroupForm
            onSubmit={handleCreateUserGroup}
            onCancel={() => setShowCreateModal(false)}
          />
        </Dialog>
      )}

      {/* Edit Modal */}
      <Dialog
        open={!!editingUserGroup}
        onOpenChange={open => {
          if (!open) setEditingUserGroup(null);
        }}
        title='Edit User Group'
        className='max-w-xl'
      >
        {editingUserGroup && (
          <UserGroupForm
            userGroup={editingUserGroup}
            onSubmit={data => handleUpdateUserGroup(editingUserGroup.id, data)}
            onCancel={() => setEditingUserGroup(null)}
          />
        )}
      </Dialog>
    </div>
  );
};

UserGroupsScreen.displayName = 'UserGroupsScreen';

export default UserGroupsScreen;
