import { ReactElement, useState } from 'react';
import { TicketPriority } from '@xyne/shared';
import { Popover } from '../../ui/Popover/Popover';
import { useZero } from '../../../hooks/useZero';
import { mutators } from '../../../zero/mutators';
import { getPriorityIcon } from '../TicketCard/TicketCard.utils';
import { surfaceMutationError } from '../../../utils/zeroMutationToast';
import { cn } from '../../../utils/classNames';

interface PriorityPickerProps {
  ticketId: string;
  priority: TicketPriority | string | null | undefined;
  compact?: boolean;
}

const PRIORITIES: ReadonlyArray<TicketPriority> = [
  TicketPriority.LOW,
  TicketPriority.MEDIUM,
  TicketPriority.HIGH,
  TicketPriority.CRITICAL,
];

const label = (p: TicketPriority): string => p.charAt(0) + p.slice(1).toLowerCase();

export function PriorityPicker({
  ticketId,
  priority,
  compact = false,
}: PriorityPickerProps): ReactElement {
  const [open, setOpen] = useState(false);
  const zero = useZero();

  const current = (priority as TicketPriority | undefined) ?? TicketPriority.LOW;

  const setPriority = (next: TicketPriority): void => {
    if (next !== current) {
      void surfaceMutationError(
        zero.mutate(
          mutators.ticket.update({ id: ticketId, priority: next, updatedAt: Date.now() }),
        ),
        'Failed to update priority',
      );
    }
    setOpen(false);
  };

  const trigger = (
    <button
      type='button'
      onClick={e => {
        e.stopPropagation();
        setOpen(prev => !prev);
      }}
      onKeyDown={e => e.stopPropagation()}
      title={`Priority: ${label(current)}`}
      className={cn(
        'inline-flex items-center rounded-md transition-colors whitespace-nowrap',
        compact
          ? 'items-center justify-center w-5 h-5 shrink-0 hover:bg-muted'
          : 'gap-1 px-2 py-0.5 bg-muted text-xs text-foreground hover:bg-border',
      )}
      aria-label='Change priority'
      data-track-category='Tickets'
      data-track-name='ToggleRowPriority'
    >
      {getPriorityIcon(current)}
      {!compact && <span>{label(current)}</span>}
    </button>
  );

  return (
    <Popover
      trigger={trigger}
      open={open}
      onOpenChange={setOpen}
      modal
      align='start'
      sideOffset={4}
      className='p-1 w-40'
    >
      <div className='flex flex-col'>
        {PRIORITIES.map(p => (
          <button
            key={p}
            type='button'
            onClick={e => {
              e.stopPropagation();
              setPriority(p);
            }}
            className={cn(
              'w-full text-left px-2 py-1.5 text-xs hover:bg-muted rounded-sm flex items-center gap-2',
              current === p && 'bg-muted',
            )}
            data-track-category='Tickets'
            data-track-name='SelectRowPriority'
          >
            {getPriorityIcon(p)}
            <span className='text-foreground'>{label(p)}</span>
          </button>
        ))}
      </div>
    </Popover>
  );
}
