import { useState, useMemo } from 'react';
import { format, startOfWeek, endOfWeek, eachDayOfInterval, isSameDay } from 'date-fns';
import type { Ticket } from '@xyne/shared';
import { CompactTicketBadge } from '../CompactTicketBadge';
import { groupTicketsByDate } from './utils';
import { DayTicketsModal } from '../DayTicketsModal';
import type { WeekViewProps } from './types';

export function WeekView({
  currentDate,
  tickets,
  onTicketClick,
}: WeekViewProps): React.ReactElement {
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  const startDate = startOfWeek(currentDate);
  const endDate = endOfWeek(currentDate);
  const days = eachDayOfInterval({ start: startDate, end: endDate });
  const ticketsByDate = useMemo(() => groupTicketsByDate(tickets), [tickets]);

  const selectedDateTickets = selectedDate
    ? ticketsByDate.get(format(selectedDate, 'yyyy-MM-dd')) || []
    : [];

  return (
    <>
      <div className='flex-1 overflow-auto bg-background px-6 py-6'>
        <div className='bg-background rounded-xl border border-border shadow-sm overflow-hidden'>
          <div className='grid grid-cols-7 bg-muted border-b border-border'>
            {days.map(day => {
              const isToday = isSameDay(day, new Date());
              return (
                <div key={format(day, 'yyyy-MM-dd')} className='px-3 py-4 text-center'>
                  <div className='text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1'>
                    {format(day, 'EEE')}
                  </div>
                  <div
                    className={`text-xl font-semibold ${
                      isToday ? 'text-blue-500' : 'text-foreground'
                    }`}
                  >
                    {format(day, 'd')}
                  </div>
                </div>
              );
            })}
          </div>

          <div className='grid grid-cols-7 auto-rows-fr min-h-[400px]'>
            {days.map(day => {
              const dateKey = format(day, 'yyyy-MM-dd');
              const dayTickets = ticketsByDate.get(dateKey) || [];
              const isToday = isSameDay(day, new Date());

              return (
                <button
                  type='button'
                  key={dateKey}
                  onClick={() => dayTickets.length > 0 && setSelectedDate(day)}
                  className={`p-3 border-r border-border last:border-r-0 text-left transition-all duration-200 hover:bg-muted/50 ${
                    isToday ? 'bg-blue-50/30' : ''
                  }`}
                  data-track-category='CALENDAR_WEEK_VIEW'
                  data-track-name='SelectDay'
                  data-track-metadata={JSON.stringify({
                    date: dateKey,
                    ticketCount: dayTickets.length,
                  })}
                >
                  <div className='space-y-2'>
                    {dayTickets.slice(0, 8).map((ticket: Ticket) => (
                      <CompactTicketBadge
                        key={ticket.id}
                        ticket={ticket}
                        onClick={e => {
                          e?.stopPropagation();
                          onTicketClick(ticket);
                        }}
                      />
                    ))}
                    {dayTickets.length > 8 && (
                      <div className='text-xs text-muted-foreground pl-1 font-medium'>
                        +{dayTickets.length - 8} more
                      </div>
                    )}
                    {dayTickets.length === 0 && (
                      <div className='flex items-center justify-center h-full min-h-[100px]'>
                        <span className='text-xs text-muted'>No tickets</span>
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {selectedDate && (
        <DayTicketsModal
          isOpen={!!selectedDate}
          onClose={() => setSelectedDate(null)}
          date={selectedDate}
          tickets={selectedDateTickets}
          onTicketClick={onTicketClick}
        />
      )}
    </>
  );
}
