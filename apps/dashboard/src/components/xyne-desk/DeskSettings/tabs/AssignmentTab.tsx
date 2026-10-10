import React, { useState } from 'react';
import { UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { UserGroupSelector } from '../../../Tickets/CreateTicketModal/UserGroupSelector';
import { useUserGroups } from '../../../../hooks/useUserGroup';
import { useConfirmDialog } from '../../../../hooks/useConfirmDialog';
import { autoAssignUnassignedTickets } from '../../../../services/clients/deskAutoAssignApi';
import Button from '../../../ui/Button';
import type { useDeskSettingsForm } from '../useDeskSettingsForm';

type DeskSettingsForm = ReturnType<typeof useDeskSettingsForm>;

interface AssignmentTabProps {
  form: DeskSettingsForm;
}

export const AssignmentTab: React.FC<AssignmentTabProps> = ({ form }) => {
  const allUserGroups = useUserGroups();
  const { defaultAssigneeGroupId, setAssigneeGroup, canManage, channelId } = form;
  const [isAutoAssigning, setIsAutoAssigning] = useState(false);
  const { confirm, ConfirmDialog } = useConfirmDialog();

  const handleAutoAssign = async (): Promise<void> => {
    if (!channelId || !canManage) return;
    const confirmed = await confirm({
      title: 'Auto-assign unassigned tickets?',
      description:
        'Every ticket in this desk without an assignee will be assigned using the same rules as new tickets. Tickets that already have an assignee are not touched.',
      confirmLabel: 'Auto-assign',
    });
    if (!confirmed) return;

    setIsAutoAssigning(true);
    try {
      // Fire-and-forget by design: the sweep runs in the background and tickets
      // update live as they are assigned, so there are no final counts to report.
      const { status } = await autoAssignUnassignedTickets(channelId);
      if (status === 'already_running') {
        toast.info('Auto-assignment is already running for this desk', {
          description: 'Tickets will update as they are assigned.',
        });
      } else {
        toast.success('Auto-assignment started', {
          description:
            'Tickets will update as they are assigned. Tickets with no group, or with no one available, stay unassigned.',
        });
      }
    } catch (err) {
      toast.error('Failed to start auto-assignment', {
        description: err instanceof Error ? err.message : 'Please try again.',
      });
    } finally {
      setIsAutoAssigning(false);
    }
  };

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

      <div className='mt-[16px] flex flex-col gap-[8px]'>
        <div>
          <div className='text-sm font-medium text-foreground'>Auto-assign unassigned tickets</div>
          <div className='text-desk-helper w-full max-w-[400px]'>
            Assigns every ticket without an assignee in this desk using the same rules as new
            tickets. Runs in the background.
          </div>
        </div>
        <div>
          <Button
            type='button'
            variant='outline'
            size='sm'
            loading={isAutoAssigning}
            disabled={!canManage || isAutoAssigning || !channelId}
            onClick={() => void handleAutoAssign()}
            data-track-category='DeskSettings'
            data-track-name='AutoAssignUnassignedTickets'
          >
            <UserPlus size={14} />
            Auto-assign now
          </Button>
        </div>
      </div>

      <ConfirmDialog />
    </div>
  );
};
