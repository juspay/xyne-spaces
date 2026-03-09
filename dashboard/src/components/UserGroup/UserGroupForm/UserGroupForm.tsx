import { ReactElement, useState, useEffect, useRef } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { Users } from 'lucide-react';
import { Button } from '../../ui/Button/Button';
import Input from '../../ui/Input/Input';
import Textarea from '../../ui/Textarea/Textarea';
import { UserManagement } from '../UserManagement';
import type { UserGroup, User } from '@xyne/shared';
import { UserResponsibility } from '@xyne/shared';
import { queries } from '../../../zero/queries';
import { useCachedQuery } from '../../../hooks/useCachedQuery';

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
    responsibilities?: Record<string, UserResponsibility>; // Send ALL, not just updates
  }) => Promise<{ id: string }> | Promise<void> | void;
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
  const [activeTab, setActiveTab] = useState<'about' | 'members'>('about');

  // ONE Map - mutate directly
  const responsibilitiesRef = useRef<Map<string, UserResponsibility>>(new Map());
  const responsibilities = responsibilitiesRef.current;

  // Load server data
  const [userGroupMembers] = useCachedQuery(
    userGroup
      ? queries.getUserGroupMembers({ userGroupId: userGroup.id })
      : queries.getUserGroupMembers({ userGroupId: '' }),
    { enabled: isEdit && !!userGroup },
  );

  // Initialize from server data
  useEffect(() => {
    if (isEdit && userGroupMembers) {
      responsibilitiesRef.current.clear();
      userGroupMembers.forEach(mapping => {
        responsibilitiesRef.current.set(mapping.userId, mapping.responsibility);
      });
    }
  }, [isEdit, userGroupMembers]);

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
          userResponsibilityUpdates?: Record<string, UserResponsibility>;
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

        // Send ALL responsibilities (like form sends all fields)
        if (responsibilities.size > 0) {
          updateData.userResponsibilityUpdates = Object.fromEntries(responsibilities);
        }

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
      className='flex flex-col h-[800px]'
    >
      {/* User Group Header */}
      <div className='px-6 py-4 border-b border-border'>
        <div className='flex items-center gap-3'>
          <div className='w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center'>
            <Users className='w-5 h-5 text-primary' />
          </div>
          <div>
            <h2 className='text-lg font-semibold text-foreground'>
              {isEdit ? userGroup.name : 'New User Group'}
            </h2>
            {isEdit && userGroup.alias && (
              <p className='text-sm text-muted-foreground'>@{userGroup.alias}</p>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className='bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mx-6 mt-6'>
          {error}
        </div>
      )}

      {/* Tabs Header */}
      <div className='border-b border-border px-6'>
        <div className='flex gap-6'>
          <Button
            type='button'
            variant='ghost'
            onClick={() => setActiveTab('about')}
            className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors rounded-none ${
              activeTab === 'about'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-input'
            }`}
            data-track-category='UserGroups'
            data-track-name='SwitchToAboutTab'
          >
            About
          </Button>
          <Button
            type='button'
            variant='ghost'
            onClick={() => setActiveTab('members')}
            className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors rounded-none ${
              activeTab === 'members'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-input'
            }`}
            data-track-category='UserGroups'
            data-track-name='SwitchToMembersTab'
          >
            Members
          </Button>
        </div>
      </div>

      {/* Tab Content */}
      <div className='flex-1 overflow-y-auto'>
        {activeTab === 'about' && (
          <div className='space-y-6 p-6'>
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
              <label
                htmlFor='description'
                className='block text-sm font-medium text-foreground mb-1.5'
              >
                Description
              </label>
              <Controller
                name='description'
                control={control}
                render={({ field: { onChange, value } }) => (
                  <Textarea
                    id='description'
                    value={value}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                      onChange(e.target.value)
                    }
                    placeholder='Enter user group description (optional)'
                    rows={4}
                    disabled={isLoading}
                  />
                )}
              />
            </div>
          </div>
        )}

        {activeTab === 'members' && (
          <div className='h-full flex flex-col'>
            <UserManagement
              userGroupId={userGroup?.id}
              selectedUsers={isEdit ? undefined : selectedUsers}
              onUsersChange={isEdit ? undefined : setSelectedUsers}
              disabled={isLoading}
              responsibilities={responsibilities}
            />
          </div>
        )}
      </div>

      {/* Footer Actions */}
      <div className='border-t border-border p-6 flex gap-2 justify-end bg-background'>
        <Button
          variant='outline'
          onClick={onCancel}
          disabled={isLoading}
          type='button'
          data-track-category='UserGroups'
          data-track-name='CancelUserGroupForm'
        >
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
