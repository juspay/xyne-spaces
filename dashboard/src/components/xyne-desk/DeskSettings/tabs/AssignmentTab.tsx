import React from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../ui/Select/Select';
import { useUserGroups } from '../../../../hooks/useUserGroup';
import type { useDeskSettingsForm } from '../useDeskSettingsForm';

type DeskSettingsForm = ReturnType<typeof useDeskSettingsForm>;

interface AssignmentTabProps {
  form: DeskSettingsForm;
}

export const AssignmentTab: React.FC<AssignmentTabProps> = ({ form }) => {
  const allUserGroups = useUserGroups();
  const { defaultAssigneeGroupId, handleAssigneeChange } = form;

  return (
    <div className='flex flex-col gap-[8px]'>
      <div>
        <div className='text-sm font-medium text-foreground'>Default Assignee User Group</div>
        <div className='text-desk-helper w-full max-w-[400px]'>
          Tickets created from emails in this channel will be assigned to this user group
        </div>
      </div>
      <Select value={defaultAssigneeGroupId || 'none'} onValueChange={handleAssigneeChange}>
        <SelectTrigger className='w-full max-w-[300px] h-[38px] px-[14px] py-[10px] bg-background rounded-[10px] font-medium shadow-sm'>
          <SelectValue
            placeholder={
              (allUserGroups ?? []).length > 0 ? 'Select user group' : 'No user groups available'
            }
          />
        </SelectTrigger>
        <SelectContent className='rounded-[10px]'>
          <SelectItem value='none' className='rounded-[8px]'>
            No default group
          </SelectItem>
          {(allUserGroups ?? []).map(group => (
            <SelectItem key={group.id} value={group.id} className='rounded-[8px]'>
              {group.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {(allUserGroups ?? []).length === 0 && (
        <p className='text-desk-helper'>No user groups found. Create one in team settings first.</p>
      )}
    </div>
  );
};
