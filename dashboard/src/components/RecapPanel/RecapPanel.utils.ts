import { TZDate } from '@date-fns/tz';
import { subDays, format } from 'date-fns';
import { YesterdayDateResult } from './RecapPanel.types';

/**
 * Helper function to get yesterday's date in IST
 * @returns Object containing date string (YYYY-MM-DD) and Date object
 */
export const getYesterdayIST = (): YesterdayDateResult => {
  // Get current time in IST
  const nowIST = new TZDate(new Date(), 'Asia/Kolkata');

  // Get yesterday in IST
  const yesterdayIST = subDays(nowIST, 1);

  // Format as YYYY-MM-DD string
  const yesterdayStr = format(yesterdayIST, 'yyyy-MM-dd');

  return {
    dateStr: yesterdayStr,
    dateObj: new Date(`${yesterdayStr}T00:00:00Z`),
  };
};

/**
 * Format recap date for display
 * @param dateString - ISO date string
 * @returns Formatted date string (e.g., "January, 1st")
 */
export const formatRecapDate = (dateString: string): string => {
  const date = new Date(dateString);
  // Format as "Month, 1st" with ordinal suffix
  return format(date, 'MMMM, do');
};
