import { ReactElement, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Pencil, Clock, Send, MoreVertical, Loader2 } from 'lucide-react';
import { cn } from '../../../utils/classNames';
import type { DelayedMessage } from '@xyne/shared';
import { DelayedMessageStatus } from '@xyne/shared';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DelayedMessageDropdownProps {
  /** The scheduled message this dropdown acts on */
  delayedMessage: DelayedMessage;
  /** Callback when user clicks "Edit" */
  onEdit?: () => void;
  /** Callback when user clicks "Reschedule" */
  onReschedule?: () => void;
  /** Callback when user clicks "Send Now" */
  onSendNow?: () => void;
  /** Callback when user clicks "Save to Drafts" */
  onSaveToDrafts?: () => void;
  /** Callback when user clicks "Delete" */
  onDelete?: () => void;
  /** Whether an async action is in progress */
  loading?: boolean;
  /** Additional CSS class */
  className?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const DelayedMessageDropdown = ({
  delayedMessage,
  onEdit,
  onReschedule,
  onSendNow,
  onSaveToDrafts,
  onDelete,
  loading = false,
  className,
}: DelayedMessageDropdownProps): ReactElement => {
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const isPending = delayedMessage.status === DelayedMessageStatus.PENDING;
  const isDisabled = !isPending || loading;

  return (
    <div className={cn('flex items-center gap-0.5', className)}>
      <button
        type='button'
        disabled={isDisabled}
        onClick={() => onEdit?.()}
        className={cn(
          'p-1.5 rounded hover:bg-accent hover:text-foreground transition-all',
          isDisabled && 'opacity-50 cursor-not-allowed',
        )}
        aria-label='Edit scheduled message'
        data-track-category='delayed-messages'
        data-track-name='edit-scheduled-message'
      >
        <Pencil size={14} />
      </button>

      <button
        type='button'
        disabled={isDisabled}
        onClick={() => onReschedule?.()}
        className={cn(
          'p-1.5 rounded hover:bg-accent hover:text-foreground transition-all',
          isDisabled && 'opacity-50 cursor-not-allowed',
        )}
        aria-label='Reschedule message'
        data-track-category='delayed-messages'
        data-track-name='reschedule-scheduled-message'
      >
        <Clock size={14} />
      </button>

      <button
        type='button'
        disabled={isDisabled}
        onClick={() => onSendNow?.()}
        className={cn(
          'p-1.5 rounded hover:bg-primary/10 hover:text-primary transition-all',
          isDisabled && 'opacity-50 cursor-not-allowed',
        )}
        aria-label='Send message now'
        data-track-category='delayed-messages'
        data-track-name='send-now-scheduled-message'
      >
        {loading ? <Loader2 size={14} className='animate-spin' /> : <Send size={14} />}
      </button>

      <Popover.Root open={isMoreMenuOpen} onOpenChange={setIsMoreMenuOpen}>
        <Popover.Trigger asChild>
          <button
            type='button'
            disabled={isDisabled}
            className={cn(
              'p-1.5 rounded hover:bg-accent hover:text-foreground transition-all',
              isDisabled && 'opacity-50 cursor-not-allowed',
            )}
            aria-label='More scheduled message actions'
            data-track-category='delayed-messages'
            data-track-name='more-options-scheduled-message'
          >
            <MoreVertical size={14} />
          </button>
        </Popover.Trigger>
        <Popover.Content
          side='bottom'
          align='end'
          sideOffset={6}
          collisionPadding={8}
          className='z-[60] min-w-[240px] max-w-[280px] bg-background border border-border rounded-lg shadow-lg py-1.5'
        >
          <button
            type='button'
            disabled={isDisabled}
            onClick={() => {
              onSaveToDrafts?.();
              setIsMoreMenuOpen(false);
            }}
            className={cn(
              'w-full px-3 py-1.5 text-left text-sm text-foreground hover:bg-accent transition-colors',
              isDisabled && 'opacity-50 cursor-not-allowed',
            )}
            data-track-category='delayed-messages'
            data-track-name='saveToDrafts-scheduled-message'
          >
            Cancel schedule and save to drafts
          </button>
          <button
            type='button'
            disabled={isDisabled}
            onClick={() => {
              onDelete?.();
              setIsMoreMenuOpen(false);
            }}
            className={cn(
              'w-full px-3 py-1.5 text-left text-sm text-destructive hover:bg-destructive/10 transition-colors',
              isDisabled && 'opacity-50 cursor-not-allowed',
            )}
            data-track-category='delayed-messages'
            data-track-name='delete-scheduled-message'
          >
            Delete message
          </button>
        </Popover.Content>
      </Popover.Root>
    </div>
  );
};

DelayedMessageDropdown.displayName = 'DelayedMessageDropdown';
