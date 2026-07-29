import { ReactElement } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Star, Ban, Inbox as InboxIcon, X } from 'lucide-react';
import { toast } from 'sonner';
import { MailboxState } from '@xyne/shared';
import { queries } from '../../../zero/queries';
import { mutators } from '../../../zero/mutators';
import { useZero } from '../../../hooks/useZero';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import Tooltip from '../../ui/Tooltip';
import { cn } from '../../../utils/classNames';

export type MailboxSlot = 'star' | 'actions' | 'chip';

interface MailboxActionsProps {
  ticketId: string;
  channelId: string;
  slot: MailboxSlot;
}

// The mailbox location rendered as a removable chip (Gmail-style), like a label.
// ARCHIVED has no chip — the Inbox tag has been removed, so the mail lives only in
// All Mail. Removing the chip is contextual: Inbox → archive, Spam → back to Inbox.
const CHIP: Record<MailboxState, { label: string; color: string } | null> = {
  [MailboxState.INBOX]: { label: 'Inbox', color: '#3b82f6' },
  [MailboxState.ARCHIVED]: null,
  [MailboxState.SPAM]: { label: 'Spam', color: '#f97316' },
};

/**
 * Per-user mailbox controls on the ticket detail: a removable location chip (Inbox /
 * Spam), a star toggle, and move actions. Reads the caller's overlay
 * (myTicketMailbox); absence means Inbox.
 */
export const MailboxActions = ({
  ticketId,
  channelId,
  slot,
}: MailboxActionsProps): ReactElement | null => {
  const zero = useZero();
  const [rows] = useCachedQuery(queries.myTicketMailbox({ ticketId }), { enabled: !!ticketId });
  const overlay = (rows ?? [])[0];
  const state = overlay?.state ?? MailboxState.INBOX;
  const starred = overlay?.starred ?? false;

  const setState = async (next: MailboxState): Promise<void> => {
    try {
      const result = await zero.mutate(
        mutators.ticketMailbox.setState({
          id: uuidv4(),
          ticketId,
          channelId,
          state: next,
          timestamp: Date.now(),
        }),
      ).server;
      if (result.type === 'error') throw new Error(result.error.message || 'Failed to move mail');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to move mail');
    }
  };

  const toggleStar = async (): Promise<void> => {
    try {
      const result = await zero.mutate(
        mutators.ticketMailbox.setStarred({
          id: uuidv4(),
          ticketId,
          channelId,
          starred: !starred,
          timestamp: Date.now(),
        }),
      ).server;
      if (result.type === 'error') throw new Error(result.error.message || 'Failed to star mail');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to star mail');
    }
  };

  const chip = CHIP[state];
  // Removing the Inbox chip archives it (leaves Inbox, stays in All Mail). Removing a
  // Spam/Trash chip restores it to the Inbox.
  const removeChip = (): void => {
    void setState(state === MailboxState.INBOX ? MailboxState.ARCHIVED : MailboxState.INBOX);
  };
  const removeTitle =
    state === MailboxState.INBOX ? 'Remove from Inbox (archive)' : 'Move to Inbox';

  // Matches the row-1 toolbar buttons so the move actions are visually
  // indistinguishable from the icons they now sit beside.
  const btn =
    'p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors';

  if (slot === 'star') {
    return (
      <Tooltip side='bottom' delayDuration={500} content={starred ? 'Unstar' : 'Star'}>
        <button
          type='button'
          onClick={() => void toggleStar()}
          aria-label={starred ? 'Unstar' : 'Star'}
          className={cn(btn, 'shrink-0')}
          data-track-category='Support'
          data-track-name='ToggleMailboxStar'
        >
          <Star
            size={18}
            className={cn(starred ? 'text-yellow-500' : '')}
            fill={starred ? 'currentColor' : 'none'}
          />
        </button>
      </Tooltip>
    );
  }

  if (slot === 'actions') {
    return (
      <>
        {/* When archived (no chip), allow adding back to Inbox. */}
        {state === MailboxState.ARCHIVED && (
          <Tooltip side='bottom' delayDuration={500} content='Move to Inbox'>
            <button
              type='button'
              onClick={() => void setState(MailboxState.INBOX)}
              aria-label='Move to Inbox'
              className={btn}
              data-track-category='Support'
              data-track-name='MailboxToInbox'
            >
              <InboxIcon size={16} />
            </button>
          </Tooltip>
        )}
        {state !== MailboxState.SPAM && (
          <Tooltip side='bottom' delayDuration={500} content='Report spam'>
            <button
              type='button'
              onClick={() => void setState(MailboxState.SPAM)}
              aria-label='Report spam'
              className={btn}
              data-track-category='Support'
              data-track-name='MailboxSpam'
            >
              <Ban size={16} />
            </button>
          </Tooltip>
        )}
      </>
    );
  }

  if (!chip) return null;
  return (
    <span className='inline-flex items-center gap-1 pl-1.5 pr-1 py-0.5 rounded-md text-xs font-medium border border-border bg-card text-foreground'>
      <span className='size-2 rounded-full shrink-0' style={{ backgroundColor: chip.color }} />
      <span>{chip.label}</span>
      <Tooltip side='bottom' delayDuration={500} content={removeTitle}>
        <button
          type='button'
          onClick={removeChip}
          aria-label={removeTitle}
          className='hover:bg-muted rounded-full p-0.5'
          data-track-category='Support'
          data-track-name='RemoveMailboxState'
        >
          <X className='size-2.5' />
        </button>
      </Tooltip>
    </span>
  );
};
