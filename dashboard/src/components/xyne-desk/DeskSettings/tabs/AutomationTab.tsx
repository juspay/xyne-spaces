import React from 'react';
import { Switch } from '../../../ui/Switch';
import type { useDeskSettingsForm } from '../useDeskSettingsForm';

type DeskSettingsForm = ReturnType<typeof useDeskSettingsForm>;

interface AutomationTabProps {
  form: DeskSettingsForm;
}

export const AutomationTab: React.FC<AutomationTabProps> = ({ form }) => {
  const { autoMergeEmails, handleAutoMergeChange, canManage } = form;

  return (
    <div className='flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6'>
      <div className='min-w-0 flex-1'>
        <div className='text-sm font-medium text-foreground'>Auto-merge similar emails</div>
        <div className='text-desk-helper w-full max-w-[400px]'>
          Merge emails with the same subject and sender into one ticket, or create separate tickets
          for each thread.
        </div>
      </div>
      <Switch
        variant='desk'
        className='shrink-0'
        checked={autoMergeEmails}
        onCheckedChange={handleAutoMergeChange}
        disabled={!canManage}
      />
    </div>
  );
};
