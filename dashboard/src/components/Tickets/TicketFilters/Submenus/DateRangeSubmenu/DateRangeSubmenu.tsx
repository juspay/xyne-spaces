import { ReactElement, useState, useEffect } from 'react';
import { Button } from '../../../../ui/Button';
import { DateRange } from '../../types';

interface DateRangeSubmenuProps {
  dateRange: DateRange;
  onChange: (dateRange: DateRange) => void;
  onClose: () => void;
  label: string;
  allowFutureDates?: boolean;
}

export const DateRangeSubmenu = ({
  dateRange,
  onChange,
  label,
  allowFutureDates = false,
}: DateRangeSubmenuProps): ReactElement => {
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

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
  }, [dateRange.start, dateRange.end]);

  const handleStartDateChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const value = e.target.value;
    setStartDate(value);

    if (value) {
      // Parse as UTC to avoid timezone issues - start of day in UTC
      const startTimestamp = new Date(`${value}T00:00:00.000Z`).getTime();
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
      // Parse as UTC to avoid timezone issues - end of day in UTC
      const endTimestamp = new Date(`${value}T23:59:59.999Z`).getTime();
      const newRange: { start?: number; end?: number } = { ...dateRange, end: endTimestamp };
      onChange(newRange);
    } else {
      const newRange: { start?: number; end?: number } = { ...dateRange };
      delete newRange.end;
      onChange(newRange);
    }
  };

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
        monthStart.setDate(today.getDate() - 30);
        start = monthStart.getTime();
        end = today.getTime() + 24 * 60 * 60 * 1000 - 1;
        break;
      }
      default:
        return;
    }

    onChange({ start, end });
  };

  const handleClear = (): void => {
    onChange({});
    setStartDate('');
    setEndDate('');
  };

  return (
    <div className='w-80 bg-white border border-gray-200 rounded-lg shadow-lg'>
      <div className='p-4'>
        {/* Header */}
        <div className='text-sm font-medium text-gray-900 mb-3'>{label}</div>

        {/* Quick Presets */}
        <div className='mb-4'>
          <div className='text-xs font-medium text-gray-500 mb-2'>Quick presets</div>
          <div className='flex gap-2'>
            <Button onClick={() => handlePresetClick('today')} variant='outline' size='sm'>
              Today
            </Button>
            <Button onClick={() => handlePresetClick('week')} variant='outline' size='sm'>
              Last 7 days
            </Button>
            <Button onClick={() => handlePresetClick('month')} variant='outline' size='sm'>
              Last 30 days
            </Button>
          </div>
        </div>

        {/* Custom Date Range */}
        <div className='border-t border-gray-100 pt-4'>
          <div className='text-xs font-medium text-gray-500 mb-3'>Custom range</div>

          <div className='space-y-3'>
            <div>
              <label htmlFor='start-date' className='block text-xs font-medium text-gray-700 mb-1'>
                Start date
              </label>
              <input
                id='start-date'
                type='date'
                value={startDate}
                onChange={handleStartDateChange}
                {...(endDate
                  ? { max: endDate }
                  : !allowFutureDates
                    ? { max: new Date().toISOString().split('T')[0] }
                    : {})}
                className='w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent'
              />
            </div>

            <div>
              <label htmlFor='end-date' className='block text-xs font-medium text-gray-700 mb-1'>
                End date
              </label>
              <input
                id='end-date'
                type='date'
                value={endDate}
                onChange={handleEndDateChange}
                {...(startDate ? { min: startDate } : {})}
                {...(!allowFutureDates ? { max: new Date().toISOString().split('T')[0] } : {})}
                className='w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent'
              />
            </div>
          </div>
        </div>

        {/* Clear Button */}
        {(dateRange.start || dateRange.end) && (
          <div className='border-t border-gray-100 pt-3 mt-4'>
            <Button onClick={handleClear} variant='ghost' size='sm' className='w-full'>
              Clear date range
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};
