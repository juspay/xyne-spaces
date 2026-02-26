/**
 * Date utility functions for chat messages using date-fns
 */

import { isSameDay as dateFnsIsSameDay, isToday, isYesterday, format } from 'date-fns';

/**
 * Options for formatting dates
 */
export interface DateFormatOptions extends Intl.DateTimeFormatOptions {
  locale?: string;
  fallbackText?: string;
}

/**
 * Check if two dates are on the same day
 */
export const isSameDay = (date1: Date | number, date2: Date | number): boolean => {
  return dateFnsIsSameDay(new Date(date1), new Date(date2));
};

/**
 * Get relative date text for timestamps
 * - "Today at 2:30 PM"
 * - "Yesterday at 2:30 PM"
 * - "Jan 15 at 2:30 PM"
 */
export const formatRelativeTimestamp = (date: Date | number): string => {
  const messageDate = new Date(date);
  const timeString = format(messageDate, 'h:mm a');

  if (isToday(messageDate)) {
    return `Today at ${timeString}`;
  } else if (isYesterday(messageDate)) {
    return `Yesterday at ${timeString}`;
  }
  const dateString = format(messageDate, 'MMM d');
  return `${dateString} at ${timeString}`;
};

/**
 * Format full timestamp for tooltip display
 * Shows complete date and time: "Monday, January 15, 2024 at 2:30:45 PM"
 */
export const formatFullTimestamp = (date: Date | number): string => {
  const messageDate = new Date(date);

  const dateString = format(messageDate, 'EEEE, MMMM d, yyyy');
  const timeString = format(messageDate, 'h:mm:ss a');

  return `${dateString} at ${timeString}`;
};

/**
 * Format elapsed time for list items (DM/channel preview)
 * - "now" for < 1 min
 * - "1m".."59m" for < 1 hour
 * - "1h".."23h" for < 1 day
 * - "1d".."31d" for up to 31 days
 * - "1 month".."11 months" then "1 year", "2 years", etc.
 */
export const formatElapsedTime = (date: Date | number): string => {
  const messageDate = new Date(date);
  const now = new Date();
  const diffInMs = now.getTime() - messageDate.getTime();
  const diffInMinutes = Math.floor(diffInMs / (1000 * 60));
  const diffInHours = Math.floor(diffInMinutes / 60);
  const diffInDays = Math.floor(diffInHours / 24);

  if (diffInMinutes < 1) {
    return 'now';
  }
  if (diffInMinutes < 60) {
    return `${diffInMinutes}m`;
  }
  if (diffInHours < 24) {
    return `${diffInHours}h`;
  }
  if (diffInDays <= 31) {
    return `${diffInDays}d`;
  }

  const diffInMonths = Math.floor(diffInDays / 30.44);
  const diffInYears = Math.floor(diffInMonths / 12);

  if (diffInYears >= 1) {
    return diffInYears === 1 ? '1 year' : `${diffInYears} years`;
  }
  return diffInMonths === 1 ? '1 month' : `${diffInMonths} months`;
};

/**
 * Format relative time (simple) - useful for showing "5m ago", "2h ago", etc.
 * This is commonly used in chat message timestamps
 */
export const formatRelativeTime = (date: Date | number): string => {
  const messageDate = new Date(date);
  const now = new Date();
  const diffInMilliseconds = now.getTime() - messageDate.getTime();
  const diffInMinutes = Math.floor(diffInMilliseconds / (1000 * 60));
  const diffInHours = Math.floor(diffInMinutes / 60);
  const diffInDays = Math.floor(diffInHours / 24);

  if (diffInMinutes < 1) {
    return 'Just now';
  } else if (diffInMinutes < 60) {
    return `${diffInMinutes}m ago`;
  } else if (diffInHours < 24) {
    return `${diffInHours}h ago`;
  } else if (diffInDays < 7) {
    return `${diffInDays}d ago`;
  }
  return format(messageDate, 'MMM d');
};

/**
 * Format relative timestamp for thread replies with week-aware context
 * - Today: "5m ago", "2h ago" (relative time)
 * - Yesterday: "Yesterday at 2:30 PM"
 * - This week (within 7 days): "Monday at 2:30 PM", "Wednesday at 2:30 PM"
 * - Older: "Jan 15 at 2:30 PM"
 */

export const formatThreadTimestamp = (date: Date | number): string => {
  const messageDate = new Date(date);
  const now = new Date();
  const diffInMilliseconds = now.getTime() - messageDate.getTime();
  const diffInMinutes = Math.floor(diffInMilliseconds / (1000 * 60));
  const diffInHours = Math.floor(diffInMinutes / 60);
  const diffInDays = Math.floor(diffInHours / 24);

  const timeString = format(messageDate, 'h:mm a');

  // Today: Show relative time (5m ago, 2h ago)
  if (isToday(messageDate)) {
    if (diffInMinutes < 1) {
      return 'Just now';
    } else if (diffInMinutes < 60) {
      return `${diffInMinutes}m ago`;
    }
    // For hours within today
    return `${diffInHours}h ago`;
  }

  // Yesterday: "Yesterday at 2:30 PM"
  if (isYesterday(messageDate)) {
    return `Yesterday at ${timeString}`;
  }

  // Within the last 7 days: "Monday at 2:30 PM"
  if (diffInDays < 7) {
    const dayName = format(messageDate, 'EEEE');
    return `${dayName} at ${timeString}`;
  }

  // Older than a week: "Jan 15, 2025 at 2:30 PM"
  const dateString = format(messageDate, 'MMM d, yyyy');
  return `${dateString} at ${timeString}`;
};

/**
 * Formats a date or timestamp into a time string in either 12-hour AM/PM or 24-hour format.
 *
 * @param {Date | number} date - The date object or timestamp to format.
 * @param {boolean} [showAmPm=true] - If true (default), uses 12-hour format with AM/PM (e.g., "2:30 PM").
 *                                    If false, uses 24-hour format (e.g., "14:30").
 * @returns {string} Formatted time string.
 *
 * @example
 * // With a Date object
 * formatTimeAmPm(new Date('2024-06-01T14:30:00Z'));
 * // => "2:30 PM"
 *
 * // With a timestamp and 24-hour format
 * formatTimeAmPm(1717233000000, false);
 * // => "14:30"
 */
export const formatTimeAmPm = (date: Date | number, showAmPm: boolean = true): string => {
  const messageDate = new Date(date);
  return format(messageDate, showAmPm ? 'h:mm a' : 'H:mm');
};

export const formatTime12HourNoAmPm = (date: Date | number): string => {
  const messageDate = new Date(date);
  return format(messageDate, 'h:mm');
};

/**
 * Format duration from milliseconds to human readable format
 * @param duration - Duration in milliseconds or string
 * @returns Formatted duration string like "1h 2m 3s" or "-" if no duration
 */
export const formatDuration = (duration?: number | string): string => {
  if (!duration) return '-';

  if (typeof duration === 'string') {
    return duration;
  }

  const seconds = Math.floor(duration / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }

  return `${seconds}s`;
};

/**
 * Format timestamp to local date and time string
 * @param timestamp - ISO timestamp string
 * @returns Formatted timestamp like "1/1/2024 2:30:00 PM" or "-" if no timestamp
 */
export const formatTimestamp = (timestamp?: string): string => {
  if (!timestamp) return '-';

  try {
    const date = new Date(timestamp);
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
  } catch {
    return timestamp;
  }
};

/**
 * Format date string for workflow step display
 * Extracted from StepDetails.tsx formatDate function with enhancements
 */
export const formatWorkflowDate = (
  dateString: string | undefined | null,
  options?: DateFormatOptions,
): string => {
  const { locale, fallbackText = 'N/A', ...intlOptions } = options || {};

  if (!dateString) {
    return fallbackText;
  }

  try {
    const date = new Date(dateString);

    // Check for invalid date
    if (isNaN(date.getTime())) {
      return fallbackText;
    }

    // Default options for readable format
    const defaultOptions: Intl.DateTimeFormatOptions = {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      ...intlOptions,
    };

    return date.toLocaleString(locale, defaultOptions);
  } catch {
    return fallbackText;
  }
};

/**
 * Format date as 'MM DD, YYYY' style, e.g. 'Dec 16, 2025'
 */
export const formatDate = (date: Date | number): string => {
  const d = new Date(date);
  return format(d, 'MMM d, yyyy');
};

/**
 * Format date for date pill separators (Slack-style)
 * - "Today" for today's date
 * - "Yesterday" for yesterday's date
 * - "Monday, January 15" for dates within the current year
 * - "Monday, January 15, 2024" for dates from previous years
 */
export const formatDatePill = (date: Date | number): string => {
  const messageDate = new Date(date);
  const now = new Date();
  const currentYear = now.getFullYear();
  const messageYear = messageDate.getFullYear();

  if (isToday(messageDate)) {
    return 'Today';
  }

  if (isYesterday(messageDate)) {
    return 'Yesterday';
  }

  if (currentYear === messageYear) {
    // Format as "Monday, January 15" for current year
    return format(messageDate, 'EEEE, MMMM d');
  }

  // Format as "Monday, January 15, 2024" for previous years
  return format(messageDate, 'EEEE, MMMM d, yyyy');
};

/**
 * Format relative time for profile display (e.g., "(10 months ago)")
 * Used for displaying tenure, join dates, etc.
 */
export const formatRelativeTimeProfile = (timestamp: number | null | undefined): string => {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();
  const diffInMs = now.getTime() - date.getTime();
  const diffInMonths = Math.floor(diffInMs / (1000 * 60 * 60 * 24 * 30.44)); // More accurate month calculation

  if (diffInMonths < 12) {
    return `(${diffInMonths} month${diffInMonths !== 1 ? 's' : ''} ago)`;
  }

  const diffInYears = Math.floor(diffInMonths / 12);
  const remainingMonths = diffInMonths % 12;

  if (remainingMonths === 0) {
    return `(${diffInYears} year${diffInYears !== 1 ? 's' : ''} ago)`;
  }

  return `(${diffInYears} year${diffInYears !== 1 ? 's' : ''}, ${remainingMonths} month${remainingMonths !== 1 ? 's' : ''} ago)`;
};

/**
 * Calculate age from birth date (e.g., "(26 Years old)")
 */
export const formatAge = (timestamp: number | null | undefined): string => {
  if (!timestamp) return '';
  const birthDate = new Date(timestamp);
  const now = new Date();
  let age = now.getFullYear() - birthDate.getFullYear();
  const monthDiff = now.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birthDate.getDate())) {
    age--;
  }
  return `(${age} Year${age !== 1 ? 's' : ''} old)`;
};
