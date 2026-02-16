import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
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
    <div className='flex items-center justify-between px-6 py-4 bg-white border-b border-gray-200'>
      {/* Left side - Navigation */}
      <div className='flex items-center gap-3'>
        <div className='flex items-center gap-1 bg-gray-50 rounded-lg p-1 border border-gray-200'>
          <button
            type='button'
            onClick={() => onNavigate('prev')}
            className='p-2 hover:bg-white hover:shadow-sm rounded-md transition-all duration-200'
            aria-label='Previous period'
          >
            <ChevronLeft className='w-4 h-4 text-gray-600' />
          </button>
          <button
            type='button'
            onClick={() => onNavigate('today')}
            className='px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-white hover:shadow-sm rounded-md transition-all duration-200'
          >
            Today
          </button>
          <button
            type='button'
            onClick={() => onNavigate('next')}
            className='p-2 hover:bg-white hover:shadow-sm rounded-md transition-all duration-200'
            aria-label='Next period'
          >
            <ChevronRight className='w-4 h-4 text-gray-600' />
          </button>
        </div>

        <div className='flex items-center gap-2'>
          <Calendar className='w-4 h-4 text-gray-400' />
          <span className='text-base font-semibold text-gray-900'>{getDateRangeLabel()}</span>
        </div>
      </div>

      {/* Right side - View mode toggle */}
      <div className='flex items-center bg-gray-100 rounded-xl p-1 border border-gray-200'>
        {viewModes.map(mode => (
          <button
            type='button'
            key={mode.value}
            onClick={() => onViewModeChange(mode.value)}
            className={`relative px-4 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${
              viewMode === mode.value
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {mode.label}
          </button>
        ))}
      </div>
    </div>
  );
}
