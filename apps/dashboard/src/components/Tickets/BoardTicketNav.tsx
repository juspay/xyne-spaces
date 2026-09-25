import { ReactElement } from 'react';
import { ChevronUp, ChevronDown } from '@xyne/icons';
import { useBoardTicketNav } from '../../hooks/useBoardTicketNav';
import Tooltip from '../ui/Tooltip';

interface BoardTicketNavProps {
  ticketId: string;
}

const NAV_BUTTON =
  'flex size-[30px] items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40';

const ShortcutHint = ({ label, shortcut }: { label: string; shortcut: string }): ReactElement => (
  <span className='flex items-center gap-2'>
    {label}
    <kbd className='font-mono text-[11px] opacity-60'>{shortcut}</kbd>
  </span>
);

export const BoardTicketNav = ({ ticketId }: BoardTicketNavProps): ReactElement | null => {
  const nav = useBoardTicketNav(ticketId);
  if (!nav.enabled) return null;
  return (
    <div className='flex items-center gap-0.5'>
      <Tooltip content={<ShortcutHint label='Previous ticket' shortcut='K' />}>
        <button
          type='button'
          onClick={nav.goPrev}
          disabled={!nav.hasPrev}
          aria-label='Previous ticket'
          className={NAV_BUTTON}
          data-track-category='Tickets'
          data-track-name='PrevTicket'
        >
          <ChevronUp size={16} />
        </button>
      </Tooltip>
      <Tooltip content={<ShortcutHint label='Next ticket' shortcut='J' />}>
        <button
          type='button'
          onClick={nav.goNext}
          disabled={!nav.hasNext}
          aria-label='Next ticket'
          className={NAV_BUTTON}
          data-track-category='Tickets'
          data-track-name='NextTicket'
        >
          <ChevronDown size={16} />
        </button>
      </Tooltip>
      <span className='mx-1.5 h-[18px] w-px shrink-0 bg-border' />
    </div>
  );
};
