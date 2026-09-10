import { ReactElement } from 'react';
import { ChevronUp, ChevronDown } from '@xyne/icons';
import { useBoardTicketNav } from '../../hooks/useBoardTicketNav';

interface BoardTicketNavProps {
  ticketId: string;
}

export const BoardTicketNav = ({ ticketId }: BoardTicketNavProps): ReactElement | null => {
  const nav = useBoardTicketNav(ticketId);
  if (!nav.enabled) return null;
  return (
    <div className='flex items-center gap-1'>
      <button
        type='button'
        onClick={nav.goPrev}
        disabled={!nav.hasPrev}
        aria-label='Previous ticket'
        className='p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors'
        data-track-category='Tickets'
        data-track-name='PrevTicket'
      >
        <ChevronUp size={16} />
      </button>
      <button
        type='button'
        onClick={nav.goNext}
        disabled={!nav.hasNext}
        aria-label='Next ticket'
        className='p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors'
        data-track-category='Tickets'
        data-track-name='NextTicket'
      >
        <ChevronDown size={16} />
      </button>
    </div>
  );
};
