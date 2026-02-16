import type { CalendarViewMode } from '../CalendarView/types';

export interface CalendarToolbarProps {
  currentDate: Date;
  viewMode: CalendarViewMode;
  onViewModeChange: (mode: CalendarViewMode) => void;
  onNavigate: (direction: 'prev' | 'next' | 'today') => void;
}
