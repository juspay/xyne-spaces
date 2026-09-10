import { ChevronLeft, ChevronRight, CalendarDefault as Calendar } from '@xyne/icons';
import { format } from 'date-fns';
import type { CalendarViewMode } from '../CalendarView/types';
import type { CalendarToolbarProps } from './types';

export function CalendarToolbar({
  currentDate,
  viewMode,
  onViewModeChange,
  onNavigate,
}: CalendarToolbarProps) {
  const viewModes: { value: CalendarViewMode; label: string }[] = [
    { value: 'month', label: 'Month' },
    { value: 'week', label: 'Week' },
    { value: 'day', label: 'Day' },
  ];

  const getDateRangeLabel = () => {
    switch (viewMode) {
      case 'month':
        return format(currentDate, 'MMMM yyyy');
      case 'week':
        return `Week of ${format(currentDate, 'MMM d, yyyy')}`;
      case 'day':
        return format(currentDate, 'EEEE, MMMM d, yyyy');
    }
  };

  return (
    <div className='flex items-center justify-between px-6 py-4 bg-background border-b border-border'>
      {/* Left side - Navigation */}
      <div className='flex items-center gap-3'>
        <div className='flex items-center gap-1 bg-muted rounded-lg p-1 border border-border'>
          <button
            type='button'
            onClick={() => onNavigate('prev')}
            className='p-2 hover:bg-background hover:shadow-sm rounded-md transition-all duration-200'
            aria-label='Previous period'
            data-track-category='CALENDAR'
            data-track-name='NavigatePrevious'
          >
            <ChevronLeft className='w-4 h-4 text-muted-foreground' />
          </button>
          <button
            type='button'
            onClick={() => onNavigate('today')}
            className='px-3 py-1.5 text-sm font-medium text-foreground hover:bg-background hover:shadow-sm rounded-md transition-all duration-200'
            data-track-category='CALENDAR'
            data-track-name='NavigateToday'
          >
            Today
          </button>
          <button
            type='button'
            onClick={() => onNavigate('next')}
            className='p-2 hover:bg-background hover:shadow-sm rounded-md transition-all duration-200'
            aria-label='Next period'
            data-track-category='CALENDAR'
            data-track-name='NavigateNext'
          >
            <ChevronRight className='w-4 h-4 text-muted-foreground' />
          </button>
        </div>

        <div className='flex items-center gap-2'>
          <Calendar className='w-4 h-4 text-muted-foreground' />
          <span className='text-base font-semibold text-foreground'>{getDateRangeLabel()}</span>
        </div>
      </div>

      {/* Right side - View mode toggle */}
      <div className='flex items-center bg-muted rounded-xl p-1 border border-border'>
        {viewModes.map(mode => (
          <button
            type='button'
            key={mode.value}
            onClick={() => onViewModeChange(mode.value)}
            className={`relative px-4 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${
              viewMode === mode.value
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            data-track-category='CALENDAR'
            data-track-name='ChangeViewMode'
            data-track-metadata={JSON.stringify({ viewMode: mode.value })}
          >
            {mode.label}
          </button>
        ))}
      </div>
    </div>
  );
}
