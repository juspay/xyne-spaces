import type { TicketCalendarDateMode } from '../dateGrouping';
import type { CalendarViewMode } from '../CalendarView/types';

export interface CalendarToolbarProps {
  currentDate: Date;
  dateMode?: TicketCalendarDateMode;
  onDateModeChange?: (mode: TicketCalendarDateMode) => void;
  viewMode: CalendarViewMode;
  onViewModeChange: (mode: CalendarViewMode) => void;
  onNavigate: (direction: 'prev' | 'next' | 'today') => void;
}
