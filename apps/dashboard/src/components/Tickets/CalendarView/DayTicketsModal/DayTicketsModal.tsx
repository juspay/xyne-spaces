import { MultipleCrossCancelDefault as X } from '@xyne/icons';
import { format } from 'date-fns';
import type { Ticket } from '@xyne/shared';
import * as Dialog from '@radix-ui/react-dialog';
import { CompactTicketBadge } from '../CompactTicketBadge';
import type { DayTicketsModalProps } from './types';

export function DayTicketsModal({
  isOpen,
  onClose,
  date,
  tickets,
  onTicketClick,
}: DayTicketsModalProps) {
  const handleTicketClick = (ticket: Ticket) => {
    onTicketClick(ticket);
    onClose();
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={onClose}>
      <Dialog.Portal>
        <Dialog.Overlay
          className='fixed inset-0 bg-black/40 backdrop-blur-sm z-50'
          onClick={onClose}
          data-track-category='Tickets'
          data-track-name='CLOSE_DAY_TICKETS_MODAL_BACKDROP'
        />
        <Dialog.Content className='fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg bg-background rounded-2xl shadow-2xl z-50 flex flex-col max-h-[80vh] border border-border overflow-hidden'>
          <div className='flex items-center justify-between px-6 py-5 bg-gradient-to-r from-muted to-background border-b border-border'>
            <div>
              <Dialog.Title className='text-lg font-semibold text-foreground'>
                {format(date, 'EEEE, MMMM d, yyyy')}
              </Dialog.Title>
              <Dialog.Description className='text-sm text-muted-foreground mt-0.5'>
                {tickets.length} ticket{tickets.length !== 1 ? 's' : ''} created
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type='button'
                className='p-2 hover:bg-muted rounded-lg transition-colors border border-border'
                aria-label='Close'
                data-track-category='Tickets'
                data-track-name='CLOSE_DAY_TICKETS_MODAL'
              >
                <X className='w-4 h-4 text-muted-foreground' />
              </button>
            </Dialog.Close>
          </div>

          <div className='flex-1 overflow-y-auto p-6 bg-muted/50'>
            {tickets.length > 0 ? (
              <div className='space-y-2'>
                {tickets.map(ticket => (
                  <CompactTicketBadge
                    key={ticket.id}
                    ticket={ticket}
                    onClick={() => handleTicketClick(ticket)}
                  />
                ))}
              </div>
            ) : (
              <div className='flex flex-col items-center justify-center py-12 text-muted-foreground bg-background rounded-xl border border-dashed border-border'>
                <p className='text-sm'>No tickets created on this day</p>
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
