import React from 'react';
import { Mail } from 'lucide-react';
import { InboxOwnerSettings } from '../InboxOwnerSettings/InboxOwnerSettings';
import { InboxAssigneeSettings } from '../InboxAssigneeSettings/InboxAssigneeSettings';

interface InboxSettingsProps {
  ownerUserId: string | null;
  onOwnerChange: (next: string | null) => void;
  assigneeUserGroupId: string | null;
  onAssigneeChange: (next: string | null) => void;
  sendAsEmail?: string | null;
  onSendAsEmailChange?: (next: string | null) => void;
  canEditSendAsEmail?: boolean;
  disabled?: boolean;
}

export const InboxSettings: React.FC<InboxSettingsProps> = ({
  ownerUserId,
  onOwnerChange,
  assigneeUserGroupId,
  onAssigneeChange,
  sendAsEmail,
  onSendAsEmailChange,
  canEditSendAsEmail = false,
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

      {(canEditSendAsEmail || (sendAsEmail && sendAsEmail.length > 0)) && (
        <div className='flex flex-col gap-1.5'>
          <label htmlFor='inbox-send-as-email' className='flex items-center gap-2 text-sm'>
            <Mail size={14} className='text-muted-foreground' />
            <span className='font-medium text-foreground'>Send-as alias</span>
          </label>
          <p className='text-xs text-muted-foreground'>
            {canEditSendAsEmail ? (
              <>
                Outbound replies use this address as the From — useful for distribution lists like
                <span className='font-mono mx-1'>support@yourcompany.com</span>
                backed by your connected mailbox. Leave blank to send from the connected mailbox.
              </>
            ) : (
              <>
                Outbound replies on this desk are sent from this address. Only the desk owner or
                creator can change it.
              </>
            )}
          </p>
          <input
            id='inbox-send-as-email'
            type='email'
            value={sendAsEmail ?? ''}
            onChange={e => onSendAsEmailChange?.(e.target.value.trim() || null)}
            placeholder='support@yourcompany.com'
            className='border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-[#6276be] disabled:opacity-50 disabled:cursor-not-allowed read-only:bg-muted/40 read-only:cursor-default read-only:focus:ring-0'
            disabled={canEditSendAsEmail && disabled}
            readOnly={!canEditSendAsEmail}
            data-track-category='inbox-settings'
            data-track-name='edit-send-as-email'
          />
        </div>
      )}
    </div>
  );
};
