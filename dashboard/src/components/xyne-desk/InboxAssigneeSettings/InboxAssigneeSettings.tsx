import React, { useMemo } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/Select';
import { useUserGroups } from '../../../hooks/useUserGroup';
import { Users } from 'lucide-react';

interface InboxAssigneeSettingsProps {
  value: string | null | undefined;
  onChange: (newUserGroupId: string | null) => void;
  disabled?: boolean;
}

export const InboxAssigneeSettings: React.FC<InboxAssigneeSettingsProps> = ({
  value,
  onChange,
  disabled,
}) => {
  const userGroups = useUserGroups();

  const userGroupOptions = useMemo(
    () =>
      userGroups?.map(group => ({
        label: group.name,
        value: group.id,
      })) || [],
    [userGroups],
  );

  const handleUserGroupChange = (next: string) => {
    onChange(next === 'none' ? null : next);
  };

  return (
    <div className='space-y-2'>
      <div className='flex items-center gap-2'>
        <Users size={16} className='text-muted-foreground' />
        <label htmlFor='inbox-assignee-user-group' className='text-sm font-medium text-foreground'>
          Default Assignee User Group
        </label>
      </div>
      <p className='text-xs text-muted-foreground'>
        Tickets created from emails in this channel will be assigned to this user group
      </p>

      <Select
        value={value || 'none'}
        onValueChange={handleUserGroupChange}
        disabled={disabled || userGroupOptions.length === 0}
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
  );
};
