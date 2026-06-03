import React from 'react';
import { AutoDraftMode } from '@xyne/shared';
import { InboxOwnerSettings } from '../InboxOwnerSettings/InboxOwnerSettings';
import { InboxAssigneeSettings } from '../InboxAssigneeSettings/InboxAssigneeSettings';

interface InboxSettingsProps {
  ownerUserId: string | null;
  onOwnerChange: (next: string | null) => void;
  assigneeUserGroupId: string | null;
  onAssigneeChange: (next: string | null) => void;
  autoDraftMode?: AutoDraftMode;
  onAutoDraftModeChange?: (next: AutoDraftMode) => void;
  disabled?: boolean;
}

export const InboxSettings: React.FC<InboxSettingsProps> = ({
  ownerUserId,
  onOwnerChange,
  assigneeUserGroupId,
  onAssigneeChange,
  autoDraftMode = AutoDraftMode.OFF,
  onAutoDraftModeChange,
  disabled = false,
}) => {
  return (
    <div className='flex flex-col gap-4'>
      <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
        <InboxOwnerSettings value={ownerUserId} onChange={onOwnerChange} disabled={disabled} />
        <InboxAssigneeSettings
          value={assigneeUserGroupId}
          onChange={onAssigneeChange}
          disabled={disabled}
        />
      </div>

      {onAutoDraftModeChange && (
        <div className='flex items-center gap-3'>
          <button
            type='button'
            id='inbox-auto-draft'
            role='switch'
            aria-checked={autoDraftMode === AutoDraftMode.DRAFT}
            onClick={() =>
              !disabled &&
              onAutoDraftModeChange(
                autoDraftMode === AutoDraftMode.DRAFT ? AutoDraftMode.OFF : AutoDraftMode.DRAFT,
              )
            }
            disabled={disabled}
            title={
              autoDraftMode === AutoDraftMode.DRAFT
                ? 'Disable auto AI draft'
                : 'Enable auto AI draft'
            }
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed ${
              autoDraftMode === AutoDraftMode.DRAFT ? 'bg-[#6276be]' : 'bg-secondary'
            }`}
            data-track-category='inbox-settings'
            data-track-name='toggle-auto-draft'
          >
            <span
              className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-sm transition-transform duration-200 ${
                autoDraftMode === AutoDraftMode.DRAFT ? 'translate-x-4' : 'translate-x-0'
              }`}
            />
          </button>
          <div>
            <p className='text-sm font-medium text-foreground'>Auto AI draft</p>
            <p className='text-xs text-muted-foreground mt-0.5'>
              Automatically prepare an AI-generated draft reply each time a new message arrives on
              this desk. Drafts are shared across the team.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
