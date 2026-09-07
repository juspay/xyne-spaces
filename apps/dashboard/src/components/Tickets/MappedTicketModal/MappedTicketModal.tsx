import React from 'react';
import { queries } from '../../../zero/queries';
import { TicketDetails } from '../TicketDetails/TicketDetails';
import ThreadMessages from '../../Chat/ThreadPannel';
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
  const [currentTicket] = useCachedQuery(queries.ticketByIdV2({ ticketId: mappedTicketId }), {
    enabled: !!mappedTicketId,
  });

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center'>
      {/* Backdrop */}
      <div
        className='absolute inset-0 bg-black/50'
        onClick={onClose}
        data-track-category='Tickets'
        data-track-name='CloseMappedTicketModal'
        onKeyDown={(e): void => {
          if (e.key === 'Escape') onClose();
        }}
        role='button'
        tabIndex={0}
        aria-label='Close modal'
      />

      {/* Modal */}
      <div className='relative bg-background dark:bg-gray-800 rounded-lg shadow-xl w-[80vw] max-w-[1400px] h-[90vh] mx-auto flex flex-col'>
        {/* Content - Split View */}
        <div className='flex-1 min-h-0 flex'>
          {/* Left: Ticket Details */}
          <div className='flex-1 overflow-y-auto border-r border-border dark:border-gray-700'>
            <TicketDetails ticketId={mappedTicketId} onNavigateToTicket={onNavigateToParent} />
          </div>

          {/* Right: Thread Messages */}
          <div className='w-[47%] overflow-y-auto'>
            <ThreadMessages
              ticketId={mappedTicketId}
              onClose={onClose}
              defaultTab='thread'
              {...(currentTicket?.conversation?.channelId && {
                channelId: currentTicket.conversation.channelId,
              })}
              {...(currentTicket?.conversationId && {
                conversationId: currentTicket.conversationId,
              })}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
