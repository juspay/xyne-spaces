import React from 'react';
import { UserGroupSelector } from '../../../Tickets/CreateTicketModal/UserGroupSelector';
import { useUserGroups } from '../../../../hooks/useUserGroup';
import type { useDeskSettingsForm } from '../useDeskSettingsForm';

type DeskSettingsForm = ReturnType<typeof useDeskSettingsForm>;

interface AssignmentTabProps {
  form: DeskSettingsForm;
}

export const AssignmentTab: React.FC<AssignmentTabProps> = ({ form }) => {
  const allUserGroups = useUserGroups();
  const { defaultAssigneeGroupId, setAssigneeGroup, canManage } = form;

  return (
    <div className='flex flex-col gap-[8px]'>
      <div>
        <div className='text-sm font-medium text-foreground'>Default Assignee User Group</div>
        <div className='text-desk-helper w-full max-w-[400px]'>
          Tickets created from emails in this channel will be assigned to this user group
        </div>
      </div>
      <fieldset
        disabled={!canManage}
        className={`w-full max-w-[300px] border-0 p-0 m-0 min-w-0 ${!canManage ? 'opacity-50' : ''}`}
      >
        <UserGroupSelector
          selectedGroupId={defaultAssigneeGroupId || null}
          onGroupSelect={groupId => setAssigneeGroup(groupId ?? 'none')}
        />
      </fieldset>
      {(allUserGroups ?? []).length === 0 && (
        <p className='text-desk-helper'>No user groups found. Create one in team settings first.</p>
      )}
    </div>
  );
};
