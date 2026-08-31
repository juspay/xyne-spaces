import { useMemo } from 'react';
import { format } from 'date-fns';
import { CompactTicketBadge } from '../CompactTicketBadge';
import { groupTicketsByDate } from './utils';
import { CalendarDefault as Calendar, ClockDefault as Clock } from '@xyne/icons';
import type { DayViewProps } from './types';

export function DayView({ currentDate, tickets, onTicketClick }: DayViewProps): React.ReactElement {
  const ticketsByDate = useMemo(() => groupTicketsByDate(tickets), [tickets]);
  const dateKey = format(currentDate, 'yyyy-MM-dd');
  const dayTickets = ticketsByDate.get(dateKey) || [];

  return (
    <div className='flex-1 overflow-auto bg-background px-6 py-6'>
      <div className='max-w-4xl mx-auto'>
        {/* Day Header */}
        <div className='mb-6 flex items-center justify-between'>
          <div className='flex items-center gap-3'>
            <div className='w-12 h-12 rounded-xl bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-100 flex items-center justify-center'>
              <Calendar className='w-6 h-6 text-blue-500' />
            </div>
            <div>
              <h2 className='text-2xl font-semibold text-foreground'>
                {format(currentDate, 'EEEE, MMMM d')}
              </h2>
              <p className='text-sm text-muted-foreground'>
                {dayTickets.length} ticket{dayTickets.length !== 1 ? 's' : ''} created
              </p>
            </div>
          </div>

          {dayTickets.length > 0 && (
            <div className='flex items-center gap-2 text-sm text-muted-foreground bg-muted px-4 py-2 rounded-lg border border-border'>
              <Clock className='w-4 h-4' />
              <span>Activity for this day</span>
            </div>
          )}
        </div>

        {/* Tickets List */}
        {dayTickets.length > 0 ? (
          <div className='bg-background rounded-xl border border-border shadow-sm overflow-hidden'>
            <div className='px-6 py-4 bg-muted border-b border-border'>
              <h3 className='text-sm font-semibold text-foreground uppercase tracking-wide'>
                Tickets
              </h3>
            </div>
            <div className='divide-y divide-border'>
              {dayTickets.map((ticket, index) => (
                <button
                  type='button'
                  key={ticket.id}
                  onClick={() => onTicketClick(ticket)}
                  className='w-full text-left p-4 hover:bg-muted transition-colors cursor-pointer group'
                  data-track-category='CALENDAR_DAY_VIEW'
                  data-track-name='OpenTicket'
                  data-track-metadata={JSON.stringify({
                    ticketId: ticket.id,
                    xyneId: ticket.xyneId,
                  })}
                >
                  <div className='flex items-start gap-4'>
                    <span className='text-xs font-medium text-muted-foreground mt-1'>
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
          <div className='flex flex-col items-center justify-center py-16 bg-muted rounded-xl border border-dashed border-border'>
            <div className='w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4'>
              <Calendar className='w-8 h-8 text-muted' />
            </div>
            <p className='text-muted-foreground font-medium'>No tickets created on this day</p>
            <p className='text-sm text-muted-foreground mt-1'>
              Select another date to view tickets
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
