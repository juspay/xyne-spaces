import * as React from 'react';
import { DayPicker } from 'react-day-picker';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../../utils/classNames';

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

/**
 * Calendar component built on react-day-picker (shadcn/ui pattern)
 *
 * Features:
 * - Single/multiple/range date selection
 * - Date constraints via disabled, fromDate, toDate
 * - Keyboard navigation
 * - Customizable styling
 *
 * @example
 * <Calendar
 *   mode="single"
 *   selected={date}
 *   onSelect={setDate}
 *   disabled={{ before: subDays(new Date(), 30), after: new Date() }}
 * />
 */
function Calendar({ className, classNames, showOutsideDays = true, ...props }: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      weekStartsOn={0}
      className={cn('p-2 w-full', className)}
      classNames={{
        months: 'flex flex-col w-full',
        month: 'space-y-2 w-full',
        month_caption: 'flex justify-center pt-1 relative items-center h-7 px-8',
        caption_label: 'text-sm font-medium text-foreground',
        nav: 'flex items-center',
        button_previous:
          'absolute left-0 h-7 w-7 bg-transparent p-0 opacity-70 hover:opacity-100 inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50',
        button_next:
          'absolute right-0 h-7 w-7 bg-transparent p-0 opacity-70 hover:opacity-100 inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50',
        month_grid: 'w-full border-collapse',
        weekdays: 'flex w-full',
        weekday:
          'text-muted-foreground flex-1 font-normal text-xs flex items-center justify-center h-8',
        week: 'flex w-full',
        day: 'relative flex-1 p-0 text-center text-sm focus-within:relative focus-within:z-20 [&:has([aria-selected])]:bg-accent [&:has([aria-selected].day-outside)]:bg-accent/50 [&:has([aria-selected].day-range-end)]:rounded-r-md',
        day_button:
          'h-8 w-full p-0 font-normal aria-selected:opacity-100 inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm transition-colors focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 hover:bg-muted hover:text-foreground',
        range_start: 'day-range-start',
        range_end: 'day-range-end',
        selected:
          'bg-blue-500 text-white hover:bg-blue-600 hover:text-white focus:bg-blue-500 focus:text-white rounded-full',
        today: 'bg-accent text-accent-foreground rounded-full',
        outside:
          'day-outside text-muted-foreground/50 aria-selected:bg-accent/50 aria-selected:text-muted-foreground',
        disabled: 'text-muted-foreground/40 cursor-not-allowed',
        range_middle: 'aria-selected:bg-accent aria-selected:text-accent-foreground',
        hidden: 'invisible',
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) => {
          const Icon = orientation === 'left' ? ChevronLeft : ChevronRight;
          return <Icon className='h-4 w-4' />;
        },
      }}
      {...props}
    />
  );
}

Calendar.displayName = 'Calendar';

export { Calendar };
