import React, { useState, useMemo, useEffect } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/Select';
import { Button } from '../../ui/Button';
import { useUserGroups } from '../../../hooks/useUserGroup';
import { useUpdateEmailChannelPreference } from '../../../hooks/useEmailChannelPreference';
import { Users } from 'lucide-react';

interface InboxAssigneeSettingsProps {
  channelId: string;
  currentAssigneeUserGroupId?: string | null | undefined;
  onUpdate?: (newUserGroupId: string | undefined) => void;
}

export const InboxAssigneeSettings: React.FC<InboxAssigneeSettingsProps> = ({
  channelId,
  currentAssigneeUserGroupId,
  onUpdate,
}) => {
  const userGroups = useUserGroups();
  const updatePreferenceMutation = useUpdateEmailChannelPreference();
  const [selectedUserGroupId, setSelectedUserGroupId] = useState<string | undefined>(
    currentAssigneeUserGroupId ?? undefined,
  );
  const [hasChanges, setHasChanges] = useState(false);

  // Update local state when prop changes
  useEffect(() => {
    setSelectedUserGroupId(currentAssigneeUserGroupId ?? undefined);
  }, [currentAssigneeUserGroupId]);

  // Memoized user group options for dropdown
  const userGroupOptions = useMemo(
    () =>
      userGroups?.map(group => ({
        label: group.name,
        value: group.id,
      })) || [],
    [userGroups],
  );

  const handleUserGroupChange = (value: string) => {
    const newValue = value === 'none' ? undefined : value;
    setSelectedUserGroupId(newValue);
    setHasChanges(newValue !== currentAssigneeUserGroupId);
  };

  const handleSave = async () => {
    try {
      await updatePreferenceMutation.mutateAsync({
        channelId,
        assigneeUserGroupId: selectedUserGroupId || null,
      });

      onUpdate?.(selectedUserGroupId);
      setHasChanges(false);
    } catch (error) {
      // Revert on error
      setSelectedUserGroupId(currentAssigneeUserGroupId ?? undefined);
      setHasChanges(false);
      console.error('Failed to update email channel preference:', error);
    }
  };

  const handleCancel = () => {
    setSelectedUserGroupId(currentAssigneeUserGroupId ?? undefined);
    setHasChanges(false);
  };

  return (
    <div className='space-y-4'>
      <div className='space-y-2'>
        <div className='flex items-center gap-2'>
          <Users size={16} className='text-muted-foreground' />
          <label
            htmlFor='inbox-assignee-user-group'
            className='text-sm font-medium text-foreground'
          >
            Default Assignee User Group
          </label>
        </div>
        <p className='text-xs text-muted-foreground'>
          Tickets created from emails in this channel will be assigned to this user group
        </p>

        <Select
          value={selectedUserGroupId || 'none'}
          onValueChange={handleUserGroupChange}
          disabled={userGroupOptions.length === 0 || updatePreferenceMutation.isPending}
        >
          <SelectTrigger id='inbox-assignee-user-group' className='w-full'>
            <SelectValue
              placeholder={
                userGroupOptions.length > 0 ? 'Select a user group' : 'No user groups available'
              }
            />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='none'>No default group</SelectItem>
            {userGroupOptions.map(option => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {userGroupOptions.length === 0 && (
          <p className='text-xs text-muted-foreground mt-1'>
            No user groups found. Create one in team settings first.
          </p>
        )}
      </div>

      {hasChanges && (
        <div className='flex gap-2'>
          <Button
            size='sm'
            onClick={() => void handleSave()}
            disabled={updatePreferenceMutation.isPending}
            data-track-category='INBOX_SETTINGS'
            data-track-name='SAVE_ASSIGNEE_USER_GROUP'
          >
            {updatePreferenceMutation.isPending ? 'Saving...' : 'Save Changes'}
          </Button>
          <Button
            size='sm'
            variant='outline'
            onClick={handleCancel}
            disabled={updatePreferenceMutation.isPending}
            data-track-category='INBOX_SETTINGS'
            data-track-name='CANCEL_ASSIGNEE_USER_GROUP'
          >
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
};
