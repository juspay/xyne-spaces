import React from 'react';
import { X } from 'lucide-react';
import { queries } from '../../../zero/queries';
import { TicketDetails } from '../TicketDetails/TicketDetails';
import ThreadMessages from '../../Chat/ThreadPannel';
import { Button } from '../../ui/Button';
import { useCachedQuery } from '../../../hooks/useCachedQuery';

interface MappedTicketModalProps {
  mappedTicketId: string;
  onClose: () => void;
  onNavigateToParent: (ticketId: string) => void;
}

export const MappedTicketModal: React.FC<MappedTicketModalProps> = ({
  mappedTicketId,
  onClose,
  onNavigateToParent,
}) => {
  // Track navigation history for breadcrumb
  const [ticketHistory, setTicketHistory] = React.useState<Array<{ id: string; title: string }>>(
    [],
  );

  // Query current ticket details
  const [currentTicket] = useCachedQuery(queries.ticketById({ ticketId: mappedTicketId }), {
    enabled: !!mappedTicketId,
  });

  // Update history when ticket changes
  React.useEffect(() => {
    if (currentTicket) {
      setTicketHistory(prev => {
        // Check if this ticket is already in history (going back)
        const existingIndex = prev.findIndex(t => t.id === currentTicket.id);
        if (existingIndex !== -1) {
          // Going back - truncate history to this point
          return prev.slice(0, existingIndex + 1);
        }
        // Going forward - add to history
        return [...prev, { id: currentTicket.id, title: currentTicket.title }];
      });
    }
  }, [currentTicket]);

  const truncateTitle = (title: string, maxLength: number = 30): string => {
    return title.length > maxLength ? title.substring(0, maxLength) : title;
  };

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center'>
      {/* Backdrop */}
      <div
        className='absolute inset-0 bg-black/50'
        onClick={onClose}
        onKeyDown={(e): void => {
          if (e.key === 'Escape') onClose();
        }}
        role='button'
        tabIndex={0}
        aria-label='Close modal'
      />

      {/* Modal */}
      <div className='relative bg-white dark:bg-gray-800 rounded-lg shadow-xl w-[80vw] max-w-[1400px] h-[90vh] mx-auto flex flex-col'>
        {/* Header */}
        <div className='flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700'>
          {/* Breadcrumb */}
          <div className='flex items-center gap-2 text-sm flex-1 min-w-0 mr-4 overflow-x-auto'>
            {ticketHistory.length > 0 ? (
              ticketHistory.map((ticket, index) => (
                <React.Fragment key={ticket.id}>
                  {index > 0 && (
                    <span className='text-gray-400 dark:text-gray-500 flex-shrink-0 text-lg'>
                      ›
                    </span>
                  )}
                  <Button
                    variant='ghost'
                    size='sm'
                    onClick={() => onNavigateToParent(ticket.id)}
                    className={`px-2 py-1 font-medium rounded transition-colors flex-shrink-0 max-w-[200px] truncate ${
                      index === ticketHistory.length - 1
                        ? 'text-gray-900 dark:text-gray-100'
                        : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                    }`}
                    title={ticket.title}
                  >
                    {truncateTitle(ticket.title)}
                  </Button>
                </React.Fragment>
              ))
            ) : (
              <span className='text-gray-900 dark:text-gray-100 font-semibold'>Ticket Details</span>
            )}
          </div>

          {/* Close Button */}
          <Button variant='ghost' size='icon' onClick={onClose} className='flex-shrink-0'>
            <X className='w-5 h-5 text-gray-500' />
          </Button>
        </div>

        {/* Content - Split View */}
        <div className='flex-1 min-h-0 flex'>
          {/* Left: Ticket Details */}
          <div className='flex-1 overflow-y-auto border-r border-gray-200 dark:border-gray-700'>
            <TicketDetails ticketId={mappedTicketId} onNavigateToTicket={onNavigateToParent} />
          </div>

          {/* Right: Thread Messages */}
          <div className='w-[47%] overflow-y-auto'>
            <ThreadMessages showHeader={true} ticketId={mappedTicketId} />
          </div>
        </div>
      </div>
    </div>
  );
};
