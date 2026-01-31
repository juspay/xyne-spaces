import { ReactElement, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { Button } from '../../ui/Button/Button';
import Input from '../../ui/Input/Input';
import Textarea from '../../ui/Textarea/Textarea';
import { UserManagement } from '../UserManagement';
import { UserSelector } from '../UserManagement/UserSelector/UserSelector';
import type { UserGroup, User } from '@xyne/shared';

interface UserGroupFormData {
  name: string;
  alias: string;
  description: string;
}

interface UserGroupFormProps {
  userGroup?: UserGroup;
  onSubmit: (data: {
    name?: string;
    alias?: string;
    description?: string;
    userIds?: string[];
  }) => Promise<{ id: string }> | void;
  onCancel: () => void;
  loading?: boolean;
}

export const UserGroupForm = ({
  userGroup,
  onSubmit,
  onCancel,
  loading = false,
}: UserGroupFormProps): ReactElement => {
  const isEdit = !!userGroup;
  const [selectedUsers, setSelectedUsers] = useState<User[]>([]);
  const [error, setError] = useState<string | null>(null);

  const {
    control,
    handleSubmit: handleFormSubmit,
    formState: { isSubmitting },
  } = useForm<UserGroupFormData>({
    defaultValues: {
      name: userGroup?.name || '',
      alias: userGroup?.alias || '',
      description: userGroup?.description || '',
    },
  });

  const handleSubmit = async (formData: UserGroupFormData): Promise<void> => {
    const { name, alias, description } = formData;

    if (alias && !/^[a-z0-9_-]+$/.test(alias)) {
      setError('Alias can only contain lowercase letters, numbers, hyphens, and underscores');
      return;
    }

    try {
      setError(null);

      if (isEdit) {
        // Edit mode - only send changed fields
        const updateData: {
          name?: string;
          alias?: string;
          description?: string;
          userIds?: string[];
        } = {};

        if (name.trim() !== userGroup.name) {
          updateData.name = name.trim();
        }

        const trimmedAlias = alias.trim();
        if (trimmedAlias !== (userGroup.alias || '')) {
          if (trimmedAlias) {
            updateData.alias = trimmedAlias;
          }
        }

        const trimmedDescription = description.trim();
        if (trimmedDescription !== (userGroup.description || '')) {
          updateData.description = trimmedDescription;
        }

        // Always include userIds for update
        updateData.userIds = selectedUsers.map(user => user.id);

        await onSubmit(updateData);
      } else {
        // Create mode - send all fields
        const data: { name: string; alias?: string; description?: string; userIds?: string[] } = {
          name: name.trim(),
        };

        if (alias.trim()) {
          data.alias = alias.trim();
        }

        if (description.trim()) {
          data.description = description.trim();
        }

        if (selectedUsers.length > 0) {
          data.userIds = selectedUsers.map(user => user.id);
        }

        await onSubmit(data);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : `Failed to ${isEdit ? 'update' : 'create'} user group`,
      );
    }
  };

  const isLoading = loading || isSubmitting;

  return (
    <form
      onSubmit={e => {
        void handleFormSubmit(handleSubmit)(e);
      }}
      className='space-y-6 p-6'
    >
      {error && (
        <div className='bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded'>
          {error}
        </div>
      )}

      <div>
        <label htmlFor='name' className='block text-sm font-medium text-foreground mb-1.5'>
          User Group Name
        </label>
        <Controller
          name='name'
          control={control}
          rules={{ required: 'User group name is required' }}
          render={({ field: { onChange, value } }) => (
            <Input
              id='name'
              value={value}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
              placeholder='Enter user group name'
              required
              disabled={isLoading}
            />
          )}
        />
      </div>

      <div>
        <label htmlFor='alias' className='block text-sm font-medium text-foreground mb-1.5'>
          Alias (for mentions)
        </label>
        <Controller
          name='alias'
          control={control}
          render={({ field: { onChange, value } }) => (
            <Input
              id='alias'
              value={value}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
              placeholder='e.g., frontend-team, backend-devs (optional)'
              disabled={isLoading}
            />
          )}
        />
        <p className='text-xs text-muted-foreground mt-1.5'>
          Lowercase letters, numbers, hyphens, and underscores only
        </p>
      </div>

      <div>
        <label htmlFor='description' className='block text-sm font-medium text-foreground mb-1.5'>
          Description
        </label>
        <Controller
          name='description'
          control={control}
          render={({ field: { onChange, value } }) => (
            <Textarea
              id='description'
              value={value}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value)}
              placeholder='Enter user group description (optional)'
              rows={4}
              disabled={isLoading}
            />
          )}
        />
      </div>

      {/* User Management - Show for both create and edit modes */}
      <div>
        <hr className='border-gray-200 my-6' />
        <div className='text-sm text-gray-600 mb-4'>
          <p className='font-medium mb-2'>User Management</p>
        </div>

        {isEdit && userGroup ? (
          <UserManagement
            userGroupId={userGroup.id}
            disabled={isLoading}
            onUsersChange={() => {
              // Force re-render if needed
            }}
          />
        ) : (
          <UserSelector
            userGroupId='' // Will be set after creation
            excludeUserIds={[]}
            onUsersAdded={() => {
              // Users are handled in form submission
            }}
            disabled={
              isLoading
                ? {
                    value: true,
                    reason: 'Cannot add users while creating group',
                  }
                : false
            }
            selectedUsersOverride={selectedUsers}
            onSelectedUsersChange={setSelectedUsers}
          />
        )}
      </div>

      <div className='flex gap-2 justify-end'>
        <Button variant='outline' onClick={onCancel} disabled={isLoading} type='button'>
          Cancel
        </Button>
        <Button variant='default' type='submit' disabled={isLoading}>
          {isLoading
            ? isEdit
              ? 'Updating...'
              : 'Creating...'
            : isEdit
              ? 'Update User Group'
              : 'Create User Group'}
        </Button>
      </div>
    </form>
  );
};
