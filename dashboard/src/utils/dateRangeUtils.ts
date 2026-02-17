export type DateRangeOption =
  | 'last_30_minutes'
  | 'last_1_hour'
  | 'last_6_hours'
  | 'last_24_hours'
  | 'today'
  | 'yesterday'
  | 'last_7_days'
  | 'last_30_days'
  | 'this_month'
  | 'last_month'
  | 'custom';

export type GroupByOption = 'none' | 'hour' | 'day' | 'week' | 'month';

export interface DateRange {
  startDate: Date;
  endDate: Date;
}

export interface DateRangePreset {
  label: string;
  value: DateRangeOption;
  range: DateRange;
}

/**
 * Get date range based on the specified option following the perfect plan logic
 */
export function getDateRange(option: DateRangeOption, customRange?: DateRange): DateRange {
  const now = new Date();

  switch (option) {
    case 'last_30_minutes':
      return {
        startDate: new Date(now.getTime() - 30 * 60 * 1000),
        endDate: now,
      };

    case 'last_1_hour':
      return {
        startDate: new Date(now.getTime() - 60 * 60 * 1000),
        endDate: now,
      };

    case 'last_6_hours':
      return {
        startDate: new Date(now.getTime() - 6 * 60 * 60 * 1000),
        endDate: now,
      };

    case 'last_24_hours':
      return {
        startDate: new Date(now.getTime() - 24 * 60 * 60 * 1000),
        endDate: now,
      };

    case 'today':
      return {
        startDate: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0),
        endDate: now,
      };

    case 'yesterday': {
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      return {
        startDate: new Date(
          yesterday.getFullYear(),
          yesterday.getMonth(),
          yesterday.getDate(),
          0,
          0,
          0,
          0,
        ),
        endDate: new Date(
          yesterday.getFullYear(),
          yesterday.getMonth(),
          yesterday.getDate(),
          23,
          59,
          59,
          999,
        ),
      };
    }

    case 'last_7_days':
      return {
        startDate: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
        endDate: now,
      };

    case 'last_30_days':
      return {
        startDate: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
        endDate: now,
      };

    case 'this_month':
      return {
        startDate: new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0),
        endDate: now,
      };

    case 'last_month': {
      const firstDayOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastDayOfPreviousMonth = new Date(firstDayOfThisMonth.getTime() - 1);
      const firstDayOfPreviousMonth = new Date(
        lastDayOfPreviousMonth.getFullYear(),
        lastDayOfPreviousMonth.getMonth(),
        1,
      );

      return {
        startDate: firstDayOfPreviousMonth,
        endDate: new Date(
          lastDayOfPreviousMonth.getFullYear(),
          lastDayOfPreviousMonth.getMonth(),
          lastDayOfPreviousMonth.getDate(),
          23,
          59,
          59,
          999,
        ),
      };
    }

    case 'custom':
      if (!customRange) {
        throw new Error('Custom range must be provided for custom date range option');
      }
      return customRange;

    default:
      return getDateRange('last_30_days');
  }
}

/**
 * Get label for a date range option
 */
function getDateRangeLabel(option: Exclude<DateRangeOption, 'custom'>): string {
  switch (option) {
    case 'last_30_minutes':
      return 'Last 30 minutes';
    case 'last_1_hour':
      return 'Last 1 hour';
    case 'last_6_hours':
      return 'Last 6 hours';
    case 'last_24_hours':
      return 'Last 24 hours';
    case 'today':
      return 'Today';
    case 'yesterday':
      return 'Yesterday';
    case 'last_7_days':
      return 'Last 7 days';
    case 'last_30_days':
      return 'Last 30 days';
    case 'this_month':
      return 'This month';
    case 'last_month':
      return 'Last month';
    default:
      return option;
  }
}

/**
 * Get all available date range presets
 */
export function getDateRangePresets(): DateRangePreset[] {
  const options: Exclude<DateRangeOption, 'custom'>[] = [
    'last_30_minutes',
    'last_1_hour',
    'last_6_hours',
    'last_24_hours',
    'today',
    'yesterday',
    'last_7_days',
    'last_30_days',
    'this_month',
    'last_month',
  ];

  return options.map(option => ({
    label: getDateRangeLabel(option),
    value: option,
    range: getDateRange(option),
  }));
}

/**
 * Determine which preset matches the current date range (if any)
 */
export function getMatchingPreset(dateRange: DateRange): DateRangePreset | null {
  const presets = getDateRangePresets();
  const tolerance = 5000; // 5 seconds tolerance for time comparison

  return (
    presets.find(preset => {
      const startMatch =
        Math.abs(preset.range.startDate.getTime() - dateRange.startDate.getTime()) < tolerance;
      const endMatch =
        Math.abs(preset.range.endDate.getTime() - dateRange.endDate.getTime()) < tolerance;
      return startMatch && endMatch;
    }) || null
  );
}

/**
 * Format a date range for display
 */
export function formatDateRangeForDisplay(dateRange: DateRange): string {
  const matchingPreset = getMatchingPreset(dateRange);

  if (matchingPreset) {
    return matchingPreset.label;
  }

  // For custom ranges, format as "MMM DD - MMM DD" or "MMM DD, YYYY - MMM DD, YYYY" if different years
  const startYear = dateRange.startDate.getFullYear();
  const endYear = dateRange.endDate.getFullYear();

  if (startYear === endYear) {
    return `${dateRange.startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${dateRange.endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  }

  return `${dateRange.startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} - ${dateRange.endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

/**
 * Check if groupBy should be enabled for the current date range and group option
 */
export function shouldEnableGroupBy(dateRange: DateRange, groupBy: GroupByOption): boolean {
  if (groupBy === 'none') return true;

  const rangeDuration = dateRange.endDate.getTime() - dateRange.startDate.getTime();
  const days = rangeDuration / (1000 * 60 * 60 * 24);

  switch (groupBy) {
    case 'day':
      // Enable day grouping for ranges > 1 day
      return days > 1;

    case 'week':
      // Enable week grouping for ranges > 7 days
      return days > 7;

    case 'month':
      // Enable month grouping for ranges > 31 days
      return days > 31;

    default:
      return true;
  }
}

/**
 * Format chart dates consistently across all analytics components
 */
export function formatChartDate(dateString: string, groupByType: GroupByOption): string {
  if (groupByType === 'hour') {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      hour12: true,
    });
  }
  if (dateString.includes('_')) {
    // Handle date ranges for week/month groupBy
    const dateParts = dateString.split('_');
    if (dateParts.length >= 2 && dateParts[0] && dateParts[1]) {
      const start = new Date(dateParts[0]);
      const end = new Date(dateParts[1]);

      if (groupByType === 'week') {
        // Format as "Nov 11-17" or "Nov 25 - Dec 1" for cross-month weeks
        if (start.getMonth() === end.getMonth()) {
          return `${start.toLocaleDateString('en-US', { month: 'short' })} ${start.getDate()}-${end.getDate()}`;
        }
        return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
      }
      // Format as "Nov 2024" for months
      return start.toLocaleDateString('en-US', {
        month: 'short',
        year: 'numeric',
      });
    }
    // Fallback if date format is unexpected
    return dateString;
  }
  // Handle single dates for day groupBy
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}
