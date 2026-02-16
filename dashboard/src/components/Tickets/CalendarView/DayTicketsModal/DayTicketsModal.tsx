import { X } from 'lucide-react';
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
        />
        <Dialog.Content className='fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg bg-white rounded-2xl shadow-2xl z-50 flex flex-col max-h-[80vh] border border-gray-200 overflow-hidden'>
          <div className='flex items-center justify-between px-6 py-5 bg-gradient-to-r from-gray-50 to-white border-b border-gray-100'>
            <div>
              <Dialog.Title className='text-lg font-semibold text-gray-900'>
                {format(date, 'EEEE, MMMM d, yyyy')}
              </Dialog.Title>
              <Dialog.Description className='text-sm text-gray-500 mt-0.5'>
                {tickets.length} ticket{tickets.length !== 1 ? 's' : ''} created
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type='button'
                className='p-2 hover:bg-gray-100 rounded-lg transition-colors border border-gray-200'
                aria-label='Close'
              >
                <X className='w-4 h-4 text-gray-500' />
              </button>
            </Dialog.Close>
          </div>

          <div className='flex-1 overflow-y-auto p-6 bg-gray-50/50'>
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
              <div className='flex flex-col items-center justify-center py-12 text-gray-400 bg-white rounded-xl border border-dashed border-gray-200'>
                <p className='text-sm'>No tickets created on this day</p>
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
