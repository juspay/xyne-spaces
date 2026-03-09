import { useState } from 'react';
import { addDays, addWeeks, addMonths, subDays, subWeeks, subMonths } from 'date-fns';
import type { Ticket } from '@xyne/shared';
import { CalendarToolbar } from '../CalendarToolbar';
import { MonthView } from '../MonthView';
import { WeekView } from '../WeekView';
import { DayView } from '../DayView';
import type { CalendarViewMode, CalendarViewProps } from './types';

export function CalendarView({ tickets, onTicketClick }: CalendarViewProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<CalendarViewMode>('month');

  const handleNavigate = (direction: 'prev' | 'next' | 'today') => {
    switch (direction) {
      case 'prev':
        setCurrentDate(prev =>
          viewMode === 'month'
            ? subMonths(prev, 1)
            : viewMode === 'week'
              ? subWeeks(prev, 1)
              : subDays(prev, 1),
        );
        break;
      case 'next':
        setCurrentDate(prev =>
          viewMode === 'month'
            ? addMonths(prev, 1)
            : viewMode === 'week'
              ? addWeeks(prev, 1)
              : addDays(prev, 1),
        );
        break;
      case 'today':
        setCurrentDate(new Date());
        break;
    }
  };

  const handleTicketClick = (ticket: Ticket) => {
    onTicketClick?.(ticket);
  };

  return (
    <div className='flex flex-col h-full bg-background'>
      <CalendarToolbar
        currentDate={currentDate}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onNavigate={handleNavigate}
      />

      {viewMode === 'month' && (
        <MonthView currentDate={currentDate} tickets={tickets} onTicketClick={handleTicketClick} />
      )}

      {viewMode === 'week' && (
        <WeekView currentDate={currentDate} tickets={tickets} onTicketClick={handleTicketClick} />
      )}

      {viewMode === 'day' && (
        <DayView currentDate={currentDate} tickets={tickets} onTicketClick={handleTicketClick} />
      )}
    </div>
  );
}
