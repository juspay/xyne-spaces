import React, { useEffect, useState } from 'react';
import { Mail, Users, GitMerge } from 'lucide-react';
import { EmailMergeMode } from '@xyne/shared';
import { Switch } from '../../ui/Switch';

interface EmailDeskSettingsProps {
  sendAsEmail?: string | null;
  onSendAsEmailChange?: (next: string | null) => void;
  canEditSendAsEmail?: boolean;
  defaultCc?: string | null;
  onSaveDefaultCc?: (next: string | null) => void;
  isSavingDefaultCc?: boolean;
  emailMergeMode?: EmailMergeMode;
  onEmailMergeModeChange?: (next: EmailMergeMode) => void;
  disabled?: boolean;
}

export const EmailDeskSettings: React.FC<EmailDeskSettingsProps> = ({
  sendAsEmail,
  onSendAsEmailChange,
  canEditSendAsEmail = false,
  defaultCc,
  onSaveDefaultCc,
  isSavingDefaultCc = false,
  emailMergeMode = EmailMergeMode.DISABLED,
  onEmailMergeModeChange,
  disabled = false,
}) => {
  const [defaultCcInput, setDefaultCcInput] = useState(defaultCc ?? '');

  useEffect(() => {
    setDefaultCcInput(defaultCc ?? '');
  }, [defaultCc]);

  const defaultCcDirty = defaultCcInput.trim() !== (defaultCc ?? '');

  return (
    <div className='flex flex-col gap-4'>
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

      <div className='flex flex-col gap-1.5'>
        <label htmlFor='inbox-default-cc' className='flex items-center gap-2 text-sm'>
          <Users size={14} className='text-muted-foreground' />
          <span className='font-medium text-foreground'>Default CC</span>
        </label>
        <p className='text-xs text-muted-foreground'>
          Comma-separated email addresses to pre-populate the CC field when composing a new email
          from this desk.
        </p>
        <input
          id='inbox-default-cc'
          type='text'
          value={defaultCcInput}
          onChange={e => setDefaultCcInput(e.target.value)}
          placeholder='alice@example.com, bob@example.com'
          className='border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-[#6276be] disabled:opacity-50 disabled:cursor-not-allowed'
          disabled={disabled || isSavingDefaultCc}
          data-track-category='inbox-settings'
          data-track-name='edit-default-cc'
        />
        {defaultCcDirty && (
          <div className='flex items-center gap-2 mt-1'>
            <button
              type='button'
              onClick={() => onSaveDefaultCc?.(defaultCcInput.trim() || null)}
              disabled={isSavingDefaultCc}
              className='px-3 py-1.5 text-sm font-medium text-white bg-[#6276be] rounded-lg hover:bg-[#4f62a8] dark:hover:bg-[#7986d0] disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
              data-track-category='inbox-settings'
              data-track-name='save-default-cc'
            >
              {isSavingDefaultCc ? 'Saving\u2026' : 'Save'}
            </button>
            <button
              type='button'
              onClick={() => setDefaultCcInput(defaultCc ?? '')}
              disabled={isSavingDefaultCc}
              className='px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground rounded-lg hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
              data-track-category='inbox-settings'
              data-track-name='cancel-default-cc'
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {onEmailMergeModeChange && (
        <div className='flex items-start gap-3 pt-2'>
          <div className='pt-0.5 shrink-0'>
            <Switch
              id='inbox-enable-email-merge-demerge'
              checked={emailMergeMode === EmailMergeMode.ENABLED}
              onCheckedChange={next =>
                onEmailMergeModeChange(next ? EmailMergeMode.ENABLED : EmailMergeMode.DISABLED)
              }
              disabled={disabled}
            />
          </div>
          <div className='flex flex-col gap-1'>
            <label
              htmlFor='inbox-enable-email-merge-demerge'
              className='flex items-center gap-2 text-sm cursor-pointer'
            >
              <GitMerge size={14} className='text-muted-foreground' />
              <span className='font-medium text-foreground'>Auto-merge similar emails</span>
            </label>
            <p className='text-xs text-muted-foreground'>
              When on, incoming emails with the same subject and sender are merged into the matching
              open ticket. Leave off if every new email thread should always create a separate
              ticket.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
