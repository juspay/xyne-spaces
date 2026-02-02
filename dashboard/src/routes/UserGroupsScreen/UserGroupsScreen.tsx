import { ReactElement, useState } from 'react';
import { useZero } from '@rocicorp/zero/react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '../../components/ui/Button/Button';
import { Dialog } from '../../components/ui/Dialog/Dialog';
import { UserGroupListItem } from '../../components/UserGroup/UserGroupListItem/UserGroupListItem';
import { UserGroupForm } from '../../components/UserGroup/UserGroupForm/UserGroupForm';
import { apiInstance } from '../../services/clients/apiClient';
import { queries } from '../../zero/queries';
import type { UserGroup as ZeroUserGroup } from '@xyne/shared';
import { UserResponsibility } from '@xyne/shared';
import { mutators } from '../../zero/mutators';
import { useCachedQuery } from '../../hooks/useCachedQuery';

const UserGroupsScreen = (): ReactElement => {
  // const { user } = useAuth();
  const zero = useZero();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingUserGroup, setEditingUserGroup] = useState<ZeroUserGroup | null>(null);

  // Fetch all user groups using zero - only if user is authenticated
  const [userGroups] = useCachedQuery(queries.getAllUserGroups());

  const loading = userGroups === undefined;

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
      <div className='h-full bg-gray-50 flex items-center justify-center'>
        <p className='text-gray-600'>Loading...</p>
      </div>
    );
  }

  return (
    <div className='h-full w-full overflow-hidden bg-gray-50'>
      <div className='h-full overflow-hidden'>
        <div className='flex flex-col h-full'>
          <div className='flex items-center justify-between p-6 border-b border-gray-200 bg-white'>
            <div>
              <h2 className='text-lg font-bold text-gray-900'>User Groups</h2>
              <p className='text-xs text-gray-600 mt-1'>
                Manage your organization user groups and teams
              </p>
            </div>
            <Button onClick={() => setShowCreateModal(true)}>Create User Group</Button>
          </div>

          <div className='flex-1 overflow-y-auto p-4'>
            {userGroups && userGroups.length > 0 ? (
              <div className='space-y-2'>
                {userGroups.map((userGroup: ZeroUserGroup) => (
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
                <div className='text-gray-400 text-5xl mb-4'>👥</div>
                <h3 className='text-xl font-semibold text-gray-700 mb-2'>No user groups yet</h3>
                <p className='text-gray-500'>Get started by creating your first user group</p>
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
