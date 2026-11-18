import React from 'react';
import { MultipleCrossCancelDefault } from '@xyne/icons';
import Dialog from '../../ui/Dialog';
import type { MarkReadTarget } from './ChatDirectory.types';

interface MarkChannelsReadDialogProps {
  /** The pending request, or null when nothing is awaiting confirmation. */
  target: MarkReadTarget | null;
  onCancel: () => void;
  onConfirm: (channelIds: string[]) => void;
}

/**
 * Confirmation for every bulk "Mark all as read" in the sidebar.
 *
 * Bulk mark-as-read cannot be undone — there is no record of which channels were unread a
 * moment ago — and one menu click can clear hundreds of them, so every entry point asks
 * first: the Channels and Starred groups, each custom section, and DMs.
 *
 * The copy adapts rather than the dialog being duplicated: DMs are counted as
 * conversations, everything else as channels, and the group or section the user acted on is
 * named so a misclick in the wrong section is obvious before it is confirmed.
 */
const MarkChannelsReadDialog: React.FC<MarkChannelsReadDialogProps> = ({
  target,
  onCancel,
  onConfirm,
}) => {
  const count = target?.channelIds.length ?? 0;
  const isDms = target?.kind === 'dms';
  const noun = isDms
    ? count === 1
      ? 'conversation'
      : 'conversations'
    : count === 1
      ? 'channel'
      : 'channels';
  // Kept distinct so the existing DM funnel stays comparable after this dialog was
  // generalised to the other groups.
  const trackSuffix = isDms ? 'MARK_DMS_READ' : 'MARK_CHANNELS_READ';

  return (
    <Dialog
      open={!!target}
      onOpenChange={open => {
        if (!open) onCancel();
      }}
      testId='mark-read-dialog'
    >
      <div className='p-4 space-y-4'>
        <div className='flex items-start justify-between gap-2'>
          <div className='text-xl font-medium text-foreground'>
            Mark {count} {noun} as read?
          </div>
          <button
            type='button'
            onClick={onCancel}
            aria-label='Close'
            data-track-category='CHAT_SIDEBAR'
            data-track-name={`CLOSE_${trackSuffix}`}
            className='-mr-1 -mt-1 shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
          >
            <MultipleCrossCancelDefault size={20} />
          </button>
        </div>
        <p className='text-sm text-foreground'>
          {isDms ? (
            <>
              Unread direct messages will no longer show as new. The messages stay in each
              conversation.
            </>
          ) : (
            <>
              Unread messages in {target?.label} will no longer show as new. The messages stay in
              each channel.
            </>
          )}
        </p>
        <div className='flex justify-end gap-3 pt-2'>
          <button
            onClick={onCancel}
            data-track-category='CHAT_SIDEBAR'
            data-track-name={`CANCEL_${trackSuffix}`}
            className='inline-flex items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors'
          >
            Cancel
          </button>
          <button
            onClick={() => {
              if (target) onConfirm(target.channelIds);
            }}
            data-track-category='CHAT_SIDEBAR'
            data-track-name={`CONFIRM_${trackSuffix}`}
            className='inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors'
          >
            Mark as read
          </button>
        </div>
      </div>
    </Dialog>
  );
};

export default MarkChannelsReadDialog;
