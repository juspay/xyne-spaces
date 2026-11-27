import { useTicketDependenciesEnabled } from '../../../../hooks/useDependencyState';
import { useAuth } from '../../../../hooks/useAuth';
import { setUserPreference, useUserPreference } from '../../../../machines/userPreferencesMachine';
import type { TicketCalendarDateMode } from '../dateGrouping';
import { useState } from 'react';
import { addDays, addWeeks, addMonths, subDays, subWeeks, subMonths } from 'date-fns';
import type { Ticket } from '@xyne/shared';
import { CalendarToolbar } from '../CalendarToolbar';
import { MonthView } from '../MonthView';
import { WeekView } from '../WeekView';
import { DayView } from '../DayView';
import type { CalendarViewMode, CalendarViewProps } from './types';

export function CalendarView({ tickets, viewKey = 'default', onTicketClick }: CalendarViewProps) {
  const enabled = useTicketDependenciesEnabled();
  const { user } = useAuth();
  const modes = useUserPreference('ticketCalendarDateModes');
  const preferenceKey = JSON.stringify([user?.workspaceId, viewKey]);
  const dateMode: TicketCalendarDateMode =
    enabled && modes[preferenceKey] === 'eta' ? 'eta' : 'created';
  const changeDateMode = (mode: TicketCalendarDateMode) =>
    setUserPreference('ticketCalendarDateModes', { ...modes, [preferenceKey]: mode });
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
        dateMode={dateMode}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onNavigate={handleNavigate}
        {...(enabled ? { onDateModeChange: changeDateMode } : {})}
      />

      {dateMode === 'eta' && (
        <p className='border-b border-border px-6 py-2 text-xs text-muted-foreground'>
          Showing ticket ETAs. Tickets without an ETA are not shown.
        </p>
      )}
      {viewMode === 'month' && (
        <MonthView
          currentDate={currentDate}
          dateMode={dateMode}
          tickets={tickets}
          onTicketClick={handleTicketClick}
        />
      )}

      {viewMode === 'week' && (
        <WeekView
          currentDate={currentDate}
          dateMode={dateMode}
          tickets={tickets}
          onTicketClick={handleTicketClick}
        />
      )}

      {viewMode === 'day' && (
        <DayView
          currentDate={currentDate}
          dateMode={dateMode}
          tickets={tickets}
          onTicketClick={handleTicketClick}
        />
      )}
    </div>
  );
}
