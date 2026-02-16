import React, { useState, useRef, useEffect } from 'react';
import { Calendar, X } from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';
import Button from '../../ui/Button';

// ==================== TYPES ====================
interface InlineCalendarProps {
  selectedDate: Date | null;
  onSelect: (date: Date | null) => void;
  placeholder?: string;
  minDate?: Date;
  maxDate?: Date;
  disabledDates?: Date[];
  inputClassName?: string;
  showClearButton?: boolean;
  isInitialOpen?: boolean;
}

// ==================== UTILITY FUNCTIONS ====================
const getMonthData = (year: number, month: number) => {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();
  const startingDayOfWeek = firstDay.getDay();

  return { daysInMonth, startingDayOfWeek };
};

const isSameDay = (date1: Date | null, date2: Date | null): boolean => {
  if (!date1 || !date2) return false;
  return (
    date1.getDate() === date2.getDate() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getFullYear() === date2.getFullYear()
  );
};

const isDateDisabled = (
  date: Date,
  minDate?: Date,
  maxDate?: Date,
  disabledDates?: Date[],
): boolean => {
  if (minDate && date < minDate) return true;
  if (maxDate && date > maxDate) return true;
  if (disabledDates?.some(d => isSameDay(d, date))) return true;
  return false;
};

const formatDate = (date: Date | null): string => {
  if (!date) return '';
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
};

// ==================== MONTH COMPONENT ====================
const MonthView: React.FC<{
  year: number;
  month: number;
  selectedDate: Date | null;
  onSelect: (date: Date) => void;
  minDate?: Date;
  maxDate?: Date;
  disabledDates?: Date[];
}> = ({ year, month, selectedDate, onSelect, minDate, maxDate, disabledDates }) => {
  const { daysInMonth, startingDayOfWeek } = getMonthData(year, month);

  const monthNames = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];

  return (
    <div className='mb-6'>
      {/* Month/Year Header */}
      <div className='text-sm font-semibold text-gray-700 leading-6 mb-2 px-3'>
        {monthNames[month]} {year}
      </div>

      {/* Calendar Grid */}
      <div className='grid grid-cols-7 gap-0.5 px-3'>
        {/* Empty cells for days before month starts */}
        {Array.from({ length: startingDayOfWeek }).map((_, i) => (
          <div key={`empty-${i}`} className='aspect-square' />
        ))}

        {/* Days of the month */}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1;
          const date = new Date(year, month, day);
          const isSelected = isSameDay(date, selectedDate);
          const isToday = isSameDay(date, new Date());
          const isDisabled = isDateDisabled(date, minDate, maxDate, disabledDates);

          return (
            <button
              key={day}
              type='button'
              onClick={() => !isDisabled && onSelect(date)}
              data-date={`${year}-${month}-${day}`}
              disabled={isDisabled}
              className={`
                aspect-square flex items-center justify-center text-sm rounded-md transition-colors
                ${isSelected ? 'bg-black text-white font-semibold' : ''}
                ${!isSelected && isToday ? 'border border-sidebar-badge-accent text-sidebar-badge-accent font-semibold' : ''}
                ${!isSelected && !isToday && !isDisabled ? 'hover:bg-gray-100 text-gray-900' : ''}
                ${isDisabled ? 'text-gray-300 cursor-not-allowed' : 'cursor-pointer'}
              `}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
};

// ==================== MAIN COMPONENT ====================
export const InlineCalendar: React.FC<InlineCalendarProps> = ({
  selectedDate,
  onSelect,
  placeholder = 'Select date',
  minDate,
  maxDate,
  disabledDates,
  inputClassName = '',
  showClearButton = true,
  isInitialOpen = false,
}) => {
  const [isOpen, setIsOpen] = useState(isInitialOpen);
  const [months, setMonths] = useState<Array<{ year: number; month: number }>>([]);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isLoadingTop, setIsLoadingTop] = useState(false);
  const [isLoadingBottom, setIsLoadingBottom] = useState(false);

  // Reset months when calendar closes (NEW)
  useEffect(() => {
    if (!isOpen) {
      setMonths([]);
    }
  }, [isOpen]);

  // Initialize months when calendar opens
  useEffect(() => {
    if (isOpen && months.length === 0) {
      const baseDate = selectedDate || new Date();
      const initialMonths = [];

      const range = selectedDate ? 6 : 0;

      for (let i = -range; i <= range; i++) {
        const date = new Date(baseDate.getFullYear(), baseDate.getMonth() + i, 1);
        initialMonths.push({
          year: date.getFullYear(),
          month: date.getMonth(),
        });
      }

      setMonths(initialMonths);
    }
  }, [isOpen, selectedDate, months.length]);

  // Scroll to selected date
  useEffect(() => {
    if (isOpen && months.length > 0 && selectedDate) {
      setTimeout(() => {
        if (!scrollContainerRef.current) return;

        const year = selectedDate.getFullYear();
        const month = selectedDate.getMonth();
        const day = selectedDate.getDate();

        const dateButton = scrollContainerRef.current.querySelector(
          `[data-date="${year}-${month}-${day}"]`,
        );

        if (dateButton) {
          dateButton.scrollIntoView({ block: 'center', behavior: 'instant' });
        }
      }, 0);
    }
  }, [isOpen, selectedDate, months.length]);

  // Handle scroll events for infinite scrolling
  const handleScroll = () => {
    if (!scrollContainerRef.current || isLoadingTop || isLoadingBottom || months.length === 0)
      return;

    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;

    // Load more months at top
    if (scrollTop < 200) {
      setIsLoadingTop(true);
      const firstMonth = months[0];
      if (!firstMonth) {
        setIsLoadingTop(false);
        return;
      }

      const newMonths = [];

      for (let i = 3; i >= 1; i--) {
        const date = new Date(firstMonth.year, firstMonth.month - i, 1);
        newMonths.push({
          year: date.getFullYear(),
          month: date.getMonth(),
        });
      }

      setMonths([...newMonths, ...months]);

      // Adjust scroll position to prevent jump
      setTimeout(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop = scrollTop + 600;
        }
        setIsLoadingTop(false);
      }, 0);
    }

    // Load more months at bottom
    if (scrollHeight - scrollTop - clientHeight < 200) {
      setIsLoadingBottom(true);
      const lastMonth = months[months.length - 1];
      if (!lastMonth) {
        setIsLoadingBottom(false);
        return;
      }

      const newMonths = [];

      for (let i = 1; i <= 3; i++) {
        const date = new Date(lastMonth.year, lastMonth.month + i, 1);
        newMonths.push({
          year: date.getFullYear(),
          month: date.getMonth(),
        });
      }

      setMonths([...months, ...newMonths]);
      setIsLoadingBottom(false);
    }
  };

  const handleDateSelect = (date: Date) => {
    onSelect(date);
    setIsOpen(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(null);
  };

  const handleCancel = () => {
    setIsOpen(false);
  };

  const handleApply = () => {
    setIsOpen(false);
  };

  return (
    <Popover.Root open={isOpen} onOpenChange={setIsOpen}>
      {/* ========== TRIGGER INPUT ========== */}
      <Popover.Trigger asChild>
        <div
          role='button'
          tabIndex={0}
          data-testid='ticket-due-date-selector'
          onClick={() => setIsOpen(!isOpen)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setIsOpen(!isOpen);
            }
          }}
          className={`relative flex items-center border px-2 gap-1.5 rounded-md h-7 transition-colors bg-gray-50 w-fit max-w-full overflow-hidden cursor-pointer hover:bg-gray-100 ${inputClassName}`}
        >
          <Calendar className='flex-shrink-0 w-3.5 h-3.5 text-gray-500' />
          <span className='text-[13px] text-gray-700 whitespace-nowrap'>
            {selectedDate ? formatDate(selectedDate) : placeholder}
          </span>
          {showClearButton && selectedDate && (
            <button
              onClick={handleClear}
              className='ml-1 flex-shrink-0 hover:bg-gray-200 rounded p-0.5 transition-colors'
            >
              <X className='w-3 h-3 text-gray-500' />
            </button>
          )}
        </div>
      </Popover.Trigger>

      {/* ========== DROPDOWN CONTENT ========== */}
      <Popover.Portal>
        <Popover.Content
          onWheel={e => {
            e.stopPropagation();
          }}
          onTouchMove={e => {
            e.stopPropagation();
          }}
          data-testid='ticket-due-date-calendar'
          className='w-[280px] rounded-lg border border-gray-200 bg-white shadow-lg overflow-hidden z-50'
          sideOffset={4}
          align='start'
        >
          <div className='sticky top-0 z-10 bg-white pt-2.5 border-b border-gray-100 shadow-sm'>
            <div className='grid grid-cols-7 gap-1 px-3'>
              {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(day => (
                <div key={day} className='text-center text-xs font-medium text-gray-500 py-1'>
                  {day}
                </div>
              ))}
            </div>
          </div>
          {/* Scrollable months container */}
          <div
            ref={scrollContainerRef}
            onScroll={handleScroll}
            className='max-h-56 overflow-y-scroll pt-3 no-scrollbar'
          >
            {months.map((m, index) => (
              <div key={`${m.year}-${m.month}`} data-month={index}>
                <MonthView
                  year={m.year}
                  month={m.month}
                  selectedDate={selectedDate}
                  onSelect={handleDateSelect}
                  {...(minDate && { minDate })}
                  {...(maxDate && { maxDate })}
                  {...(disabledDates && { disabledDates })}
                />
              </div>
            ))}
          </div>

          {/* Footer with action buttons */}
          <div className='border-t border-gray-200 flex items-center justify-end gap-3 p-3 h-14 '>
            <Button
              variant='outline'
              onClick={handleCancel}
              className='h-8 px-3 text-sm text-gray-600 font-semibold rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors'
            >
              Cancel
            </Button>
            <Button
              onClick={handleApply}
              className='h-8 px-3 text-sm text-white font-semibold rounded-lg transition-colors'
            >
              Apply
            </Button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};
