import { getTicketStatusColor } from './utils';
import type { CompactTicketBadgeProps } from './types';

export function CompactTicketBadge({ ticket, onClick }: CompactTicketBadgeProps) {
  const statusColor = getTicketStatusColor(ticket.statusV2);

  return (
    <button
      type='button'
      onClick={onClick}
      className='w-full text-left group'
      title={`${ticket.xyneId}: ${ticket.title}`}
      data-track-category='CALENDAR'
      data-track-name='OpenTicketFromCalendar'
      data-track-metadata={JSON.stringify({ ticketId: ticket.id, xyneId: ticket.xyneId })}
    >
      <div className='flex items-center gap-2 p-2 rounded-lg bg-gray-50 hover:bg-white border border-gray-100 hover:border-gray-200 hover:shadow-sm transition-all duration-200'>
        {/* Status indicator */}
        <div
          className='w-1.5 h-8 rounded-full flex-shrink-0'
          style={{ backgroundColor: statusColor }}
        />

        {/* Content */}
        <div className='flex-1 min-w-0'>
          <div className='flex items-center gap-2 mb-0.5'>
            <span className='text-[10px] font-medium text-gray-400 font-mono'>{ticket.xyneId}</span>
          </div>
          <p className='text-xs font-medium text-gray-700 truncate group-hover:text-gray-900'>
            {ticket.title}
          </p>
        </div>
      </div>
    </button>
  );
}
