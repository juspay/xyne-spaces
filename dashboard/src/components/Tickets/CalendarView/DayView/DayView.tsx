import { useMemo } from 'react';
import { format } from 'date-fns';
import { CompactTicketBadge } from '../CompactTicketBadge';
import { groupTicketsByDate } from './utils';
import { Calendar, Clock } from 'lucide-react';
import type { DayViewProps } from './types';

export function DayView({ currentDate, tickets, onTicketClick }: DayViewProps): React.ReactElement {
  const ticketsByDate = useMemo(() => groupTicketsByDate(tickets), [tickets]);
  const dateKey = format(currentDate, 'yyyy-MM-dd');
  const dayTickets = ticketsByDate.get(dateKey) || [];

  return (
    <div className='flex-1 overflow-auto bg-white px-6 py-6'>
      <div className='max-w-4xl mx-auto'>
        {/* Day Header */}
        <div className='mb-6 flex items-center justify-between'>
          <div className='flex items-center gap-3'>
            <div className='w-12 h-12 rounded-xl bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-100 flex items-center justify-center'>
              <Calendar className='w-6 h-6 text-blue-500' />
            </div>
            <div>
              <h2 className='text-2xl font-semibold text-gray-900'>
                {format(currentDate, 'EEEE, MMMM d')}
              </h2>
              <p className='text-sm text-gray-500'>
                {dayTickets.length} ticket{dayTickets.length !== 1 ? 's' : ''} created
              </p>
            </div>
          </div>

          {dayTickets.length > 0 && (
            <div className='flex items-center gap-2 text-sm text-gray-500 bg-gray-50 px-4 py-2 rounded-lg border border-gray-200'>
              <Clock className='w-4 h-4' />
              <span>Activity for this day</span>
            </div>
          )}
        </div>

        {/* Tickets List */}
        {dayTickets.length > 0 ? (
          <div className='bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden'>
            <div className='px-6 py-4 bg-gray-50 border-b border-gray-200'>
              <h3 className='text-sm font-semibold text-gray-700 uppercase tracking-wide'>
                Tickets
              </h3>
            </div>
            <div className='divide-y divide-gray-100'>
              {dayTickets.map((ticket, index) => (
                <button
                  type='button'
                  key={ticket.id}
                  onClick={() => onTicketClick(ticket)}
                  className='w-full text-left p-4 hover:bg-gray-50 transition-colors cursor-pointer group'
                  data-track-category='CALENDAR_DAY_VIEW'
                  data-track-name='OpenTicket'
                  data-track-metadata={JSON.stringify({
                    ticketId: ticket.id,
                    xyneId: ticket.xyneId,
                  })}
                >
                  <div className='flex items-start gap-4'>
                    <span className='text-xs font-medium text-gray-400 mt-1'>
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <div className='flex-1'>
                      <CompactTicketBadge ticket={ticket} />
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className='flex flex-col items-center justify-center py-16 bg-gray-50 rounded-xl border border-dashed border-gray-200'>
            <div className='w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-4'>
              <Calendar className='w-8 h-8 text-gray-300' />
            </div>
            <p className='text-gray-500 font-medium'>No tickets created on this day</p>
            <p className='text-sm text-gray-400 mt-1'>Select another date to view tickets</p>
          </div>
        )}
      </div>
    </div>
  );
}
