import { ReactElement, useState, useMemo } from 'react';
import { useZero } from '../../hooks/useZero';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Search } from 'lucide-react';
import { Button } from '../../components/ui/Button/Button';
import { Dialog } from '../../components/ui/Dialog/Dialog';
import Input from '../../components/ui/Input/Input';
import { UserGroupListItem } from '../../components/UserGroup/UserGroupListItem/UserGroupListItem';
import { UserGroupForm } from '../../components/UserGroup/UserGroupForm/UserGroupForm';
import { apiInstance } from '../../services/clients/apiClient';
import { queries } from '../../zero/queries';
import type { UserGroup as ZeroUserGroup } from '@xyne/shared';
import { UserResponsibility } from '@xyne/shared';
import { mutators } from '../../zero/mutators';
import { useCachedQuery } from '../../hooks/useCachedQuery';

const UserGroupsScreen = (): ReactElement => {
  const zero = useZero();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingUserGroup, setEditingUserGroup] = useState<ZeroUserGroup | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showManagedOnly, setShowManagedOnly] = useState(false);

  // Fetch all user groups using zero - only if user is authenticated
  const [userGroups] = useCachedQuery(queries.getAllUserGroups());
  // Fetch current user's group memberships to find which groups they manage
  const [userMemberships] = useCachedQuery(queries.getUserGroupMappingsByUserId());

  const loading = userGroups === undefined;

  // Get set of group IDs where current user is MANAGER or TEAM_LEAD
  const managedGroupIds = useMemo(() => {
    if (!userMemberships) return new Set<string>();
    return new Set(
      userMemberships
        .filter(
          m =>
            m.responsibility === UserResponsibility.MANAGER ||
            m.responsibility === UserResponsibility.TEAM_LEAD,
        )
        .map(m => m.userGroupId),
    );
  }, [userMemberships]);

  // Filter groups based on search and "Managed by Me" filter
  const filteredUserGroups = useMemo(() => {
    if (!userGroups) return [];

    let filtered = userGroups;

    // Apply "Managed by Me" filter
    if (showManagedOnly) {
      filtered = filtered.filter(group => managedGroupIds.has(group.id));
    }

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      filtered = filtered.filter(
        group =>
          group.name?.toLowerCase().includes(query) ||
          group.alias?.toLowerCase().includes(query) ||
          group.description?.toLowerCase().includes(query),
      );
    }

    return filtered;
  }, [userGroups, showManagedOnly, managedGroupIds, searchQuery]);

  const createUserGroupMutation = useMutation({
    mutationFn: async (data: {
      name?: string;
      alias?: string;
      description?: string;
      userIds?: string[];
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
  }): Promise<{ id: string }> => {
    return await createUserGroupMutation.mutateAsync(data);
  };

  const handleUpdateUserGroup = async (
    userGroupId: string,
    data: {
      name?: string;
      alias?: string;
      description?: string;
      userResponsibilityUpdates?: Record<string, UserResponsibility>;
    },
  ): Promise<void> => {
    const result = zero.mutate(
      mutators.userGroup.update({
        userGroupId,
        ...(data.name !== undefined && { name: data.name }),
        ...(data.alias !== undefined && { alias: data.alias }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.userResponsibilityUpdates !== undefined && {
          userResponsibilityUpdates: data.userResponsibilityUpdates,
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

  const handleDeleteUserGroup = (userGroupId: string): void => {
    void zero.mutate(mutators.userGroup.delete({ userGroupId }));
  };

  if (loading) {
    return (
      <div className='h-full bg-background flex items-center justify-center'>
        <p className='text-muted-foreground'>Loading...</p>
      </div>
    );
  }

  return (
    <div className='h-full w-full bg-background md:rounded-2xl overflow-hidden shadow-md'>
      <div className='h-full overflow-hidden'>
        <div className='flex flex-col h-full'>
          <div className='p-6 border-b border-border bg-background'>
            <div className='flex items-center justify-between mb-4'>
              <div>
                <h2 className='text-lg font-bold text-foreground'>User Groups</h2>
                <p className='text-xs text-muted-foreground mt-1'>
                  Manage your organization user groups and teams
                </p>
              </div>
              <Button
                onClick={() => setShowCreateModal(true)}
                data-track-category='UserGroups'
                data-track-name='CreateUserGroup'
                data-testid='create-user-group-btn'
              >
                Create User Group
              </Button>
            </div>

            {/* Search and Filter Bar */}
            <div className='flex items-center gap-3 mt-4'>
              {/* Search Input */}
              <div className='relative flex-1 max-w-md'>
                <Search
                  className='absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground'
                  size={18}
                />
                <Input
                  type='text'
                  placeholder='Search user groups by name...'
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className='pl-10 w-full'
                />
              </div>

              {/* Filter Button */}
              <Button
                variant={showManagedOnly ? 'default' : 'outline'}
                onClick={() => setShowManagedOnly(!showManagedOnly)}
                className='whitespace-nowrap'
              >
                {showManagedOnly ? 'Managed by Me' : 'Managed by Me'}
              </Button>
            </div>
          </div>

          <div className='flex-1 overflow-y-auto p-4'>
            {filteredUserGroups && filteredUserGroups.length > 0 ? (
              <div className='space-y-2'>
                {filteredUserGroups.map((userGroup: ZeroUserGroup) => (
                  <UserGroupListItem
                    key={userGroup.id}
                    userGroup={userGroup}
                    onEdit={setEditingUserGroup}
                    onDelete={(userGroupId: string) => void handleDeleteUserGroup(userGroupId)}
                  />
                ))}
              </div>
            ) : (
              <div className='text-center py-16'>
                <div className='text-muted-foreground text-5xl mb-4'>👥</div>
                <h3 className='text-xl font-semibold text-foreground mb-2'>
                  {searchQuery || showManagedOnly
                    ? 'No matching user groups'
                    : 'No user groups yet'}
                </h3>
                <p className='text-muted-foreground'>
                  {searchQuery || showManagedOnly
                    ? 'Try adjusting your search or filter'
                    : 'Get started by creating your first user group'}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Create Modal */}
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
