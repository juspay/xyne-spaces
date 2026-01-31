import { ReactElement, useState, useRef, useEffect } from 'react';
import { Calendar, X, ChevronDown } from 'lucide-react';
import { DateRangeFilterProps } from '../types';
import { Button } from '../../../ui/Button/Button';

export const DateRangeFilter = ({
  dateRange,
  onChange,
  label,
  placeholder = 'Select date range',
  className = '',
}: DateRangeFilterProps): ReactElement => {
  const [isOpen, setIsOpen] = useState(false);
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Initialize date inputs from dateRange
  useEffect(() => {
    const newStartDate: string =
      dateRange.start !== undefined
        ? new Date(dateRange.start).toISOString().split('T')[0] || ''
        : '';
    setStartDate(newStartDate);

    const newEndDate: string =
      dateRange.end !== undefined ? new Date(dateRange.end).toISOString().split('T')[0] || '' : '';
    setEndDate(newEndDate);
  }, [dateRange]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent): void => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return (): void => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleStartDateChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const value = e.target.value;
    setStartDate(value);

    if (value) {
      const startTimestamp = new Date(value).getTime();
      const newRange: { start?: number; end?: number } = { ...dateRange, start: startTimestamp };
      onChange(newRange);
    } else {
      const newRange: { start?: number; end?: number } = { ...dateRange };
      delete newRange.start;
      onChange(newRange);
    }
  };

  const handleEndDateChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const value = e.target.value;
    setEndDate(value);

    if (value) {
      const endTimestamp = new Date(value).getTime() + 24 * 60 * 60 * 1000 - 1; // End of day
      const newRange: { start?: number; end?: number } = { ...dateRange, end: endTimestamp };
      onChange(newRange);
    } else {
      const newRange: { start?: number; end?: number } = { ...dateRange };
      delete newRange.end;
      onChange(newRange);
    }
  };

  const handleClear = (): void => {
    onChange({});
    setStartDate('');
    setEndDate('');
  };

  const hasSelection = dateRange.start || dateRange.end;

  const formatDisplayDate = (timestamp?: number): string => {
    if (!timestamp) return '';
    return new Date(timestamp).toLocaleDateString();
  };

  const getDisplayText = (): string => {
    if (dateRange.start && dateRange.end) {
      return `${formatDisplayDate(dateRange.start)} - ${formatDisplayDate(dateRange.end)}`;
    } else if (dateRange.start) {
      return `From ${formatDisplayDate(dateRange.start)}`;
    } else if (dateRange.end) {
      return `Until ${formatDisplayDate(dateRange.end)}`;
    }
    return placeholder;
  };

  // Quick date presets
  const handlePresetClick = (preset: 'today' | 'week' | 'month'): void => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let start: number;
    let end: number;

    switch (preset) {
      case 'today': {
        start = today.getTime();
        end = today.getTime() + 24 * 60 * 60 * 1000 - 1;
        break;
      }
      case 'week': {
        const weekStart = new Date(today);
        weekStart.setDate(today.getDate() - 7);
        start = weekStart.getTime();
        end = today.getTime() + 24 * 60 * 60 * 1000 - 1;
        break;
      }
      case 'month': {
        const monthStart = new Date(today);
        monthStart.setMonth(monthStart.getMonth() - 1);

        start = monthStart.getTime();
        end = today.getTime() + 24 * 60 * 60 * 1000 - 1;
        break;
      }
      default:
        return;
    }

    onChange({ start, end });
  };

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-2 px-3 py-2 text-sm border rounded-lg transition-colors min-w-0 ${
          hasSelection
            ? 'border-blue-200 bg-blue-50 text-blue-700'
            : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
        }`}
      >
        <Calendar className='w-4 h-4 flex-shrink-0' />
        <span className='truncate min-w-0 flex-1 text-left'>
          <span className='font-medium'>{label}:</span> {getDisplayText()}
        </span>
        {hasSelection && (
          <span className='bg-blue-600 text-white text-xs px-2 py-0.5 rounded-full flex-shrink-0'>
            1
          </span>
        )}
        <ChevronDown className='w-4 h-4 flex-shrink-0' />
      </button>

      {/* Clear Button */}
      {hasSelection && !isOpen && (
        <button
          onClick={handleClear}
          className='absolute -top-1 -right-1 bg-gray-100 hover:bg-gray-200 rounded-full p-1 transition-colors'
          title={`Clear ${label.toLowerCase()} filter`}
        >
          <X className='w-3 h-3 text-gray-600' />
        </button>
      )}

      {/* Dropdown */}
      {isOpen && (
        <div className='absolute top-full left-0 mt-1 w-80 bg-white border border-gray-200 rounded-lg shadow-lg z-50'>
          <div className='p-4'>
            {/* Quick Presets */}
            <div className='mb-4'>
              <div className='text-xs font-medium text-gray-500 mb-2'>Quick presets</div>
              <div className='flex gap-2'>
                <Button
                  onClick={() => handlePresetClick('today')}
                  variant='ghost'
                  size='sm'
                  className='border text-xs py-1 h-6'
                >
                  Today
                </Button>
                <Button
                  onClick={() => handlePresetClick('week')}
                  variant='ghost'
                  size='sm'
                  className='border text-xs py-1 h-6'
                >
                  Last 7 days
                </Button>
                <Button
                  onClick={() => handlePresetClick('month')}
                  variant='ghost'
                  size='sm'
                  className='border text-xs py-1 h-6'
                >
                  Last 30 days
                </Button>
              </div>
            </div>

            {/* Custom Date Range */}
            <div className='border-t border-gray-100 pt-4'>
              <div className='text-xs font-medium text-gray-500 mb-3'>Custom range</div>

              <div className='space-y-3'>
                <div>
                  <label
                    htmlFor='start-date'
                    className='block text-xs font-medium text-gray-700 mb-1'
                  >
                    Start date
                  </label>
                  <input
                    id='start-date'
                    type='date'
                    value={startDate}
                    onChange={handleStartDateChange}
                    max={endDate || new Date().toISOString().split('T')[0]}
                    className='w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent'
                  />
                </div>

                <div>
                  <label
                    htmlFor='end-date'
                    className='block text-xs font-medium text-gray-700 mb-1'
                  >
                    End date
                  </label>
                  <input
                    id='end-date'
                    type='date'
                    value={endDate}
                    onChange={handleEndDateChange}
                    min={startDate || ''}
                    max={new Date().toISOString().split('T')[0]}
                    className='w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent'
                  />
                </div>
              </div>
            </div>

            {/* Clear Button */}
            {hasSelection && (
              <div className='border-t border-gray-100 pt-3 mt-4'>
                <button
                  onClick={handleClear}
                  className='w-full text-xs text-gray-500 hover:text-gray-700 transition-colors py-2'
                >
                  Clear date range
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
