import { useState, useMemo } from 'react';
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
} from 'date-fns';
import { CompactTicketBadge } from '../CompactTicketBadge';
import { groupTicketsByDate } from './utils';
import { DayTicketsModal } from '../DayTicketsModal';
import type { MonthViewProps } from './types';

export function MonthView({
  currentDate,
  tickets,
  onTicketClick,
}: MonthViewProps): React.ReactElement {
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const startDate = startOfWeek(monthStart);
  const endDate = endOfWeek(monthEnd);
  const days = eachDayOfInterval({ start: startDate, end: endDate });
  const ticketsByDate = useMemo(() => groupTicketsByDate(tickets), [tickets]);

  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const selectedDateTickets = selectedDate
    ? ticketsByDate.get(format(selectedDate, 'yyyy-MM-dd')) || []
    : [];

  return (
    <>
      <div className='flex-1 overflow-auto bg-background px-6 py-6'>
        <div className='bg-background rounded-xl border border-border shadow-sm overflow-hidden'>
          {/* Weekday Headers */}
          <div className='grid grid-cols-7 bg-muted border-b border-border'>
            {weekDays.map(day => (
              <div
                key={day}
                className='px-3 py-3 text-xs font-semibold text-muted-foreground text-center uppercase tracking-wide'
              >
                {day}
              </div>
            ))}
          </div>

          {/* Calendar Grid */}
          <div className='grid grid-cols-7 auto-rows-fr'>
            {days.map(day => {
              const dateKey = format(day, 'yyyy-MM-dd');
              const dayTickets = ticketsByDate.get(dateKey) || [];
              const isCurrentMonth = isSameMonth(day, currentDate);
              const isToday = isSameDay(day, new Date());
              const hasTickets = dayTickets.length > 0;

              return (
                <button
                  type='button'
                  key={dateKey}
                  onClick={() => hasTickets && setSelectedDate(day)}
                  className={`min-h-[120px] p-3 border-r border-b border-border last:border-r-0 text-left transition-all duration-200 hover:bg-muted/50 ${
                    !isCurrentMonth ? 'bg-muted/30' : 'bg-background'
                  } ${hasTickets ? 'hover:shadow-inner' : ''}`}
                  data-track-category='CALENDAR_MONTH_VIEW'
                  data-track-name='SelectDay'
                  data-track-metadata={JSON.stringify({
                    date: dateKey,
                    ticketCount: dayTickets.length,
                  })}
                >
                  {/* Date Number */}
                  <div className='flex items-center justify-between mb-2'>
                    <span
                      className={`text-sm font-medium w-7 h-7 flex items-center justify-center ${
                        isToday
                          ? 'bg-blue-500 text-white rounded-full'
                          : isCurrentMonth
                            ? 'text-foreground'
                            : 'text-muted-foreground'
                      }`}
                    >
                      {format(day, 'd')}
                    </span>
                    {hasTickets && (
                      <span className='text-[10px] font-medium text-muted-foreground'>
                        {dayTickets.length}
                      </span>
                    )}
                  </div>

                  {/* Tickets */}
                  <div className='space-y-1.5'>
                    {dayTickets.slice(0, 3).map(ticket => (
                      <CompactTicketBadge
                        key={ticket.id}
                        ticket={ticket}
                        onClick={e => {
                          e?.stopPropagation();
                          onTicketClick(ticket);
                        }}
                      />
                    ))}
                    {dayTickets.length > 3 && (
                      <div className='text-xs text-muted-foreground pl-1 font-medium'>
                        +{dayTickets.length - 3} more
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
