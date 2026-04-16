import React, { useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { Button } from '../../ui/Button';
import { SearchUser } from '../../ui/SearchUser/SearchUser';
import Textarea from '../../ui/Textarea';
import { User } from '@xyne/shared';
import { useAuthContextValues } from '../../../hooks/useAuth';
import { getUserDisplayName } from '../../../utils/userDisplayName';

export interface CreateDmFormData {
  participants: User[];
  message: string;
}

interface AddDmFormProps {
  onSubmit: (data: CreateDmFormData) => void;
  onCancel: () => void;
  loading?: boolean;
}

export const AddDmForm: React.FC<AddDmFormProps> = ({ onSubmit, loading, onCancel }) => {
  const [selectedUsers, setSelectedUsers] = useState<User[]>([]);
  const context = useAuthContextValues();

  const form = useForm({
    defaultValues: {
      message: '',
    },
    onSubmit: ({ value }) => {
      onSubmit?.({
        participants: selectedUsers,
        message: value.message,
      });
    },
  });

  const handleUsersChange = (users: User[]): void => {
    setSelectedUsers(users);
  };

  const getConversationTitle = (): string => {
    if (selectedUsers.length === 0) return 'Select people to message';
    if (selectedUsers.length === 1) {
      const user = selectedUsers[0];
      if (!user) return 'Select people to message';
      const displayName = getUserDisplayName(user);
      if (user.id === context.userID) return `${displayName} (you)`;
      return `Message ${displayName}`;
    }
    if (selectedUsers.length <= 3) {
      return selectedUsers.map(u => getUserDisplayName(u)).join(', ');
    }
    const firstTwo = selectedUsers
      .slice(0, 2)
      .map(u => getUserDisplayName(u))
      .join(', ');
    const remaining = selectedUsers.length - 2;
    return `${firstTwo} + ${remaining} others`;
  };

  return (
    <form
      onSubmit={e => {
        e.preventDefault();
        e.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <div className='space-y-6  mx-auto'>
        {/* Conversation Preview */}
        <div>
          <div className='text-base font-medium text-foreground mb-1'>{getConversationTitle()}</div>
          {selectedUsers.length > 0 && (
            <div className='text-xs text-muted-foreground'>
              {selectedUsers.length === 1 && selectedUsers[0]?.id === context.userID
                ? 'Personal notes and reminders'
                : selectedUsers.length === 1
                  ? 'Direct message'
                  : `Group conversation with ${selectedUsers.length} people`}
            </div>
          )}
        </div>

        {/* User Search */}
        <div>
          <SearchUser
            selectedUsers={selectedUsers}
            onUsersChange={handleUsersChange}
            placeholder='Type to find people...'
            label={`Add people (${selectedUsers.length}/9)`}
            hintText='Search user by email or name'
          />
          {selectedUsers.length === 0 && (
            <div className='text-sm text-destructive mt-1'>
              Please select at least one person to message
            </div>
          )}
          {selectedUsers.length > 9 && (
            <div className='text-sm text-destructive mt-1'>Maximum 9 recipients allowed</div>
          )}
        </div>

        {/* Message Input */}
        <form.Field
          name='message'
          validators={{
            onChange: ({ value }) => {
              if (value.length > 1000) return 'Message must be 1000 characters or less';
              return undefined;
            },
          }}
        >
          {field => (
            <div className='space-y-1.5'>
              <label htmlFor='dm-message' className='text-sm font-medium text-foreground'>
                Message (optional)
              </label>
              <Textarea
                id='dm-message'
                value={field.state.value}
                onChange={e => field.handleChange(e.target.value)}
                placeholder='Say something to start the conversation...'
                rows={4}
                data-testid='dm-message-textarea'
                aria-invalid={field.state.meta.errors.length > 0}
              />
              <div className='flex justify-end mt-1'>
                <span className='text-sm text-muted-foreground'>{`${field.state.value.length}/1000 characters`}</span>
              </div>
              {field.state.meta.errors.length > 0 && field.state.meta.errors[0] && (
                <p className='text-sm text-destructive'>{field.state.meta.errors[0]}</p>
              )}
            </div>
          )}
        </form.Field>

        {/* Participant Limit Notice */}
        {selectedUsers.length >= 9 && (
          <div className='p-3 bg-muted border border-border rounded-lg'>
            <p className='text-sm text-status-pending'>
              Maximum of 9 people can be added to a conversation.
            </p>
          </div>
        )}

        {/* Action Buttons */}
        <div className='flex justify-end space-x-3 pt-4'>
          {onCancel && (
            <Button
              variant='ghost'
              size='default'
              type='button'
              onClick={e => {
                e.preventDefault();
                onCancel();
              }}
              data-track-category='ADD_DM_FORM'
              data-track-name='Cancel_Create_DM'
              data-track-metadata={JSON.stringify({ selectedUserCount: selectedUsers })}
            >
              Cancel
            </Button>
          )}
          <Button
            type='submit'
            variant='default'
            size='default'
            className='bg-action-primary text-action-primary-foreground hover:bg-action-primary/90'
            loading={loading || false}
            disabled={selectedUsers.length === 0}
            data-testid='start-dm-btn'
            data-track-category='ADD_DM_FORM'
            data-track-name='Start_DM'
            data-track-metadata={JSON.stringify({ selectedUserCount: selectedUsers })}
          >
            Start DM
          </Button>
        </div>
      </div>
    </form>
  );
};

export default AddDmForm;
