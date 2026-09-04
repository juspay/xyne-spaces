import React, { useState, useRef, useEffect } from 'react';
import { Calendar, X } from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';
import Button from '../Button';
import { cn } from '../../../utils/classNames';

// ==================== TYPES ====================
interface DatePickerProps {
  id?: string;
  selectedDate: Date | null;
  onSelect: (date: Date | null) => void;
  placeholder?: string;
  minDate?: Date;
  maxDate?: Date;
  disabledDates?: Date[];
  markedDates?: Date[];
  inputClassName?: string;
  showClearButton?: boolean;
  isInitialOpen?: boolean;
  /** Extra classes merged into the popover content — e.g. to raise its z-index
   * when the picker is opened from inside a higher-stacked overlay. */
  contentClassName?: string;
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
  markedDates?: Date[];
}> = ({ year, month, selectedDate, onSelect, minDate, maxDate, disabledDates, markedDates }) => {
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
      <div className='text-sm font-semibold text-foreground leading-6 mb-2 px-3'>
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
          const isMarked = markedDates?.some(markedDate => isSameDay(markedDate, date)) ?? false;

          return (
            <button
              key={day}
              type='button'
              onClick={() => !isDisabled && onSelect(date)}
              data-date={`${year}-${month}-${day}`}
              disabled={isDisabled}
              className={`
                relative aspect-square flex items-center justify-center text-sm rounded-md transition-colors
                ${isSelected ? 'bg-primary text-white font-semibold' : ''}
                ${!isSelected && isToday ? 'border border-primary text-primary font-semibold' : ''}
                ${!isSelected && !isToday && !isDisabled ? 'hover:bg-muted text-foreground' : ''}
                ${isDisabled ? 'text-muted-foreground cursor-not-allowed' : 'cursor-pointer'}
              `}
              data-track-category='Tickets'
              data-track-name='SelectDate'
              data-track-metadata={JSON.stringify({
                date: `${year}-${month}-${day}`,
                disabled: isDisabled,
              })}
            >
              {day}
              {isMarked && (
                <span
                  className={cn(
                    'absolute bottom-1 size-1 rounded-full',
                    isSelected ? 'bg-background' : 'bg-status-failure',
                  )}
                  aria-hidden='true'
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

// ==================== MAIN COMPONENT ====================
export const DatePicker: React.FC<DatePickerProps> = ({
  id,
  selectedDate,
  onSelect,
  placeholder = 'Select date',
  minDate,
  maxDate,
  disabledDates,
  markedDates,
  inputClassName = '',
  showClearButton = true,
  isInitialOpen = false,
  contentClassName,
}) => {
  const [isOpen, setIsOpen] = useState(isInitialOpen);
  const [months, setMonths] = useState<Array<{ year: number; month: number }>>([]);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isLoadingTop, setIsLoadingTop] = useState(false);
  const [isLoadingBottom, setIsLoadingBottom] = useState(false);

  // Reset months when calendar closes
  useEffect(() => {
    if (!isOpen) {
      const timer = setTimeout(() => {
        setMonths([]);
      }, 200);
      return () => clearTimeout(timer);
    }
    return;
  }, [isOpen]);

  // Initialize months when calendar opens
  useEffect(() => {
    if (isOpen && months.length === 0) {
      const baseDate = selectedDate || new Date();
      const initialMonths = [];

      // Always load 6 months before and after for smooth scrolling
      const range = 6;

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

  // Scroll to selected date or current month
  useEffect(() => {
    if (isOpen && months.length > 0) {
      setTimeout(() => {
        if (!scrollContainerRef.current) return;

        if (selectedDate) {
          // Scroll to selected date
          const year = selectedDate.getFullYear();
          const month = selectedDate.getMonth();
          const day = selectedDate.getDate();

          const dateButton = scrollContainerRef.current.querySelector(
            `[data-date="${year}-${month}-${day}"]`,
          );

          if (dateButton) {
            dateButton.scrollIntoView({ block: 'center', behavior: 'instant' });
          }
        } else {
          // Scroll to current month (which should be in the middle since range=6)
          const currentMonth = new Date().getMonth();
          const currentYear = new Date().getFullYear();

          // Find the current month's container
          const monthElements = scrollContainerRef.current.querySelectorAll('[data-month]');
          const currentMonthElement = Array.from(monthElements).find(el => {
            const monthView = el.querySelector('[class*="text-sm font-semibold"]');
            if (monthView && monthView.textContent) {
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
              const expectedText = `${monthNames[currentMonth]} ${currentYear}`;
              return monthView.textContent.trim() === expectedText;
            }
            return false;
          });

          if (currentMonthElement) {
            currentMonthElement.scrollIntoView({ block: 'start', behavior: 'instant' });
          }
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

      // Store the current scroll height before adding new content
      const previousScrollHeight = scrollHeight;

      const newMonths = [];

      for (let i = 3; i >= 1; i--) {
        const date = new Date(firstMonth.year, firstMonth.month - i, 1);
        newMonths.push({
          year: date.getFullYear(),
          month: date.getMonth(),
        });
      }

      setMonths([...newMonths, ...months]);

      // Adjust scroll position based on the actual height difference
      requestAnimationFrame(() => {
        if (scrollContainerRef.current) {
          const newScrollHeight = scrollContainerRef.current.scrollHeight;
          const heightDifference = newScrollHeight - previousScrollHeight;
          scrollContainerRef.current.scrollTop = scrollTop + heightDifference;
        }
        setIsLoadingTop(false);
      });
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
    // setIsOpen(false);
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
          id={id}
          data-testid='ticket-due-date-selector'
          onClick={() => setIsOpen(!isOpen)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setIsOpen(!isOpen);
            }
          }}
          className={cn(
            'relative flex items-center border border-border px-2 gap-1.5 rounded-[6px] h-7 transition-colors bg-background dark:bg-input w-fit max-w-full overflow-hidden cursor-pointer hover:bg-muted shadow-[0_1px_1px_0_rgba(5,5,6,0.04)]',
            inputClassName,
          )}
          data-track-category='Tickets'
          data-track-name='ToggleDatePicker'
        >
          <Calendar
            className={cn(
              'flex-shrink-0 w-3.5 h-3.5',
              selectedDate ? 'text-foreground' : 'text-muted-foreground',
            )}
          />
          <span
            className={cn(
              'text-[13px] whitespace-nowrap w-full',
              selectedDate ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            {selectedDate ? formatDate(selectedDate) : placeholder}
          </span>
          {showClearButton && selectedDate && (
            <button
              onClick={handleClear}
              className='ml-1 flex-shrink-0 hover:bg-muted rounded p-0.5 transition-colors'
              data-track-category='Tickets'
              data-track-name='ClearSelectedDate'
            >
              <X className='w-3 h-3 text-muted-foreground' />
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
          className={cn(
            'w-[280px] rounded-lg border border-border bg-background shadow-lg overflow-hidden z-50',
            // Animation classes
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
            'duration-200',
            contentClassName,
          )}
          sideOffset={4}
          align='start'
        >
          <div className='sticky top-0 z-10 bg-background pt-2.5 border-b border-border shadow-sm'>
            <div className='grid grid-cols-7 gap-1 px-3'>
              {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(day => (
                <div
                  key={day}
                  className='text-center text-xs font-medium text-muted-foreground py-1'
                >
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
                  {...(markedDates && { markedDates })}
                />
              </div>
            ))}
          </div>

          {/* Footer with action buttons */}
          <div className='border-t border-border flex items-center justify-end gap-3 p-3 h-14 '>
            <Button
              variant='outline'
              onClick={handleCancel}
              className='h-8 px-3 text-sm text-muted-foreground font-semibold rounded-lg border border-border hover:bg-muted transition-colors'
              data-track-category='Tickets'
              data-track-name='CancelDatePicker'
            >
              Cancel
            </Button>
            <Button
              onClick={handleApply}
              className='h-8 px-3 text-sm font-semibold rounded-lg transition-colors bg-primary hover:bg-primary/90 text-white'
              data-track-category='Tickets'
              data-track-name='ApplyDatePicker'
            >
              Apply
            </Button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};
