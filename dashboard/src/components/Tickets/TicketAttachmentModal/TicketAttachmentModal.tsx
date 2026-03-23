import React, { useState, useCallback } from 'react';
import { Plus, X } from 'lucide-react';
import { TicketList } from '../TicketList/TicketList';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import type { Ticket } from '../../../hooks/useTickets';
import { useAuth } from '../../../hooks/useAuth';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { queries } from '../../../zero/queries';

export interface TicketAttachmentModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback when modal is closed */
  onClose: () => void;
  /** Callback when a ticket is selected for insertion */
  onSelectTicket: (ticket: Ticket) => void;
  /** Callback when user wants to create a new ticket */
  onCreateNewTicket: () => void | Promise<void>;
}

/**
 * TicketAttachmentModal
 *
 * A modal for selecting an existing ticket or creating a new one
 * to attach to a message. Similar to CanvasAttachmentModal.
 */
export const TicketAttachmentModal: React.FC<TicketAttachmentModalProps> = ({
  isOpen,
  onClose,
  onSelectTicket,
  onCreateNewTicket,
}) => {
  const { user } = useAuth();
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [activeFilter, setActiveFilter] = useState<'all' | 'my_tickets'>('all');

  // Fetch tickets - similar to canvas queries
  const [allTickets] = useCachedQuery(queries.allTickets());

  const tickets = (allTickets as unknown as Ticket[]) || [];

  const handleSelectTicket = useCallback((_e: React.MouseEvent | KeyboardEvent, ticket: Ticket) => {
    setSelectedTicket(ticket);
  }, []);

  const handleInsert = useCallback(() => {
    if (selectedTicket) {
      onSelectTicket(selectedTicket);
      setSelectedTicket(null);
    }
  }, [selectedTicket, onSelectTicket]);

  const handleCreateNew = useCallback(() => {
    setSelectedTicket(null);
    void onCreateNewTicket();
  }, [onCreateNewTicket]);

  const handleClose = useCallback(() => {
    setSelectedTicket(null);
    onClose();
  }, [onClose]);

  return (
    <Dialog
      open={isOpen}
      onOpenChange={open => {
        if (!open) handleClose();
      }}
      title='Attach Ticket'
      className='max-w-6xl w-full max-h-[80vh] bg-white m-4 p-0 overflow-hidden'
    >
      <div className='flex flex-col h-full max-h-[80vh]'>
        {/* Header */}
        <div className='flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0'>
          <h2 className='text-lg font-semibold text-gray-900'>Attach Ticket</h2>
          <button
            onClick={handleClose}
            className='text-gray-400 hover:text-gray-600 transition-colors'
            aria-label='Close'
            data-testid='ticket-attachment-close'
            data-track-category='TICKET'
            data-track-name='Close_Attachment_Modal'
          >
            <X className='w-5 h-5' />
          </button>
        </div>

        {/* Ticket List */}
        <div className='flex-1 overflow-auto min-h-0'>
          <TicketList
            tickets={tickets}
            onSelect={handleSelectTicket}
            loading={!allTickets}
            {...(user?.id && { currentUserId: user.id })}
            selectedTicketId={selectedTicket?.id ?? null}
            activeFilter={activeFilter}
            onFilterChange={setActiveFilter}
          />
        </div>

        {/* Footer */}
        <div className='flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-lg flex-shrink-0'>
          <Button
            variant='outline'
            onClick={handleCreateNew}
            data-testid='ticket-attachment-create-new'
            data-track-category='TICKET'
            data-track-name='Create_New_Ticket_From_Attachment'
          >
            <Plus className='w-4 h-4 mr-2' />
            Create New Ticket
          </Button>

          <div className='flex items-center gap-3'>
            <Button variant='secondary' onClick={handleClose}>
              Cancel
            </Button>
            <Button
              variant='default'
              onClick={handleInsert}
              disabled={!selectedTicket}
              data-testid='ticket-attachment-insert'
              data-track-category='TICKET'
              data-track-name='Insert_Ticket_Link'
              data-track-metadata={JSON.stringify({
                ticketId: selectedTicket?.id,
                xyneId: selectedTicket?.xyneId,
                title: selectedTicket?.title,
              })}
            >
              Insert
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
};

TicketAttachmentModal.displayName = 'TicketAttachmentModal';
